#!/usr/bin/env node
/** Dossiers PDF de AT Results Service (Asia): un PDF por etapa en su servidor. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestCompetitionId, synthRaceId, synthEventId } from './pdf-results-ids.mjs';
export { suggestCompetitionId } from './pdf-results-ids.mjs';

export const PDF_BASE = 'https://atresult.synology.me/PDF';
const FINAL_SLOT = 99;
const log = (value) => process.stderr.write(`${value}\n`);
const TIME = '\\d{1,3}:[0-5]\\d:[0-5]\\d';
const GAP = '(?:\\d{1,3}:)?[0-5]?\\d:[0-5]\\d';
const MONTHS = { JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6, JULY: 7, AUGUST: 8,
  SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12 };
const DATE = /\b(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),\s+(\d{1,2})\s+([A-Z]+)\s+(20\d{2})\b/i;
const MOVEMENT = '(?:[▲▼]\\s*\\d+|=|-|NEW)?';
const STAGE_ROW = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+(?:\\d{11}\\s+)?\\S.*?\\s(${TIME})(?:\\s+(${GAP}))?(?:\\s+\\d{1,2})?(?:\\s+\\S+)?\\s*$`);
const GC_ROW = new RegExp(`^\\s*(\\d+)\\s+${MOVEMENT}\\s+(\\d+)\\s+(?:\\d{11}\\s+)?\\S.*?\\s(${TIME})(?:\\s+(${GAP}))?\\s*$`);
const TEAM_ROW = new RegExp(`^\\s*(\\d+)\\s+${MOVEMENT}\\s+(\\S.*?)\\s{2,}([A-Z0-9]{3})\\s+(${TIME})(?:\\s+(${GAP}))?\\s*$`);
const IRM_ROW = /^\s*(DNF|DNS|OTL|DSQ)\s+(\d+)\b/;
const POINTS_ROW = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s+([A-Z0-9]{3})\s+(\d+)\s*$/;

/** atresultsCode: `<carpeta>/<prefijo>` o un único código cuando ambos coinciden. */
export function parseCode(code) {
  const match = String(code || '').trim().match(/^([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?$/);
  if (!match) throw new Error(`atresultsCode no válido: ${code}`);
  return { folder: match[1], prefix: match[2] || match[1] };
}

export function stagePdfUrl(code, stageNumber) {
  const { folder, prefix } = parseCode(code);
  return `${PDF_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(`${prefix} Results Stage ${stageNumber}`)}.pdf`;
}

function dateKeyOf(text) {
  const match = String(text).match(DATE);
  const month = match && MONTHS[match[2].toUpperCase()];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}

function seconds(value) {
  const parts = String(value).split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n))) throw new Error(`tiempo inválido: ${value}`);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function gapText(value) {
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = String(value % 60).padStart(2, '0');
  return h ? `+${h}:${String(m).padStart(2, '0')}:${s}` : m ? `+${m}:${s}` : `+${s}`;
}

function timeRow(rank, bib, absolute, difference) {
  const gap = rank === 1 ? null : gapText(difference);
  return { rank, rankText: String(rank), bib, resultValue: rank === 1 ? absolute : gap,
    timeText: rank === 1 ? absolute : null, gapText: gap, points: null, irm: null };
}

// Puestos consecutivos; se admite el empate impreso (mismo puesto que la fila anterior).
function validateRanks(rows, label, keyOf = (row) => row.bib) {
  const ranked = rows.filter((row) => row.rank != null);
  if (!ranked.length || ranked[0].rank !== 1) throw new Error(`${label}: falta el primer puesto`);
  ranked.forEach((row, index) => {
    if (index && row.rank !== index + 1 && row.rank !== ranked[index - 1].rank) throw new Error(`${label}: puestos incompletos junto al ${row.rank}`);
  });
  const keys = rows.map(keyOf);
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) throw new Error(`${label}: dorsales duplicados o ausentes`);
  return rows;
}

// Bloque entre un encabezado y el siguiente de la lista; los encabezados se
// repiten idénticos en todas las ediciones observadas del sistema AT.
function section(text, start, ends, label) {
  const from = text.search(start);
  if (from < 0) throw new Error(`falta el cuadro ${label}`);
  const rest = text.slice(from);
  const firstLine = rest.indexOf('\n');
  const body = rest.slice(firstLine + 1);
  const cut = Math.min(...ends.map((end) => { const i = body.search(end); return i < 0 ? Infinity : i; }));
  return body.slice(0, cut);
}

function timedRows(block, pattern, label, { stage = false } = {}) {
  const records = [];
  for (const line of block.split(/\r?\n/)) {
    const irm = line.match(IRM_ROW);
    if (irm) { records.push({ row: { rank: null, rankText: irm[1], bib: String(Number(irm[2])), resultValue: null,
      timeText: null, gapText: null, points: null, irm: irm[1] } }); continue; }
    const match = line.match(pattern);
    if (!match) continue;
    // En la general, un nuevo puesto 1 indica que empieza otro cuadro sin encabezado legible.
    if (!stage && Number(match[1]) === 1 && records.some((r) => r.row.rank != null)) break;
    records.push({ rank: Number(match[1]), bib: String(Number(match[2])), absolute: match[3], gap: match[4] ?? null });
  }
  const leader = records.find((r) => r.rank === 1);
  if (!leader) throw new Error(`${label}: falta el primer puesto`);
  const base = seconds(leader.absolute);
  for (const record of records.filter((r) => r.rank != null)) {
    const difference = seconds(record.absolute) - base;
    // El jurado puede reordenar la llegada con tiempo de grupo; la diferencia
    // impresa debe coincidir con el tiempo absoluto, sin reordenar filas.
    if (record.rank !== 1 && (record.gap == null || seconds(record.gap) !== difference)) throw new Error(`${label}: tiempo y diferencia incoherentes, dorsal ${record.bib}`);
    if (difference < 0) throw new Error(`${label}: tiempo menor que el del líder, dorsal ${record.bib}`);
    record.row = timeRow(record.rank, record.bib, record.absolute, difference);
  }
  return validateRanks(records.map((r) => r.row), label);
}

function teamRows(block) {
  const rows = [];
  let leader = null;
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(TEAM_ROW);
    if (!match) continue;
    const rank = Number(match[1]);
    if (rank === 1 && rows.length) break;
    leader ??= seconds(match[4]);
    const difference = seconds(match[4]) - leader;
    if (rank !== 1 && (match[5] == null || seconds(match[5]) !== difference)) throw new Error(`equipos: tiempo y diferencia incoherentes, ${match[2]}`);
    const teamName = match[2].trim();
    rows.push({ ...timeRow(rank, null, match[4], difference), riderDisplay: teamName, teamName });
  }
  return validateRanks(rows, 'equipos', (row) => row.teamName);
}

// Puntos y montaña imprimen a la izquierda el detalle de la etapa y a la derecha
// la clasificación acumulada; la columna derecha empieza en el segundo PLACE.
function overallPointsRows(block, label) {
  const rows = [];
  let column = null;
  for (const line of block.split(/\r?\n/)) {
    const places = [...line.matchAll(/\bPLACE\b/g)].map((m) => m.index);
    if (places.length >= 2) { column = places[1]; continue; }
    if (column == null || line.length <= column) continue;
    const match = line.slice(Math.max(0, column - 3)).match(POINTS_ROW);
    if (!match) continue;
    const points = Number(match[5]);
    rows.push({ rank: Number(match[1]), rankText: match[1], bib: String(Number(match[2])), resultValue: String(points),
      timeText: String(points), gapText: null, points, irm: null });
  }
  if (column == null) throw new Error(`${label}: falta la cabecera de columnas`);
  return validateRanks(rows, label);
}

export function parsePdf(year, stageNumber, text, { competitionId, expectedDate = null, totalStages = null, sourcePdfUrl = null } = {}) {
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('competitionId sintético no válido');
  if (!Number.isInteger(stageNumber) || stageNumber < 1) throw new Error('etapa no válida');
  const cover = text.split('\f')[0];
  if (!/TIMING\s*(?:&|and)\s*RESULTS PROCESSING by AT RESULTS SERVICE/i.test(text)) throw new Error('el PDF no procede de AT Results Service');
  const coverStage = Number(cover.match(/RESULTS OF\s+STAGE\s+(\d+)/)?.[1]);
  if (coverStage !== stageNumber) throw new Error(`el PDF corresponde a la etapa ${coverStage || '?'}, no a la ${stageNumber}`);
  const dateKey = dateKeyOf(cover);
  if (!dateKey || Number(dateKey.slice(0, 4)) !== year || !new RegExp(`\\b${year}\\b`).test(cover.split(/RESULTS OF/)[0])) {
    throw new Error(`PDF de otra edición (${dateKey || 'sin fecha'}, esperado ${year})`);
  }
  if (expectedDate && expectedDate !== dateKey) throw new Error(`fecha ${dateKey}, esperada ${expectedDate}`);

  const stageBlock = section(text, /^\s*STAGE INDIVIDUAL CLASSIFICATION\s*$/m, [/No of Riders Finished/], 'de llegada');
  // Resumen del jurado: tomaron la salida + no salieron = filas del cuadro de llegada.
  const summary = (label) => Number(text.match(new RegExp(`No of ${label}\\s*:\\s*(\\d+)`))?.[1]);
  const finished = summary('Riders Finished');
  const declared = summary('Starters') + summary('Riders Not Starting');
  const stageRows = timedRows(stageBlock, STAGE_ROW, 'llegada', { stage: true });
  const classified = stageRows.filter((row) => row.rank != null).length;
  if (!Number.isInteger(finished) || classified !== finished) throw new Error(`llegada: ${classified} clasificados, se publican ${finished}`);
  if (!Number.isInteger(declared) || stageRows.length !== declared) throw new Error(`llegada: ${stageRows.length} filas, se declaran ${declared}`);

  const gcBlock = section(text, /^\s*INDIVIDUAL GENERAL CLASSIFICATION BY TIME\b.*$/m, [/^\s*BEST ASIAN RIDER\b/m, /^\s*BEST ASEAN RIDER\b/m, /^\s*TEAM GENERAL CLASSIFICATION\b/m], 'general');
  const gcRows = timedRows(gcBlock, GC_ROW, 'general');
  const teamsBlock = section(text, /^\s*TEAM GENERAL CLASSIFICATION BY TIME\b.*$/m, [/^\s*BEST ASIAN TEAM\b/m, /^\s*ORDER of TEAM CAR\b/mi, /BEST SPRINTERS'? CLASSIFICATION/], 'equipos');
  const pointsBlock = section(text, /BEST SPRINTERS'? CLASSIFICATION.*$/m, [/BEST CLIMBERS'? CLASSIFICATI?ON/], 'puntos');
  const komBlock = section(text, /BEST CLIMBERS'? CLASSIFICATI?ON.*$/m, [/^\s*START LIST\b/m, /^\s*START LIST OF\b/m], 'montaña');

  const kinds = [
    ['stage', 'stage', 'Stage Classification', stageRows, declared],
    ['gc', 'stage', 'General Classification', gcRows],
    ['points', 'overall', 'Overall Points Classification', overallPointsRows(pointsBlock, 'puntos')],
    ['kom', 'overall', 'Overall Mountains Classification', overallPointsRows(komBlock, 'montaña')],
    ['teams', 'overall', 'Overall Teams Classification', teamRows(teamsBlock)],
  ];
  const classifications = kinds.map(([classKind, scope, eventName, rows, expectedRowCount]) => ({
    eventId: synthEventId(competitionId, stageNumber, classKind), classKind, scope, eventName,
    isTeamEvent: classKind === 'teams', rowCount: rows.length,
    ...(expectedRowCount != null ? { expectedRowCount } : {}), rows,
  }));
  const stage = { uciRaceId: synthRaceId(competitionId, stageNumber), stageNumber, dateKey, raceType: 'IRR',
    isFinalClassification: false, eventName: `Stage ${stageNumber}`, sourcePdfUrl, classifications };
  const final = stageNumber === totalStages ? { ...stage, uciRaceId: synthRaceId(competitionId, FINAL_SLOT), stageNumber: null,
    isFinalClassification: true, eventName: 'Final Classification', classifications: classifications.filter((cl) => cl.classKind !== 'stage')
      .map((cl) => ({ ...cl, scope: 'stage', eventId: synthEventId(competitionId, FINAL_SLOT, cl.classKind) })) } : null;
  return { stage, final };
}

// El servidor redirige los archivos inexistentes a /404.html: sin seguir la
// redirección, un 3xx/404 significa que el dossier todavía no está publicado.
async function fetchPdf(url) {
  const target = new URL(url);
  target.searchParams.set('_', String(Date.now()));
  const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(45000), headers: {
    'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)',
    'Cache-Control': 'no-cache', Pragma: 'no-cache',
  } });
  if ((response.status >= 300 && response.status < 400) || response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error(`respuesta no PDF en ${url}`);
  return buffer;
}

function pdfToText(buffer) {
  const dir = mkdtempSync(join(tmpdir(), 'atresults-results-'));
  try {
    const file = join(dir, 'results.pdf');
    writeFileSync(file, buffer);
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', timeout: 45000, maxBuffer: 30 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (key, fallback = null) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : fallback;
  const raceId = arg('--race-id');
  if (argv.includes('--suggest-id')) {
    if (!raceId) throw new Error('falta --race-id');
    process.stdout.write(`${suggestCompetitionId(raceId)}\n`); return;
  }
  const code = arg('--code'), year = Number(arg('--year')), competitionId = Number(arg('--competition-id'));
  parseCode(code);
  if (!Number.isInteger(year) || year < 2000) throw new Error('falta --year');
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('falta --competition-id negativo');
  const totalStages = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
  const stageDates = JSON.parse(arg('--stage-dates', '{}'));
  const requested = arg('--stage') == null ? Array.from({ length: totalStages || 0 }, (_, i) => i + 1) : [Number(arg('--stage'))];
  if (!requested.length || requested.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('usa --stage o --total-stages válidos');
  // --fixture: JSON { "<etapa>": "<ruta del .txt de pdftotext -layout>" } para pruebas sin red.
  const fixture = arg('--fixture') ? JSON.parse(readFileSync(resolve(arg('--fixture')), 'utf8')) : null;
  const stages = [];
  for (const stageNumber of requested) {
    const sourcePdfUrl = stagePdfUrl(code, stageNumber);
    let text;
    if (fixture) text = fixture[stageNumber] ? readFileSync(resolve(fixture[stageNumber]), 'utf8') : null;
    else { const buffer = await fetchPdf(sourcePdfUrl); text = buffer && pdfToText(buffer); }
    if (!text) { log(`∅ etapa ${stageNumber}: dossier aún no publicado`); continue; }
    const parsed = parsePdf(year, stageNumber, text, { competitionId, expectedDate: stageDates[stageNumber] ?? null, totalStages, sourcePdfUrl });
    stages.push(parsed.stage);
    if (parsed.final) stages.push(parsed.final);
  }
  const output = { ...(raceId ? { raceId } : {}), competitionId, disciplineId: 10, source: 'atresults', atresultsCode: code,
    fetchedAt: new Date().toISOString(), stages };
  const out = arg('--out', '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${competitionId}.json`), JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exitCode = 1; });
}
