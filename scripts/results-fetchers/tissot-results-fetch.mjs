#!/usr/bin/env node
/**
 * tissot-results-fetch.mjs — FETCHER de resultados desde TISSOT TIMING.
 *
 * Fuente alternativa a uci-results-fetch.mjs para las carreras que cronometra
 * Tissot (ASO: Tour, Vuelta, ARA/ex-Dauphiné, París-Niza, clásicas; Suiza;
 * Romandía; Mundial…). Ventaja: publica los resultados validados 5–15 min
 * después de meta — antes que UCI DataRide. API REST SIN autenticación
 * (contrato: TISSOT-TIMING-API.md, ingeniería inversa verificada 2026-06-10).
 *
 * EMITE EXACTAMENTE EL MISMO JSON que uci-results-fetch.mjs → el upsert
 * (uci-results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source ('uci'|'tissot', migración 089) vía uci-results-cron.mjs.
 *
 * MAPEO Tissot → contrato UCI
 *   /stages/{n}/rankings/stage   → scope='stage':  Time→stage · Young→youth ·
 *                                  Team→teams · SprintPoints→points · MountainPoints→kom
 *   /stages/{n}/rankings/overall → Time→gc (scope='stage', como la "Stage General
 *                                  Classification" de la UCI = GC del día) · SprintPoints→
 *                                  points · MountainPoints→kom · Young→youth · Team→teams
 *                                  (estos cuatro scope='overall').
 *   Carrera con status 'Previous' (terminada) → se emite además la pseudo-etapa
 *   "Final Classification" (stageNumber NULL, isFinalClassification=true, scope='stage'
 *   — mismo quirk que la UCI, ver migración 085) clonando las generales de la última etapa.
 *
 * IDs SINTÉTICOS: Tissot no tiene eventId/raceId numéricos (usa fases hex). Se
 *   sintetizan NEGATIVOS y deterministas — fnv1a(compId)%200000 como base,
 *   eventId = -(base*10000 + slotEtapa*100 + idxClasificación) — para no chocar
 *   NUNCA con los eventId positivos de DataRide y que ON CONFLICT(eventId) siga
 *   siendo idempotente entre volcados. ⚠ Al conmutar la fuente de una carrera ya
 *   volcada hay que purgar las cabeceras de la otra fuente (ver migración 089).
 *
 * NORMALIZACIÓN DE VALORES (al formato que ya hay en BD vía UCI):
 *   "3h43'58\""→"3:43:58" (absoluto) · "41\""→"+41" · "01'29\""→"+1:29" ·
 *   "' '" (mismo grupo) → se PROPAGA el gap de la fila anterior ("+0" si la
 *   anterior es el ganador) · cola "DNF"/"DNS"/"OTL"/"DSQ" → rank NULL + irm.
 *   Puntos/Montaña: el valor va en resultValue (entero en texto), como la UCI.
 *
 * CRE (TTT): Tissot da el ranking de etapa como FILAS DE EQUIPO y NO publica los
 *   tiempos individuales de meta en ningún endpoint (rider sin entrada de etapa,
 *   subRankings vacíos, members vacíos). La UCI SÍ los publica (con centésimas) en
 *   su "Stage Classification" → HÍBRIDO: para una etapa TTT se intenta DataRide y,
 *   si ya está publicada, sus filas individuales (todos los corredores con su
 *   tiempo real, rank del equipo repetido) entran bajo el MISMO eventId sintético.
 *   Si la UCI aún no la tiene (Tissot publica antes), FALLBACK: expansión con el
 *   roster de /stages/{n}/teams al patrón UCI (líder con rank+tiempo ABSOLUTO del
 *   equipo, compañeros rank=NULL detrás) — y el siguiente volcado de la ventana
 *   del cron se auto-corrige al aparecer la UCI (upsert idempotente).
 *   Caveat del fallback: el status del roster es el VIGENTE (no histórico) → en un
 *   backfill tardío puede faltar algún corredor ya retirado dentro del desplegable.
 *
 * Solo se emiten etapas TERMINADAS (con Stage Ranking publicado): la ventana de
 * meta del cron (087) ya garantiza que se consulta cuando toca.
 *
 * Uso (desde la raíz del repo; fetch nativo, sin deps):
 *   node scripts/results-fetchers/tissot-results-fetch.mjs --competition ara2026 --competition-id 76394
 *   node scripts/results-fetchers/tissot-results-fetch.mjs --competition ara2026 --competition-id 76394 --stage 2
 *
 * Args:
 *   --competition     comp_id de Tissot: {código}{año} ("ara2026", "tdf2026").
 *   --competition-id  competitionId del puente race_uci_links. Para carreras CON
 *                     comp de UCI DataRide (p.ej. ARA): el competitionId de DataRide
 *                     (entero POSITIVO). Para carreras Tissot SIN DataRide (p.ej.
 *                     Vuelta a Suiza tds/tsf): un entero NEGATIVO sintético —
 *                     convención -(fnv1a(comp_id)%200000), lo imprime --suggest-id.
 *                     Obligatorio: el JSON lo lleva para que el upsert NO recablee
 *                     el puente; también nombra el archivo de salida <id>.json.
 *   --stage           (opcional) limitar a un nº de etapa.
 *   --out             carpeta de salida (default _results_run/tissot-<comp> JUNTO A ESTE
 *                     script, no relativo al cwd). La ruta que imprime al terminar es la
 *                     real: leer esa, no reconstruirla a mano.
 *   --pretty          además vuelca el JSON a stdout.
 *   --suggest-id      imprime el competitionId sintético negativo sugerido y sale.
 *   --delay           ms entre peticiones (default 150).
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const COMP = getArg('competition');                 // "ara2026"
const COMPETITION_ID = getArg('competition-id');    // 76394 (DataRide, para el puente)
const ONLY_STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `tissot-${COMP}`);
const PRETTY = hasFlag('pretty');
const DELAY = parseInt(getArg('delay') || '150', 10);

const BASE = 'https://prod.server.tissottiming.com';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── IDs sintéticos (negativos, deterministas) ─────────────────────────────
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// ≤199999 → eventId > -2^31 garantizado. Sin --competition queda NaN: solo lo usa
// main(), que valida los args antes (importar el módulo desde un test no ejecuta nada).
const ID_BASE = COMP ? fnv1a(COMP) % 200000 : NaN;

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (!COMP) { log('FATAL: falta --competition <comp_id tissot, p.ej. ara2026>'); process.exit(1); }
  // competitionId del puente: positivo (DataRide, p.ej. ARA 76394) o negativo
  // sintético para carreras Tissot SIN DataRide (Vuelta a Suiza tds/tsf). El
  // negativo sugerido = -(fnv1a(comp_id)%200000), misma base que los eventId.
  if (hasFlag('suggest-id')) {
    process.stdout.write(String(-ID_BASE) + '\n');
    process.exit(0);
  }
  if (!COMPETITION_ID || !/^-?\d+$/.test(COMPETITION_ID)) {
    log(`FATAL: falta --competition-id <entero del puente race_uci_links> (DataRide positivo, o negativo sintético; sugerido para ${COMP}: ${-ID_BASE})`);
    process.exit(1);
  }
}

const FINAL_SLOT = 99;                              // pseudo-etapa "Final Classification"
// idx fijo por (classKind, scope) — independiente del orden en que Tissot liste los rankings.
const CLASS_IDX = {
  'stage/stage': 1, 'gc/stage': 2,
  'points/overall': 3, 'kom/overall': 4, 'youth/overall': 5, 'teams/overall': 6,
  'points/stage': 7, 'kom/stage': 8, 'youth/stage': 9, 'teams/stage': 10,
  'other/stage': 11, 'other/overall': 12,
};
const synthRaceId = (slot) => -(ID_BASE * 10000 + slot * 100);
const synthEventId = (slot, kind, scope) => -(ID_BASE * 10000 + slot * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 12));

// ── normalización de tiempos Tissot → formato UCI ─────────────────────────
// Exportadas para tests (js/__tests__/tissotResultsFetch.test.js). El script sigue
// siendo ejecutable: main() solo corre si se invoca directamente (ver pie del fichero).
export function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

// "3h43'58\"" | "32'52\"17" | "41\"" → {sec, centis} | null
// Variante vista en la GC provisional/jóvenes de una CRE desunida (TdF 2026 E1):
// "MM:SS''" | "SS''" (separador ':' en vez de "'", sufijo "''" doble en vez de '"').
// Variante vista en Stage Classification (TdF 2026 E2): tiempo absoluto del
// ganador como "H:MM:SS" (sin comillas) y el gap del resto como segundos
// crudos "00"/"03" (SOLO gap, nunca tiempo absoluto — un ganador siempre
// tiene rank===1 y usa la primera rama de mapTimeRows).
export function parseAbsoluteColonTime(v) {
  const raw = clean(v);
  const m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return null;
  return { sec: parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10), centis: null };
}
// Gap del resto del pelotón (rank!==1) en esta variante: "SS" bajo 1:00,
// "M:SS" a partir de 1:00, "H:MM:SS" a partir de 1h — SIEMPRE gap, nunca
// absoluto (el absoluto del ganador se distingue por rank===1, ver arriba).
export function parsePlainSecondsGap(v) {
  const raw = clean(v);
  if (/^\d{1,3}$/.test(raw)) return { sec: parseInt(raw, 10), centis: null };
  let m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (m) return { sec: parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10), centis: null };
  m = /^(\d+):(\d{1,2})$/.exec(raw);
  if (m) return { sec: parseInt(m[1], 10) * 60 + parseInt(m[2], 10), centis: null };
  return null;
}
export function parseTissotTime(v) {
  const raw = clean(v);
  // Variante COLON + comilla final vista en el TdF 2026 (E9+): tiempo del
  // ganador "H:MM:SS\"" y gaps del resto "M:SS\"" | "SS\"" (dos puntos como
  // separador, comilla final, sin 'h'/"'", sin centésimas). Se prueba PRIMERO
  // porque contiene ':' — el formato clásico con "'" nunca lleva ':'.
  if (raw.includes(':') && raw.endsWith('"')) {
    let cm = /^(\d+):(\d{1,2}):(\d{1,2})"$/.exec(raw);
    if (cm) return { sec: parseInt(cm[1], 10) * 3600 + parseInt(cm[2], 10) * 60 + parseInt(cm[3], 10), centis: null };
    cm = /^(\d+):(\d{1,2})"$/.exec(raw);
    if (cm) return { sec: parseInt(cm[1], 10) * 60 + parseInt(cm[2], 10), centis: null };
  }
  let m = /^(?:(\d+)h)?(?:(\d+)')?(\d+)"(\d{1,2})?$/.exec(raw);
  if (!m) m = /^(?:(\d+):)?(\d+)''(\d{1,2})?$/.exec(raw);
  if (!m) return null;
  if (raw.endsWith("''")) {
    // segunda forma: grupos [min?, sec, centis?] — sin horas.
    const sec = (parseInt(m[1] || '0', 10) * 60) + parseInt(m[2], 10);
    return { sec, centis: m[3] || null };
  }
  const sec = (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3], 10);
  return { sec, centis: m[4] || null };
}
const pad = (n) => String(n).padStart(2, '0');
export function absText({ sec, centis }) {            // → "3:43:58" | "32:52" (+ ".cc" si crono con centésimas)
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const t = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return centis ? `${t}.${centis}` : t;
}
export function gapText({ sec, centis }) {            // → "+41" | "+1:29" | "+1:02:03" (estilo UCI en BD)
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const t = h > 0 ? `+${h}:${pad(m)}:${pad(s)}` : (m > 0 ? `+${m}:${pad(s)}` : `+${s}`);
  return centis ? `${t}.${centis}` : t;
}

// "DNF" / "DNS" / "OTL" / "DSQ" / "ABD"… (cola de no clasificados; rank viene 0)
// ⚠️ NUNCA aceptar "OK"/"None" u otro estado de roster "vigente, sin resolver":
// Tissot los usa para corredores que siguen en carrera pero aún sin posición
// confirmada — no son un abandono. Solo whitelist de códigos de abandono reales.
const IRM_CODES = new Set(['DNF', 'DNS', 'OTL', 'DSQ', 'ABD']);
export function irmCode(v) {
  const s = clean(v).toUpperCase();
  return IRM_CODES.has(s) ? s : null;
}

// ── mapeo de filas ────────────────────────────────────────────────────────
const displayOf = (r) => clean(r.rider?.name || r.team?.name || r.key) || null;

// Clasificaciones POR TIEMPO (stage/gc/youth/teams). Propaga el gap en "' '".
// teamRows=true → filas de equipo: bib NULL (un bib de equipo casaría por error
// con un dorsal de corredor en resolve_uci_results).
export function mapTimeRows(results, { teamRows = false } = {}) {
  let lastGap = '+0';
  const rows = [];
  for (const r of results || []) {
    const display = displayOf(r);
    const bib = !teamRows && r.rider?.bib != null ? String(r.rider.bib) : null;
    const teamName = clean(r.rider?.teamName) || (teamRows ? display : null);
    const irm = irmCode(r.value);
    if (irm) {
      rows.push({ rank: null, rankText: irm, bib, riderDisplay: display, teamName,
        resultValue: null, timeText: null, gapText: null, points: null, irm });
      continue;
    }
    const rank = r.rank > 0 ? r.rank : null;
    // Ganador: "H:MM:SS" absoluto (variante colon-sin-comillas) o el formato
    // clásico con comillas. Resto: gap en segundos crudos "SS" (sin +/comillas)
    // cuando el ganador ya vino en formato colon — nunca tiempo absoluto.
    const t = parseTissotTime(r.value) || (rank === 1 ? parseAbsoluteColonTime(r.value) : null);
    const plainGap = rank !== 1 ? parsePlainSecondsGap(r.value) : null;
    let timeText = null, gap = null, resultValue = null;
    if (clean(r.value) === "' '" || (!t && !plainGap && !clean(r.value))) {
      gap = lastGap;                                   // mismo grupo → gap de la fila anterior
      resultValue = gap;
    } else if (t && rank === 1) {
      timeText = absText(t); resultValue = timeText; lastGap = '+0';
    } else if (t) {
      gap = gapText(t); resultValue = gap; lastGap = gap;
    } else if (plainGap) {
      gap = gapText(plainGap); resultValue = gap; lastGap = gap;
    } else if (rank == null) {
      // Sin rank y valor no parseable como tiempo/gap/IRM (p.ej. "OK"/"None" =
      // roster vigente en carrera, aún sin posición confirmada por Tissot).
      // NO se emite: se completará en un fetch posterior cuando tenga
      // posición real o pase a IRM explícito.
      continue;
    } else {
      resultValue = clean(r.value) || null;            // rank>0 con valor raro → crudo, sin romper
    }
    rows.push({ rank, rankText: rank != null ? String(rank) : null, bib, riderDisplay: display,
      teamName, resultValue, timeText, gapText: gap, points: null, irm: null });
  }
  return rows;
}

// Clasificaciones POR PUNTOS (points/kom): el valor (entero) va en resultValue, como la UCI.
export function mapPointsRows(results) {
  let lastVal = null;
  const rows = [];
  for (const r of results || []) {
    const irm = irmCode(r.value);
    const raw = clean(r.value);
    const rank = r.rank > 0 ? r.rank : null;
    if (rank == null && !irm) {
      // Sin rank y sin IRM real ("OK"/"None" = roster vigente sin posición
      // confirmada) → no se emite hasta que tenga posición o IRM explícito.
      continue;
    }
    const val = irm ? null : (raw === "' '" ? lastVal : (raw || null));
    if (!irm) lastVal = val;
    rows.push({
      rank,
      rankText: rank != null ? String(rank) : (irm || null),
      bib: r.rider?.bib != null ? String(r.rider.bib) : null,
      riderDisplay: displayOf(r), teamName: clean(r.rider?.teamName) || null,
      resultValue: val, timeText: null, gapText: null, points: null, irm,
    });
  }
  return rows;
}

// CRE: expandir filas de equipo al patrón UCI (líder con rank+TIEMPO ABSOLUTO,
// compañeros rank=NULL detrás). roster = /stages/{n}/teams; se cruza por nombre.
// El render TTT de la web toma el tiempo del equipo del timeText ABSOLUTO del
// líder y DERIVA los gaps él mismo (resultados.js, caso A: exige que NINGUNA
// fila traiga gapText) → aquí se reconstruye el absoluto de cada equipo
// (ganador + gap de Tissot) y NO se emite gapText.
// El status "activo" del roster varía por etapa ("OK" en unas, "None" en otras) →
// se excluye SOLO por código de abandono explícito, nunca por no-reconocido.
const ABANDON_STATUS = new Set(['DNF', 'DNS', 'OTL', 'DSQ', 'ABD']);
export function expandTeamTimeTrial(results, roster) {
  const rows = [];
  const byName = new Map();
  for (const t of roster || []) byName.set(clean(t.name).toUpperCase(), t);
  let winnerCentis = null, lastCentis = null;
  for (const r of results || []) {
    const display = displayOf(r);
    const irm = irmCode(r.value);
    const rank = r.rank > 0 ? r.rank : null;
    let absCentis = null;
    if (!irm) {
      const t = parseTissotTime(r.value);
      const c = t ? t.sec * 100 + (t.centis ? parseInt(t.centis, 10) : 0) : null;
      if (rank === 1 && c != null) absCentis = winnerCentis = c;                 // absoluto del ganador
      else if (clean(r.value) === "' '") absCentis = lastCentis;                 // mismo tiempo que el anterior
      else if (c != null) absCentis = winnerCentis != null ? winnerCentis + c : c; // gap → absoluto
      lastCentis = absCentis;
    }
    const timeText = absCentis == null ? null : absText({
      sec: Math.floor(absCentis / 100),
      centis: absCentis % 100 ? String(absCentis % 100).padStart(2, '0') : null,
    });
    const lead = { rank, rankText: irm || (rank != null ? String(rank) : null), riderDisplay: display,
      teamName: display, resultValue: timeText, timeText, gapText: null, points: null, irm: irm || null };
    const entry = byName.get(clean(display).toUpperCase());
    const members = (entry?.members || []).filter((m) => !ABANDON_STATUS.has(clean(m.status).toUpperCase()));
    if (!members.length) { rows.push({ ...lead, bib: null }); continue; }   // sin roster → fila de equipo tal cual
    members.forEach((m, i) => {
      rows.push(i === 0
        ? { ...lead, bib: String(m.bib), riderDisplay: clean(m.name) }
        : { rank: null, rankText: null, bib: String(m.bib), riderDisplay: clean(m.name),
            teamName: display, resultValue: null, timeText: null, gapText: null, points: null, irm: null });
    });
  }
  return rows;
}

// ── CRE: tiempos individuales desde UCI DataRide (Tissot no los publica) ───
// Cliente mínimo de dataride.uci.ch/iframe (espejo de uci-results-fetch.mjs:
// POST form-urlencoded, respuesta Kendo {data}, /Events/ exige cookie de sesión).
// Solo se usa para etapas TTT; carga perezosa y silenciosa: cualquier fallo →
// null → fallback a la expansión por roster.
const UCI_BASE = 'https://dataride.uci.ch/iframe';
let _uciCookie = null;
let _uciRaces = null;
async function uciPost(path, formObj, needCookie = false) {
  if (needCookie && _uciCookie == null) {
    const res = await fetch('https://dataride.uci.ch/', { headers: { 'User-Agent': UA } });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    _uciCookie = (sc || []).map((c) => c.split(';')[0]).join('; ');
  }
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': UA,
  };
  if (needCookie && _uciCookie) headers['Cookie'] = _uciCookie;
  const res = await fetch(`${UCI_BASE}/${path}`, { method: 'POST', headers, body: new URLSearchParams(formObj).toString() });
  if (!res.ok) return null;
  try { return JSON.parse(await res.text()); } catch { return null; }
}
// Fila DataRide → contrato (espejo del normalizeRow de uci-results-fetch.mjs;
// en una CRE los ResultValue son tiempos absolutos por corredor, sin gaps).
function uciRow(r) {
  const rankNum = /^\d+$/.test(clean(r.Rank)) ? parseInt(r.Rank, 10) : null;
  const rv = clean(r.ResultValue);
  return {
    rank: rankNum,
    rankText: clean(r.Rank) || (r.Irm ? clean(r.Irm) : null),
    bib: clean(r.Bib) || null,
    riderDisplay: clean(r.DisplayName) || clean(r.IndividualDisplayName) || null,
    teamName: clean(r.TeamName) || null,
    resultValue: rv || null,
    timeText: rv && !rv.startsWith('+') ? rv : null,
    gapText: rv && rv.startsWith('+') ? rv : null,
    points: r.PointPcR != null ? Number(r.PointPcR) : null,
    irm: clean(r.Irm) || null,
  };
}
async function fetchUciTttRows(stageNumber) {
  try {
    if (_uciRaces == null) {
      const res = await uciPost('Races/', {
        disciplineId: 10, competitionId: COMPETITION_ID,
        take: 60, skip: 0, page: 1, pageSize: 60,
      });
      _uciRaces = (res && res.data) || [];
    }
    const race = _uciRaces.find((rc) => {
      const m = /stage\s+(\d+)/i.exec(rc.RaceName || '');
      return m ? parseInt(m[1], 10) === stageNumber
               : (stageNumber === 0 && /prologue/i.test(rc.RaceName || ''));
    });
    if (!race) return null;
    const events = await uciPost('Events/', { disciplineId: 10, raceId: race.Id }, true);
    if (!Array.isArray(events)) return null;
    const ev = events.find((e) => /^stage classification$/i.test(clean(e.EventName).toLowerCase()));
    if (!ev) return null;
    const res = await uciPost('Results/', {
      disciplineId: 10, eventId: ev.EventId,
      take: 300, skip: 0, page: 1, pageSize: 300,
    });
    const rows = ((res && res.data) || []).map(uciRow);
    return rows.length ? rows : null;
  } catch { return null; }
}

// ── (rankingType, vista) → {classKind, scope, eventName, mapper} ──────────
export function classifyTissot(rankingType, view /* 'stage' | 'overall' */) {
  const T = {
    stage: {
      Time:           { classKind: 'stage',  scope: 'stage', eventName: 'Stage Classification', time: true },
      Young:          { classKind: 'youth',  scope: 'stage', eventName: 'Stage Youth Classification', time: true },
      Team:           { classKind: 'teams',  scope: 'stage', eventName: 'Stage Teams Classification', time: true, teamRows: true },
      SprintPoints:   { classKind: 'points', scope: 'stage', eventName: 'Stage Points Classification' },
      MountainPoints: { classKind: 'kom',    scope: 'stage', eventName: 'Stage Mountain Classification' },
    },
    overall: {
      Time:           { classKind: 'gc',     scope: 'stage', eventName: 'Stage General Classification', time: true },
      Young:          { classKind: 'youth',  scope: 'overall', eventName: 'Overall Youth Classification', time: true },
      Team:           { classKind: 'teams',  scope: 'overall', eventName: 'Overall Teams Classification', time: true, teamRows: true },
      SprintPoints:   { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification' },
      MountainPoints: { classKind: 'kom',    scope: 'overall', eventName: 'Overall Mountain Classification' },
    },
  };
  return T[view][rankingType] || { classKind: 'other', scope: view === 'overall' ? 'overall' : 'stage', eventName: clean(rankingType) };
}

// ── cliente HTTP ──────────────────────────────────────────────────────────
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA } });
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

// ── pipeline ──────────────────────────────────────────────────────────────
async function main() {
  checkArgs();
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher Tissot — comp=${COMP} (puente DataRide ${COMPETITION_ID}) · idBase=${ID_BASE}`);

  const comp = await get(`/competitions/${COMP}`);
  if (!comp) { log(`FATAL: Tissot no responde para ${COMP} (¿comp_id correcto?)`); process.exit(1); }
  log(`  ${comp.name} · status=${comp.status} · ${comp.start} → ${comp.end}`);

  const stageList = (await get(`/competitions/${COMP}/stages`)) || [];
  if (!stageList.length) { log('⚠️  0 etapas en Tissot'); }

  const stages = [];
  let lastOveralls = null;   // generales de la última etapa procesada (para la pseudo-final)

  // Número de la ÚLTIMA etapa del calendario: sus generales (overall) son las
  // DEFINITIVAS de la carrera → van a la pseudo-final (stageNumber NULL, quirk 085),
  // NO colgadas de la etapa. Vale aunque la carrera siga 'Live' y se pida --stage N.
  const maxStageNumber = stageList.reduce((mx, s) => {
    const n = Number(s.number);
    return Number.isFinite(n) && n > mx ? n : mx;
  }, -Infinity);

  for (const st of stageList) {
    const stageNumber = Number(st.number);
    if (!Number.isFinite(stageNumber)) { log(`  ⚠ etapa con number raro (${st.number}) — omitida`); continue; }
    if (ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;
    const isLastStage = stageNumber === maxStageNumber;

    await sleep(DELAY);
    const stageRk = (await get(`/competitions/${COMP}/stages/${stageNumber}/rankings/stage`)) || [];
    const hasStageResults = stageRk.some((r) => Array.isArray(r.results) && r.results.length > 0);
    if (!hasStageResults) { log(`  E${stageNumber} sin Stage Ranking publicado (no terminada) — omitida`); continue; }

    await sleep(DELAY);
    const overallRk = (await get(`/competitions/${COMP}/stages/${stageNumber}/rankings/overall`)) || [];
    const isTTT = clean(st.type) === 'TTT';
    const roster = isTTT ? (await get(`/competitions/${COMP}/stages/${stageNumber}/teams`)) : null;

    const classifications = [];
    const overallsOfStage = [];
    for (const [view, rankings] of [['stage', stageRk], ['overall', overallRk]]) {
      for (const rk of rankings) {
        if (!Array.isArray(rk.results) || rk.results.length === 0) continue;   // placeholders vacíos
        const spec = classifyTissot(rk.rankingType, view);
        const teamShaped = rk.results.some((r) => r.team && !r.rider);
        let rows;
        if (view === 'stage' && spec.classKind === 'stage' && teamShaped) {
          // CRE: tiempos individuales de la UCI si ya están publicados; si no,
          // expansión por roster con el tiempo del equipo (se auto-corrige en el
          // siguiente volcado de la ventana cuando la UCI publique).
          const uciRows = await fetchUciTttRows(stageNumber);
          rows = uciRows || expandTeamTimeTrial(rk.results, roster);
          log(uciRows
            ? `    E${stageNumber} CRE: tiempos individuales desde UCI DataRide (${uciRows.length} filas)`
            : `    E${stageNumber} CRE: UCI aún sin publicar — expansión por roster (tiempo por equipo)`);
        } else if (spec.time || teamShaped) {
          rows = mapTimeRows(rk.results, { teamRows: spec.teamRows || teamShaped });
        } else {
          rows = mapPointsRows(rk.results);
        }
        // En la ÚLTIMA etapa, las generales (overall) son las DEFINITIVAS → no se
        // cuelgan de la etapa; se acumulan para emitirlas en la pseudo-final.
        if (view === 'overall') {
          overallsOfStage.push({ spec, rows });
          if (isLastStage) {
            log(`    E${String(stageNumber).padEnd(2)} ${(spec.scope + '/' + spec.classKind).padEnd(14)} ${String(rows.length).padStart(3)} filas  → FINAL (última etapa)`);
            continue;
          }
        }
        const cl = buildClassification(stageNumber, spec, rows);
        classifications.push(cl);
        log(`    E${String(stageNumber).padEnd(2)} ${(cl.scope + '/' + cl.classKind).padEnd(14)} ${String(rows.length).padStart(3)} filas  (event ${cl.eventId})`);
      }
    }
    if (!classifications.length) continue;

    stages.push({
      uciRaceId: synthRaceId(stageNumber),
      stageNumber,
      stageName: clean(st.name) || `Stage ${stageNumber}`,
      isFinalClassification: false,
      dateKey: clean(st.start).slice(0, 10) || null,
      raceType: clean(st.type) === 'TTT' ? 'TTT' : clean(st.type) === 'ITT' ? 'ITT' : 'IRR',
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    if (overallsOfStage.length) lastOveralls = { stageNumber, overalls: overallsOfStage };
  }

  // Pseudo-etapa "Final Classification" (quirk UCI: scope='stage' + isFinalClassification,
  // ver migración 085) con las generales de la ÚLTIMA etapa. Se emite en cuanto se ha
  // procesado la última etapa (status 'Previous' O 'Live' con la E final ya disputada),
  // también con --stage <última>: sus overall SON las definitivas.
  if (lastOveralls && lastOveralls.stageNumber === maxStageNumber) {
    const FINAL_NAMES = { gc: 'General Classification', points: 'Points Classification', kom: 'Mountain Classification', youth: 'Youth Classification', teams: 'Teams Classification' };
    const classifications = lastOveralls.overalls.map(({ spec, rows }) => buildClassification(
      FINAL_SLOT,
      { ...spec, scope: 'stage', eventName: FINAL_NAMES[spec.classKind] || spec.eventName },
      rows,
    ));
    stages.push({
      uciRaceId: synthRaceId(FINAL_SLOT),
      stageNumber: null,
      stageName: 'Final Classification',
      isFinalClassification: true,
      dateKey: clean(comp.end) || null,
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
    source: 'tissot',
    tissotCompetition: COMP,
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
