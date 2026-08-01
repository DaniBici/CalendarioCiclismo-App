#!/usr/bin/env node

/**
 * Sincroniza la instantánea vigente del ránking UCI de equipos.
 *
 * - DataRide se consulta fuera de la transacción.
 * - Los equipos se resuelven contra team_seasons + teams del año UCI.
 * - Sin --apply solo valida y muestra el resumen (no escribe).
 * - Con --fetch-only ni siquiera necesita DATABASE_URL.
 * - Con --apply sustituye hombres + mujeres en una transacción corta.
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

const TOP_DIVISIONS = new Set(['WT', 'PT', 'WWT', 'PRW']);
const GENERIC_NAME_WORDS = new Set([
  'team', 'cycling', 'cyclisme', 'pro', 'professional', 'continental',
  'women', 'womens', 'woman', 'femme', 'femmes',
]);

const shouldApply = process.argv.includes('--apply');
const fetchOnly = process.argv.includes('--fetch-only');

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

function currentSeason(seasons) {
  const now = Date.now();
  const active = seasons.find((season) => {
    const start = microsoftDateMillis(season.StartDate);
    const end = microsoftDateMillis(season.EndDate);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  });
  return active || [...seasons].sort((a, b) => Number(b.Year) - Number(a.Year))[0];
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

async function fetchRanking(config, season) {
  const moments = await fetchJson(
    `/GetRankingMoments/?disciplineId=${DISCIPLINE_ID}` +
    `&disciplineSeasonId=${season.Id}&rankingId=${config.rankingId}`,
  );
  const moment = moments
    .filter((item) => Number(item.Id) > 0)
    .sort((a, b) => momentTimestamp(b) - momentTimestamp(a))[0]
    || moments.find((item) => Number(item.Id) > 0);
  invariant(moment, `DataRide no ofrece fechas para ${config.gender}`);

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
    countryCode: String(row.CountryIsoCode2 ?? '').trim().toUpperCase() || null,
    points: Number(row.Points),
    rankingDate: date,
    rankingId: config.rankingId,
    momentId: Number(moment.Id),
    disciplineSeasonId: Number(season.Id),
    sourceUrl,
  }));
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
  let score = 0;
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

function resolveTeams(rows, seasons) {
  const usedByGender = new Map();
  const resolved = rows.map((row) => {
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

  const matchedIds = new Set(resolved.map((row) => row.teamId).filter(Boolean));
  const missingTopDivision = seasons.filter(
    (season) => TOP_DIVISIONS.has(season.category) && !matchedIds.has(season.teamId),
  );
  invariant(
    missingTopDivision.length === 0,
    `Faltan equipos de máxima división: ${missingTopDivision
      .map((season) => `${season.category}:${season.seasonName || season.baseName}`)
      .join(', ')}`,
  );
  return resolved;
}

async function loadTeamSeasons(client, year) {
  const { rows } = await client.query(
    `select
       ts."teamId",
       ts.name as "seasonName",
       ts."nameAliases" as "seasonNameAliases",
       ts.category,
       ts.gender,
       t.name as "baseName",
       t."nameAliases",
       t."foldedNames",
       t."countryCode"
     from public.team_seasons ts
     join public.teams t on t.id = ts."teamId"
     where ts.year = $1`,
    [year],
  );
  return rows;
}

async function replaceSnapshot(client, rows) {
  const columns = [
    'gender', 'rank', '"previousRank"', '"uciTeamId"', '"teamId"',
    '"teamCategory"', '"sourceName"', '"displayName"', '"teamCode"',
    '"countryCode"', 'points', '"rankingDate"', '"rankingId"', '"momentId"',
    '"disciplineSeasonId"', '"sourceUrl"', '"syncedAt"',
  ];
  const values = [];
  const tuples = rows.map((row, rowIndex) => {
    const offset = rowIndex * columns.length;
    values.push(
      row.gender,
      row.rank,
      row.previousRank,
      row.uciTeamId,
      row.teamId,
      row.teamCategory,
      row.sourceName,
      row.displayName,
      row.teamCode,
      row.countryCode,
      row.points,
      row.rankingDate,
      row.rankingId,
      row.momentId,
      row.disciplineSeasonId,
      row.sourceUrl,
      new Date(),
    );
    return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(',')})`;
  });

  await client.query('begin');
  try {
    await client.query(`set local statement_timeout = '30s'`);
    await client.query(`select pg_advisory_xact_lock(hashtext('uci_team_rankings_sync'))`);
    await client.query('delete from public.uci_team_rankings');
    await client.query(
      `insert into public.uci_team_rankings (${columns.join(',')}) values ${tuples.join(',')}`,
      values,
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function main() {
  const seasons = await fetchJson(`/GetDisciplineSeasons/?disciplineId=${DISCIPLINE_ID}`);
  const season = currentSeason(seasons);
  invariant(season?.Id && season?.Year, 'No se pudo determinar la temporada de DataRide');

  const rankingGroups = await Promise.all(RANKINGS.map((config) => fetchRanking(config, season)));
  const rawRows = rankingGroups.flat();

  if (fetchOnly) {
    console.log(JSON.stringify({
      ok: true,
      season: Number(season.Year),
      rankings: rankingGroups.map((rows) => ({
        gender: rows[0].gender,
        date: rows[0].rankingDate,
        rows: rows.length,
      })),
      applied: false,
    }));
    return;
  }

  invariant(process.env.DATABASE_URL, 'Falta DATABASE_URL (usa --fetch-only para validar solo DataRide)');
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const teamSeasons = await loadTeamSeasons(client, Number(season.Year));
    const rows = resolveTeams(rawRows, teamSeasons);
    const unmatched = rows.filter((row) => !row.teamId);
    if (unmatched.length) {
      console.warn(
        `Aviso: ${unmatched.length} equipos sin asociación canónica:\n` +
        unmatched.map((row) => `- ${row.gender} #${row.rank} ${row.sourceName} (${row.matchIssue})`).join('\n'),
      );
    }
    if (shouldApply) await replaceSnapshot(client, rows);

    console.log(JSON.stringify({
      ok: true,
      season: Number(season.Year),
      rankings: rankingGroups.map((group) => ({
        gender: group[0].gender,
        date: group[0].rankingDate,
        rows: group.length,
      })),
      matched: rows.length - unmatched.length,
      unmatched: unmatched.length,
      applied: shouldApply,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
