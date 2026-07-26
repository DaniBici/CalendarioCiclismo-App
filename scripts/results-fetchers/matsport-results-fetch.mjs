#!/usr/bin/env node
/**
 * matsport-results-fetch.mjs — FETCHER de resultados desde MATSPORT
 * (api.cycling.matsport.com), el cronometrador de muchas carreras francesas y
 * algunas belgas/europeas (Tour Féminin des Pyrénées, Dunkerque, Poitou-Charentes,
 * Isbergues, Marsellesa, Denain, Morbihan, Luxemburgo…). Publica en vivo durante
 * la etapa y valida minutos después de meta — mucho antes que UCI DataRide
 * (que en estas carreras pequeñas puede tardar días o no llegar).
 *
 * EMITE EXACTAMENTE EL MISMO JSON que uci-results-fetch.mjs → el upsert
 * (uci-results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source ('uci'|'tissot'|'pdf'|'matsport', migración 101) vía
 * uci-results-cron.mjs.
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
 * NORMALIZACIÓN: capital "10:15:27" (absoluto, ya en formato BD) · gap "+00"→"+0",
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
 *   --out             carpeta de salida (default _results_run/matsport-<comp> JUNTO A ESTE
 *                     script, no relativo al cwd). La ruta que imprime al terminar es la
 *                     real: leer esa, no reconstruirla a mano.
 *   --pretty          además vuelca el JSON a stdout.
 *   --delay           ms entre peticiones (default 150).
 *   --suggest-id      imprime el competitionId sintético sugerido y sale.
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const COMP = getArg('competition');                 // "2026_PYF"
const COMPETITION_ID = getArg('competition-id');    // sintético negativo (puente race_uci_links)
const ONLY_STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `matsport-${COMP}`);
const PRETTY = hasFlag('pretty');
const DELAY = parseInt(getArg('delay') || '150', 10);

const BASE = 'https://api.cycling.matsport.com';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── IDs sintéticos (negativos, deterministas; salt "matsport:") ────────────
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// ≤199999 → eventId > -2^31 garantizado. Sin --competition queda NaN: solo lo usa
// main(), que valida los args antes (importar el módulo desde un test no ejecuta nada).
const ID_BASE = COMP ? fnv1a(`matsport:${COMP}`) % 200000 : NaN;

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (!COMP) { log('FATAL: falta --competition <id matsport, p.ej. 2026_PYF>'); process.exit(1); }
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
// Exportadas para tests (js/__tests__/matsportResultsFetch.test.js). El script sigue
// siendo ejecutable: main() solo corre si se invoca directamente (ver pie del fichero).
export function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

// status francés de Matsport → códigos IRM UCI (los que entiende js/uci-irm.js).
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

// capital "10:15:27" / "2:53:41" → tal cual (ya es el formato de BD); "61 pts" → null.
export function normAbsTime(v) {
  const t = clean(v);
  return /^\d+(:\d{2}){1,2}$/.test(t) ? t : null;
}

// "61 pts" / "61" → "61"
export function normPoints(v) {
  const m = /^(\d+)\s*(pts?)?$/i.exec(clean(v));
  return m ? m[1] : null;
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
      const gap = rank === 1 ? null : normGap(r.gap);
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
      const gap = rank === 1 ? null : normGap(r.gap);
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

// ── cliente HTTP ────────────────────────────────────────────────────────────
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

  const stageList = [...(comp.stages || [])].sort((a, b) => Number(a.stage) - Number(b.stage));
  if (!stageList.length) log('⚠️  0 etapas en Matsport');
  const lastStageNumber = stageList.length ? Number(stageList[stageList.length - 1].stage) : null;
  // Una sola etapa = carrera de un día (clásica) → resultado único, sin complementarias.
  const isOneDay = stageList.length === 1;

  const stages = [];
  let lastOveralls = null;       // generales de la última etapa procesada (para la pseudo-final)
  let lastStageDone = false;     // la ÚLTIMA etapa tiene ITE → carrera terminada

  for (const st of stageList) {
    const stageNumber = Number(st.stage);
    if (!Number.isFinite(stageNumber)) { log(`  ⚠ etapa con número raro (${st.stage}) — omitida`); continue; }
    if (ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;

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
    if (!byType.has('ITE')) { log(`  E${stageNumber} sin Stage Classification publicada (no terminada) — omitida`); continue; }

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
      const ite = byType.get('ITE');
      const rows = mapRows(ite.rankings, TYPE_MAP.ITE, riderByBib, teamByNumber);
      const spec = { ...TYPE_MAP.ITE, classKind: 'gc', scope: 'stage', eventName: 'General Classification' };
      const cl = buildClassification(FINAL_SLOT, spec, rows);
      const dropped = [...byType.keys()].filter((t) => t !== 'ITE');
      stages.push({
        uciRaceId: synthRaceId(FINAL_SLOT),
        stageNumber: null,
        stageName: 'Final Classification',
        isFinalClassification: true,
        dateKey: clean(st.date).slice(0, 10) || clean(comp.endDate) || null,
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
