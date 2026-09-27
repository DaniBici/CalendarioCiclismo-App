#!/usr/bin/env node
/** Dossiers oficiales del Tour of South Bohemia: descubrimiento HTML y PDF. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestCompetitionId, synthRaceId, synthEventId } from './pdf-results-ids.mjs';
export { suggestCompetitionId } from './pdf-results-ids.mjs';

export const RESULTS_PAGE = 'https://www.okolojiznichcech.cz/vysledky.html';
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const plain = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const htmlText = (value) => clean(value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&'));
const log = (value) => process.stderr.write(`${value}\n`);
const TIME = '\\d+:[0-5]\\d:[0-5]\\d';
const ROW_START = /^(?:(\d+)\s+)?(\d+)\s+[A-Z]{3}\s+(\d{4})\s+\d{11}\s*(\*)?\s*(.*)$/;

export function pdfLinksFromHtml(html) {
  const links = new Map();
  let currentStage = null;
  let resultsHeading = false;
  // El encabezado pertenece al bloque siguiente; no deducir la etapa del nombre
  // del archivo (solo contiene fecha y revisión). Un encabezado nuevo lo reinicia.
  for (const match of String(html).matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>|<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (match[1] != null) {
      const heading = plain(htmlText(match[1]));
      if (/^VYSLEDKY\b/.test(heading)) resultsHeading = true;
      const ordinal = heading.match(/^VYSLEDKY\s+(IV|III|II|I|[1-9]\d*)\.\s*ETAPA\b/)?.[1];
      currentStage = ordinal ? ({ I: 1, II: 2, III: 3, IV: 4 }[ordinal] ?? Number(ordinal)) : null;
      continue;
    }
    if (!currentStage || !/\.pdf(?:\?|$)/i.test(match[2])) continue;
    const url = new URL(match[2].replace(/&amp;/gi, '&'), RESULTS_PAGE);
    if (url.origin !== new URL(RESULTS_PAGE).origin || !url.pathname.startsWith('/uploads/soubory/')) continue;
    // Dos archivos diferentes bajo la misma etapa requieren revisión: el orden
    // del HTML no demuestra cuál reemplaza al otro.
    if (links.has(currentStage) && links.get(currentStage) !== url.href) {
      throw new Error(`etapa ${currentStage}: varios dossiers publicados; revisar la versión vigente`);
    }
    links.set(currentStage, url.href);
  }
  if (!resultsHeading) throw new Error('la respuesta no es la página oficial de resultados');
  return links;
}

function documentBlock(text, code, stageNumber, year, expectedDate) {
  const headers = [...text.matchAll(/^\s*([A-Z]{1,2})(\d+)\s+(?:po\s+)?\d+\.\s*etap[^\n]*/gm)];
  const header = headers.find((item) => item[1] === code);
  if (!header) throw new Error(`falta cuadro ${code}${stageNumber}`);
  const headingStage = Number(header[0].match(/(?:po\s+)?(\d+)\.\s*etap/)?.[1]);
  if (Number(header[2]) !== stageNumber || headingStage !== stageNumber) {
    throw new Error(`${code}: el PDF corresponde a la etapa ${header[2]}, no a la ${stageNumber}`);
  }
  const next = headers.find((item) => item.index > header.index);
  const block = text.slice(header.index, next?.index ?? text.length);
  const date = block.match(/Datum\s*\/\s*Date:\s*(\d{2})\.(\d{2})\.(20\d{2})/);
  const dateKey = date ? `${date[3]}-${date[2]}-${date[1]}` : null;
  if (!dateKey || Number(date[3]) !== year || (expectedDate && expectedDate !== dateKey)) {
    throw new Error(`${code}: fecha ${dateKey || 'ausente'}, esperada ${expectedDate || year}`);
  }
  return { block, dateKey };
}

function seconds(time) {
  if (!new RegExp(`^${TIME}$`).test(time)) throw new Error(`tiempo inválido: ${time}`);
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function gap(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error('diferencia inválida');
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = String(value % 60).padStart(2, '0');
  return h ? `+${h}:${String(m).padStart(2, '0')}:${s}` : m ? `+${m}:${s}` : `+${s}`;
}

function timeRow(rank, bib, absolute, difference) {
  seconds(absolute);
  const gapText = rank === 1 ? null : gap(difference);
  return { rank, rankText: String(rank), bib, resultValue: rank === 1 ? absolute : gapText,
    timeText: rank === 1 ? absolute : null, gapText, points: null, irm: null };
}

function validateRows(rows, label, expectedCount = null, team = false) {
  const ranked = rows.filter((row) => row.rank != null);
  if (!ranked.length || ranked.some((row, index) => row.rank !== index + 1)) throw new Error(`${label}: puestos incompletos`);
  const keys = rows.map((row) => team ? row.teamName : row.bib);
  if (new Set(keys).size !== rows.length) throw new Error(`${label}: duplicados`);
  if (expectedCount != null && rows.length !== expectedCount) throw new Error(`${label}: ${rows.length} filas, se publican ${expectedCount}`);
  return rows;
}

function individualTimes(block, label, timeColumns) {
  const count = block.match(/num\.\s*of riders:\s*(\d+)/i);
  if (!count) throw new Error(`${label}: falta el total de participantes`);
  const records = [];
  for (const line of block.slice(0, count.index).split(/\r?\n/)) {
    const normalized = clean(line);
    const start = normalized.match(ROW_START);
    if (start) records.push({ rank: start[1] ? Number(start[1]) : null, bib: String(Number(start[2])),
      birthYear: Number(start[3]), young: !!start[4], text: start[5] });
    else if (records.length) records.at(-1).text += ` ${normalized}`;
  }
  for (const record of records) {
    if (record.rank == null) {
      const irm = record.text.match(/\b(DNF|DNS|OTL|DSQ)\b/)?.[1];
      if (!irm) throw new Error(`${label}: dorsal ${record.bib} sin puesto ni IRM`);
      record.row = { rank: null, rankText: irm, bib: record.bib, resultValue: null, timeText: null, gapText: null, points: null, irm };
    } else {
      if (new RegExp(`${TIME}[.,]\\d`).test(record.text)) throw new Error(`${label}: precisión fraccional no soportada; revisar el dossier`);
      const times = record.text.match(new RegExp(`\\b${TIME}\\b`, 'g')) || [];
      if (times.length !== timeColumns) throw new Error(`${label}: dorsal ${record.bib}, columnas de tiempo inesperadas`);
      record.absolute = times[0];
      record.difference = seconds(times[1]);
      record.row = timeRow(record.rank, record.bib, times[0], record.difference);
    }
  }
  validateRows(records.map((r) => r.row), label, Number(count[1]));
  const leader = seconds(records[0].absolute);
  for (const record of records.filter((r) => r.rank != null)) {
    // No ordenar por tiempo: el jurado puede acreditar tiempo de pelotón a un
    // corredor relegado en el orden de llegada por un incidente en los últimos km.
    if (seconds(record.absolute) - leader !== record.difference) throw new Error(`${label}: tiempo y diferencia incoherentes, dorsal ${record.bib}`);
  }
  return { records, expectedCount: Number(count[1]) };
}

function pointsRows(block, label) {
  const rows = [];
  for (const line of block.split(/\r?\n/)) {
    const match = clean(line).match(ROW_START);
    if (!match) continue;
    const total = match[5].match(/\s(\d+)$/)?.[1];
    if (!match[1] || total == null) throw new Error(`${label}: fila sin puesto o total`);
    const rank = Number(match[1]);
    rows.push({ rank, rankText: String(rank), bib: String(Number(match[2])), resultValue: total,
      timeText: total, gapText: null, points: Number(total), irm: null });
  }
  return validateRows(rows, label);
}

function teamRows(block) {
  const rows = [];
  for (const line of block.split(/\r?\n/)) {
    const match = clean(line).match(/^(\d+)\s+[A-Z]{3}\s+(.+?)\s+[A-Z]{3}\s+\d+\s+(.*)$/);
    if (!match) continue;
    const totals = match[3].match(new RegExp(`(${TIME})\\s+(${TIME})$`));
    if (!totals) throw new Error('equipos: fila sin tiempo y diferencia acumulados');
    const teamName = match[2];
    const row = timeRow(Number(match[1]), null, totals[1], seconds(totals[2]));
    rows.push({ ...row, riderDisplay: teamName, teamName });
  }
  return validateRows(rows, 'equipos', null, true);
}

export function parsePdf(year, stageNumber, text, { competitionId, expectedDate = null, totalStages = null, sourcePdfUrl = null } = {}) {
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('competitionId sintético no válido');
  if (!Number.isInteger(stageNumber) || stageNumber < 1) throw new Error('etapa no válida');
  const firstPage = text.split('\f')[0];
  const documentYear = Number(firstPage.match(/TOUR OF SOUTH BOHEMIA\s+(20\d{2})/)?.[1]);
  if (documentYear !== year) throw new Error(`PDF de otra carrera o año (${documentYear || '?'}, esperado ${year})`);
  const stageBlock = documentBlock(text, 'E', stageNumber, year, expectedDate);
  const gcBlock = documentBlock(text, 'A', stageNumber, year, stageBlock.dateKey);
  const pointsBlock = documentBlock(text, 'P', stageNumber, year, stageBlock.dateKey);
  const teamsBlock = documentBlock(text, 'G', stageNumber, year, stageBlock.dateKey);
  const arrival = individualTimes(stageBlock.block, 'llegada', 3);
  const general = individualTimes(gcBlock.block, 'general', 2);
  const pointsParts = pointsBlock.block.split(/INDIVIDUAL POINT CLASSIFICATION|CLIMBING COMPETITION/);
  if (pointsParts.length !== 3) throw new Error('faltan los cuadros acumulados de puntos/montaña');

  // Reglamento oficial 2026, apartado D: nacidos en 2004–2007, según orden de
  // la general. El asterisco del dossier debe coincidir con esa elegibilidad U23.
  // No se usa el portador sustituto del maillot ni la llegada de etapa.
  for (const record of general.records) {
    if (record.young !== (record.birthYear >= year - 22 && record.birthYear <= year - 19)) throw new Error('criterio U23 del dossier no coincide con el reglamento');
  }
  const eligible = general.records.filter((record) => record.young);
  const youthLeader = eligible.find((record) => record.rank != null);
  if (!youthLeader) throw new Error('falta ganador U23');
  let youthRank = 0;
  const youth = eligible.map((record) => record.rank == null ? record.row
    : timeRow(++youthRank, record.bib, record.absolute, seconds(record.absolute) - seconds(youthLeader.absolute)));
  validateRows(youth, 'jóvenes', eligible.length);

  const kinds = [
    ['stage', 'stage', 'Stage Classification', arrival.records.map((r) => r.row), arrival.expectedCount],
    ['gc', 'stage', 'General Classification', general.records.map((r) => r.row), general.expectedCount],
    ['points', 'overall', 'Overall Points Classification', pointsRows(pointsParts[1], 'puntos')],
    ['kom', 'overall', 'Overall Mountains Classification', pointsRows(pointsParts[2], 'montaña')],
    ['youth', 'overall', 'Overall Youth Classification', youth, eligible.length],
    ['teams', 'overall', 'Overall Teams Classification', teamRows(teamsBlock.block)],
  ];
  const classifications = kinds.map(([classKind, scope, eventName, rows, expectedRowCount]) => ({
    eventId: synthEventId(competitionId, stageNumber, classKind), classKind, scope, eventName,
    isTeamEvent: classKind === 'teams', rowCount: rows.length, ...(expectedRowCount != null ? { expectedRowCount } : {}), rows,
  }));
  const stage = { uciRaceId: synthRaceId(competitionId, stageNumber), stageNumber, dateKey: stageBlock.dateKey,
    raceType: 'IRR', isFinalClassification: false, eventName: `Stage ${stageNumber}`, sourcePdfUrl, classifications };
  const final = stageNumber === totalStages ? { ...stage, uciRaceId: synthRaceId(competitionId, 99), stageNumber: null,
    isFinalClassification: true, eventName: 'Final Classification', classifications: classifications.filter((cl) => cl.classKind !== 'stage')
      .map((cl) => ({ ...cl, scope: 'stage', eventId: synthEventId(competitionId, 99, cl.classKind) })) } : null;
  return { stage, final };
}

async function fetchNoCache(url, binary = false) {
  const target = new URL(url);
  target.searchParams.set('_', String(Date.now()));
  const response = await fetch(target, { signal: AbortSignal.timeout(45000), headers: {
    'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)',
    'Cache-Control': 'no-cache', Pragma: 'no-cache',
  } });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return binary ? response.arrayBuffer() : response.text();
}

async function pdfToText(url) {
  const dir = mkdtempSync(join(tmpdir(), 'southbohemia-results-'));
  try {
    const file = join(dir, 'results.pdf');
    writeFileSync(file, Buffer.from(await fetchNoCache(url, true)));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', timeout: 45000, maxBuffer: 30 * 1024 * 1024 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (key, fallback = null) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : fallback;
  const year = Number(arg('--year')), raceId = arg('--race-id'), competitionId = Number(arg('--competition-id'));
  if (!Number.isInteger(year) || year < 2000) throw new Error('falta --year');
  if (argv.includes('--suggest-id')) {
    if (!raceId) throw new Error('falta --race-id');
    process.stdout.write(`${suggestCompetitionId(raceId)}\n`); return;
  }
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('falta --competition-id negativo');
  const totalStages = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
  const stageDates = JSON.parse(arg('--stage-dates', '{}'));
  const requested = arg('--stage') == null ? Array.from({ length: totalStages || 0 }, (_, i) => i + 1) : [Number(arg('--stage'))];
  if (!requested.length || requested.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('usa --stage o --total-stages válidos');
  const fixture = arg('--fixture') ? JSON.parse(readFileSync(resolve(arg('--fixture')), 'utf8')) : null;
  const links = pdfLinksFromHtml(fixture?.html ?? await fetchNoCache(RESULTS_PAGE));
  const stages = [];
  for (const stageNumber of requested) {
    const sourcePdfUrl = links.get(stageNumber);
    if (!sourcePdfUrl) { log(`∅ etapa ${stageNumber}: dossier aún no publicado`); continue; }
    const text = fixture?.pdfTextByUrl?.[sourcePdfUrl] ?? await pdfToText(sourcePdfUrl);
    const parsed = parsePdf(year, stageNumber, text, { competitionId, expectedDate: stageDates[stageNumber] ?? null, totalStages, sourcePdfUrl });
    stages.push(parsed.stage);
    if (parsed.final) stages.push(parsed.final);
  }
  const output = { ...(raceId ? { raceId } : {}), competitionId, disciplineId: 10, source: 'southbohemia', fetchedAt: new Date().toISOString(), stages };
  const out = arg('--out', '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${competitionId}.json`), JSON.stringify(output, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exitCode = 1; });
}
