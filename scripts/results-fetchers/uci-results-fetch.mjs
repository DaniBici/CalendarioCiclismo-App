#!/usr/bin/env node
/**
 * uci-results-fetch.mjs — FETCHER limpio de resultados de la UCI (DataRide).
 *
 * Fase 1 del plan (PLAN-resultados-web.md): dado un competitionId de carretera, recorre
 * Races → Events → Results y emite JSON NORMALIZADO listo para la BD / la web. NO toca
 * Supabase ni la web; solo descubre y normaliza (prueba de concepto end-to-end).
 *
 * Contrato (UCI-RESULTS-API.md): API en dataride.uci.ch/iframe/*, SIN navegador.
 *   - Competitions/Races/Results → POST form-urlencoded, respuesta Kendo {data,total}, EN FRÍO.
 *   - Events → POST, devuelve ARRAY crudo [...], y REQUIERE cookie de sesión (GET previo).
 *   - disciplineId carretera = 10.
 *
 * Uso (desde la raíz del repo; requiere `npm install --no-save` nada — usa fetch nativo):
 *   node scripts/results-fetchers/uci-results-fetch.mjs --competition 76394
 *   node scripts/results-fetchers/uci-results-fetch.mjs --competition 76390 --out _results_run/giro
 *   node scripts/results-fetchers/uci-results-fetch.mjs --competition 76394 --stage 2   # 1 etapa
 *   node scripts/results-fetchers/uci-results-fetch.mjs --competition 77913 --uci-race-id 265479  # 1 prueba CN
 *   node scripts/results-fetchers/uci-results-fetch.mjs --competition 76394 --pretty    # imprime a stdout
 *
 * Args:
 *   --competition  competitionId de DataRide (Dauphiné 2026 = 76394, Giro = 76390).
 *   --discipline   disciplineId (default 10 = carretera).
 *   --stage        (opcional) limitar a un nº de etapa concreto (para iterar rápido).
 *   --uci-race-id  (opcional) limitar a UNA "race" de DataRide por su race.Id (Campeonatos
 *                  Nacionales: una sola prueba dentro del competitionId del país).
 *   --out          carpeta de salida (default _results_run/comp-<id> JUNTO A ESTE script, no
 *                  relativo al cwd); escribe <comp>.json. La ruta que imprime al terminar
 *                  es la real: leer esa, no reconstruirla a mano.
 *   --reorder-names  emite riderDisplay y winnerName como "Nombre Apellido" (Title Case)
 *                  en vez del "APELLIDO Nombre" de la UCI. Para Campeonatos Nacionales,
 *                  que NO tienen startlist y se pintan verbatim (feedback_cn_rider_name_order).
 *                  Las carreras normales (resueltas por dorsal) NO lo necesitan → opt-in.
 *   --pretty       además vuelca el JSON normalizado a stdout.
 *   --delay        ms entre peticiones (default 120) para ser educados con el servidor.
 *
 * Salida: <out>/<competitionId>.json con la forma:
 *   { competitionId, disciplineId, fetchedAt, stageCount, stages: [
 *       { uciRaceId, stageNumber, stageName, dateKey, raceType, isFinalClassification,
 *         classifications: [
 *           { eventId, classKind, scope, eventName, isTeamEvent, winnerName,
 *             rows: [ { rank, rankText, bib, riderDisplay, firstName, lastName, isoCode2,
 *                       birthDate, age, teamName, resultValue, gapText, timeText,
 *                       points, irm } ] } ] } ] }
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const COMPETITION = getArg('competition');
const DISCIPLINE = getArg('discipline') || '10';
const ONLY_STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
// Caché opcional de uci-results-cron: cuando solo falta una etapa conocida evita
// repetir la llamada Races/ para descubrir toda la competición.
const TOPOLOGY = (() => {
  const raw = getArg('topology');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
})();
// --uci-race-id: limitar a UNA "race" de DataRide por su race.Id (NO el nº de etapa). Se usa
// para los Campeonatos Nacionales, donde la UCI publica todas las pruebas (línea/CRI ×
// élite/sub23 × M/F) bajo un único competitionId, cada una como una "race" con su race.Id
// propio (p. ej. 265479 = "Men Under 23 - Individual Road Race"). Cada prueba CN es una
// ficha nuestra independiente (one_day) → el link la apunta a su race.Id y aquí volcamos
// SOLO esa. La clasificación de meta de una prueba CN llega como evento "General
// Classification" → classifyEvent la mapea a classKind='gc'/scope='stage', la MISMA forma
// que ya producen los volcados PDF de los CN (FI/US/EC) y que la web renderiza para one-day.
const ONLY_UCI_RACE_ID = getArg('uci-race-id') != null ? parseInt(getArg('uci-race-id'), 10) : null;
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `comp-${COMPETITION}`);
const PRETTY = hasFlag('pretty');
const DELAY = parseInt(getArg('delay') || '120', 10);

const BASE = 'https://dataride.uci.ch/iframe';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── helpers de normalización ──────────────────────────────────────────────

// /Date(1780869600000)/ → "2026-06-08"  (YYYY-MM-DD)
// Solo se usa para BirthDate. La UCI serializa el /Date(ms)/ a MEDIANOCHE hora
// central europea → en UTC cae a las 22:00/23:00 del día ANTERIOR y truncar en
// UTC retrocede un día (mismo bug documentado abajo para las fechas de etapa;
// detectado en nacimientos al drenar el backlog: Serrano 1994-08-16 vs el real
// 1994-08-17). +3h antes de truncar recupera el día previsto (cubre CET y CEST
// y no desplaza fechas ya en UTC). Guard a 1900 (no 1990: hay corredores
// nacidos en los 80) — el sentinel "vacío" /Date(-62135596800000)/ es año 1.
function dotnetToISODate(s) {
  const m = /\/Date\((-?\d+)\)\//.exec(s || '');
  if (!m) return null;
  const d = new Date(Number(m[1]) + 3 * 3600 * 1000);
  if (isNaN(d) || d.getUTCFullYear() < 1900) return null;
  return d.toISOString().slice(0, 10);
}

function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

// ── reorder de nombres "APELLIDO Nombre" → "Nombre Apellido" (--reorder-names) ──
// La UCI/DataRide entrega el nombre en mayúsculas y apellido-primero ("NIKAČEVIĆ
// Rastko"). En los Campeonatos Nacionales NO hay startlist curada → /resultados/
// pinta el riderDisplay VERBATIM para todas las filas, así que ese orden invertido
// queda feo (ver feedback_cn_rider_name_order). Con --reorder-names el fetcher emite
// riderDisplay y winnerName ya en orden natural "Nombre Apellido" con el apellido en
// Title Case. Se reutiliza la misma heurística que uci-results-upsert.mjs (splitUci):
// tokens 100% mayúsculas (absorbiendo partículas de/van/von…) = apellido contiguo,
// el resto = nombre. Preferimos los campos separados DisplayFirstName/DisplayLastName
// cuando la UCI los trae (más fiable); si no, partimos el DisplayName invertido.
const REORDER_NAMES = hasFlag('reorder-names');
const _PARTICLE = /^(de|del|della|der|den|van|von|da|di|do|dos|das|la|le|el|al|bin|ben|mac|mc|ter|ten|zur|zum)$/i;
function titleCaseName(t) {
  return (t || '').split(/([ -])/).map((part) => {
    if (part === ' ' || part === '-') return part;
    return part.replace(/\p{L}[\p{L}'’]*/gu, (w) => {
      const lw = w.toLocaleLowerCase();
      if (_PARTICLE.test(w)) return lw;
      return lw.replace(/(^|['’])(\p{L})/gu, (_, p, c) => p + c.toLocaleUpperCase());
    });
  }).join('');
}
function splitUciDisplay(display) {
  const str = clean(display);
  if (!str) return { first: '', last: '' };
  const tokens = str.split(' ');
  const isUpper = (t) => /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t);
  let i = 0;
  const lastTokens = [];
  while (i < tokens.length) {
    if (isUpper(tokens[i])) { lastTokens.push(tokens[i]); i++; continue; }
    if (_PARTICLE.test(tokens[i]) && i + 1 < tokens.length && isUpper(tokens[i + 1])) { lastTokens.push(tokens[i]); i++; continue; }
    break;
  }
  if (lastTokens.length === 0) { lastTokens.push(tokens[0]); i = 1; }
  if (i >= tokens.length && lastTokens.length > 1) { i = lastTokens.length - 1; lastTokens.length = i; }
  return { first: tokens.slice(i).join(' '), last: lastTokens.map(titleCaseName).join(' ') };
}
// "Nombre Apellido" a partir de campos separados (preferente) o del display invertido.
function naturalName(display, firstRaw, lastRaw) {
  let first = clean(firstRaw), last = clean(lastRaw);
  if (!first || !last) { const sp = splitUciDisplay(display); first = first || sp.first; last = last || sp.last; }
  // El apellido viene en MAYÚSCULAS de la UCI → Title Case respetando partículas.
  last = titleCaseName(last);
  const out = `${first} ${last}`.replace(/\s+/g, ' ').trim();
  return out || clean(display);
}

// Campo "Date" textual de DataRide: "08 Jun 2026" → "2026-06-08".
// IMPORTANTE: preferir SIEMPRE este campo a derivarlo de StartDate /Date(ms)/, que viene a
// medianoche hora central europea y al pasar a UTC retrocede un día (Stage 2 → 07 en vez de 08).
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function textDateToISO(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(clean(s));
  if (!m) return null;
  const mo = MONTHS[m[2].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// EventName ("Stage General Classification" / "Overall Points Classification") → {classKind, scope}
//   classKind: stage | gc | points | kom | youth | teams | sprint | other
//   (sprint = metas volantes; other = secundaria desconocida. Ambas se ingieren
//   pero JAMÁS son keepForWeb — whitelist en la migración 092.)
//   scope:     stage (resultado de esta etapa) | overall (acumulado tras esta etapa)
//
// El classKind se deduce SIEMPRE del nombre, NUNCA de IsTeamEvent. Motivo: en una CRE
// (crono por equipos) la UCI marca IsTeamEvent=true en TODOS los eventos de esa etapa
// —incluidas la general, los puntos y la montaña— y a veces con el RaceTypeCode mal
// (Dauphiné: una CRE clarísima viene como ITT). Si dejáramos que IsTeamEvent forzara
// classKind='teams', colapsaríamos las 6 clasificaciones de la etapa en "teams" y
// perderíamos la distinción stage/gc/points/youth (caso real: Tour de Japón 2026 et.4).
// Solo es 'teams' una clasificación de equipos DE VERDAD, cuyo nombre dice "Team(s)
// Classification". La verdadera CRE de etapa es la "Stage Classification" (classKind
// 'stage'); el render la colapsa a una fila por equipo al detectar el patrón (un solo
// corredor con rank por equipo). isTeamEvent se conserva como metadato aparte (lo
// guarda el fetcher en cl.isTeamEvent), pero NO entra aquí.
function classifyEvent(eventName) {
  const n = clean(eventName).toLowerCase();
  const scope = /^overall/.test(n) ? 'overall' : 'stage';
  let classKind;
  if (/\bteams?\b/.test(n)) classKind = 'teams';
  else if (/general classification/.test(n)) classKind = 'gc';
  else if (/mountain/.test(n)) classKind = 'kom';
  else if (/point/.test(n)) classKind = 'points';
  else if (/youth/.test(n)) classKind = 'youth';
  // Metas volantes ("Sprint Classification" y variantes Stage/Overall, Tour de
  // Lituania). Kind propio, NUNCA visible (keepForWeb whitelist, migración 092):
  // la web/apps no tienen pestaña para él. Antes caía al catch-all de 'stage' y
  // se colaba como resultado de etapa con puntos.
  else if (/sprint/.test(n)) classKind = 'sprint';
  // El resultado de etapa real es EXACTAMENTE "Stage Classification" (120/120 en
  // las 22 vueltas volcadas); alias defensivos de final/un-día. El catch-all
  // antiguo (/classification/ sin general|mountain|point|youth) tragaba CUALQUIER
  // clasificación secundaria desconocida (sprint, combatividad…) como 'stage'
  // visible → prohibido. Lo desconocido cae a 'other' (se ingiere, no se pinta).
  else if (/^(stage|final) classification$/.test(n) || /^(final )?result$/.test(n)) classKind = 'stage';
  else classKind = 'other';
  return { classKind, scope };
}

// ResultValue: "9:27:40" (tiempo del 1º) | "+32" | "+35:09" | "+43:59" (gaps) | "" (DNF)
//   → { timeText, gapText }: el ganador tiene timeText; el resto gapText.
function parseResultValue(v, rank) {
  const s = clean(v);
  if (!s) return { timeText: null, gapText: null };
  if (s.startsWith('+')) return { timeText: null, gapText: s };
  // sin '+': es un tiempo absoluto (típicamente el rank 1, o resultados de crono individuales)
  return { timeText: s, gapText: null };
}

// "H:MM:SS" | "MM:SS" | "SS" → segundos (o null). Para detectar gaps disfrazados.
export function _toSeconds(txt) {
  if (!txt) return null;
  const p = String(txt).trim().split(':').map(Number);
  if (p.some(Number.isNaN)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
}
// Tiempo en NOTACIÓN DE PRENSA de la UCI → segundos (o null). Formato:
// "3h 00'02\"" (H h M'SS"), "20'52\"" (M'SS"), "42\"" (SS"). Es una variante del
// ResultValue que la UCI empezó a publicar en algunas carreras (Memorial
// Trochanowski 2026, comp 77761): en vez del clásico "ganador=3:00:02, resto=+gap",
// manda el TIEMPO ABSOLUTO de CADA corredor ya formateado con h/'/". _toSeconds no
// lo parsea (no hay ':') → quedaría todo como timeText sin gaps ni m.t.
export function _pressToSeconds(txt) {
  if (!txt) return null;
  const s0 = String(txt);
  // Exige al menos UN marcador de unidad (h/'/") → un entero suelto "12" NO cuela.
  if (!/[h'"]/.test(s0)) return null;
  const m = /^\s*(?:(\d+)\s*h\s*)?(?:(\d+)\s*')?\s*(\d+)\s*"?\s*$/.exec(s0);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0, mm = m[2] ? Number(m[2]) : 0, s = Number(m[3]);
  if ([h, mm, s].some(Number.isNaN)) return null;
  return h * 3600 + mm * 60 + s;
}
// Post-proceso por clasificación por tiempo: la UCI a veces manda los gaps SIN
// '+' en formato HH:MM:SS ("00:00:01" = +1s), que normalizeRow tomó como timeText.
// Señal segura: en una etapa por tiempo, un rank>1 NUNCA puede tener un tiempo
// menor que el ganador → si lo tiene, su valor es un GAP. Mueve timeText→gapText.
export function fixDisguisedGaps(rows, isTeamEvent) {
  if (isTeamEvent) return rows;
  const winner = rows.find((r) => r.rank === 1 && !r.irm);
  const winnerSec = _toSeconds(winner && winner.timeText);
  if (winnerSec == null) return rows;
  const disguised = rows.some((r) => r.rank != null && r.rank !== 1 && !r.irm
    && _toSeconds(r.timeText) != null && _toSeconds(r.timeText) < winnerSec);
  if (!disguised) return rows;
  return rows.map((r) => {
    if (r.rank == null || r.rank === 1 || r.irm) return r;
    const sec = _toSeconds(r.timeText);
    if (sec == null) return r;
    // Reescribir como gap "+SS"/"+MM:SS"/"+H:MM:SS" y limpiar timeText.
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const gap = h > 0 ? `+${h}:${mm}:${String(s).padStart(2, '0')}` : `+${mm}:${String(s).padStart(2, '0')}`;
    return { ...r, timeText: null, gapText: gap };
  });
}

// segundos → gap "+SS"/"+MM:SS"/"+H:MM:SS" (la web/apps lo normalizan a notación de prensa).
function _secsToGap(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `+${h}:${mm}:${String(s).padStart(2, '0')}` : `+${mm}:${String(s).padStart(2, '0')}`;
}

// Post-proceso por clasificación por tiempo: la corrupción ESPEJO de fixDisguisedGaps.
// Algunos feeds de la UCI (vistos en Campeonatos Nacionales en circuito: EE.UU. línea
// masc/fem 2026) publican en ResultValue el TIEMPO ABSOLUTO de cada corredor con un '+'
// delante → parseResultValue lo tomó como gapText. Señal SEGURA (que NO confunde con una
// clasificación normal ni con basura suelta tipo prólogo de El Salvador): el MEJOR
// clasificado tras el ganador (rank más bajo > 1) tiene un "gap" que YA es ≥ el tiempo
// TOTAL del ganador. Eso es imposible para un gap real (el 2º no puede estar 3 h detrás en
// una carrera de 3 h) → toda la columna son tiempos absolutos. Entonces, por fila rank>1
// sin irm con gapText:
//   · abs ≥ ganador → terminó: gap REAL = abs − ganador (reescribe gapText).
//   · abs < ganador → NO completó la distancia (en circuito la UCI le da el tiempo de la
//     última vuelta cruzada, pero no terminó la prueba) → ABANDONO no marcado por la UCI:
//     lo marcamos (irm='DNF', sin puesto ni tiempo), igual que un DNF nativo.
export function fixInvertedAbsoluteGaps(rows, isTeamEvent) {
  if (isTeamEvent) return rows;
  const winner = rows.find((r) => r.rank === 1 && !r.irm);
  const winnerSec = _toSeconds(winner && winner.timeText);
  if (winnerSec == null) return rows;
  const gapSec = (r) => (r.gapText ? _toSeconds(String(r.gapText).replace(/^\+/, '')) : null);
  // Mejor clasificado tras el ganador con gap parseable (rank más bajo > 1).
  const top = rows
    .filter((r) => r.rank != null && r.rank !== 1 && !r.irm && gapSec(r) != null)
    .reduce((best, r) => (best == null || r.rank < best.rank ? r : best), null);
  // Disparo SOLO si su gap ya es ≥ el tiempo total del ganador (toda la columna es absoluta).
  if (top == null || gapSec(top) < winnerSec) return rows;
  return rows.map((r) => {
    if (r.rank == null || r.rank === 1 || r.irm) return r;
    const abs = gapSec(r);
    if (abs == null) return r;
    // No completó la distancia → abandono (misma forma que un DNF de la UCI).
    if (abs < winnerSec) return { ...r, rank: null, rankText: 'DNF', irm: 'DNF', timeText: null, gapText: null };
    return { ...r, timeText: null, gapText: _secsToGap(abs - winnerSec) };
  });
}

// Post-proceso por clasificación por tiempo: la variante de la UCI en la que el
// ResultValue de CADA corredor es su TIEMPO ABSOLUTO en NOTACIÓN DE PRENSA
// ("3h 00'02\""), no el clásico "ganador=absoluto, resto=+gap". parseResultValue lo
// dejó como timeText en todas las filas → sin gaps ni m.t. (todos con el mismo
// tiempo). Caso real: Memorial Andrzej Trochanowski 2026 (comp 77761), donde el
// grupo compacto de 119 quedó con "3h 00'02\"" idéntico. Señal SEGURA (no la
// confunde con una crono, donde cada uno tiene su tiempo real): el ganador (rank 1)
// y TODOS los rank>1 clasificados traen timeText en este formato de prensa. Se deja
// al ganador su timeText y al resto se le calcula el gap real; el que empata con el
// ganador queda a +0" → la web/apps lo pintan como m.t./s.t.
export function fixPressFormattedAbsolute(rows, isTeamEvent) {
  if (isTeamEvent) return rows;
  const winner = rows.find((r) => r.rank === 1 && !r.irm);
  const winnerSec = _pressToSeconds(winner && winner.timeText);
  if (winnerSec == null) return rows;
  // Todos los clasificados tras el ganador deben venir en notación de prensa (si
  // alguno trae ':' o un gap explícito, no es esta variante → no tocar nada).
  const rest = rows.filter((r) => r.rank != null && r !== winner && !r.irm);
  if (!rest.length || rest.some((r) => r.gapText || _pressToSeconds(r.timeText) == null)) return rows;
  return rows.map((r) => {
    if (r === winner || r.rank == null || r.irm) return r;   // ganador y abandonos intactos
    const abs = _pressToSeconds(r.timeText);
    if (abs == null) return r;
    // abs < ganador es imposible en una prueba por tiempo (no puede acabar antes que
    // el 1º) → dato corrupto: lo dejamos como está en vez de inventar un gap negativo.
    if (abs < winnerSec) return r;
    return { ...r, timeText: null, gapText: _secsToGap(abs - winnerSec) };
  });
}

function normalizeRow(r) {
  const rankText = clean(r.Rank) || (r.Irm ? clean(r.Irm) : '');
  const rankNum = /^\d+$/.test(clean(r.Rank)) ? parseInt(r.Rank, 10) : null;
  const { timeText, gapText } = parseResultValue(r.ResultValue, rankNum);
  const rawDisplay = clean(r.DisplayName) || clean(r.IndividualDisplayName) || null;
  const fName = clean(r.DisplayFirstName) || clean(r.IndividualFirstName) || null;
  const lName = clean(r.DisplayLastName) || clean(r.IndividualLastName) || null;
  return {
    rank: rankNum,
    rankText,
    bib: clean(r.Bib) || null,
    // riderDisplay: con --reorder-names, "Nombre Apellido" (CN sin startlist); si no,
    // el "APELLIDO Nombre" verbatim de la UCI (el resto del pipeline lo resuelve por dorsal).
    riderDisplay: (REORDER_NAMES && rawDisplay) ? naturalName(rawDisplay, fName, lName) : rawDisplay,
    firstName: fName,
    lastName: lName,
    isoCode2: (clean(r.IsoCode2) || clean(r.IndividualCountryIsoCode2) || '').toLowerCase() || null,
    birthDate: dotnetToISODate(r.BirthDate),
    age: clean(r.Age) ? parseInt(r.Age, 10) : null,
    teamName: clean(r.TeamName) || null,
    resultValue: clean(r.ResultValue) || null,
    timeText,
    gapText,
    points: r.PointPcR != null ? Number(r.PointPcR) : null,
    irm: clean(r.Irm) || null, // DNF / DNS / OTL / DSQ …
  };
}

// ── cliente HTTP (fetch nativo) ───────────────────────────────────────────

let COOKIE = '';
async function seedCookie() {
  // GET a la home → guardar Set-Cookie (necesario SOLO para /Events/).
  const res = await fetch('https://dataride.uci.ch/', { headers: { 'User-Agent': UA } });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  COOKIE = (sc || []).map((c) => c.split(';')[0]).join('; ');
  log(`  cookie sembrada (${COOKIE ? COOKIE.split(';').length + ' cookies' : 'ninguna'})`);
}

async function post(path, formObj, { needCookie = false } = {}) {
  const body = new URLSearchParams(formObj).toString();
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': UA,
  };
  if (needCookie && COOKIE) headers['Cookie'] = COOKIE;
  const res = await fetch(`${BASE}/${path}`, { method: 'POST', headers, body });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* no-op */ }
  return { status: res.status, json, text };
}

// ── pipeline ──────────────────────────────────────────────────────────────

async function main() {
  if (!COMPETITION) { log('FATAL: falta --competition <id>'); process.exit(1); }
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher de resultados — competitionId=${COMPETITION} disciplineId=${DISCIPLINE}`);
  await seedCookie();

  // 1) Etapas de la competición. Para una etapa concreta, reutilizar la
  // topología persistida por el cron si contiene su raceId DataRide; el fallback
  // conserva el descubrimiento normal si la caché quedó vieja o incompleta.
  const cachedStages = ONLY_STAGE != null && TOPOLOGY?.source === 'uci'
    ? (TOPOLOGY.stages || []).filter((st) => Number(st.stageNumber) === ONLY_STAGE && Number(st.uciRaceId) > 0)
    : [];
  let races;
  if (cachedStages.length) {
    races = cachedStages.map((st) => ({
      Id: Number(st.uciRaceId), RaceName: st.stageName, Date: st.dateKey,
      RaceTypeCode: st.raceType, StartLocation: null,
    }));
    log(`Etapas: 1 (caché de topología)`);
  } else {
    const racesRes = await post('Races/', {
      disciplineId: DISCIPLINE, competitionId: COMPETITION,
      take: 60, skip: 0, page: 1, pageSize: 60,
    });
    races = (racesRes.json && racesRes.json.data) || [];
    log(`Etapas: ${races.length}`);
    if (!races.length) { log('⚠️  0 etapas — ¿competitionId correcto? ¿disciplina correcta?'); }
  }

  // CN: quedarnos SOLO con la "race" cuyo race.Id pidió --uci-race-id (la prueba concreta).
  const racesToWalk = ONLY_UCI_RACE_ID != null ? races.filter((r) => r.Id === ONLY_UCI_RACE_ID) : races;
  if (ONLY_UCI_RACE_ID != null) {
    if (!racesToWalk.length) log(`⚠️  --uci-race-id ${ONLY_UCI_RACE_ID} no está entre las ${races.length} races de la competición ${COMPETITION} (¿aún no publicada?)`);
    else log(`Filtrado a la prueba race.Id=${ONLY_UCI_RACE_ID}: «${clean(racesToWalk[0].RaceName)}»`);
  }

  // Doble sector: la UCI publica un día con 2 sectores como "Stage 3A"/"Stage 3B".
  // Nuestras jornadas (race_days) los modelan como DOS filas con el MISMO entero
  // stageNumber (3) y mismo dateKey, distinguidas por la hora de salida (el sufijo
  // A/B es de runtime). Por eso NO se renumeran: ambos sectores conservan su
  // stageNumber base (3) y se distinguen por `sectorIndex` (0=A, 1=B, …), que
  // uci-results-upsert usa para resolver el raceDayId de la jornada correcta
  // (offset dentro de las jornadas de ese stageNumber ordenadas por hora).
  const stages = [];
  for (const race of racesToWalk) {
    const stageName = clean(race.RaceName);                 // "Stage 2" | "Stage 3A" | "Final Classification" | "Prologue" | "Men Under 23 - Individual Road Race"
    const isFinal = /final classification/i.test(stageName);
    const mStage = /stage\s+(\d+)\s*([a-z])?/i.exec(stageName);
    const stageNumber = isFinal ? null
      : (mStage ? parseInt(mStage[1], 10) : (/prologue/i.test(stageName) ? 0 : null));
    // sectorIndex: 0 para A / etapas sin sector; 1 para B; etc. null = sin letra.
    const sectorIndex = (mStage && mStage[2]) ? (mStage[2].toUpperCase().charCodeAt(0) - 65) : null;

    if (ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;

    // 2) Eventos (clasificaciones) de la etapa — NECESITA cookie.
    await sleep(DELAY);
    const evRes = await post('Events/', { disciplineId: DISCIPLINE, raceId: race.Id }, { needCookie: true });
    const events = Array.isArray(evRes.json) ? evRes.json : [];

    const classifications = [];
    for (const ev of events) {
      const { classKind, scope } = classifyEvent(ev.EventName);
      // 3) Filas de resultados del evento.
      await sleep(DELAY);
      const resRes = await post('Results/', {
        disciplineId: DISCIPLINE, eventId: ev.EventId,
        take: 300, skip: 0, page: 1, pageSize: 300,
      });
      const rows = fixPressFormattedAbsolute(fixInvertedAbsoluteGaps(fixDisguisedGaps(
        ((resRes.json && resRes.json.data) || []).map(normalizeRow)
          // (saneo 2026-06-11) etapa cancelada: la UCI publica UNA fila-marcador
          // "Race Cancelled" que acababa enlazada a una ficha fantasma
          // 'race-cancelled' (Murcia E2, Setmana Valenciana E3 2026). Se filtra:
          // una clasificación que quede vacía no se muestra (rowCount 0).
          .filter((r) => !/^race\s+cancelled/i.test(r.riderDisplay || '')),
        !!ev.IsTeamEvent,
      ), !!ev.IsTeamEvent), !!ev.IsTeamEvent);
      classifications.push({
        eventId: ev.EventId,
        classKind, scope,
        eventName: clean(ev.EventName),
        // (saneo 2026-06-11) isTeamEvent NO se copia ciego de DataRide: la UCI
        // marca IsTeamEvent=true en TODAS las clasificaciones de un día CRE
        // (gc/puntos/montaña/jóvenes incluidas, que son individuales — ambos
        // resolve las saltaban y jornadas enteras quedaban sin enlazar:
        // París-Niza E3, Tour de Feminin E1, Tour de Japón E4) y en CREs de
        // un día tipadas TTT enteras (Trofeo Ses Salines 2026). Convención
        // del pipeline (precedente ARA/Dauphiné E3): filas de corredor →
        // false; SOLO la clasificación de equipos es team-event. Para kinds
        // desconocidos ('other') se respeta el flag UCI: podría ser una
        // clasificación por equipos rara cuyo "bib" no es dorsal de corredor.
        isTeamEvent: classKind === 'teams' ? true
                   : (classKind === 'other' ? !!ev.IsTeamEvent : false),
        // winnerName: con --reorder-names, "Nombre Apellido" (la UCI no trae el ganador
        // partido en campos → se parte el WinnerName invertido con la misma heurística).
        winnerName: REORDER_NAMES
          ? (clean(ev.WinnerName) ? naturalName(ev.WinnerName, null, null) : null)
          : (clean(ev.WinnerName) || null),
        rowCount: rows.length,
        rows,
      });
      log(`    ${stageName.padEnd(20)} ${(scope + '/' + classKind).padEnd(14)} ${String(rows.length).padStart(3)} filas  (event ${ev.EventId})`);
    }

    stages.push({
      uciRaceId: race.Id,
      stageNumber,
      sectorIndex,   // 0=A · 1=B · … (doble sector); null = sin sector
      stageName,
      isFinalClassification: isFinal,
      dateKey: textDateToISO(race.Date) || dotnetToISODate(race.StartDate),  // Date textual primero (huso correcto)
      raceType: clean(race.RaceTypeCode) || null,   // IRR (línea), ITT (crono indiv), TTT (crono equipos)…
      startLocation: clean(race.StartLocation) || null,
      classificationCount: classifications.length,
      classifications,
    });
  }

  const out = {
    competitionId: Number(COMPETITION),
    disciplineId: Number(DISCIPLINE),
    fetchedAt: new Date().toISOString(),
    stageCount: stages.length,
    stages,
  };

  const file = join(OUT, `${COMPETITION}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`\n✅ ${stages.length} etapas, ${stages.reduce((a, s) => a + s.classificationCount, 0)} clasificaciones → ${file}`);
  if (PRETTY) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// Solo ejecuta al invocarlo directamente (no al importarlo desde los tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
