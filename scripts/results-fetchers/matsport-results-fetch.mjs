#!/usr/bin/env node
/**
 * matsport-results-fetch.mjs — FETCHER de resultados desde MATSPORT
 * (api.cycling.matsport.com), el cronometrador de muchas carreras francesas y
 * algunas belgas/europeas (Tour Féminin des Pyrénées, Dunkerque, Poitou-Charentes,
 * Isbergues, Marsellesa, Denain, Morbihan, Luxemburgo…). Publica en vivo durante
 * la etapa y valida minutos después de meta — mucho antes que UCI DataRide
 * (que en estas carreras pequeñas puede tardar días o no llegar).
 *
 * EMITE EXACTAMENTE EL MISMO JSON que dataride-results-fetch.mjs → el upsert
 * (results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source ('uci'|'tissot'|'pdf'|'matsport', migración 101) vía
 * results-cron.mjs.
 *
 * API MATSPORT (sin auth; misma API que la skill usa para startlists):
 *   GET /competitions/{id}        → metadatos + stages[] + teams[] (con riders/bibs)
 *   GET /stages/{stageId}         → rankingTypes[] con las clasificaciones EMBEBIDAS
 *   ⚠ Los filtros query ($ilike, etc.) se IGNORAN (devuelve todo) → filtrar en cliente.
 *   ⚠ El payload de /stages pesa ~2 MB (roads/groups/timeline) → solo se usa rankingTypes.
 *   Convención de IDs: {año}_{código3letras} ("2026_PYF") y {compId}_STAGE_NN.
 *
 * MAPEO rankingType → contrato UCI (whitelist; el resto se descarta, espíritu 092):
 *   ITE → stage/stage  · ITG → gc/stage ("Stage General", GC del día, como Tissot)
 *   IJE → youth/stage  · ETE → teams/stage (filas de equipo)
 *   IPG → points/overall · IMG → kom/overall · IJG → youth/overall · ETG → teams/overall
 *   Descartados: IPE/IME/IPA (sprints/puertos/pasos intermedios), PAS/CLM (puntos de
 *   paso), RPM/RPP (penalidades), *_JERSEY/*_WEARER (porteadores).
 *   Carrera terminada (la ÚLTIMA etapa tiene ITE publicado) → se emite además la
 *   pseudo-etapa "Final Classification" (stageNumber NULL, isFinalClassification=true,
 *   scope='stage' — mismo quirk que la UCI, migración 085) clonando las generales
 *   de la última etapa.
 *
 * FILAS: Matsport NO incluye nombres en las filas (solo bib + position + capital +
 *   gap + status) → el display se reconstruye desde competitions.teams[].riders por
 *   dorsal ("APELLIDO Nombre", formato UCI). Da igual que Matsport pierda acentos:
 *   el corredor REAL se resuelve POR DORSAL contra la startlist curada (RPC 082) y
 *   el display es solo fallback. Filas de EQUIPO (ETE/ETG): su `bib` es el NÚMERO DE
 *   EQUIPO (== teams[].position, verificado: equipo 4 = dorsales 31-36) → se traduce
 *   a nombre de equipo y el bib se emite NULL (un bib de equipo casaría por error
 *   con un dorsal de corredor en resolve_uci_results).
 *
 * NORMALIZACIÓN: capital "10:15:27" (absoluto, ya en formato BD; Matsport también
 * puede añadir centésimas o un punto final, que se truncan) · gap "+00"→"+0",
 *   "+05"→"+5", "+1:22"/"+1:02:03" tal cual · puntos "61 pts"→"61" en resultValue ·
 *   status francés → IRM UCI: AB→DNF · NP→DNS · HD→OTL · DSQ/EX→DSQ (desconocidos
 *   se conservan en crudo, mayúsculas).
 *
 * IDs SINTÉTICOS: Matsport no existe en DataRide → eventId/uciRaceId NEGATIVOS y
 *   deterministas (mismo esquema que Tissot/PDF, salt propio "matsport:"):
 *   fnv1a("matsport:"+compId)%200000 como base, eventId = -(base*10000 + slot*100 + idx).
 *   El competitionId del puente también es sintético negativo (-base), como en PDF.
 *   ⚠ Al conmutar la fuente de una carrera ya volcada, la purga de gemelas del
 *   upsert (090) reemplaza los placeholders automáticamente.
 *
 * Solo se emiten etapas TERMINADAS (con ITE publicado); la ventana de meta del
 * cron (087) ya garantiza que se consulta cuando toca.
 *
 * CRONOS SUELTAS (--matsport-stage, Chrono des Nations): Matsport NO publica ITE;
 *   la meta sale en PAS_A («Arrivée», una fila por corredor que ha llegado) y no
 *   hay bandera de prueba terminada. Se da por terminada cuando los TRES ÚLTIMOS
 *   EN SALIR de la categoría ya figuran en PAS_A (ver tailStartersFinished); hasta
 *   entonces no se emite nada (una clasificación parcial se publicaría como final).
 *   Si los últimos en salir son bajas que Matsport no marca (sin fila ni status), se
 *   cierra cuando nadie está en carrera (RUN_A vacío) y su llegada esperada venció
 *   hace más de 10 min, o la prueba es de un día anterior.
 *   Al emitirse, el cuadro lleva publication {format:'fixed', sourceStatus:'official'}
 *   (como EvoData en las cronos cerradas): se publica oficial sin lecturas estables.
 *
 * COMPETICIÓN MULTIPRUEBA (--matsport-stage N): Matsport agrupa bajo un mismo id
 *   varias pruebas independientes de un día como «etapas» (Chrono des Nations:
 *   2026_HER con una etapa por categoría, la 7 = hombres élite, la 6 = mujeres,
 *   la 5 = sub23 hombres). Con --matsport-stage solo se procesa esa etapa y se
 *   trata como carrera de UN DÍA (stageNumber NULL, gc/stage, sin complementarias),
 *   y la semilla de los IDs sintéticos pasa a "<comp>#<etapa>" para que cada
 *   prueba tenga su propio competitionId. Sin él, nada cambia. Tiene precedencia
 *   sobre --stage (nº de etapa de una carrera por etapas).
 *
 * Uso (desde la raíz del repo; fetch nativo, sin deps):
 *   node scripts/results-fetchers/matsport-results-fetch.mjs --competition 2026_PYF --competition-id -123456
 *   node scripts/results-fetchers/matsport-results-fetch.mjs --competition 2026_PYF --competition-id -123456 --stage 1
 *
 * Args:
 *   --competition     id de Matsport: {año}_{código} ("2026_PYF").
 *   --competition-id  competitionId del puente race_uci_links (sintético NEGATIVO;
 *                     obligatorio: el JSON lo lleva para que el upsert NO recablee
 *                     el puente; también nombra el archivo de salida <id>.json).
 *                     Convención: -(fnv1a("matsport:"+compId)%200000) — lo imprime
 *                     este script si se pasa --suggest-id.
 *   --stage           (opcional) limitar a un nº de etapa.
 *   --matsport-stage  (opcional) etapa de Matsport que es la carrera completa en una
 *                     competición multiprueba (ver arriba). Entra en --suggest-id.
 *   --out             carpeta de salida (default _results_run/matsport-<comp> JUNTO A ESTE
 *                     script, no relativo al cwd). La ruta que imprime al terminar es la
 *                     real: leer esa, no reconstruirla a mano.
 *   --pretty          además vuelca el JSON a stdout.
 *   --delay           ms entre peticiones (default 150).
 *   --assume-closed   da por terminada una crono sin ITE aunque falten los últimos en salir
 *                     (bajas confirmadas por el organizador); solo con --matsport-stage y PAS_A.
 *   --timezone        zona IANA de las horas que publica Matsport (default Europe/Paris).
 *   --suggest-id      imprime el competitionId sintético sugerido y sale.
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fnv1aCodeUnits as fnv1a } from './pdf-results-ids.mjs';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const COMP = getArg('competition');                 // "2026_PYF"
const COMPETITION_ID = getArg('competition-id');    // sintético negativo (puente race_uci_links)
const ONLY_STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
// Prueba (etapa de Matsport) que constituye la carrera entera en una competición
// multiprueba. NULL = comportamiento por etapas / carrera de un día de una sola etapa.
const MATSPORT_STAGE = getArg('matsport-stage') != null ? parseInt(getArg('matsport-stage'), 10) : null;
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `matsport-${COMP}`);
const PRETTY = hasFlag('pretty');
const DELAY = parseInt(getArg('delay') || '150', 10);
const ASSUME_CLOSED = hasFlag('assume-closed');   // cierre manual de una crono con bajas confirmadas (solo --matsport-stage)
const TIMEZONE = getArg('timezone') || 'Europe/Paris';   // zona de las horas de Matsport (cierre de cronos con bajas sin marcar)

const BASE = 'https://api.cycling.matsport.com';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const HTTP_TIMEOUT_MS = 20_000;
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── IDs sintéticos (negativos, deterministas; salt "matsport:") ────────────
// ≤199999 → eventId > -2^31 garantizado. Sin --competition queda NaN: solo lo usa
// main(), que valida los args antes (importar el módulo desde un test no ejecuta nada).
export function matsportIdSeed(comp, stage = null) {
  return stage == null ? `matsport:${comp}` : `matsport:${comp}#${stage}`;
}
const ID_BASE = COMP ? fnv1a(matsportIdSeed(COMP, MATSPORT_STAGE)) % 200000 : NaN;

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (!COMP) { log('FATAL: falta --competition <id matsport, p.ej. 2026_PYF>'); process.exit(1); }
  if (getArg('matsport-stage') != null && !(Number.isInteger(MATSPORT_STAGE) && MATSPORT_STAGE > 0)) {
    log('FATAL: --matsport-stage debe ser un entero positivo (nº de etapa de la competición multiprueba)');
    process.exit(1);
  }
  if (hasFlag('suggest-id')) {
    process.stdout.write(String(-ID_BASE) + '\n');
    process.exit(0);
  }
  if (!COMPETITION_ID || !/^-\d+$/.test(COMPETITION_ID)) {
    log(`FATAL: falta --competition-id <entero NEGATIVO sintético> (sugerido para ${COMP}: ${-ID_BASE})`);
    process.exit(1);
  }
}

const FINAL_SLOT = 99;                              // pseudo-etapa "Final Classification"
// idx fijo por (classKind, scope) — mismo cuadro que el fetcher de Tissot.
const CLASS_IDX = {
  'stage/stage': 1, 'gc/stage': 2,
  'points/overall': 3, 'kom/overall': 4, 'youth/overall': 5, 'teams/overall': 6,
  'points/stage': 7, 'kom/stage': 8, 'youth/stage': 9, 'teams/stage': 10,
  'other/stage': 11, 'other/overall': 12,
};
const synthRaceId = (slot) => -(ID_BASE * 10000 + slot * 100);
const synthEventId = (slot, kind, scope) => -(ID_BASE * 10000 + slot * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 12));

// ── normalización ───────────────────────────────────────────────────────────
// Exportadas para tests (scripts/__tests__/matsport-results-fetch.test.js). El script sigue
// siendo ejecutable: main() solo corre si se invoca directamente (ver pie del fichero).
export function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

// status francés de Matsport → códigos IRM UCI (los que entiende js/results/uci-irm.js).
const IRM_MAP = { AB: 'DNF', ABD: 'DNF', NP: 'DNS', DNS: 'DNS', HD: 'OTL', OTL: 'OTL', DSQ: 'DSQ', EX: 'DSQ', DNF: 'DNF' };
export function irmOf(status) {
  const st = clean(status).toUpperCase();
  if (!st) return null;
  return IRM_MAP[st] || st;
}

// gap Matsport → estilo UCI en BD: "+00"→"+0" · "+05"→"+5" · "+1:22" tal cual.
export function normGap(g) {
  const v = clean(g);
  if (!v || !v.startsWith('+')) return null;
  const body = v.slice(1);
  if (!/^[\d:]+$/.test(body)) return null;
  const parts = body.split(':').map((p, i) => (i === 0 ? String(parseInt(p, 10)) : p));
  return '+' + parts.join(':');
}

const toSecs = (t) => t.split(':').reduce((a, p) => a * 60 + Number(p), 0);
// segundos de diferencia → gap estilo BD ("+5", "+1:22", "+1:02:03").
export function fmtGapSecs(n) {
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  if (h) return `+${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  if (m) return `+${m}:${String(sec).padStart(2, '0')}`;
  return `+${sec}`;
}

// capital "10:15:27" / "2:53:41" → formato BD. Matsport puede enviar
// "26:49.95" o "12:10:10."; se truncan las fracciones porque el contrato de
// resultados de carretera trabaja con segundos enteros. "61 pts" → null.
export function normAbsTime(v) {
  const t = clean(v);
  const m = /^(\d+(?::\d{2}){1,2})(?:\.\d*)?$/.exec(t);
  return m ? m[1] : null;
}

// "61 pts" / "61" → "61"
export function normPoints(v) {
  const m = /^(\d+)\s*(pts?)?$/i.exec(clean(v));
  return m ? m[1] : null;
}

// Gap de una fila de tiempos. Con décimas ("+03.50", "+1:00.61") normGap devuelve
// null; se reconstruye como diferencia de los tiempos ya truncados para que gap y
// tiempos cuadren entre sí.
function gapOf(r, abs, winnerSecs) {
  const g = normGap(r.gap);
  if (g) return g;
  if (abs && winnerSecs != null && /\./.test(clean(r.gap))) return fmtGapSecs(toSecs(abs) - winnerSecs);
  return null;
}

// ── (rankingType) → {classKind, scope, eventName, mapper} ───────────────────
const TYPE_MAP = {
  ITE: { classKind: 'stage',  scope: 'stage',   eventName: 'Stage Classification', time: true },
  ITG: { classKind: 'gc',     scope: 'stage',   eventName: 'Stage General Classification', time: true },
  IJE: { classKind: 'youth',  scope: 'stage',   eventName: 'Stage Youth Classification', time: true },
  ETE: { classKind: 'teams',  scope: 'stage',   eventName: 'Stage Teams Classification', time: true, teamRows: true },
  IPG: { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification' },
  IMG: { classKind: 'kom',    scope: 'overall', eventName: 'Overall Mountain Classification' },
  IJG: { classKind: 'youth',  scope: 'overall', eventName: 'Overall Youth Classification', time: true },
  ETG: { classKind: 'teams',  scope: 'overall', eventName: 'Overall Teams Classification', time: true, teamRows: true },
};

// ── filas ───────────────────────────────────────────────────────────────────
// riderByBib: Map(bib → {display, teamName}); teamByNumber: Map(position → name).
export function mapRows(rankings, spec, riderByBib, teamByNumber) {
  const rows = [];
  const first = (rankings || []).find((r) => r.position === 1);
  const firstAbs = first ? normAbsTime(first.capital) : null;
  const winnerSecs = firstAbs ? toSecs(firstAbs) : null;
  for (const r of rankings || []) {
    const irm = irmOf(r.status);
    if (spec.teamRows) {
      const teamName = teamByNumber.get(Number(r.bib)) || `Team ${r.bib}`;
      if (irm) {
        rows.push({ rank: null, rankText: irm, bib: null, riderDisplay: teamName, teamName,
          resultValue: null, timeText: null, gapText: null, points: null, irm });
        continue;
      }
      const rank = r.position > 0 ? r.position : null;
      const abs = normAbsTime(r.capital);
      const gap = rank === 1 ? null : gapOf(r, abs, winnerSecs);
      rows.push({ rank, rankText: rank != null ? String(rank) : null, bib: null,
        riderDisplay: teamName, teamName,
        resultValue: rank === 1 ? abs : (gap || abs), timeText: rank === 1 ? abs : null,
        gapText: gap, points: null, irm: null });
      continue;
    }
    const bib = r.bib != null ? String(r.bib) : null;
    const who = riderByBib.get(Number(r.bib)) || {};
    if (irm) {
      rows.push({ rank: null, rankText: irm, bib, riderDisplay: who.display || null,
        teamName: who.teamName || null, resultValue: null, timeText: null, gapText: null,
        points: null, irm });
      continue;
    }
    const rank = r.position > 0 ? r.position : null;
    if (spec.time) {
      const abs = normAbsTime(r.capital);
      const gap = rank === 1 ? null : gapOf(r, abs, winnerSecs);
      rows.push({ rank, rankText: rank != null ? String(rank) : null, bib,
        riderDisplay: who.display || null, teamName: who.teamName || null,
        resultValue: rank === 1 ? abs : (gap || abs), timeText: rank === 1 ? abs : null,
        gapText: gap, points: null, irm: null });
    } else {
      const pts = normPoints(r.capital);
      rows.push({ rank, rankText: rank != null ? String(rank) : null, bib,
        riderDisplay: who.display || null, teamName: who.teamName || null,
        resultValue: pts, timeText: null, gapText: null, points: null, irm: null });
    }
  }
  return rows;
}

// ¿Han llegado los tres últimos en salir de la categoría? Matsport no publica el
// orden de salida: se deduce de las llegadas (salida = hour − capital). Si las
// salidas no son monótonas con el dorsal (o hay menos de 4 llegadas) no se puede
// afirmar nada y se devuelve done=false. Una fila con status (AB, NP…) cuenta
// como resuelta. La categoría es la centena del dorsal (élite 1–N → 0, sub-23 5xx,
// mujeres 6xx).
export function tailStartersFinished(rankings, riderBibs, opts = {}) {
  const rows = (rankings || []).filter((r) => r && r.bib > 0);
  const present = new Set(rows.map((r) => Number(r.bib)));
  const TIME = /^\d+(?::\d{2}){1,2}(?:\.\d*)?$/;
  const timed = rows
    .filter((r) => !clean(r.status) && TIME.test(clean(r.hour)) && TIME.test(clean(r.capital)))
    .map((r) => ({ bib: Number(r.bib), start: toSecs(clean(r.hour)) - toSecs(clean(r.capital)), cap: toSecs(clean(r.capital)) }))
    .sort((a, b) => a.bib - b.bib);
  if (timed.length < 4) return { done: false, reason: `solo ${timed.length} llegadas con hora` };
  let asc = true, desc = true;
  for (let i = 1; i < timed.length; i++) {
    if (timed[i].start <= timed[i - 1].start) asc = false;
    if (timed[i].start >= timed[i - 1].start) desc = false;
  }
  if (!asc && !desc) return { done: false, reason: 'orden de salida no monótono con el dorsal' };
  const hundred = Math.floor(timed[0].bib / 100);
  const field = [...riderBibs].map(Number).filter((b) => Math.floor(b / 100) === hundred).sort((a, b) => a - b);
  // salida ascendente con el dorsal → salen últimos los dorsales más altos.
  const tail = asc ? field.slice(-3) : field.slice(0, 3);
  const missing = tail.filter((b) => !present.has(b));
  if (!missing.length) return { done: true, tail, reason: 'llegaron los tres últimos' };

  // Bajas que Matsport no marca (sin fila ni status): los últimos en salir no
  // aparecen. Se cierra cuando ya no puede llegar nadie: la prueba es de un día
  // anterior, o hoy no hay nadie en carrera y la llegada esperada de cada ausente
  // (salida extrapolada del dorsal + el mayor tiempo registrado) pasó hace >10 min.
  const { now, stageDate, running } = opts;
  if (now && stageDate) {
    if (now.date > stageDate) return { done: true, tail, reason: `ausentes ${missing.join(', ')} (día anterior)` };
    if (now.date === stageDate && running === false) {
      const first = timed[0], last = timed[timed.length - 1];
      const slope = (last.start - first.start) / (last.bib - first.bib);
      const maxCap = Math.max(...timed.map((t) => t.cap));
      const late = missing.every((b) => first.start + (b - first.bib) * slope + maxCap + 600 <= now.secs);
      if (late) return { done: true, tail, reason: `ausentes ${missing.join(', ')} sin salir (nadie en carrera, llegada esperada vencida)` };
    }
  }
  return { done: false, tail, reason: `faltan ${missing.join(', ')}` };
}

// Fecha y segundos del día en la zona de la prueba (las horas de Matsport son locales).
export function localNow(timeZone, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, secs: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second) };
}

// Fecha de la prueba de un día: la de la etapa, salvo que caiga fuera de la
// competición (el Chrono des Nations publica la femenina el 19 siendo del 18).
function oneDayDateKey(st, comp) {
  const d = clean(st.date).slice(0, 10);
  const from = clean(comp.startDate).slice(0, 10), to = clean(comp.endDate).slice(0, 10);
  if (d && (!from || d >= from) && (!to || d <= to)) return d;
  return to || d || null;
}

// ── cliente HTTP ────────────────────────────────────────────────────────────
async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

function buildClassification(slot, spec, rows) {
  const winner = rows.find((r) => r.rank === 1);
  return {
    eventId: synthEventId(slot, spec.classKind, spec.scope),
    classKind: spec.classKind, scope: spec.scope,
    eventName: spec.eventName,
    isTeamEvent: !!spec.teamRows,
    winnerName: winner ? winner.riderDisplay : null,
    rowCount: rows.length,
    rows,
  };
}

// ── pipeline ────────────────────────────────────────────────────────────────
async function main() {
  checkArgs();
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher Matsport — comp=${COMP} (puente sintético ${COMPETITION_ID}) · idBase=${ID_BASE}`);

  const comp = await get(`/competitions/${COMP}`);
  if (!comp) { log(`FATAL: Matsport no responde para ${COMP} (¿id correcto? convención {año}_{código})`); process.exit(1); }
  log(`  ${comp.name} · ${comp.startDate} → ${comp.endDate} · ${comp.gender}`);

  // Índices de resolución: bib → corredor ("APELLIDO Nombre" formato UCI) y
  // número de equipo (position) → nombre, para las filas de ETE/ETG.
  const riderByBib = new Map();
  const teamByNumber = new Map();
  for (const t of comp.teams || []) {
    if (t.position != null) teamByNumber.set(Number(t.position), clean(t.name));
    for (const r of t.riders || []) {
      const bib = r.bib > 0 ? r.bib : r.engaged;            // type=E → dorsal en engaged
      if (bib == null || !(bib > 0)) continue;
      const display = clean(`${clean(r.lastName).toUpperCase()} ${clean(r.firstName)}`) || null;
      riderByBib.set(Number(bib), { display, teamName: clean(t.name) || null });
    }
  }
  log(`  índice: ${riderByBib.size} corredores con dorsal, ${teamByNumber.size} equipos numerados`);

  let stageList = [...(comp.stages || [])].sort((a, b) => Number(a.stage) - Number(b.stage));
  if (!stageList.length) log('⚠️  0 etapas en Matsport');
  if (MATSPORT_STAGE != null) {
    stageList = stageList.filter((st) => Number(st.stage) === MATSPORT_STAGE);
    if (!stageList.length) {
      log(`FATAL: ${COMP} no tiene la etapa ${MATSPORT_STAGE} (--matsport-stage)`);
      process.exit(1);
    }
    log(`  prueba única: etapa ${MATSPORT_STAGE} «${clean(stageList[0].name)}» como carrera de un día`);
  }
  const lastStageNumber = stageList.length ? Number(stageList[stageList.length - 1].stage) : null;
  // Una sola etapa = carrera de un día (clásica) → resultado único, sin complementarias.
  // --matsport-stage fuerza el mismo tratamiento para una prueba suelta de una multiprueba.
  const isOneDay = stageList.length === 1;

  const stages = [];
  let lastOveralls = null;       // generales de la última etapa procesada (para la pseudo-final)
  let lastStageDone = false;     // la ÚLTIMA etapa tiene ITE → carrera terminada

  for (const st of stageList) {
    const stageNumber = Number(st.stage);
    if (!Number.isFinite(stageNumber)) { log(`  ⚠ etapa con número raro (${st.stage}) — omitida`); continue; }
    if (MATSPORT_STAGE == null && ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;

    await sleep(DELAY);
    const detail = await get(`/stages/${st.id}`);
    const rankingTypes = (detail && detail.rankingTypes) || [];
    const byType = new Map();
    for (const rt of rankingTypes) {
      const type = clean(rt.type);
      if (!TYPE_MAP[type] || byType.has(type)) continue;     // primera de cada tipo
      if (!Array.isArray(rt.rankings) || rt.rankings.length === 0) continue;
      byType.set(type, rt);
    }
    let timeRankings = byType.get('ITE') ? byType.get('ITE').rankings : null;
    let closedTimeTrial = false;   // cuadro de PAS_A con los tres últimos en salir ya en meta
    if (!timeRankings && MATSPORT_STAGE != null) {
      const finish = rankingTypes.find((rt) => clean(rt.type) === 'PAS_A' && Array.isArray(rt.rankings) && rt.rankings.length);
      if (finish) {
        const runRt = rankingTypes.find((rt) => clean(rt.type) === 'RUN_A');
        const fin = tailStartersFinished(finish.rankings, riderByBib.keys(), {
          now: localNow(TIMEZONE),
          stageDate: oneDayDateKey(st, comp),
          running: runRt && Array.isArray(runRt.rankings) ? runRt.rankings.length > 0 : undefined,
        });
        if (ASSUME_CLOSED && !fin.done) { fin.done = true; fin.tail = fin.tail || []; fin.reason = `cierre manual (${fin.reason})`; }
        if (!fin.done) { log(`  E${stageNumber} PAS_A con ${finish.rankings.length} llegadas, prueba en curso (${fin.reason}) — omitida`); continue; }
        log(`  E${stageNumber} sin ITE: se usa PAS_A (${finish.rankings.length} filas; ${fin.reason}: ${fin.tail.join(', ')})`);
        timeRankings = finish.rankings;
        closedTimeTrial = true;
      }
    }
    if (!timeRankings) { log(`  E${stageNumber} sin Stage Classification publicada (no terminada) — omitida`); continue; }

    const classifications = [];
    const overallsOfStage = [];
    // En la ÚLTIMA etapa las generales ACUMULADas (ITG→gc y todo scope 'overall')
    // son las DEFINITIVAS de la carrera → van SOLO a la pseudo-etapa "Final
    // Classification", no colgando de la etapa (evita el duplicado "general del
    // día E_última" ≈ "general final"). Se conservan para clonarlas en la final
    // (overallsOfStage) pero NO se añaden al bloque de la etapa. La clasificación
    // de ETAPA (ITE→stage) y las secundarias */stage sí se emiten normalmente.
    // CARRERA DE UN DÍA (clásica): Matsport la modela como una competición de UNA
    // etapa, pero una clásica NO tiene etapas ni clasificaciones complementarias —
    // tiene UN resultado y punto. Convención del catálogo (verificada contra las
    // one_day ya volcadas): stageNumber NULL + classKind 'gc' + scope 'stage'.
    // Las ITG/IPG/IMG/IJG que Matsport publique aquí son metas volantes y premios
    // de montaña de la propia carrera, NO clasificaciones publicables (espíritu
    // de la whitelist 092) → se DESCARTAN.
    if (isOneDay) {
      const rows = mapRows(timeRankings, TYPE_MAP.ITE, riderByBib, teamByNumber);
      const spec = { ...TYPE_MAP.ITE, classKind: 'gc', scope: 'stage', eventName: 'General Classification' };
      const cl = buildClassification(FINAL_SLOT, spec, rows);
      // Crono cerrada: cada llegada es definitiva, no se espera a lecturas estables.
      if (closedTimeTrial) cl.publication = { provider: 'matsport', format: 'fixed', sourceStatus: 'official' };
      const dropped = [...byType.keys()].filter((t) => t !== 'ITE');
      stages.push({
        uciRaceId: synthRaceId(FINAL_SLOT),
        stageNumber: null,
        stageName: 'Final Classification',
        isFinalClassification: true,
        dateKey: oneDayDateKey(st, comp),
        raceType: null,
        startLocation: null,
        classificationCount: 1,
        classifications: [cl],
      });
      log(`    UN DÍA → stage/gc ${String(rows.length).padStart(3)} filas (event ${cl.eventId})`
        + (dropped.length ? `  · descartadas complementarias: ${dropped.join(',')}` : ''));
      continue;
    }

    const isLastStage = stageNumber === lastStageNumber;
    for (const [type, rt] of byType) {
      const spec = TYPE_MAP[type];
      const rows = mapRows(rt.rankings, spec, riderByBib, teamByNumber);
      const isCumulative = (type === 'ITG') || spec.scope === 'overall';
      // Para la pseudo-final: generales acumuladas = ITG + las overall.
      if (type === 'ITG') overallsOfStage.push({ finalKind: 'gc', spec, rows });
      else if (spec.scope === 'overall') overallsOfStage.push({ finalKind: spec.classKind, spec, rows });
      if (isLastStage && isCumulative) {
        log(`    E${String(stageNumber).padEnd(2)} ${(spec.scope + '/' + spec.classKind).padEnd(14)} ${String(rows.length).padStart(3)} filas  → SOLO a FINAL (última etapa)`);
        continue;
      }
      const cl = buildClassification(stageNumber, spec, rows);
      classifications.push(cl);
      log(`    E${String(stageNumber).padEnd(2)} ${(cl.scope + '/' + cl.classKind).padEnd(14)} ${String(rows.length).padStart(3)} filas  (event ${cl.eventId})`);
    }
    if (!classifications.length) continue;

    stages.push({
      uciRaceId: synthRaceId(stageNumber),
      stageNumber,
      stageName: clean(st.name) || `Stage ${stageNumber}`,
      isFinalClassification: false,
      dateKey: clean(st.date).slice(0, 10) || null,
      raceType: null,                       // Matsport no etiqueta ITT/TTT en la etapa
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    if (overallsOfStage.length) lastOveralls = { stageNumber, overalls: overallsOfStage };
    if (stageNumber === lastStageNumber) lastStageDone = true;
  }

  // Carrera terminada (última etapa con ITE) → pseudo-etapa "Final Classification"
  // (quirk UCI: scope='stage' + isFinalClassification, migración 085).
  if (lastStageDone && lastOveralls && lastOveralls.stageNumber === lastStageNumber && ONLY_STAGE == null) {
    const FINAL_NAMES = { gc: 'General Classification', points: 'Points Classification', kom: 'Mountain Classification', youth: 'Youth Classification', teams: 'Teams Classification' };
    const seen = new Set();
    const classifications = [];
    for (const { finalKind, spec, rows } of lastOveralls.overalls) {
      if (seen.has(finalKind)) continue;       // p. ej. youth: IJE (stage) no entra; IJG sí
      seen.add(finalKind);
      classifications.push(buildClassification(
        FINAL_SLOT,
        { ...spec, classKind: finalKind, scope: 'stage', eventName: FINAL_NAMES[finalKind] || spec.eventName },
        rows,
      ));
    }
    stages.push({
      uciRaceId: synthRaceId(FINAL_SLOT),
      stageNumber: null,
      stageName: 'Final Classification',
      isFinalClassification: true,
      dateKey: clean(comp.endDate) || null,
      raceType: null,
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    log(`    FINAL (carrera terminada): ${classifications.length} clasificaciones desde la E${lastOveralls.stageNumber}`);
  }

  const out = {
    competitionId: Number(COMPETITION_ID),
    disciplineId: 10,
    source: 'matsport',
    matsportCompetition: COMP,
    ...(MATSPORT_STAGE != null ? { matsportStage: MATSPORT_STAGE } : {}),
    fetchedAt: new Date().toISOString(),
    stageCount: stages.length,
    stages,
  };

  const file = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`\n✅ ${stages.length} etapas, ${stages.reduce((a, s) => a + s.classificationCount, 0)} clasificaciones → ${file}`);
  if (PRETTY) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// Solo se ejecuta si se invoca como script; importarlo (tests) no dispara nada.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
