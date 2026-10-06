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
import { fnv1aCodeUnits as fnv1a } from './pdf-results-ids.mjs';

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
// Estado de la lista de salida. La llegada solo publica a los clasificados; los
// abandonos constan aquí. Códigos contrastados con el contador del proveedor
// (getRaceCounts) en los Europeos de Liubliana 2026; el resto no se interpreta.
const START_LIST_IRM = { 1: 'DNF', 3: 'DNS', 9: 'OTL' };
// Sin estado codificado (status 0), las banderas started/finished de la lista
// separan abandonos y no salidas (Giro di Campania y Coppa Bernocchi 2026). Un
// corredor en carrera tampoco tiene llegada: solo se derivan cuando la llegada
// lleva este tiempo sin nuevas filas.
const ARRIVAL_QUIET_MS = 20 * 60_000;
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

const lastArrivalAt = (times) => Math.max(-Infinity,
  ...(Array.isArray(times) ? times : []).map((row) => Date.parse(row?.createdAt)).filter(Number.isFinite));

export function mapStartListIrm(startList, presentRows = [], { arrivalClosed = false } = {}) {
  const list = Array.isArray(startList) ? startList : [];
  // Un concurso sin ninguna salida registrada no distingue DNS de DNF.
  const startsRecorded = list.some((rider) => rider?.started === true);
  const present = new Set(presentRows.map((row) => row.bib).filter(Boolean));
  const rows = [];
  for (const rider of list) {
    const bib = bibOf(rider);
    let irm = START_LIST_IRM[Number(rider?.status)];
    if (!irm && arrivalClosed && Number(rider?.status) === 0 && rider?.finished === false) {
      if (rider.started === true) irm = 'DNF';
      else if (startsRecorded && rider.started === false && rider.starting !== false) irm = 'DNS';
    }
    if (!bib || !irm || present.has(bib)) continue;
    present.add(bib);
    rows.push({ rank: null, rankText: irm, bib, resultValue: null, timeText: null, gapText: null, points: null, irm });
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

// Relevo mixto UEC: un concurso cronometrado por selecciones (raceTypeId 13,
// dorsal y nombre de la selección) y concursos «Singoli» sin distancia con los
// corredores de cada selección. Cualquier otra combinación no es un relevo.
export function relayRacesOf(races = []) {
  const list = Array.isArray(races) ? races : [];
  const timed = list.filter((race) => Number(race?.raceTypeId) === 13 && Number(race?.distance) > 0);
  const members = list.filter((race) => /^singoli\b/i.test(clean(race?.name)) && !(Number(race?.distance) > 0));
  if (timed.length !== 1 || !members.length || timed.length + members.length !== list.length) return null;
  return { timed: timed[0], members };
}

const relayKeyOf = (row) => clean(row?.teamName || row?.lastName).toUpperCase();

// Patrón de CRE de la web (variante B de la UCI): la primera fila de cada
// selección lleva puesto y tiempo absoluto del equipo (sin gapText) y los
// compañeros van detrás sin puesto. Si los concursos individuales publican
// tiempos, cada compañero lleva el suyo en timeText, como en las CRE del Tour;
// encabeza el bloque el corredor cuyo tiempo coincide con el del equipo.
export function mapRelayRows(sourceRows, memberRows, individualRows = []) {
  const membersByTeam = new Map();
  for (const rider of Array.isArray(memberRows) ? memberRows : []) {
    const bib = bibOf(rider);
    const key = relayKeyOf(rider);
    if (!bib || !key) continue;
    if (!membersByTeam.has(key)) membersByTeam.set(key, new Set());
    membersByTeam.get(key).add(bib);
  }
  const individualTime = new Map();
  for (const row of Array.isArray(individualRows) ? individualRows : []) {
    const timeText = rankOf(row) && bibOf(row) ? millisToTime(row.order) : null;
    if (timeText) individualTime.set(bibOf(row), timeText);
  }
  const source = Array.isArray(sourceRows) ? sourceRows : [];
  const ranked = source.filter((row) => rankOf(row) && bibOf(row)).sort((a, b) => rankOf(a) - rankOf(b));
  const unranked = source.filter((row) => !rankOf(row) && bibOf(row) && IRM[clean(row.positionText).toUpperCase()]);
  const rows = [];
  for (const row of [...ranked, ...unranked]) {
    const rank = rankOf(row);
    const irm = rank ? null : IRM[clean(row.positionText).toUpperCase()];
    const timeText = rank ? millisToTime(row.order) : null;
    if (rank && !timeText) throw new Error(`EvoData: relevo sin tiempo para la selección ${clean(row.teamName) || bibOf(row)}`);
    const teamName = teamNameOf(row.teamName || row.lastName);
    const bibs = [...(membersByTeam.get(relayKeyOf(row)) || [])].sort((a, b) => Number(a) - Number(b));
    if (!bibs.length) throw new Error(`EvoData: relevo sin corredores para la selección ${teamName || bibOf(row)}`);
    const lead = (timeText && bibs.find((bib) => individualTime.get(bib) === timeText)) || bibs[0];
    rows.push({ rank, rankText: irm || String(rank), bib: lead, teamName, resultValue: timeText, timeText, gapText: null, points: null, irm });
    for (const bib of bibs) {
      if (bib === lead) continue;
      rows.push({ rank: null, rankText: null, bib, teamName, resultValue: null,
        timeText: individualTime.get(bib) || null, gapText: null, points: null, irm: null });
    }
  }
  return rows;
}

// Selecciones de la lista de salida del concurso cronometrado que siguen en
// carrera: sin llegada ni estado IRM. Sin lista no se puede acreditar que la
// clasificación esté completa (Europeos de Liubliana 2026: cinco llegadas con
// Italia aún en carrera).
export function pendingRelayTeams(teamStartList, sourceRows = []) {
  if (!Array.isArray(teamStartList) || !teamStartList.length) return null;
  const arrived = new Set((Array.isArray(sourceRows) ? sourceRows : [])
    .filter((row) => bibOf(row) && (rankOf(row) || IRM[clean(row.positionText).toUpperCase()]))
    .map(bibOf));
  return teamStartList
    .filter((team) => bibOf(team) && team.starting !== false && !START_LIST_IRM[Number(team.status)])
    .filter((team) => !arrived.has(bibOf(team)))
    .map((team) => teamNameOf(team.teamName || team.lastName) || bibOf(team));
}

function buildRelayStage(code, subEvent, payload) {
  const pending = pendingRelayTeams(payload.relayTeams, payload.timing?.times);
  if (pending == null || pending.length) return [];
  const rows = mapRelayRows(payload.timing?.times, payload.relayMembers, payload.relayTimes);
  if (!rows.some((row) => row.rank === 1)) return [];
  const teamCount = rows.filter((row) => row.rankText != null).length;
  return [{
    uciRaceId: synthRaceId(code, subEvent.eventId), stageNumber: null,
    stageName: 'Final Classification', isFinalClassification: true, raceType: 'TTT',
    dateKey: clean(subEvent.date).slice(0, 10) || null, sourcePdfUrl: eventsListUrl(code),
    classifications: [{
      eventId: synthEventId(code, subEvent.eventId, 'stage', 'stage'),
      classKind: 'gc', scope: 'stage', eventName: 'General Classification', isTeamEvent: false,
      rowCount: rows.length,
      ...(Number(payload.timing?.tot) === teamCount ? { expectedRowCount: rows.length } : {}),
      rows,
    }],
  }];
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

export function buildStage(code, subEvent, payload, { totalStages = null, oneDay = false, now = Date.now() } = {}) {
  if (payload.relayMembers) return buildRelayStage(code, subEvent, payload);
  const sourceStageNumber = stageNumberFor(subEvent);
  const stageNumber = oneDay ? null : sourceStageNumber;
  const sourceRaceType = raceTypeFor(subEvent, payload.races);
  const raceType = oneDay ? null : sourceRaceType;
  const timingRows = mapTimingRows(payload.timing?.times, { timeTrial: sourceRaceType === 'ITT' });
  if (!timingRows.some((row) => row.rank === 1)) return [];
  // Solo en la carrera de un día: en las vueltas, EvoData ha omitido de la
  // llegada a corredores que siguieron en carrera (Tour del Porvenir 2026, E4).
  const lastArrival = lastArrivalAt(payload.timing?.times);
  const arrivalClosed = Number.isFinite(lastArrival) && now - lastArrival >= ARRIVAL_QUIET_MS;
  const stageRows = oneDay ? [...timingRows, ...mapStartListIrm(payload.startList, timingRows, { arrivalClosed })] : timingRows;

  const stageClassification = {
    eventId: synthEventId(code, subEvent.eventId, 'stage', 'stage'),
    classKind: oneDay ? 'gc' : 'stage', scope: 'stage',
    eventName: oneDay ? 'General Classification' : 'Stage Classification', isTeamEvent: false,
    rowCount: stageRows.length,
    ...(Number(payload.timing?.tot) === timingRows.length && timingRows.length > 0 ? { expectedRowCount: stageRows.length } : {}),
    rows: stageRows,
  };
  const generalClassifications = (oneDay ? [] : (payload.jerseys || []))
    .map((jersey) => buildClassification(code, subEvent.eventId, jersey, payload.generals?.[String(jersey.jerseyId)], false))
    .filter(Boolean);
  const isLast = totalStages != null && sourceStageNumber === Number(totalStages);
  const dateKey = clean(subEvent.date).slice(0, 10) || null;
  const common = { dateKey, sourcePdfUrl: eventsListUrl(code) };
  const stages = [{
    uciRaceId: synthRaceId(code, subEvent.eventId), stageNumber,
    stageName: oneDay ? 'Final Classification' : (clean(subEvent.name) || `Stage ${stageNumber}`),
    isFinalClassification: oneDay,
    raceType, ...common,
    classifications: oneDay || isLast ? [stageClassification] : [stageClassification, ...generalClassifications],
  }];
  if (!oneDay && isLast && generalClassifications.length) {
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

async function fetchStartList(eventId, raceId, token) {
  try {
    const response = await apiPost('/api/registrations/getStartList', {
      eventId, raceId, gender: 'all', category: 'all', nationality: 'ALL', pageSize: 1000, pageIndex: 0,
    }, token);
    return response?.status === 'OK' && Array.isArray(response.startList) ? response.startList : null;
  } catch {
    return null;
  }
}

const validRaceId = (race, eventId) => {
  const raceId = Number(race?.raceId);
  if (!Number.isSafeInteger(raceId) || raceId <= 0 || Number(race?.eventId) !== Number(eventId)) {
    throw new Error(`EvoData: concurso inválido para la jornada ${eventId}`);
  }
  return raceId;
};

const fetchTiming = (eventId, raceId, token) => apiPost('/api/timing/results/getResults/', {
  eventId, raceId, splitNumber: -1, gender: 'all', category: 'all',
  nationality: 'ALL', pageSize: 1000, pageIndex: 0, getBonus: false,
}, token);

async function fetchRelayPayload(eventId, races, relay, token) {
  const raceId = validRaceId(relay.timed, eventId);
  const memberRaceIds = relay.members.map((race) => validRaceId(race, eventId));
  const [timing, relayTeams, memberLists, individual] = await Promise.all([
    fetchTiming(eventId, raceId, token),
    fetchStartList(eventId, raceId, token),
    Promise.all(memberRaceIds.map((memberRaceId) => fetchStartList(eventId, memberRaceId, token))),
    // Los tiempos individuales son opcionales: su fallo no bloquea el relevo.
    Promise.all(memberRaceIds.map((memberRaceId) => fetchTiming(eventId, memberRaceId, token).catch(() => null))),
  ]);
  if (memberLists.some((list) => !list?.length)) throw new Error(`EvoData: relevo ${eventId} sin corredores en los concursos individuales`);
  return {
    races, jerseys: [], timing, generals: {}, startList: null, relayTeams, relayMembers: memberLists.flat(),
    relayTimes: individual.flatMap((response) => (response?.status === 'OK' && Array.isArray(response.times) ? response.times : [])),
  };
}

async function fetchStagePayload(eventId, token, { withStartList = false } = {}) {
  const [races, jerseys] = await Promise.all([
    apiPost('/api/races/getRacesByEventId/', { eventId }, token),
    apiPost('/api/jerseys/getJerseysByEventId/', { eventId }, token),
  ]);
  if (!Array.isArray(races)) throw new Error(`EvoData: respuesta de carreras inválida para la jornada ${eventId}`);
  // El raceId pertenece a cada jornada y no coincide necesariamente con el de
  // la primera etapa. No inferirlo a partir del número ni elegir entre concursos.
  if (races.length > 1) {
    const relay = relayRacesOf(races);
    if (!relay) throw new Error(`EvoData: varios concursos en la jornada ${eventId}`);
    return fetchRelayPayload(eventId, races, relay, token);
  }
  if (!races.length) return { races, jerseys: [], timing: null, generals: {}, startList: null };
  const raceId = validRaceId(races[0], eventId);
  const generalJerseys = (Array.isArray(jerseys) ? jerseys : []).filter((jersey) => GENERAL_TYPES[Number(jersey.type)]);
  const [timing, startList, ...responses] = await Promise.all([
    fetchTiming(eventId, raceId, token),
    withStartList ? fetchStartList(eventId, raceId, token) : null,
    ...generalJerseys.map((jersey) =>
      apiPost('/api/generalclassification/getGeneralClassification/', {
        eventId, jerseyId: jersey.jerseyId, status: 0, pageIndex: 0, pageSize: 1000,
      }, token)),
  ]);
  const generals = Object.fromEntries(generalJerseys.map((jersey, index) => [String(jersey.jerseyId), responses[index]]));
  return { races: Array.isArray(races) ? races : [], jerseys: Array.isArray(jerseys) ? jerseys : [], timing, generals, startList };
}

// Los campeonatos UEC publican cada prueba como evento autónomo, sin padre ni
// subEvents: el propio evento es la única jornada.
export function jornadasOf(event, code) {
  if (Array.isArray(event?.subEvents) && event.subEvents.length) return event.subEvents;
  if (Number(event?.eventId) !== Number(code) || Number(event?.parentEventId) > 0) return [];
  return [{ eventId: Number(event.eventId), order: 1, eventType: event.eventType, name: event.name, date: event.date }];
}

export async function fetchCompetition(code, { onlyStage = null, totalStages = null, delay = 300, oneDay = false, fixture = null } = {}) {
  const parsedCode = parseCode(code);
  const token = fixture ? null : await getAppToken();
  const parentEvent = fixture?.parentEvent || await apiPost('/api/events/getEventById/', { eventId: Number(parsedCode) }, token);
  const subEvents = jornadasOf(parentEvent, parsedCode)
    .map((subEvent, index) => ({ ...subEvent, _stageNumber: stageNumberFor(subEvent, index) }))
    .filter((subEvent) => onlyStage == null || subEvent._stageNumber === Number(onlyStage))
    .sort((a, b) => a._stageNumber - b._stageNumber);
  const stages = [];
  for (const subEvent of subEvents) {
    const payload = fixture?.byEventId?.[String(subEvent.eventId)] || await fetchStagePayload(subEvent.eventId, token, { withStartList: oneDay });
    stages.push(...buildStage(parsedCode, subEvent, payload, { totalStages, oneDay }));
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
  const stages = await fetchCompetition(code, {
    onlyStage: ONLY_STAGE, totalStages: TOTAL_STAGES, delay: DELAY, oneDay: has('--one-day'), fixture,
  });
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
