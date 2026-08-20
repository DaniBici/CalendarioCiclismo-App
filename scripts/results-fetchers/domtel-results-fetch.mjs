#!/usr/bin/env node
/**
 * domtel-results-fetch.mjs — FETCHER de resultados desde DOMTEL SPORT TIMING
 * (domtel-sport.pl), cronometrador polaco (Course de Solidarność i Olimpijczyków
 * UCI Europe Tour, y otras carreras de Polonia).
 *
 * EMITE EXACTAMENTE EL MISMO JSON que uci-results-fetch.mjs → el upsert
 * (uci-results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source (migración 118) vía uci-results-cron.mjs.
 *
 * ENDPOINT (público, sin auth): POST
 *   https://wyniki.domtel-sport.pl/wp-admin/admin-ajax.php
 *   body: action=ptc_front_refresh&pid=<domtelCode>
 *   El plugin WordPress es "prosta-tabela-csv" (ptc). Devuelve JSON
 *   { success: true, data: [ {fila}, … ] }. `domtelCode` = id de post WP (p.ej. 8850).
 *
 * CONTRATO DE FILA (verificado en vivo con la Course de Solidarnosc 2026, E1 y E5):
 *   DYSTANS  = agrupador: "Stage 1 (81.8km)" | "Stage 2 (94km)" | "GENERAL" |
 *              "GENERAL POINTS" | "GENERAL SPRINT" (estas 2 últimas solo aparecen
 *              cuando la carrera ya lleva suficientes etapas; NO confundir con
 *              "GENERAL" a secas — exact-match, NUNCA startsWith)
 *   Msc      = puesto ("1".."N"; vacío en abandonos y en etapas no corridas)
 *   Numer    = DORSAL (resolución por dorsal estándar 082)
 *   Zawodnik = "APELLIDO Nombre" (display, fallback)
 *   Team     = nombre de equipo (display)   ·   Kraj = país IOC-3 (display)
 *   Czas     = tiempo absoluto "HH:MM:SS" en etapa/GENERAL; en GENERAL POINTS/SPRINT
 *              es el CONTADOR de puntos/esprints ganados (entero, no tiempo) · o
 *              código IRM ("DNF"/"DNS"/"DSQ"/"DQ") · o ""
 *   roznica  = gap "+MM:SS" / "+H:MM:SS" · "" en el líder Y en filas a mismo tiempo
 *
 * Domtel expone la clasificación de ETAPA (Stage N), la GENERAL (GC acumulada) y,
 * a partir de cierta etapa, GENERAL POINTS (puntos) y GENERAL SPRINT (esprints,
 * mapeada al slot kom/overall, la pestaña "Montaña" de la app — no hay clasificación
 * de montaña real en esta carrera, es la más parecida). BUG HISTÓRICO (cazado
 * 2026-07-04, etapa 5): `DYSTANS.startsWith('GENERAL')` casaba TAMBIÉN con
 * "GENERAL POINTS"/"GENERAL SPRINT" y como el código sobrescribía `generalRows` en
 * cada match, la última en aparecer en `data[]` ganaba como si fuera la GC real →
 * la etapa 5 quedó con "GENERAL SPRINT" (16 filas, ganador STOSZ Patryk) como
 * gc/stage en vez de "GENERAL" (90 filas, ganador BOGUSLAWSKI Marceli). Fix: exact
 * match por grupo.
 * Una etapa no corrida aparece con TODAS sus filas vacías (Msc/Czas/roznica = "")
 * → se OMITE (no hay <Resultats>, igual criterio que sts/matsport).
 *
 * ÚLTIMA ETAPA (quirk UCI 085, igual que matsport/tissot/sts/raceresult): Domtel no
 * indica cuántas etapas tiene la carrera, así que el número total lo pasa el cron
 * vía --total-stages (derivado de race_days). Cuando la etapa procesada coincide con
 * ese total, además de colgar la GC del día se emite una pseudo-etapa "Final
 * Classification" (stageNumber NULL, isFinalClassification=true, scope='stage') con
 * clones de GC/Puntos/Esprints — así el feed y la pestaña "F" muestran la general
 * definitiva de la carrera, no la "del día".
 *
 * ENCODING (clave): en la etapa, Domtel da el TIEMPO ABSOLUTO de cada clasificado
 *   en `Czas` y deja `roznica` vacío para los del mismo grupo (mismo tiempo) →
 *   emitimos timeText=abs y NUNCA gapText (la web entra en su Caso A `deriveGaps` y
 *   pinta m.t. sola; mezclar gapText rompería deriveGaps). En la GENERAL, Domtel SÍ
 *   trae `roznica` (gap del líder) además del `Czas` absoluto → misma política:
 *   emitimos SIEMPRE el timeText absoluto y dejamos gapText en null (deriveGaps
 *   recompone los gaps desde los tiempos absolutos; el ganador es rank=1).
 *
 * IRM: Domtel no tiene columna dedicada. Se detecta por substring en `Czas`/`Msc`
 *   (heurística del propio plugin): DNS→DNS · DNF→DNF · DSQ/DQ→DSQ. Fila con IRM →
 *   rank=null, rankText=código, sin tiempo/gap.
 *
 * IDs SINTÉTICOS: Domtel no existe en DataRide → eventId/uciRaceId NEGATIVOS y
 *   deterministas (mismo esquema que Tissot/PDF/STS, salt propio "domtel:"):
 *   fnv1a("domtel:"+code) % 200000 como base; el competitionId del puente es -base.
 *   ⚠ Al conmutar la fuente de una carrera ya volcada, la purga de gemelas del
 *   upsert (090) reemplaza los placeholders automáticamente.
 *
 * USO:
 *   node domtel-results-fetch.mjs --pid 8850 --suggest-id     → imprime competitionId
 *   node domtel-results-fetch.mjs --pid 8850 --competition-id -137279 --out <dir>
 *   node domtel-results-fetch.mjs --file <json> --competition-id -137279 --out <dir>
 *       (--file: leer un JSON ya descargado en vez de golpear el endpoint)
 *   --stage N          limita la salida a esa etapa (Stage N)
 *   --total-stages N   nº total de etapas de la carrera (lo pasa el cron desde
 *                      race_days); si la etapa procesada es la N, emite además la
 *                      pseudo-etapa "Final Classification" (quirk 085)
 *   --pretty    vuelca el JSON emitido por stdout
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const getArg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const hasFlag = (n) => argv.includes(n);
const log = (m) => process.stderr.write(m + '\n');

const PID = getArg('--pid');
const FILE = getArg('--file');
const OUT = getArg('--out') || '.';
const ONLY_STAGE = getArg('--stage') != null ? Number(getArg('--stage')) : null;
const TOTAL_STAGES = getArg('--total-stages') != null ? Number(getArg('--total-stages')) : null;
const PRETTY = hasFlag('--pretty');

// fnv1a → base determinista para los ids sintéticos negativos.
// Exportada para tests (js/__tests__/domtelResultsFetch.test.js).
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const SALT_KEY = PID || (FILE ? FILE : 'domtel');
const ID_BASE = fnv1a(`domtel:${SALT_KEY}`) % 200000;   // ≤199999 → eventId > -2^31

const COMPETITION_ID = getArg('--competition-id');

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (hasFlag('--suggest-id')) {
    process.stdout.write(String(-ID_BASE) + '\n');
    process.exit(0);
  }
  if (!COMPETITION_ID) { log('FATAL: falta --competition-id (o usa --suggest-id)'); process.exit(1); }
}

// idx fijo por (classKind, scope) — mismo cuadro que las demás fuentes. points/stage
// y kom/overall/stage distintos entre sí para que la pseudo-etapa Final (que reusa
// classKind con scope='stage') no colisione con las 'overall' del día.
const CLASS_IDX = {
  'stage/stage': 0, 'gc/stage': 1,
  'points/overall': 2, 'kom/overall': 3, 'youth/overall': 4, 'teams/overall': 5,
  'points/stage': 6, 'kom/stage': 7,
};
const synthEventId = (slot, kind, scope) => -(ID_BASE * 10000 + slot * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 12));
const synthRaceId  = (slot) => -(ID_BASE * 100 + slot);
// Slot reservado para la pseudo-etapa "Final Classification" (quirk 085), fuera del
// rango de números de etapa reales (idéntico patrón a matsport/tissot/sts).
const FINAL_SLOT = 9999;

// Exportadas para tests (js/__tests__/domtelResultsFetch.test.js). El script sigue
// siendo ejecutable: main() solo corre si se invoca directamente (ver pie del fichero).
export const clean = (s) => (s == null ? '' : String(s).trim());

// Czas → IRM code | null. Substring-match sobre Czas/Msc (heurística del plugin).
export function irmOf(czas, msc) {
  const t = (clean(czas) + ' ' + clean(msc)).toUpperCase();
  if (/\bDNS\b|NIE\s*WYSTARTOWA/.test(t)) return 'DNS';
  if (/\bDSQ\b|\bDQ\b|DYSKWAL/.test(t))   return 'DSQ';
  if (/\bDNF\b|NIE\s*UKO/.test(t))         return 'DNF';   // "nie ukończył"
  return null;
}

// "HH:MM:SS" o "H:MM:SS" → normalizado "H:MM:SS" (recorta ceros de hora inicial).
export function normTime(v) {
  const s = clean(v);
  if (!s || !/^\d{1,2}:\d{2}:\d{2}$/.test(s)) return s || null;
  const [h, m, sec] = s.split(':');
  return `${Number(h)}:${m}:${sec}`;
}

// ¿tiene la fila datos reales de resultado? (etapas no corridas = todo vacío)
export const isEmptyRow = (r) => !clean(r.Msc) && !clean(r.Czas) && !clean(r.roznica);

// mode 'time' (etapa/GC: Czas = tiempo absoluto) | 'count' (puntos/esprints:
// Czas = contador entero de puntos/esprints ganados, sin tiempo ni gap).
export function buildStageRows(rows, mode = 'time') {
  const out = [];
  for (const r of rows) {
    const bib = clean(r.Numer);
    const display = clean(r.Zawodnik) || null;
    const teamName = clean(r.Team) || null;
    const irm = mode === 'time' ? irmOf(r.Czas, r.Msc) : null;   // puntos/esprints no llevan IRM propio
    if (irm) {
      out.push({ rank: null, rankText: irm, bib: bib || null, riderDisplay: display,
        teamName, resultValue: null, timeText: null, gapText: null, points: null, irm });
      continue;
    }
    const msc = clean(r.Msc);
    if (!/^\d+$/.test(msc)) continue;         // sin puesto y sin IRM → placeholder vacío
    const rank = Number(msc);
    if (mode === 'count') {
      const pts = clean(r.Czas);
      out.push({ rank, rankText: String(rank), bib: bib || null,
        riderDisplay: display, teamName,
        resultValue: pts || null, timeText: null, gapText: null, points: /^-?\d+$/.test(pts) ? Number(pts) : null, irm: null });
      continue;
    }
    const abs = normTime(r.Czas);
    // timeText absoluto SIEMPRE; gapText null → la web deriva gaps (Caso A).
    out.push({ rank, rankText: String(rank), bib: bib || null,
      riderDisplay: display, teamName,
      resultValue: abs, timeText: abs, gapText: null, points: null, irm: null });
  }
  return out;
}

function buildClassification(slot, classKind, scope, eventName, rows) {
  const winner = rows.find((r) => r.rank === 1);
  return {
    eventId: synthEventId(slot, classKind, scope),
    classKind, scope, eventName,
    winnerName: winner ? winner.riderDisplay : null,
    rowCount: rows.length,
    rows,
  };
}

async function fetchData() {
  if (FILE) return JSON.parse(readFileSync(FILE, 'utf8'));
  if (!PID) { log('FATAL: falta --pid (o --file)'); process.exit(1); }
  const res = await fetch('https://wyniki.domtel-sport.pl/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `action=ptc_front_refresh&pid=${encodeURIComponent(PID)}`,
  });
  if (!res.ok) { log(`FATAL: HTTP ${res.status}`); process.exit(1); }
  return res.json();
}

async function main() {
  checkArgs();
  const payload = await fetchData();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  if (!data.length) { log('FATAL: respuesta sin data'); process.exit(1); }

  // Agrupar por DYSTANS conservando el orden de aparición.
  const groups = new Map();
  for (const r of data) {
    const key = clean(r.DYSTANS) || '(sin dystans)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const stages = [];
  // Las 3 GENERAL* se procesan aparte (no son etapas numeradas). EXACT MATCH por
  // grupo — NUNCA startsWith('GENERAL'), que casaría las 3 indistintamente (bug
  // histórico del 2026-07-04: la última en aparecer en data[] pisaba a las demás).
  let generalRows = null;       // "GENERAL" → gc/stage (GC acumulada real)
  let pointsRows = null;        // "GENERAL POINTS" → points/overall
  let sprintRows = null;        // "GENERAL SPRINT" → kom/overall (pestaña Montaña; no hay KOM real)

  for (const [dystans, rows] of groups) {
    const up = dystans.toUpperCase();
    if (up === 'GENERAL') {
      const nonEmpty = rows.filter((r) => !isEmptyRow(r));
      if (nonEmpty.length) generalRows = buildStageRows(nonEmpty, 'time');
      continue;
    }
    if (up === 'GENERAL POINTS') {
      const nonEmpty = rows.filter((r) => !isEmptyRow(r));
      if (nonEmpty.length) pointsRows = buildStageRows(nonEmpty, 'count');
      continue;
    }
    if (up === 'GENERAL SPRINT') {
      const nonEmpty = rows.filter((r) => !isEmptyRow(r));
      if (nonEmpty.length) sprintRows = buildStageRows(nonEmpty, 'count');
      continue;
    }
    const m = dystans.match(/stage\s*(\d+)/i);
    if (!m) { log(`  ⚠ DYSTANS no reconocido, omitido: ${dystans!==''?dystans:'(vacío)'}`); continue; }
    const stageNumber = Number(m[1]);
    if (ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;

    const nonEmpty = rows.filter((r) => !isEmptyRow(r));
    if (!nonEmpty.length) { log(`  Stage ${stageNumber} sin resultados (no corrida) — omitida`); continue; }

    const stageRows = buildStageRows(nonEmpty, 'time');
    // Una etapa se emite SOLO cuando tiene GANADOR (rank 1). En vivo, Domtel
    // puebla filas de abandono (DNF/DNS) antes de que llegue ningún clasificado
    // → una etapa con SOLO IRMs y sin puesto 1 aún no se ha decidido: se omite
    // hasta que haya ganador (evita crear una clasificación de etapa vacía de meta).
    if (!stageRows.some((r) => r.rank === 1)) {
      log(`  Stage ${stageNumber} sin ganador todavía (solo abandonos/en curso) — omitida`);
      continue;
    }

    const classifications = [buildClassification(stageNumber, 'stage', 'stage', 'Stage Classification', stageRows)];
    stages.push({
      uciRaceId: synthRaceId(stageNumber),
      stageNumber,
      stageName: `Stage ${stageNumber}`,
      isFinalClassification: false,
      dateKey: null,   // el upsert deriva stageDate de race_days por (raceId, stageNumber)
      raceType: null,
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    classifications.forEach((c) =>
      log(`    E${String(stageNumber).padEnd(2)} ${(c.scope + '/' + c.classKind).padEnd(14)} ${String(c.rowCount).padStart(3)} filas  (event ${c.eventId})`));
  }

  // GENERAL / GENERAL POINTS / GENERAL SPRINT se adjuntan como clasificaciones
  // 'overall' de la ÚLTIMA etapa EMITIDA (misma convención que matsport/sts: la
  // acumulada del día cuelga de su etapa). Como una etapa solo entra en `stages`
  // cuando tiene ganador, cuelgan siempre de la última etapa contestada; sin
  // ninguna etapa con ganador (arranque de carrera) no se emiten sueltas.
  const lastStage = stages.length ? stages[stages.length - 1] : null;
  if (lastStage) {
    if (generalRows && generalRows.length) {
      lastStage.classifications.push(
        buildClassification(lastStage.stageNumber, 'gc', 'stage', 'Stage General Classification', generalRows));
      log(`    E${lastStage.stageNumber}  gc/stage        ${String(generalRows.length).padStart(3)} filas  (GENERAL adjunta)`);
    }
    if (pointsRows && pointsRows.length) {
      lastStage.classifications.push(
        buildClassification(lastStage.stageNumber, 'points', 'overall', 'Overall Points Classification', pointsRows));
      log(`    E${lastStage.stageNumber}  points/overall  ${String(pointsRows.length).padStart(3)} filas  (GENERAL POINTS adjunta)`);
    }
    if (sprintRows && sprintRows.length) {
      lastStage.classifications.push(
        buildClassification(lastStage.stageNumber, 'kom', 'overall', 'Overall Sprints Classification', sprintRows));
      log(`    E${lastStage.stageNumber}  kom/overall     ${String(sprintRows.length).padStart(3)} filas  (GENERAL SPRINT adjunta)`);
    }
    lastStage.classificationCount = lastStage.classifications.length;
  }

  // Última etapa de la carrera (quirk UCI 085, igual que matsport/tissot/sts/
  // raceresult): si el cron nos dijo cuántas etapas tiene la carrera (--total-stages,
  // derivado de race_days) y la etapa procesada es esa, las acumuladas ya son
  // DEFINITIVAS → se clonan en una pseudo-etapa "Final Classification" (stageNumber
  // NULL, isFinalClassification=true, scope='stage') para que el feed/pestaña "F"
  // muestren la general de la carrera, no "la del día". No sustituye al gc/stage
  // colgado de la última etapa numerada (ambas conviven, igual que las demás fuentes).
  // También al pedir explícitamente la última etapa: es el caso operativo de
  // re-fetch puntual tras meta. Limitar a una etapa anterior nunca puede crear
  // una final porque `lastStage.stageNumber` no alcanza `TOTAL_STAGES`.
  if (lastStage && TOTAL_STAGES != null && lastStage.stageNumber === TOTAL_STAGES) {
    const finalClassifications = [];
    if (generalRows && generalRows.length)
      finalClassifications.push(buildClassification(FINAL_SLOT, 'gc', 'stage', 'General Classification', generalRows));
    if (pointsRows && pointsRows.length)
      finalClassifications.push(buildClassification(FINAL_SLOT, 'points', 'stage', 'Points Classification', pointsRows));
    if (sprintRows && sprintRows.length)
      finalClassifications.push(buildClassification(FINAL_SLOT, 'kom', 'stage', 'Sprints Classification', sprintRows));
    if (finalClassifications.length) {
      stages.push({
        uciRaceId: synthRaceId(FINAL_SLOT),
        stageNumber: null,
        stageName: 'Final Classification',
        isFinalClassification: true,
        dateKey: null,
        raceType: null,
        startLocation: null,
        classificationCount: finalClassifications.length,
        classifications: finalClassifications,
      });
      log(`    FINAL (carrera terminada, ${TOTAL_STAGES} etapas): ${finalClassifications.length} clasificaciones desde la E${lastStage.stageNumber}`);
    }
  }

  if (!stages.length) { log('Sin etapas con resultados publicados.'); }

  const out = {
    competitionId: Number(COMPETITION_ID),
    disciplineId: 10,
    source: 'domtel',
    domtelCode: PID ? String(PID) : null,
    fetchedAt: new Date().toISOString(),
    stageCount: stages.length,
    stages,
  };

  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`\n✅ ${stages.length} etapas, ${stages.reduce((a, s) => a + s.classificationCount, 0)} clasificaciones → ${file}`);
  if (PRETTY) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// Solo se ejecuta si se invoca como script; importarlo (tests) no dispara nada.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
