/**
 * Respaldo manual de resultados desde el directorio de competiciones UCI
 * (https://uci-competition.tech.uci.ch/api), para cuando DataRide no responde o
 * no publica. Solo por CLI: `dataride-results-fetch.mjs --source directory`; no
 * lo usa ningún cron ni worker.
 *
 * El directorio publica la misma clasificación que DataRide: `result` es el
 * `ResultValue` en bruto (tiempos absolutos, huecos con «+», huecos disfrazados
 * «00:00:22», puntos, «-4 LAPS»). Cada fila se traduce a la forma cruda de
 * DataRide y pasa por su misma normalización, de modo que el documento emitido
 * es el de `dataride-results-fetch.mjs` (carretera) o el de
 * `cx-dataride-results.mjs` (CX). Diferencias de la fuente:
 *  - sin dorsal ni fecha de nacimiento; `riderRef` es la licencia UCI de 11
 *    cifras y `uciProfileId` = int(riderRef[2:9]);
 *  - sin clasificación por equipos; `teamName` solo de equipos UCI;
 *  - nacionalidad con el código UCI de tres letras (DEN, GER, SUI…);
 *  - carreras (`D2RC…`) y eventos (`D2EV…`) con numeración propia, distinta de
 *    `uciRaceId`/`eventId` de DataRide.
 *
 * Carretera: competición, carreras y eventos llevan IDs sintéticos negativos
 * derivados del código del directorio. El documento no declara `source`:
 * `results-upsert.mjs` lo trata como fuente secundaria sin tocar
 * `race_uci_links`, y la clasificación oficial de DataRide (eventId positivo) lo
 * sustituye al publicarse. CX: documento `manual` con `raceId` y `seasonKey`,
 * sin bloqueo frente al worker (`lockAutomatic=false`) para que DataRide lo
 * sustituya.
 */
'use strict';

import { fnv1aCodeUnits } from './pdf-results-ids.mjs';
import { UCI_DIRECTORY_PROVIDER } from './result-publication.mjs';
import { normalizeUciLicense } from './uci-license.mjs';
import { countryCode } from '../uci-catalog/countries.mjs';
import {
  classifyEvent, fixDisguisedGaps, fixInvertedAbsoluteGaps, fixPressFormattedAbsolute,
  isFinalClassificationRace, markIncompleteArrivals, normalizeInitialStageOnlyClassification,
  normalizePointsRows, normalizeRow,
} from './dataride-results-fetch.mjs';
import { CX_RESULT_SCHEMA_VERSION, normalizeCxDataRideRows } from './cx-dataride-results.mjs';
import {
  findUciCompetitionByCalendarId, getUciCompetition, getUciEventClassification, getUciResultsAvailability,
  uciCalendarIdOf, uciEventResultsUrl, uciIsoDate,
} from '../../supabase/functions/_shared/uci-competition-api.mjs';

export { UCI_DIRECTORY_PROVIDER };

const CX_CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
// `eventId` es INTEGER y normalizeInitialStageOnlyClassification deriva la
// general inicial como -(|id| × 10 + 9): con este rango el derivado cabe.
const RACE_EVENT_ID_RANGE = 200_000_000;
const COMPETITION_ID_RANGE = 200_000;
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const directoryCode = (item) => clean(item?.v1Code) || clean(item?.code) || clean(item?.id);

/** ID sintético negativo y estable de un código del directorio. */
export function directorySyntheticId(kind, code, range = RACE_EVENT_ID_RANGE) {
  const key = clean(code);
  if (!key) throw new Error(`Directorio UCI: ${kind} sin código`);
  return -(fnv1aCodeUnits(`${UCI_DIRECTORY_PROVIDER}:${kind}:${key}`) % range || 1);
}

/** Licencia UCI de 11 cifras → uciProfileId (int de las cifras 3 a 9). */
export function uciProfileIdFromRiderRef(riderRef) {
  const license = normalizeUciLicense(riderRef);
  const profile = license ? Number(license.slice(2, 9)) : 0;
  return profile > 0 ? String(profile) : null;
}

/** Fila del directorio en la forma cruda de DataRide (Results/). */
function directoryRowToDataRide(row, index = 0) {
  const firstName = clean(row?.firstName);
  const lastName = clean(row?.lastName);
  const license = normalizeUciLicense(row?.riderRef);
  const rank = Number.isSafeInteger(row?.rank) && row.rank > 0 ? row.rank : null;
  return {
    Rank: rank == null ? '' : String(rank),
    RankNumber: rank,
    Irm: clean(row?.mark),
    ResultValue: row?.result == null ? '' : String(row.result),
    DisplayName: [lastName, firstName].filter(Boolean).join(' '),
    DisplayFirstName: firstName,
    DisplayLastName: lastName,
    IsoCode2: countryCode(row?.nationalityCode || row?.nationality) || '',
    Age: row?.age ?? '',
    TeamName: clean(row?.teamName),
    PointPcR: row?.points ?? null,
    IndividualId: uciProfileIdFromRiderRef(license),
    UciId: license,
    SortOrder: index,
  };
}

export function createUciDirectoryClient({ fetchImpl = fetch, delayMs = 120 } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error('Cadencia inválida');
  const fetcher = async (url, init) => {
    if (delayMs) await sleep(delayMs);
    return fetchImpl(url, init);
  };
  return {
    findByCalendarId: (calendarId, disciplineCode, seasonYears) => findUciCompetitionByCalendarId({ fetcher, calendarId, disciplineCode, seasonYears }),
    competition: (id) => getUciCompetition({ fetcher, id }),
    // Volcado manual y puntual: disponibilidad y clasificaciones del origen, no
    // la copia de CloudFront (hasta una hora en carreras pasadas).
    availability: (competitionId) => getUciResultsAvailability({ fetcher, competitionId, fresh: true }),
    results: (competitionId, eventId) => getUciEventClassification({ fetcher, competitionId, eventId, fresh: true }),
  };
}

// Temporadas que se recorren cuando la búsqueda no encuentra el D2CP (código
// propio desde 2027): la indicada o el año en curso, el siguiente y el anterior
// (el año de temporada CX es el final: 2027 para 2026-27).
function seasonYearsFor(seasonYear, now = new Date()) {
  if (seasonYear != null) {
    const year = Number(seasonYear);
    if (!Number.isInteger(year) || year < 1900) throw new Error(`Año de temporada inválido: ${seasonYear}`);
    return [year];
  }
  const year = now.getUTCFullYear();
  return [year, year + 1, year - 1];
}

// Competición del directorio por uciCalendarId o por su UUID, con la
// disciplina esperada y los eventos que ya tienen filas.
async function loadCompetition({ calendarId, directoryId, seasonYear, disciplineCode, client }) {
  let id = clean(directoryId);
  if (!id) {
    if (calendarId == null) throw new Error('Falta --uci-calendar-id o --directory-id');
    const seasonYears = seasonYearsFor(seasonYear);
    const item = await client.findByCalendarId(calendarId, disciplineCode, seasonYears);
    if (!item) throw new Error(`El directorio UCI no tiene D2CP${calendarId} en ${disciplineCode} (temporadas ${seasonYears.join(', ')}; --season-year o --directory-id)`);
    id = item.id;
  }
  const competition = await client.competition(id);
  if (!competition?.id || !Array.isArray(competition.races)) throw new Error('Ficha del directorio UCI sin carreras');
  if (competition.disciplineCode !== disciplineCode) throw new Error(`La competición ${competition.name} es ${competition.disciplineCode}, no ${disciplineCode}`);
  if (calendarId != null && uciCalendarIdOf(competition) !== Number(calendarId)) throw new Error(`La competición ${competition.id} no es D2CP${calendarId}`);
  const availability = await client.availability(competition.id);
  const counts = availability?.resultCounts && typeof availability.resultCounts === 'object' ? availability.resultCounts : {};
  const published = new Set(Object.entries(counts).filter(([, count]) => Number(count) > 0).map(([eventId]) => eventId));
  return { competition, published };
}

function directorySummary(competition) {
  return {
    competitionId: competition.id,
    code: clean(competition.code) || null,
    v1Code: clean(competition.v1Code) || null,
    uciCalendarId: uciCalendarIdOf(competition),
    name: clean(competition.name) || null,
    seasonYear: competition.seasonYear ?? null,
    classCode: clean(competition.classCode) || null,
    startDate: competition.startDate ?? null,
    endDate: competition.endDate ?? null,
  };
}

// Mismo análisis del nombre de carrera que DataRide: «Stage 3B», «Prologue»,
// «Final Classification» / «Final Result».
function directoryStageOf(name) {
  const stageName = clean(name);
  const isFinalClassification = isFinalClassificationRace(stageName);
  const match = /stage\s+(\d+)\s*([a-z])?/i.exec(stageName);
  const stageNumber = isFinalClassification ? null
    : (match ? parseInt(match[1], 10) : (/prologue/i.test(stageName) ? 0 : null));
  const sectorIndex = match && match[2] ? match[2].toUpperCase().charCodeAt(0) - 65 : null;
  return { stageName, stageNumber, sectorIndex, isFinalClassification };
}

/**
 * Llegada de una CRE (`layout: 'team'`): el directorio repite puesto y equipo en
 * cada corredor; DataRide los da solo al primero de cada equipo y deja a los
 * compañeros sin puesto inmediatamente detrás, el patrón que agrupa el render.
 */
export function collapseTeamTimeTrialRanks(rows) {
  let group = null;
  return rows.map((row) => {
    if (row.rank == null || row.irm) { group = null; return row; }
    if (group && group.rank === row.rank && group.teamName === row.teamName) {
      return { ...row, rank: null, rankText: '', teamName: null };
    }
    group = { rank: row.rank, teamName: row.teamName };
    return row;
  });
}

function roadClassification(race, event, body, competitionId) {
  const { classKind, scope } = classifyEvent(event.name);
  // DataRide marca IsTeamEvent en todas las clasificaciones de un día de CRE; el
  // directorio solo da `layout: 'team'` en la llegada. Las correcciones de
  // huecos usan la señal de DataRide para no alterar el comportamiento.
  const sourceTeamEvent = clean(race.raceTypeCode).toUpperCase() === 'TTT' || body.layout === 'team';
  const normalized = fixPressFormattedAbsolute(fixInvertedAbsoluteGaps(fixDisguisedGaps(
    normalizePointsRows(body.results.map(directoryRowToDataRide).map(normalizeRow), classKind)
      .filter((row) => !/^race\s+cancelled/i.test(row.riderDisplay || '')),
    sourceTeamEvent), sourceTeamEvent), sourceTeamEvent);
  const rows = body.layout === 'team' ? collapseTeamTimeTrialRanks(normalized) : normalized;
  const winner = rows.find((row) => row.rank === 1 && !row.irm);
  return {
    eventId: directorySyntheticId('event', directoryCode(event)),
    classKind,
    scope,
    eventName: clean(event.name),
    isTeamEvent: classKind === 'teams' ? true : (classKind === 'other' ? body.layout === 'team' : false),
    winnerName: winner?.riderDisplay || null,
    rowCount: rows.length,
    rows,
    directory: { eventId: event.id, code: directoryCode(event), classificationCode: clean(event.classificationCode) || null,
      sourceUrl: uciEventResultsUrl(competitionId, event.id) },
  };
}

/**
 * Documento de carretera con el contrato de `dataride-results-fetch.mjs`.
 * `stage` limita a un número de etapa; `directoryRace` (código D2RC o UUID) a
 * una carrera del directorio, p. ej. una prueba de campeonato.
 */
export async function fetchDirectoryRoadCompetition({ calendarId = null, directoryId = null, seasonYear = null, stage = null, directoryRace = null,
  client = createUciDirectoryClient(), log = () => {} } = {}) {
  const { competition, published } = await loadCompetition({ calendarId, directoryId, seasonYear, disciplineCode: 'ROA', client });
  const races = [...competition.races].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))
    || (a.sequence ?? 0) - (b.sequence ?? 0));
  const wantedRace = clean(directoryRace);
  if (wantedRace && !races.some((race) => race.id === wantedRace || directoryCode(race) === wantedRace)) {
    throw new Error(`La carrera ${wantedRace} no pertenece a ${competition.name}`);
  }
  const stages = [];
  for (const race of races) {
    if (wantedRace && race.id !== wantedRace && directoryCode(race) !== wantedRace) continue;
    const parsed = directoryStageOf(race.name);
    if (stage != null && parsed.stageNumber !== stage) continue;
    const classifications = [];
    for (const event of race.events || []) {
      if (!published.has(event.id)) { log(`    ${parsed.stageName.padEnd(20)} ${clean(event.name)}: sin filas en el directorio`); continue; }
      const body = await client.results(competition.id, event.id);
      const classification = roadClassification(race, event, body, competition.id);
      classifications.push(classification);
      log(`    ${parsed.stageName.padEnd(20)} ${(classification.scope + '/' + classification.classKind).padEnd(14)} ${String(classification.rowCount).padStart(3)} filas  (${classification.directory.code})`);
    }
    // Sin bonificaciones por competición: la tabla de DataRide va por su competitionId.
    const initial = normalizeInitialStageOnlyClassification(parsed.stageNumber, classifications, []);
    const normalized = markIncompleteArrivals(initial, clean(race.raceTypeCode))
      .map((classification) => ({ ...classification,
        publication: { ...(classification.publication || {}), provider: UCI_DIRECTORY_PROVIDER, format: 'uci' } }));
    stages.push({
      uciRaceId: directorySyntheticId('race', directoryCode(race)),
      stageNumber: parsed.stageNumber,
      sectorIndex: parsed.sectorIndex,
      stageName: parsed.stageName,
      isFinalClassification: parsed.isFinalClassification,
      dateKey: uciIsoDate(race.startDate, `Fecha de ${parsed.stageName}`),
      raceType: clean(race.raceTypeCode) || null,
      startLocation: clean(race.startVenueName) || null,
      classificationCount: normalized.length,
      classifications: normalized,
      directory: { raceId: race.id, code: directoryCode(race), categoryCode: clean(race.categoryCode) || null },
    });
  }
  return {
    provider: UCI_DIRECTORY_PROVIDER,
    competitionId: directorySyntheticId('competition', directoryCode(competition), COMPETITION_ID_RANGE),
    disciplineId: 10,
    fetchedAt: new Date().toISOString(),
    directory: directorySummary(competition),
    stageCount: stages.length,
    stages,
  };
}

/**
 * Documento CX `manual` con las filas de `normalizeCxDataRideRows` y el
 * `uciLicenseId` de cada corredor, que `cx-results-upsert.mjs` resuelve contra
 * `uciProfileId`. Las filas sin puesto ni estado (manga en curso) se excluyen.
 */
export async function fetchDirectoryCxCompetition({ calendarId = null, directoryId = null, seasonYear = null, raceId, seasonKey, category = null,
  client = createUciDirectoryClient(), log = () => {} } = {}) {
  if (!clean(raceId) || !/^\d{4}-\d{2}$/.test(clean(seasonKey))) throw new Error('CX requiere --race-id <cxRaceId> y --season-key <AAAA-AA>');
  if (category != null && !CX_CATEGORIES.has(category)) throw new Error(`Categoría CX no reconocida: ${category}`);
  // Sin --season-year, el año final de la temporada CX propia.
  const cxSeasonYear = seasonYear ?? Number(clean(seasonKey).slice(0, 4)) + 1;
  const { competition, published } = await loadCompetition({ calendarId, directoryId, seasonYear: cxSeasonYear, disciplineCode: 'CRO', client });
  const document = {
    schemaVersion: CX_RESULT_SCHEMA_VERSION,
    source: 'manual',
    provider: UCI_DIRECTORY_PROVIDER,
    disciplineId: 3,
    raceId: clean(raceId),
    seasonKey: clean(seasonKey),
    fetchedAt: new Date().toISOString(),
    directory: directorySummary(competition),
    categories: [],
    exclusions: [],
  };
  const mapped = new Set();
  for (const race of competition.races) {
    const code = clean(race.categoryCode).toUpperCase();
    if (clean(race.raceTypeCode).toUpperCase() !== 'IND' || !CX_CATEGORIES.has(code)) {
      document.exclusions.push({ raceId: race.id, raceName: clean(race.name), reason: 'Formato o categoría fuera del modelo CX' });
      continue;
    }
    if (category != null && code !== category) continue;
    if (mapped.has(code)) throw new Error(`Dos mangas del directorio con la categoría ${code}; correspondencia requiere revisión`);
    mapped.add(code);
    const general = (race.events || []).filter((event) => clean(event.name).toLowerCase() === 'general classification');
    if (general.length !== 1) throw new Error(`${clean(race.name)}: se esperaba una clasificación general, hay ${general.length}`);
    const event = general[0];
    if (!published.has(event.id)) {
      document.exclusions.push({ raceId: race.id, category: code, reason: 'Clasificación de meta todavía no disponible' });
      continue;
    }
    const body = await client.results(competition.id, event.id);
    const source = body.results.map(directoryRowToDataRide)
      .filter((row) => !/^race\s+cancelled$/i.test(clean(row.DisplayName)));
    const normalized = normalizeCxDataRideRows(source);
    if (normalized.length !== source.length) throw new Error(`${code}: filas normalizadas sin correspondencia con la fuente`);
    const rows = [];
    let unclassified = 0;
    normalized.forEach((row, index) => {
      if (row.rank == null && !row.irm) { unclassified++; return; }
      rows.push({ ...row, uciLicenseId: source[index].UciId || null });
    });
    if (unclassified) document.exclusions.push({ raceId: race.id, category: code, reason: `${unclassified} filas sin puesto ni estado` });
    if (!rows.length) {
      document.exclusions.push({ raceId: race.id, category: code, reason: 'Clasificación de meta sin puestos ni estados' });
      continue;
    }
    const sourceUrl = uciEventResultsUrl(competition.id, event.id);
    document.categories.push({
      category: code,
      dateKey: uciIsoDate(race.startDate, `Fecha de ${clean(race.name)}`),
      eventName: clean(event.name),
      publicationHint: 'unverified_results',
      rows,
      evidence: {
        sourceUrl,
        inputProvider: UCI_DIRECTORY_PROVIDER,
        // Clasificación UCI publicada, la misma que DataRide: el worker importa
        // la de DataRide como oficial. Sin bloqueo para que DataRide la sustituya.
        officialReviewed: true,
        officialReviewSourceUrl: sourceUrl,
        lockAutomatic: false,
        uciDirectory: { competitionId: competition.id, raceId: race.id, raceCode: directoryCode(race), eventId: event.id, eventCode: directoryCode(event) },
      },
    });
    log(`    ${code} ${String(rows.length).padStart(3)} filas  (${directoryCode(event)})`);
  }
  if (category != null && !mapped.has(category)) throw new Error('Categoría solicitada ausente en la competición del directorio');
  return document;
}
