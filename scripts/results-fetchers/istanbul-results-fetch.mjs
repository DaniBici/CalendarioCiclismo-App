#!/usr/bin/env node
/**
 * Tour of Istanbul — resultados oficiales en PDF.
 *
 * La página estable /results/ publica progresivamente un PDF por etapa. Cada
 * dossier incluye llegada, general, puntos, montaña, jóvenes y equipos, además
 * de documentos auxiliares que se ignoran. El fetcher descubre los enlaces en
 * la página; no infiere nombres de archivo ni rutas de uploads.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestCompetitionId, synthRaceId, synthEventId } from './pdf-results-ids.mjs';
export { fnv1a, suggestCompetitionId, synthRaceId, synthEventId } from './pdf-results-ids.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const has = (name) => argv.includes(name);
const YEAR = Number(arg('--year'));
const RACE_ID = arg('--race-id');
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const STAGE_DATES = arg('--stage-dates') ? JSON.parse(arg('--stage-dates')) : {};
const FIXTURE = arg('--fixture');
const RESULTS_PAGE = 'https://tourofistanbul.com.tr/results/';
const UA = 'calendariociclismo.app results sync (+https://calendariociclismo.app)';
const FINAL_SLOT = 99;
const log = (message) => process.stderr.write(`${message}\n`);

const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const plain = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const htmlText = (value) => clean(String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/gi, '&').replace(/&#038;/gi, '&'));
const teamKey = (value) => plain(value).replace(/[.]/g, '').replace(/[–—-]/g, ' ').replace(/\s+/g, ' ').trim();
const TEAM_NAME_ALIASES = new Map([
  ['KONYA BUYUKSEHIR BELEDIYE SPOR', 'Konya Büyükşehir'],
  ['MUGLA BUYUKSEHIR BELEDIYESI SK', 'Mugla BB'],
  ['TEAM VINO NORTH QAZAQSTAN R', 'Team Vino - North Qazaqstan Region'],
]);
const canonicalTeamName = (value) => TEAM_NAME_ALIASES.get(teamKey(value)) || clean(value);

export function pdfLinksFromHtml(html, year) {
  const links = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(match[1].replace(/&amp;/gi, '&').replace(/&#038;/gi, '&'), RESULTS_PAGE).href;
    if (!new URL(url).pathname.includes(`/${year}/`)) continue;
    const stageNumber = Number(plain(htmlText(match[2])).match(/STAGE\s+(\d+)\s+RESULTS?/)?.[1]);
    if (Number.isInteger(stageNumber) && stageNumber > 0) links.set(stageNumber, url);
  }
  return links;
}

function dateKey(text) {
  const match = String(text).match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  return match ? `${match[3]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}` : null;
}

function section(text, startPattern, endPattern) {
  const start = String(text).search(startPattern);
  if (start < 0) return '';
  const tail = String(text).slice(start);
  const end = endPattern ? tail.slice(1).search(endPattern) : -1;
  return end < 0 ? tail : tail.slice(0, end + 1);
}

function normalizeAbsoluteTime(value) {
  const match = clean(value).match(/^(\d+):(\d{2}):(\d{2})$/);
  return match ? `${Number(match[1])}:${match[2]}:${match[3]}` : null;
}

function secondsOf(value) {
  const time = normalizeAbsoluteTime(value);
  if (!time) return null;
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function secondsToGap(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) return null;
  if (seconds < 60) return `+${String(seconds).padStart(2, '0')}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `+${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `+${minutes}:${String(remainder).padStart(2, '0')}`;
}

function normalizeGap(value) {
  const gap = clean(value);
  if (gap === '-') return '+00';
  const match = gap.match(/^\+(\d+):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return minutes === 0 ? `+${String(seconds).padStart(2, '0')}` : `+${minutes}:${String(seconds).padStart(2, '0')}`;
}

function timeRow(rank, bib, absolute, sourceGap = null, winnerSeconds = null) {
  const time = normalizeAbsoluteTime(absolute);
  if (!time) return null;
  const gapText = rank === 1
    ? null
    : sourceGap == null
      ? secondsToGap(secondsOf(time) - winnerSeconds)
      : normalizeGap(sourceGap);
  if (rank !== 1 && !gapText) return null;
  const resultValue = rank === 1 ? time : gapText;
  return {
    rank,
    rankText: String(rank),
    bib: String(Number(bib)),
    resultValue,
    timeText: rank === 1 ? time : null,
    gapText,
    points: null,
    irm: null,
  };
}

function validateRows(rows, label, { team = false } = {}) {
  const ranked = rows.filter((row) => row.rank != null);
  if (!ranked.length || ranked[0].rank !== 1 || ranked.some((row, index) => row.rank !== index + 1)) {
    throw new Error(`${label}: puestos incompletos o sin ganador`);
  }
  const identities = rows.map((row) => team ? row.teamName : row.bib);
  if (new Set(identities).size !== identities.length) throw new Error(`${label}: filas duplicadas`);
  return rows;
}

function stageRows(block) {
  const rows = [];
  for (const line of String(block).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+.+?\s+(\d+:\d{2}:\d{2})\s+(-|\+\d+:\d{2})(?:\s|$)/);
    if (!match) continue;
    const row = timeRow(Number(match[1]), match[2], match[3], match[4]);
    if (row) rows.push(row);
  }
  for (const line of String(block).split(/\r?\n/)) {
    const match = line.match(/^\s*(DNF|DNS|OTL|DSQ)\s+(\d+)\b/i);
    if (!match) continue;
    const irm = match[1].toUpperCase();
    rows.push({ rank: null, rankText: irm, bib: String(Number(match[2])), resultValue: null, timeText: null, gapText: null, points: null, irm });
  }
  return validateRows(rows, 'Stage Classification');
}

function generalRows(block) {
  const rows = [];
  for (const line of String(block).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+.+?\s+(\d+:\d{2}:\d{2})\s+(-|\+\d+:\d{2})(?:\s|$)/);
    if (!match) continue;
    const row = timeRow(Number(match[1]), match[2], match[3], match[4]);
    if (row) rows.push(row);
  }
  return validateRows(rows, 'General Classification');
}

function overallPointsRows(block, label) {
  const general = section(block, /GENERAL TOTAL/i, null);
  const rows = [];
  for (const line of general.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+.+?\s+(\d+)\s+pts?\b/i);
    if (!match) continue;
    const rank = Number(match[1]);
    const points = Number(match[3]);
    rows.push({ rank, rankText: String(rank), bib: String(Number(match[2])), resultValue: String(points), timeText: String(points), gapText: null, points, irm: null });
  }
  return validateRows(rows, label);
}

function overallYouthRows(block) {
  const general = section(block, /General classification/i, null);
  const extracted = [];
  for (const line of general.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+.+?\s+(\d+:\d{2}:\d{2})\s*$/);
    if (match) extracted.push({ rank: Number(match[1]), bib: match[2], time: match[3] });
  }
  const winnerSeconds = secondsOf(extracted[0]?.time);
  const rows = extracted.map((row) => timeRow(row.rank, row.bib, row.time, null, winnerSeconds)).filter(Boolean);
  return validateRows(rows, 'Overall Youth Classification');
}

function overallTeamRows(block) {
  const general = section(block, /General classification/i, null);
  const rows = [];
  for (const line of general.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\.\s+(.+?)\s{2,}(\d+:\d{2}:\d{2})\s+(-|\+\d+:\d{2})\s*$/);
    if (!match) continue;
    const rank = Number(match[1]);
    const time = normalizeAbsoluteTime(match[3]);
    const gapText = rank === 1 ? null : normalizeGap(match[4]);
    const teamName = canonicalTeamName(match[2]);
    rows.push({
      rank,
      rankText: String(rank),
      bib: null,
      riderDisplay: teamName,
      teamName,
      resultValue: rank === 1 ? time : gapText,
      timeText: rank === 1 ? time : null,
      gapText,
      points: null,
      irm: null,
    });
  }
  return validateRows(rows, 'Overall Teams Classification', { team: true });
}

function classification(competitionId, stageNumber, classKind, scope, eventName, rows, isTeamEvent = false) {
  return {
    eventId: synthEventId(competitionId, stageNumber, classKind),
    classKind,
    scope,
    eventName,
    isTeamEvent,
    winnerName: isTeamEvent ? rows[0].teamName : null,
    rowCount: rows.length,
    expectedRowCount: rows.length,
    rows,
  };
}

export function parsePdf(year, stageNumber, text, {
  competitionId,
  expectedDate = null,
  totalStages = null,
  sourcePdfUrl = null,
} = {}) {
  if (!Number.isInteger(year) || year < 2000) throw new Error('año no válido');
  if (!Number.isInteger(stageNumber) || stageNumber < 1) throw new Error('etapa no válida');
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('competitionId sintético no válido');
  if (!/TOUR OF ISTANBUL/i.test(text)) throw new Error('el PDF no corresponde al Tour of Istanbul');

  // Algunas jornadas omiten el ordinal en la llegada. La general del mismo
  // dossier sigue identificando la etapa; todas las cabeceras deben coincidir.
  const headingStages = [...String(text).matchAll(/\b(\d+)(?:st|nd|rd|th) Stage classification\b|General classification after stage\s+(\d+)\b/gi)]
    .map((match) => Number(match[1] || match[2]));
  const wrongStage = headingStages.find((value) => value !== stageNumber);
  if (!headingStages.length || wrongStage != null) {
    throw new Error(`el PDF corresponde a la etapa ${wrongStage || '?'}, no a la ${stageNumber}`);
  }

  const publishedDate = dateKey(text);
  if (!publishedDate) throw new Error('el PDF no contiene fecha');
  if (Number(publishedDate.slice(0, 4)) !== year) throw new Error(`el PDF es de ${publishedDate.slice(0, 4)}, no de ${year}`);
  if (expectedDate && publishedDate !== expectedDate) throw new Error(`el PDF es de ${publishedDate}, no de ${expectedDate}`);

  const stageBlock = section(text, /^\s*(?:\d+(?:st|nd|rd|th) )?Stage classification\b/im, /General classification after stage\s+\d+/i);
  const gcBlock = section(text, /General classification after stage\s+\d+/i, /Team classification\s*-\s*Stage\s+\d+/i);
  const teamsBlock = section(text, /Team classification\s*-\s*Stage\s+\d+/i, /Points classification\s*-\s*Stage\s+\d+/i);
  const pointsBlock = section(text, /Points classification\s*-\s*Stage\s+\d+/i, /Climbing classification\s*-\s*Stage\s+\d+/i);
  const komBlock = section(text, /Climbing classification\s*-\s*Stage\s+\d+/i, /Youth classification\s*-\s*Stage\s+\d+/i);
  const youthBlock = section(text, /Youth classification\s*-\s*Stage\s+\d+/i, /Jerseys\s*-\s*Stage\s+\d+/i);

  const classifications = [
    classification(competitionId, stageNumber, 'stage', 'stage', 'Stage Classification', stageRows(stageBlock)),
    classification(competitionId, stageNumber, 'gc', 'stage', 'General Classification', generalRows(gcBlock)),
    classification(competitionId, stageNumber, 'points', 'overall', 'Overall Points Classification', overallPointsRows(pointsBlock, 'Overall Points Classification')),
    classification(competitionId, stageNumber, 'kom', 'overall', 'Overall Mountains Classification', overallPointsRows(komBlock, 'Overall Mountains Classification')),
    classification(competitionId, stageNumber, 'youth', 'overall', 'Overall Youth Classification', overallYouthRows(youthBlock)),
    classification(competitionId, stageNumber, 'teams', 'overall', 'Overall Teams Classification', overallTeamRows(teamsBlock), true),
  ];

  const stage = {
    uciRaceId: synthRaceId(competitionId, stageNumber),
    stageNumber,
    dateKey: publishedDate,
    raceType: 'IRR',
    isFinalClassification: false,
    eventName: `Stage ${stageNumber}`,
    sourcePdfUrl,
    classifications,
  };
  const final = totalStages != null && stageNumber === totalStages
    ? {
        uciRaceId: synthRaceId(competitionId, FINAL_SLOT),
        stageNumber: null,
        dateKey: publishedDate,
        raceType: 'IRR',
        isFinalClassification: true,
        eventName: 'Final Classification',
        sourcePdfUrl,
        classifications: classifications
          .filter((item) => item.classKind !== 'stage')
          .map((item) => ({ ...item, scope: 'stage', eventId: synthEventId(competitionId, FINAL_SLOT, item.classKind) })),
      }
    : null;
  return { stage, final };
}

async function fetchNoCache(url, type = 'text') {
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}_=${Date.now()}`, {
    headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return type === 'arrayBuffer' ? response.arrayBuffer() : response.text();
}

async function pdfToText(url) {
  const dir = mkdtempSync(join(tmpdir(), 'istanbul-results-'));
  const file = join(dir, 'results.pdf');
  try {
    writeFileSync(file, Buffer.from(await fetchNoCache(url, 'arrayBuffer')));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!Number.isInteger(YEAR) || YEAR < 2000) throw new Error('Falta --year válido');
  if (has('--suggest-id')) {
    if (!RACE_ID) throw new Error('--suggest-id requiere --race-id');
    process.stdout.write(`${suggestCompetitionId(RACE_ID)}\n`);
    return;
  }
  if (!Number.isInteger(COMPETITION_ID) || COMPETITION_ID >= 0) throw new Error('Falta --competition-id sintético negativo');
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  const html = fixture?.html ?? await fetchNoCache(RESULTS_PAGE);
  const links = pdfLinksFromHtml(html, YEAR);
  const stagesToFetch = ONLY_STAGE != null
    ? [ONLY_STAGE]
    : Array.from({ length: TOTAL_STAGES || 0 }, (_, index) => index + 1);
  if (!stagesToFetch.length) throw new Error('Usa --stage o --total-stages');

  const stages = [];
  for (const stageNumber of stagesToFetch) {
    const sourcePdfUrl = links.get(stageNumber);
    if (!sourcePdfUrl) {
      log(`  ∅ etapa ${stageNumber}: PDF aún no publicado`);
      continue;
    }
    const text = fixture?.pdfTextByUrl?.[sourcePdfUrl] ?? await pdfToText(sourcePdfUrl);
    const parsed = parsePdf(YEAR, stageNumber, text, {
      competitionId: COMPETITION_ID,
      expectedDate: STAGE_DATES?.[stageNumber] ?? null,
      totalStages: TOTAL_STAGES,
      sourcePdfUrl,
    });
    stages.push(parsed.stage);
    if (parsed.final) stages.push(parsed.final);
  }

  const output = {
    ...(RACE_ID ? { raceId: RACE_ID } : {}),
    competitionId: COMPETITION_ID,
    disciplineId: 10,
    source: 'istanbul',
    fetchedAt: new Date().toISOString(),
    stages,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exit(1); });
