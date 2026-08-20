#!/usr/bin/env node
/**
 * Resultados publicados por las webs de carrera A.S.O. (ranking HTML + AJAX).
 *
 * La página de clasificaciones contiene URLs efímeras para cada tabla; se
 * descubren en cada lectura. El adaptador solo emite clasificaciones que tengan
 * un ganador válido, para que el upsert conserve una carrera pendiente mientras
 * el organizador no haya publicado resultados.
 *
 * Uso:
 *   node aso-results-fetch.mjs --url https://www.arctic-race-of-norway.com/en/rankings \
 *     --competition-id -40470 --stage 1 --out <dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const has = (name) => argv.includes(name);
const PAGE_URL = arg('--url');
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const FIXTURE = arg('--fixture');
const ONE_DAY = has('--one-day');
const FINAL_CLASSIFICATION = has('--final');
const FINAL_STAGE_KEY = 99;

export function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export const suggestCompetitionId = (url) => -(fnv1a(`aso:${url}`) % 200000);
const CLASS_IDX = { 'stage/stage': 0, 'gc/stage': 1, 'points/overall': 2, 'kom/overall': 3, 'youth/overall': 4, 'teams/overall': 5 };
export const synthEventId = (url, stage, kind, scope) => -((-suggestCompetitionId(url)) * 10000 + stage * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 99));

/** A.S.O. publica la primera etapa en /rankings y las restantes en /stage-N. */
export function stageUrl(baseUrl, stageNumber) {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/stage-\d+\/?$/i, '').replace(/\/$/, '');
  url.pathname = Number(stageNumber) === 1 ? basePath : `${basePath}/stage-${stageNumber}`;
  return url.href;
}

export function clean(value = '') {
  return String(value).replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#(?:0?39|x27);/gi, "'").replace(/<[^>]*>/g, ' ').replace(/\\\//g, '/')
    .replace(/\s+/g, ' ').trim();
}
const irmOf = (value) => ({ DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL' }[clean(value).toUpperCase()] || null);
export function timeOf(value) {
  const t = clean(value);
  const aso = t.match(/^(?:(\d{1,2})h\s*)?(\d{1,2})'\s*(\d{1,2})''$/);
  if (aso) return aso[1] ? `${Number(aso[1])}:${aso[2].padStart(2, '0')}:${aso[3].padStart(2, '0')}` : `0:${aso[2].padStart(2, '0')}:${aso[3].padStart(2, '0')}`;
  const colon = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return colon ? `${Number(colon[1])}:${colon[2]}:${colon[3]}` : null;
}
export function gapOf(value) {
  const t = clean(value);
  const aso = t.match(/^\+\s*(?:(\d{1,2})h\s*)?(\d{1,2})'\s*(\d{1,2})''$/);
  if (aso) {
    const hours = Number(aso[1] || 0), minutes = Number(aso[2]), seconds = Number(aso[3]);
    if (hours) return `+${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return minutes ? `+${minutes}:${String(seconds).padStart(2, '0')}` : `+${seconds}`;
  }
  const canonical = t.replace(/^\+?0+(?=\d)/, '+');
  return /^\+\d+(?::\d{2}){0,2}$/.test(canonical) ? canonical : null;
}

export function rankingUrls(pageHtml, pageUrl) {
  const urls = new Map();
  const decoded = String(pageHtml).replace(/&quot;/gi, '"').replace(/\\\//g, '/');
  for (const m of decoded.matchAll(/\/([a-z]{2})\/ajax\/ranking\/(\d+)\/(ite|itg|ipg|img|ijg|etg)\/([a-f0-9]+)\/(none|subtab)/gi)) {
    const [, language, stage, type, token, view] = m;
    urls.set(type, new URL(`/${language}/ajax/ranking/${stage}/${type}/${token}/${view}`, pageUrl).href);
  }
  return urls;
}

export function rowsFromRankingHtml(html, { isTeamEvent = false, points = false } = {}) {
  const rows = [];
  let groupGap = '+0';
  for (const match of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rawCells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (rawCells.length < (isTeamEvent ? 4 : 6)) continue;
    const cells = rawCells.map(clean);
    const rank = /^\d+$/.test(cells[0]) ? Number(cells[0]) : null;
    const irm = irmOf(cells[0]);
    if (!rank && !irm) continue;
    const riderCell = cells[1] || null;
    const bib = isTeamEvent ? null : (/^\d+$/.test(cells[2]) ? cells[2] : null);
    const teamName = isTeamEvent ? riderCell : (cells[3] || null);
    const timeCell = isTeamEvent ? cells[2] : cells[4];
    const gapCell = isTeamEvent ? cells[3] : cells[5];
    const pointsValue = points ? cells.map((cell) => clean(cell).match(/^(-?\d+(?:[.,]\d+)?)\s*(?:PTS?|POINTS?)\b/i)?.[1]).find(Boolean) || null : null;
    const explicitGap = gapOf(gapCell);
    if (!points && rank !== 1 && explicitGap) groupGap = explicitGap;
    const timeGap = rank === 1 ? null : groupGap;
    const value = points ? pointsValue : (rank === 1 ? timeOf(timeCell) : timeGap);
    rows.push({ rank, rankText: rank ? String(rank) : irm, bib, riderDisplay: riderCell, teamName,
      resultValue: value || null, timeText: points ? pointsValue : (rank === 1 ? timeOf(timeCell) : null),
      gapText: points || rank === 1 ? null : timeGap, points: pointsValue == null ? null : Number(pointsValue.replace(',', '.')), irm });
  }
  return rows;
}

const SPECS = {
  ite: { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification' },
  itg: { classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification' },
  ipg: { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification', points: true },
  img: { classKind: 'kom', scope: 'overall', eventName: 'Overall Mountains Classification', points: true },
  ijg: { classKind: 'youth', scope: 'overall', eventName: 'Overall Youth Classification' },
  etg: { classKind: 'teams', scope: 'overall', eventName: 'Overall Team Classification', isTeamEvent: true },
};

export function classificationsFromPages(url, stageNumber, pages, { oneDay = false } = {}) {
  const classifications = [];
  for (const [type, spec] of Object.entries(SPECS)) {
    if (oneDay && type !== 'ite') continue;
    const html = pages.get(type);
    if (!html) continue;
    const rows = rowsFromRankingHtml(html, spec);
    if (!rows.some((row) => row.rank === 1 && !row.irm)) continue;
    classifications.push({ eventId: synthEventId(url, stageNumber, spec.classKind, spec.scope), ...spec,
      isTeamEvent: !!spec.isTeamEvent, winnerName: rows.find((row) => row.rank === 1)?.riderDisplay || null, rowCount: rows.length, rows });
  }
  return classifications;
}

// ASO no publica una pseudo-etapa final separada: las clasificaciones generales
// de la última jornada viven en las mismas tablas que la etapa. Las clonamos en
// una unidad Final Classification estable para que el upsert pueda marcarlas como
// definitivas sin perder el resultado de la etapa.
export function finalClassificationsFromPages(url, pages) {
  return classificationsFromPages(url, FINAL_STAGE_KEY, pages)
    .filter((cl) => cl.classKind !== 'stage');
}

async function fetchText(url) { const response = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } }); if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`); return response.text(); }

async function main() {
  if (!PAGE_URL) throw new Error('Falta --url <página-de-clasificaciones-A.S.O.>');
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id');
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  const baseStageMatch = new URL(PAGE_URL).pathname.match(/stage-(\d+)/i);
  const stageNumber = ONLY_STAGE ?? (baseStageMatch ? Number(baseStageMatch[1]) : 1);
  const pageUrl = stageUrl(PAGE_URL, stageNumber);
  const page = fixture?.page || await fetchText(pageUrl);
  const urls = rankingUrls(page, pageUrl);
  const endpointStages = new Set([...urls.values()].map((url) => Number(new URL(url).pathname.match(/\/ranking\/(\d+)\//i)?.[1])));
  if (endpointStages.size !== 1 || !endpointStages.has(stageNumber)) {
    throw new Error(`A.S.O. publicó una clasificación de etapa distinta de la solicitada (${stageNumber})`);
  }
  const pages = new Map();
  for (const [type, url] of urls) pages.set(type, fixture?.pages?.[type] || await fetchText(url));
  const classifications = classificationsFromPages(PAGE_URL, stageNumber, pages, { oneDay: ONE_DAY });
  const finalClassifications = FINAL_CLASSIFICATION && !ONE_DAY
    ? finalClassificationsFromPages(PAGE_URL, pages)
    : [];
  const stages = [];
  if (classifications.length) {
    stages.push(ONE_DAY
      ? { uciRaceId: -Math.abs(suggestCompetitionId(PAGE_URL)) * 100 - 1, stageNumber: null, isFinalClassification: true, eventName: 'Final Classification', classifications }
      : { uciRaceId: -Math.abs(suggestCompetitionId(PAGE_URL)) * 100 - stageNumber, stageNumber, isFinalClassification: false, eventName: `Stage ${stageNumber}`, classifications });
  }
  if (finalClassifications.length) {
    stages.push({
      uciRaceId: -Math.abs(suggestCompetitionId(PAGE_URL)) * 100 - 1,
      stageNumber: null,
      isFinalClassification: true,
      eventName: 'Final Classification',
      classifications: finalClassifications,
    });
  }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'ASO', asoUrl: PAGE_URL, fetchedAt: new Date().toISOString(), stages };
  mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) main().catch((error) => { process.stderr.write(`FATAL: ${error.stack || error.message}\n`); process.exit(1); });
