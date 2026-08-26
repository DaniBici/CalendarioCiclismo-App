#!/usr/bin/env node
/** Resultados públicos de EvoData CIS (cis.evodata.it).
 *
 * El evento padre descubre las jornadas. Cada jornada expone la llegada y las
 * clasificaciones acumuladas mediante el mismo token efímero que usa la web
 * pública. El token solo se conserva en memoria durante la ejecución.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : fallback; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const DELAY = Number(arg('--delay', '300'));
const FIXTURE = arg('--fixture');
const BASE = 'https://cis.evodata.it';
export const RESULTS_SOURCE = 'evodata';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const IRM = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL', HD: 'OTL', ABD: 'DNF' };
const TEAM_NAME_OVERRIDES = new Map([
  ['CENTRE MONDIAL DU CYCLISME', 'WCC Team'],
  ['UAE TEAM EMIRATES ADNOC', 'UAE Team Emirates Gen-Z'],
  ['CANADA', 'Canada'],
]);

const teamNameOf = (value) => {
  const name = clean(value);
  return TEAM_NAME_OVERRIDES.get(name.toUpperCase()) || name;
};

export function parseCode(value) {
  const code = clean(value);
  if (!/^[1-9][0-9]*$/.test(code)) throw new Error('--code debe ser el eventId padre numérico de EvoData');
  return code;
}

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const negativeId = (seed, modulo = 2_000_000_000) => -(fnv1a(seed) % modulo || 1);
export const suggestCompetitionId = (code) => negativeId(`evodata:${parseCode(code)}`, 200_000);
export const synthRaceId = (code, eventId, final = false) => negativeId(`evodata:${parseCode(code)}:race:${final ? 'final' : eventId}`);
export const synthEventId = (code, eventId, kind, scope, final = false) =>
  negativeId(`evodata:${parseCode(code)}:event:${final ? 'final' : eventId}:${kind}:${scope}`);
export const eventsListUrl = (code) => `${BASE}/eventsList/${parseCode(code)}`;

function secondsToTime(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function millisToTime(value) {
  const millis = Number(value);
  return Number.isFinite(millis) && millis >= 0 ? secondsToTime(millis / 1000) : null;
}

function millisToGap(value) {
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis < 0) return null;
  const total = Math.floor(millis / 1000);
  if (total < 60) return `+${String(total).padStart(2, '0')}`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `+${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `+${minutes}:${String(seconds).padStart(2, '0')}`;
}

const bibOf = (row) => (/^[1-9][0-9]*$/.test(clean(row?.bib)) ? clean(row.bib) : null);
const rankOf = (row) => {
  const rank = Number(row?.position);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
};

export function mapTimingRows(sourceRows, { timeTrial = false } = {}) {
  const source = Array.isArray(sourceRows) ? sourceRows : [];
  const ranked = source.filter((row) => rankOf(row) && bibOf(row)).sort((a, b) => rankOf(a) - rankOf(b));
  const winnerMillis = Number(ranked.find((row) => rankOf(row) === 1)?.order);
  let lastAssignedGap = 0;
  const rows = [];

  for (const row of ranked) {
    const rank = rankOf(row);
    const bib = bibOf(row);
    if (rank === 1) {
      const timeText = millisToTime(row.order);
      if (!timeText) continue;
      rows.push({ rank, rankText: '1', bib, resultValue: timeText, timeText, gapText: null, points: null, irm: null });
      continue;
    }
    let gapMillis;
    if (timeTrial) {
      gapMillis = Number(row.order) - winnerMillis;
    } else if (clean(row.gap) === '-') {
      gapMillis = lastAssignedGap;
    } else {
      gapMillis = Number(row.gap);
      // EvoData ha publicado casos aislados con un gap explícito reciclado de
      // otro grupo (p. ej. +2 s después de +1:32). La hora cronometrada sigue
      // siendo correcta: solo se usa como fallback cuando el gap retrocedería.
      if (Number.isFinite(gapMillis) && gapMillis < lastAssignedGap && Number.isFinite(winnerMillis)) {
        gapMillis = Math.max(lastAssignedGap, Number(row.order) - winnerMillis);
      }
      if (Number.isFinite(gapMillis) && gapMillis >= 0) lastAssignedGap = gapMillis;
    }
    const gapText = millisToGap(gapMillis);
    if (!gapText) continue;
    rows.push({ rank, rankText: String(rank), bib, resultValue: gapText, timeText: null, gapText, points: null, irm: null });
  }

  for (const row of source) {
    if (rankOf(row) || !bibOf(row)) continue;
    const status = clean(row.positionText).toUpperCase();
    const irm = IRM[status];
    if (irm) rows.push({ rank: null, rankText: irm, bib: bibOf(row), resultValue: null, timeText: null, gapText: null, points: null, irm });
  }
  return rows;
}

const GENERAL_TYPES = {
  1: { classKind: 'gc', scope: 'stage', eventName: 'General Classification', timed: true },
  2: { classKind: 'points', scope: 'overall', eventName: 'Points Classification', points: true },
  3: { classKind: 'kom', scope: 'overall', eventName: 'Mountain Classification', points: true },
  4: { classKind: 'youth', scope: 'overall', eventName: 'Youth Classification', timed: true },
  11: { classKind: 'teams', scope: 'overall', eventName: 'Teams Classification', timed: true, teams: true },
};

export function mapGeneralRows(sourceRows, spec) {
  const rows = [];
  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const rank = rankOf(row);
    if (!rank) continue;
    const bib = spec.teams ? null : bibOf(row);
    const riderDisplay = spec.teams ? teamNameOf(row.team) : null;
    if (!spec.teams && !bib) continue;
    if (spec.teams && !riderDisplay) continue;
    if (spec.points) {
      const points = Number(row.pointsResult);
      if (!Number.isFinite(points)) continue;
      rows.push({ rank, rankText: String(rank), bib, ...(spec.teams ? { riderDisplay, teamName: riderDisplay } : {}),
        resultValue: String(points), timeText: String(points), gapText: null, points, irm: null });
      continue;
    }
    const timeText = rank === 1 ? millisToTime(row.timeResult) : null;
    const gapText = rank === 1 ? null : millisToGap(row.timeGap);
    const resultValue = timeText || gapText;
    if (!resultValue) continue;
    rows.push({ rank, rankText: String(rank), bib, ...(spec.teams ? { riderDisplay, teamName: riderDisplay } : {}),
      resultValue, timeText, gapText, points: null, irm: null });
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

export function stageNumberFor(subEvent, index = 0) {
  const order = Number(subEvent?.order);
  if (Number.isInteger(order) && order >= 0) return order;
  const match = clean(subEvent?.name).match(/(?:stage|etape|étape)\s*(\d+)\b/i);
  return match ? Number(match[1]) : index + 1;
}

export function raceTypeFor(subEvent, races = []) {
  const type = Number(subEvent?.eventType);
  if (type === 3) return 'TTT';
  if (type === 2 || races.some((race) => Number(race?.raceTypeId) === 13)) return 'ITT';
  return 'IRR';
}

function buildClassification(code, eventId, jersey, response, final = false) {
  const spec = GENERAL_TYPES[Number(jersey?.type)];
  if (!spec || response?.status !== 'OK') return null;
  const rows = mapGeneralRows(response.results, spec);
  if (!rows.some((row) => row.rank === 1)) return null;
  return {
    eventId: synthEventId(code, eventId, spec.classKind, final ? 'stage' : spec.scope, final),
    classKind: spec.classKind,
    scope: final ? 'stage' : spec.scope,
    eventName: spec.eventName,
    isTeamEvent: !!spec.teams,
    rowCount: rows.length,
    ...(Number(response.tot) === rows.length && rows.length > 0 ? { expectedRowCount: rows.length } : {}),
    rows,
  };
}

export function buildStage(code, subEvent, payload, { totalStages = null } = {}) {
  const stageNumber = stageNumberFor(subEvent);
  const raceType = raceTypeFor(subEvent, payload.races);
  const stageRows = mapTimingRows(payload.timing?.times, { timeTrial: raceType === 'ITT' });
  if (!stageRows.some((row) => row.rank === 1)) return [];

  const stageClassification = {
    eventId: synthEventId(code, subEvent.eventId, 'stage', 'stage'),
    classKind: 'stage', scope: 'stage', eventName: 'Stage Classification', isTeamEvent: false,
    rowCount: stageRows.length,
    ...(Number(payload.timing?.tot) === stageRows.length && stageRows.length > 0 ? { expectedRowCount: stageRows.length } : {}),
    rows: stageRows,
  };
  const generalClassifications = (payload.jerseys || [])
    .map((jersey) => buildClassification(code, subEvent.eventId, jersey, payload.generals?.[String(jersey.jerseyId)], false))
    .filter(Boolean);
  const isLast = totalStages != null && stageNumber === Number(totalStages);
  const dateKey = clean(subEvent.date).slice(0, 10) || null;
  const common = { dateKey, sourcePdfUrl: eventsListUrl(code) };
  const stages = [{
    uciRaceId: synthRaceId(code, subEvent.eventId), stageNumber,
    stageName: clean(subEvent.name) || `Stage ${stageNumber}`, isFinalClassification: false,
    raceType, ...common,
    classifications: isLast ? [stageClassification] : [stageClassification, ...generalClassifications],
  }];
  if (isLast && generalClassifications.length) {
    stages.push({
      uciRaceId: synthRaceId(code, subEvent.eventId, true), stageNumber: null,
      stageName: 'Final Classification', isFinalClassification: true, raceType: null, ...common,
      classifications: generalClassifications.map((classification) => ({
        ...classification,
        eventId: synthEventId(code, subEvent.eventId, classification.classKind, 'stage', true),
        scope: 'stage',
      })),
    });
  }
  return stages;
}

async function apiPost(path, body, token = null) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' },
    body: JSON.stringify(token ? { ...body, token } : body),
  });
  if (!response.ok) throw new Error(`EvoData HTTP ${response.status} en ${path}`);
  return response.json();
}

async function getAppToken() {
  const response = await apiPost('/api/users/apptoken', {});
  if (response?.status !== 'OK' || !response.token) throw new Error('EvoData no devolvió token público de aplicación');
  return response.token;
}

async function fetchStagePayload(eventId, token) {
  const [races, jerseys, timing] = await Promise.all([
    apiPost('/api/races/getRacesByEventId/', { eventId }, token),
    apiPost('/api/jerseys/getJerseysByEventId/', { eventId }, token),
    apiPost('/api/timing/results/getResults/', {
      eventId, raceId: 100000001, splitNumber: -1, gender: 'all', category: 'all',
      nationality: 'ALL', pageSize: 1000, pageIndex: 0, getBonus: false,
    }, token),
  ]);
  const generalJerseys = (Array.isArray(jerseys) ? jerseys : []).filter((jersey) => GENERAL_TYPES[Number(jersey.type)]);
  const responses = await Promise.all(generalJerseys.map((jersey) =>
    apiPost('/api/generalclassification/getGeneralClassification/', {
      eventId, jerseyId: jersey.jerseyId, status: 0, pageIndex: 0, pageSize: 1000,
    }, token)));
  const generals = Object.fromEntries(generalJerseys.map((jersey, index) => [String(jersey.jerseyId), responses[index]]));
  return { races: Array.isArray(races) ? races : [], jerseys: Array.isArray(jerseys) ? jerseys : [], timing, generals };
}

export async function fetchCompetition(code, { onlyStage = null, totalStages = null, delay = 300, fixture = null } = {}) {
  const parsedCode = parseCode(code);
  const token = fixture ? null : await getAppToken();
  const parentEvent = fixture?.parentEvent || await apiPost('/api/events/getEventById/', { eventId: Number(parsedCode) }, token);
  const subEvents = (parentEvent?.subEvents || [])
    .map((subEvent, index) => ({ ...subEvent, _stageNumber: stageNumberFor(subEvent, index) }))
    .filter((subEvent) => onlyStage == null || subEvent._stageNumber === Number(onlyStage))
    .sort((a, b) => a._stageNumber - b._stageNumber);
  const stages = [];
  for (const subEvent of subEvents) {
    const payload = fixture?.byEventId?.[String(subEvent.eventId)] || await fetchStagePayload(subEvent.eventId, token);
    stages.push(...buildStage(parsedCode, subEvent, payload, { totalStages }));
    if (!fixture && delay > 0) await sleep(delay);
  }
  return stages;
}

async function main() {
  const code = parseCode(CODE);
  if (has('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(code)}\n`);
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  if (!Number.isFinite(DELAY) || DELAY < 0) throw new Error('--delay debe ser un número no negativo');
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  const stages = await fetchCompetition(code, { onlyStage: ONLY_STAGE, totalStages: TOTAL_STAGES, delay: DELAY, fixture });
  const output = {
    competitionId: COMPETITION_ID, disciplineId: 10, source: RESULTS_SOURCE,
    evodataCode: code, sourceUrl: eventsListUrl(code), fetchedAt: new Date().toISOString(), stages,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { process.stderr.write(`FATAL: ${error.stack || error.message}\n`); process.exit(1); });
