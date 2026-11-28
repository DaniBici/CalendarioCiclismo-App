#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { recordAutomationSourceRun } from '../automation-monitor.mjs';
import { databaseUrl, PG_CONNECTION_LIMITS } from '../db/env.mjs';

/**
 * Sincroniza las instantáneas oficiales del ránking UCI de equipos y recalcula
 * el ránking publicado (public.uci_team_rankings).
 *
 * - DataRide se consulta fuera de la transacción.
 * - Se leen la temporada publicada y las posteriores ya empezadas: el ránking
 *   final de la cerrada y el de la temporada en curso se guardan por separado
 *   en public.uci_team_ranking_official.
 * - Los equipos se resuelven contra team_seasons + teams del año UCI y, para
 *   los equipos sin temporada de ese año, contra la del anterior.
 * - Sin --apply solo valida y muestra el resumen (no escribe).
 * - Con --fetch-only ni siquiera necesita DATABASE_URL.
 * - Con --apply actualiza las filas de cada equipo publicado (los ausentes
 *   conservan su última fila) y después llama a
 *   public.refresh_uci_team_rankings(), que suma a la última instantánea
 *   oficial los puntos de las clasificaciones oficiales posteriores y resta
 *   las penalizaciones manuales.
 * - Con --refresh-only no consulta DataRide: solo recalcula (timer de 15 min).
 */

const DATARIDE_BASE = 'https://dataride.uci.ch/iframe';
const DISCIPLINE_ID = 10;
const RANKING_TYPE_ID = 2;
const PAGE_SIZE = 500;
const USER_AGENT = 'CalendarioCiclismo/uci-team-ranking-sync (+https://calendariociclismo.app)';

const RANKINGS = [
  { gender: 'male', categoryId: 22, groupId: 1, rankingId: 238 },
  { gender: 'female', categoryId: 23, groupId: 2, rankingId: 35 },
];

const GENERIC_NAME_WORDS = new Set([
  'team', 'cycling', 'cyclisme', 'pro', 'professional', 'continental',
  'women', 'womens', 'woman', 'femme', 'femmes',
]);

const shouldApply = process.argv.includes('--apply');
const fetchOnly = process.argv.includes('--fetch-only');
const refreshOnly = process.argv.includes('--refresh-only');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(path, init = {}) {
  const response = await fetch(`${DATARIDE_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': USER_AGENT,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`DataRide ${response.status} al consultar ${path}`);
  }
  return response.json();
}

function microsoftDateMillis(value) {
  const match = String(value || '').match(/Date\(([-\d]+)\)/);
  return match ? Number(match[1]) : Number.NaN;
}

function rankingDate(moment) {
  const match = String(moment.Name || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  invariant(match, `Fecha de ránking inesperada: ${moment.Name}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function momentTimestamp(moment) {
  const apiDate = microsoftDateMillis(moment.Date);
  if (Number.isFinite(apiDate)) return apiDate;
  const match = String(moment.Name || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : 0;
}

function appendFilter(params, index, field, value) {
  params.set(`filter[filters][${index}][field]`, field);
  params.set(`filter[filters][${index}][operator]`, 'eq');
  params.set(`filter[filters][${index}][value]`, String(value ?? ''));
}

async function fetchLatestMoment(config, season) {
  const moments = await fetchJson(
    `/GetRankingMoments/?disciplineId=${DISCIPLINE_ID}` +
    `&disciplineSeasonId=${season.Id}&rankingId=${config.rankingId}`,
  );
  return moments
    .filter((item) => Number(item.Id) > 0)
    .sort((a, b) => momentTimestamp(b) - momentTimestamp(a))[0] || null;
}

function seasonDate(value) {
  const millis = microsoftDateMillis(value);
  invariant(Number.isFinite(millis), `Fecha de temporada inesperada: ${value}`);
  // DataRide da la medianoche de Europa central en UTC (22:00 o 23:00 del día anterior).
  return new Date(millis).toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
}

/**
 * Temporadas que se sincronizan: la publicada y las posteriores que ya hayan
 * empezado. DataRide abre la temporada nueva al día siguiente del cierre (2027
 * empezó el 19-10-2026 y publicó su primera fecha el 27-10-2026).
 */
export function seasonsToSync(seasons, publishedYear, now = Date.now()) {
  return seasons
    .filter((season) => Number(season.Year) >= Number(publishedYear))
    .filter((season) => microsoftDateMillis(season.StartDate) <= now)
    .sort((a, b) => Number(a.Year) - Number(b.Year));
}

async function fetchRanking(config, season, moment) {
  const params = new URLSearchParams({
    rankingId: String(config.rankingId),
    disciplineId: String(DISCIPLINE_ID),
    rankingTypeId: String(RANKING_TYPE_ID),
    take: String(PAGE_SIZE),
    skip: '0',
    page: '1',
    pageSize: String(PAGE_SIZE),
    'filter[logic]': 'and',
  });
  [
    ['RaceTypeId', 0],
    ['CategoryId', config.categoryId],
    ['SeasonId', season.Id],
    ['MomentId', moment.Id],
    ['CountryId', ''],
    ['IndividualName', ''],
    ['TeamName', ''],
  ].forEach(([field, value], index) => appendFilter(params, index, field, value));

  const payload = await fetchJson('/ObjectRankings/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: params,
  });
  invariant(Array.isArray(payload.data), `Respuesta de ránking inválida para ${config.gender}`);
  invariant(payload.data.length > 0, `DataRide devolvió 0 equipos para ${config.gender}`);
  invariant(
    Number(payload.total) === payload.data.length,
    `${config.gender}: se recibieron ${payload.data.length} de ${payload.total} filas`,
  );

  const date = rankingDate(moment);
  const sourceUrl =
    `${DATARIDE_BASE}/RankingDetails/${config.rankingId}` +
    `?disciplineId=${DISCIPLINE_ID}&groupId=${config.groupId}` +
    `&momentId=${moment.Id}&disciplineSeasonId=${season.Id}` +
    `&rankingTypeId=${RANKING_TYPE_ID}&categoryId=${config.categoryId}&raceTypeId=0`;

  return payload.data.map((row) => ({
    gender: config.gender,
    rank: Number(row.Rank),
    previousRank: Number(row.PrecedingRank) > 0 ? Number(row.PrecedingRank) : null,
    uciTeamId: Number(row.TeamId ?? row.ObjectId),
    sourceName: String(row.TeamName ?? row.ObjectName ?? '').trim(),
    teamCode: String(row.TeamCode ?? '').trim() || null,
    // DataRide da «--» a los equipos sin país (WCC Team de la UCI): sin bandera.
    countryCode: countryCode(row.CountryIsoCode2),
    points: Number(row.Points),
    sanctionPoints: row.SanctionPoints == null ? null : Number(row.SanctionPoints),
    rankingDate: date,
    rankingId: config.rankingId,
    momentId: Number(moment.Id),
    disciplineSeasonId: Number(season.Id),
    sourceUrl,
  }));
}

function countryCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bcyclingteam\b/g, 'cycling team')
    .replace(/\brentacar\b/g, 'rent a car')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactName(value) {
  return normalizedName(value)
    .split(' ')
    .filter((word) => word && !GENERIC_NAME_WORDS.has(word))
    .join(' ');
}

function isDevelopmentName(value) {
  return /\b(development|devo|dev|rookies|generation|continental)\b/.test(
    normalizedName(value),
  );
}

function splitAliases(value) {
  return Array.isArray(value)
    ? value
    : String(value || '').split(/\r?\n|\\n/);
}

function aliasesFor(season) {
  return [
    season.seasonName,
    season.baseName,
    ...splitAliases(season.seasonNameAliases),
    ...splitAliases(season.nameAliases),
    ...(Array.isArray(season.foldedNames) ? season.foldedNames : []),
  ].filter(Boolean);
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let aIndex = 1; aIndex <= a.length; aIndex += 1) {
    let diagonal = previous[0];
    previous[0] = aIndex;
    for (let bIndex = 1; bIndex <= b.length; bIndex += 1) {
      const above = previous[bIndex];
      previous[bIndex] = Math.min(
        previous[bIndex] + 1,
        previous[bIndex - 1] + 1,
        diagonal + (a[aIndex - 1] === b[bIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function matchScore(source, season) {
  const sourceExact = normalizedName(source.sourceName);
  const sourceCompact = compactName(source.sourceName);
  const sourceCode = String(source.teamCode || '').trim().toUpperCase();
  const seasonCode = String(season.uciCode || '').trim().toUpperCase();
  let score = 0;
  if (sourceCode && seasonCode && sourceCode === seasonCode) score = 200;
  for (const canonical of [season.seasonName, season.baseName].filter(Boolean)) {
    const canonicalExact = normalizedName(canonical);
    const canonicalCompact = compactName(canonical);
    if (sourceExact && sourceExact === canonicalExact) score = Math.max(score, 120);
    if (sourceCompact && sourceCompact === canonicalCompact) score = Math.max(score, 100);
  }
  for (const alias of aliasesFor(season)) {
    const aliasExact = normalizedName(alias);
    const aliasCompact = compactName(alias);
    if (sourceExact && sourceExact === aliasExact) score = Math.max(score, 100);
    if (sourceCompact && sourceCompact === aliasCompact) score = Math.max(score, 80);
    if (
      Math.min(sourceCompact.length, aliasCompact.length) >= 9 &&
      (sourceCompact.includes(aliasCompact) || aliasCompact.includes(sourceCompact))
    ) {
      score = Math.max(score, 60);
    }
    if (
      sourceCompact.length >= 12 &&
      aliasCompact.length >= 12 &&
      editDistance(sourceCompact, aliasCompact) <= 2
    ) {
      score = Math.max(score, 50);
    }
  }
  if (
    score > 0 &&
    source.countryCode &&
    season.countryCode &&
    source.countryCode.toUpperCase() === String(season.countryCode).toUpperCase()
  ) {
    score += 2;
  }
  if (score > 0) {
    const sourceDevelopment = isDevelopmentName(source.sourceName);
    const seasonDevelopment = isDevelopmentName(
      `${season.seasonName || ''} ${season.baseName || ''}`,
    );
    score += sourceDevelopment === seasonDevelopment ? 20 : -20;
  }
  return score;
}

export function resolveTeams(rows, seasons) {
  const usedByGender = new Map();
  return rows.map((row) => {
    if (!usedByGender.has(row.gender)) usedByGender.set(row.gender, new Set());
    const usedTeamIds = usedByGender.get(row.gender);
    const candidates = seasons
      .filter((season) => season.gender === row.gender)
      .map((season) => ({ season, score: matchScore(row, season) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);
    const unused = candidates.filter((candidate) => !usedTeamIds.has(candidate.season.teamId));
    const pool = unused.length ? unused : candidates;
    const best = pool[0];
    const tied = best && pool.filter((candidate) => candidate.score === best.score);
    if (!best || tied.length !== 1) {
      return {
        ...row,
        teamId: null,
        teamCategory: null,
        displayName: row.sourceName,
        matchIssue: !best ? 'sin coincidencia' : `empate: ${tied.map((item) => item.season.teamId).join(', ')}`,
      };
    }
    usedTeamIds.add(best.season.teamId);
    return {
      ...row,
      teamId: best.season.teamId,
      teamCategory: best.season.category,
      displayName: best.season.seasonName || best.season.baseName || row.sourceName,
      matchIssue: null,
    };
  });
}

// Temporada del año del ránking y, para los equipos que aún no la tienen (altas
// de 2027 pendientes), la del año anterior: la identidad del equipo es la misma.
async function loadTeamSeasons(client, year) {
  const { rows } = await client.query(
    `select distinct on (ts."teamId")
       ts."teamId",
       ts.name as "seasonName",
       ts."nameAliases" as "seasonNameAliases",
       ts.category,
       ts.gender,
       ts."uciCode",
       t.name as "baseName",
       t."nameAliases",
       t."foldedNames",
       t."countryCode"
     from public.team_seasons ts
     join public.teams t on t.id = ts."teamId"
     where ts.year in ($1, $1 - 1)
     order by ts."teamId", ts.year desc`,
    [year],
  );
  return rows;
}

const OFFICIAL_COLUMNS = [
  'seasonYear', 'gender', 'rank', 'previousRank', 'uciTeamId', 'teamId',
  'teamCategory', 'sourceName', 'displayName', 'teamCode', 'countryCode',
  'points', 'sanctionPoints', 'rankingDate', 'rankingId', 'momentId',
  'disciplineSeasonId', 'sourceUrl',
];

async function upsertOfficial(client, seasonYear, rows) {
  const values = [];
  const tuples = rows.map((row, rowIndex) => {
    const offset = rowIndex * (OFFICIAL_COLUMNS.length + 1);
    values.push(...OFFICIAL_COLUMNS.map((column) => (
      column === 'seasonYear' ? seasonYear : row[column] ?? null
    )), new Date());
    const placeholders = Array.from(
      { length: OFFICIAL_COLUMNS.length + 1 },
      (_, columnIndex) => `$${offset + columnIndex + 1}`,
    );
    return `(${placeholders.join(',')})`;
  });
  const columnList = [...OFFICIAL_COLUMNS, 'syncedAt'].map((column) => `"${column}"`).join(',');

  await client.query('begin');
  try {
    await client.query(`set local statement_timeout = '30s'`);
    await client.query(`select pg_advisory_xact_lock(hashtext('uci_team_rankings_sync'))`);
    // Sin borrar los equipos ausentes: en enero la UCI vacía el ránking y repone
    // los equipos según los registra; cada uno conserva su última fila oficial.
    const updates = [...OFFICIAL_COLUMNS, 'syncedAt']
      .filter((column) => !['seasonYear', 'gender', 'uciTeamId'].includes(column))
      .map((column) => `"${column}" = excluded."${column}"`)
      .join(', ');
    await client.query(
      `insert into public.uci_team_ranking_official (${columnList}) values ${tuples.join(',')}
       on conflict ("seasonYear", gender, "uciTeamId") do update set ${updates}`,
      values,
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function upsertSeason(client, season) {
  await client.query(
    `insert into public.uci_ranking_seasons ("seasonYear", "startDate", "endDate", "dataRideSeasonId")
     values ($1, $2, $3, $4)
     on conflict ("seasonYear") do update set
       "startDate" = excluded."startDate",
       "endDate" = excluded."endDate",
       "dataRideSeasonId" = excluded."dataRideSeasonId",
       "updatedAt" = now()
     where (uci_ranking_seasons."startDate", uci_ranking_seasons."endDate", uci_ranking_seasons."dataRideSeasonId")
       is distinct from (excluded."startDate", excluded."endDate", excluded."dataRideSeasonId")`,
    [Number(season.Year), seasonDate(season.StartDate), seasonDate(season.EndDate), Number(season.Id)],
  );
}

const SNAPSHOT_FIELDS = [
  'gender', 'rank', 'previousRank', 'uciTeamId', 'teamId', 'teamCategory',
  'sourceName', 'displayName', 'teamCode', 'countryCode', 'points', 'sanctionPoints',
  'rankingDate', 'sourceUrl',
];

function snapshotKey(row) {
  return `${row.gender}:${row.uciTeamId}`;
}

// points es numeric(…, 2): pg devuelve "2018.00" y DataRide, 2018.
function signatureValue(field, value) {
  if (value === null || value === undefined) return '';
  return field === 'points' || field === 'sanctionPoints'
    ? Number(value).toFixed(2)
    : String(value);
}

function snapshotSignature(row) {
  return SNAPSHOT_FIELDS.map((field) => signatureValue(field, row[field])).join('\u001f');
}

export function storedSnapshot(rows) {
  return new Map(rows.map((row) => [snapshotKey(row), snapshotSignature(row)]));
}

export function snapshotIsCurrent(rows, storedRows) {
  if (!rows.length || rows.length !== storedRows.size) return false;
  return rows.every((row) => snapshotSignature(row) === storedRows.get(snapshotKey(row)));
}

/**
 * Una instantánea provisional cargada desde otra fuente (momentId 0) lleva una
 * fecha posterior a la última de DataRide; no se sustituye por una publicación
 * más antigua. La primera fecha oficial igual o posterior la reemplaza.
 */
export function storedIsNewer(rows, storedRows) {
  const latest = new Map();
  for (const row of storedRows) {
    if (!latest.has(row.gender) || row.rankingDate > latest.get(row.gender)) {
      latest.set(row.gender, row.rankingDate);
    }
  }
  return rows.some((row) => latest.has(row.gender) && latest.get(row.gender) > row.rankingDate);
}

async function loadStoredRows(client, seasonYear) {
  const { rows } = await client.query(
    `select gender, rank, "previousRank", "uciTeamId", "teamId", "teamCategory",
            "sourceName", "displayName", "teamCode", "countryCode", points,
            "sanctionPoints", "rankingDate"::text as "rankingDate", "sourceUrl"
     from public.uci_team_ranking_official
     where "seasonYear" = $1`,
    [seasonYear],
  );
  return rows;
}

async function latestMoments(season) {
  return Promise.all(RANKINGS.map((config) => fetchLatestMoment(config, season)));
}

// Un género sin fechas publicadas en la temporada (inicio de temporada) se omite.
async function fetchRankings({ season, moments }) {
  invariant(season?.Id && season?.Year, 'No se pudo determinar la temporada de DataRide');
  const groups = await Promise.all(
    RANKINGS.map((config, index) => (
      moments[index] ? fetchRanking(config, season, moments[index]) : null
    )),
  );
  return groups.filter(Boolean);
}

function rankingSummary(rankingGroups) {
  return rankingGroups.map((rows) => ({
    gender: rows[0].gender,
    date: rows[0].rankingDate,
    rows: rows.length,
  }));
}

async function openClient() {
  invariant(databaseUrl(), 'Falta DATABASE_URL (usa --fetch-only para validar solo DataRide)');
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: databaseUrl(),
    ssl: databaseUrl().includes('localhost')
      ? undefined
      : { rejectUnauthorized: false },
    ...PG_CONNECTION_LIMITS,
  });
  await client.connect();
  return client;
}

async function refreshPublished(client) {
  const { rows } = await client.query('select public.refresh_uci_team_rankings() as result');
  return rows[0].result;
}

async function syncSeason(client, season) {
  const year = Number(season.Year);
  const rankingGroups = await fetchRankings({ season, moments: await latestMoments(season) });
  if (!rankingGroups.length) {
    return { season: year, rankings: [], matched: 0, unmatched: [], applied: false };
  }
  const teamSeasons = await loadTeamSeasons(client, year);
  const rows = resolveTeams(rankingGroups.flat(), teamSeasons);
  const storedRows = await loadStoredRows(client, year);
  const genders = rankingGroups.map((group) => group[0].gender);
  const storedForGenders = storedRows.filter((row) => genders.includes(row.gender));
  const storedNewer = storedIsNewer(rows, storedForGenders);
  // Las filas conservadas de equipos ausentes no cuentan para la comparación.
  const freshKeys = new Set(rows.map((row) => `${row.gender}:${row.uciTeamId}`));
  const alreadyCurrent = !storedNewer && snapshotIsCurrent(
    rows,
    storedSnapshot(storedForGenders.filter((row) => freshKeys.has(`${row.gender}:${row.uciTeamId}`))),
  );
  const applied = shouldApply && !storedNewer && !alreadyCurrent;
  if (shouldApply) await upsertSeason(client, season);
  if (applied) await upsertOfficial(client, year, rows);
  const unmatched = rows.filter((row) => !row.teamId);
  return {
    season: year,
    rankings: rankingSummary(rankingGroups),
    matched: rows.length - unmatched.length,
    unmatched: unmatched.map((row) => `${row.gender} #${row.rank} ${row.sourceName} (${row.matchIssue})`),
    applied,
    alreadyCurrent,
    storedNewer,
  };
}

async function main() {
  if (refreshOnly) {
    const client = await openClient();
    try {
      console.log(JSON.stringify({ ok: true, refresh: await refreshPublished(client) }));
    } finally {
      await client.end();
    }
    return;
  }

  const seasons = await fetchJson(`/GetDisciplineSeasons/?disciplineId=${DISCIPLINE_ID}`);

  if (fetchOnly) {
    const latest = seasons
      .filter((season) => microsoftDateMillis(season.StartDate) <= Date.now())
      .sort((a, b) => Number(b.Year) - Number(a.Year))
      .slice(0, 2);
    const summaries = [];
    for (const season of latest) {
      const groups = await fetchRankings({ season, moments: await latestMoments(season) });
      summaries.push({ season: Number(season.Year), rankings: rankingSummary(groups) });
    }
    console.log(JSON.stringify({ ok: true, seasons: summaries, applied: false }));
    return;
  }

  const client = await openClient();
  try {
    const { rows: published } = await client.query(
      'select "seasonYear" from public.uci_ranking_seasons where "isPublished"',
    );
    invariant(published.length === 1, 'No hay una temporada de ránking publicada');
    const results = [];
    for (const season of seasonsToSync(seasons, published[0].seasonYear)) {
      results.push(await syncSeason(client, season));
    }
    const unmatched = results.flatMap((result) => result.unmatched);
    if (unmatched.length) {
      console.warn(`Aviso: ${unmatched.length} equipos sin asociación canónica:\n- ${unmatched.join('\n- ')}`);
    }
    const refresh = shouldApply ? await refreshPublished(client) : null;

    if (process.env.CC_AUTOMATION_RUN_ID) {
      const found = results.reduce((sum, result) => sum + result.matched + result.unmatched.length, 0);
      await recordAutomationSourceRun(client, {
        runId: process.env.CC_AUTOMATION_RUN_ID,
        source: 'uci_team_ranking',
        status: unmatched.length ? 'warning' : 'success',
        itemsFound: found,
        itemsMatched: found - unmatched.length,
        itemsChanged: results.filter((result) => result.applied).length,
        summary: {
          seasons: results.map(({ season, rankings, applied }) => ({ season, rankings, applied })),
          refresh,
        },
      });
    }

    console.log(JSON.stringify({ ok: true, seasons: results, refresh }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
