#!/usr/bin/env node
/**
 * Enlaza las carreras que se disputan hoy con UCI DataRide cuando todavía no
 * tienen ninguna fuente de resultados.
 *
 * El enlazador es deliberadamente más conservador que un backfill histórico:
 * solo mira jornadas reales del día local en España, exige una señal de
 * identidad además de fecha/país/clase y no compite con un enlace existente.
 * Después de crear el enlace activa la herencia de ventanas automáticas y, si
 * se solicita, vuelca de inmediato la jornada actual. Las jornadas posteriores
 * quedan para `results-cron.mjs --configured`.
 *
 * Uso en producción:
 *   node scripts/results-fetchers/dataride-live-linker.mjs --process-linked
 *
 * Requiere DATABASE_URL con el rol `cc_results_worker`.
 */
'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { databaseUrl } from '../db/env.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const hasFlag = (name) => args.includes(`--${name}`);

const DISCIPLINE_ID = 10;
const parsedLimit = parseInt(getArg('limit') || '8', 10);
const parsedSlack = parseInt(getArg('slack') || '1', 10);
const MAX_LINKS = Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 8;
const SLACK_DAYS = Number.isFinite(parsedSlack) ? Math.max(0, parsedSlack) : 1;
const DRY_RUN = hasFlag('dry-run');
const PROCESS_LINKED = hasFlag('process-linked');
const DATARIDE_BASE = 'https://dataride.uci.ch/iframe';
const USER_AGENT = 'calendariociclismo-live-linker/1.0 (+https://calendariociclismo.app)';
const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_CRON = join(HERE, 'results-cron.mjs');
const DAY_MS = 24 * 60 * 60 * 1000;
let DATA_RIDE_COOKIE = '';

const log = (...values) => process.stderr.write(`${values.join(' ')}\n`);

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

export function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'tour', 'de', 'la', 'le', 'du', 'des', 'di', 'a', 'of', 'the', 'gp',
  'grand', 'prix', 'gran', 'premio', 'ronde', 'van', 'giro', 'vuelta',
  'classic', 'classique', 'race', 'cycling', 'international', 'internazionale',
  'trophy', 'trofeo', 'and', 'et', 'y', 'el', 'i', 'ii', 'iii', 'memorial',
]);

export function nameTokens(value) {
  return new Set(fold(value).split(/\s+/).filter((token) => token && !STOPWORDS.has(token)));
}

export function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

/** Convierte /Date(ms)/ o una fecha ISO a la fecha civil UTC. */
export function dataRideDay(value) {
  const raw = String(value || '');
  const dotnet = /\/Date\((-?\d+)\)\//.exec(raw);
  if (dotnet) {
    // DataRide serializa algunas fechas a medianoche CET/CEST. El +3h evita
    // que su representación UTC caiga en el día civil anterior.
    const date = new Date(Number(dotnet[1]) + 3 * 60 * 60 * 1000);
    return Number.isNaN(date.getTime()) ? null : Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    );
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return iso ? Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : null;
}

function ourDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function overlaps(ourStart, ourEnd, uciStart, uciEnd, slackDays) {
  if (ourStart == null || uciStart == null) return false;
  const endA = ourEnd ?? ourStart;
  const endB = uciEnd ?? uciStart;
  return ourStart - slackDays * DAY_MS <= endB
    && uciStart - slackDays * DAY_MS <= endA;
}

export function normalizeClass(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').replace('UCIWT', 'UWT');
}

function isWomenName(value) {
  return /\b(women|woman|femmes?|f[ée]mina[s]?|f[ée]minin[es]?|dames|donne|frauen|vrouwen|ladies|femminile|kobiet|emakume[a-z]*|we|wu)\b/i.test(String(value || ''));
}

function isJuniorName(value) {
  return /\b(junior|juniores|juniors|espoirs)\b/i.test(String(value || ''));
}

export function uciGender(competition) {
  const classCode = normalizeClass(competition?.ClassCode);
  if (/WWT|^WW|^1\.WW|^2\.WW/.test(classCode)
    || (classCode === 'WC' && isWomenName(competition?.CompetitionName))) return 'female';
  if (/UWT/.test(classCode)) return 'male';
  if (isWomenName(competition?.CompetitionName)) return 'female';
  return null;
}

function competitionId(competition) {
  const value = Number(competition?.CompetitionId ?? competition?.Id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function scoreCandidate(race, competition) {
  const ourGender = race.gender === 'female' ? 'female' : 'male';
  const gender = uciGender(competition);
  return {
    competition,
    competitionId: competitionId(competition),
    uciName: String(competition.CompetitionName || '').trim(),
    uciClass: String(competition.ClassCode || '').trim(),
    classMatch: normalizeClass(race.uciCategory) === normalizeClass(competition.ClassCode),
    genderMatch: gender != null && gender === ourGender,
    nameSim: jaccard(nameTokens(race.nameEn || race.originalName || race.name), nameTokens(competition.CompetitionName)),
  };
}

/**
 * Emparejamiento para altas del día. `unique` exige la misma señal que el
 * matcher histórico, pero no acepta una coincidencia basada solo en fecha.
 */
export function matchTodayRace(race, competitions, { slackDays = 1 } = {}) {
  const start = ourDay(race.startDate);
  const end = ourDay(race.endDate);
  const country = String(race.countryCode || '').toLowerCase().split('-')[0];
  const candidates = competitions
    .filter((competition) => competitionId(competition) != null)
    .filter((competition) => !isJuniorName(competition.CompetitionName))
    .filter((competition) => overlaps(
      start,
      end,
      dataRideDay(competition.StartDate),
      dataRideDay(competition.EndDate),
      slackDays,
    ))
    .filter((competition) => {
      const uciCountry = String(competition.CountryIsoCode2 || '').toLowerCase();
      return !country || !uciCountry || country === uciCountry;
    })
    .filter((competition) => {
      const gender = uciGender(competition);
      const ourGender = race.gender === 'female' ? 'female' : 'male';
      return gender == null || gender === ourGender;
    })
    .map((competition) => scoreCandidate(race, competition))
    .sort((left, right) => (
      Number(right.genderMatch) - Number(left.genderMatch)
      || Number(right.classMatch) - Number(left.classMatch)
      || right.nameSim - left.nameSim
    ));

  if (!candidates.length) return { status: 'none', candidates: [] };

  const top = candidates[0];
  const second = candidates[1] || null;
  const classWinners = candidates.filter((candidate) => candidate.classMatch);
  const classAndName = classWinners.filter((candidate) => candidate.nameSim > 0);
  const genderWinners = candidates.filter((candidate) => candidate.genderMatch);
  const nameMargin = top.nameSim - (second?.nameSim || 0);

  let winner = null;
  let note = null;
  if (genderWinners.length === 1 && genderWinners[0].classMatch) {
    winner = genderWinners[0];
    note = 'género y clase coinciden';
  } else if (classWinners.length === 1 && (classWinners[0].nameSim > 0 || classWinners[0].genderMatch)) {
    winner = classWinners[0];
    note = 'única coincidencia de clase con señal nominal';
  } else if (top.classMatch && top.nameSim >= 0.33 && nameMargin >= 0.15) {
    winner = top;
    note = 'nombre domina entre candidatos de fecha/país';
  } else if (classAndName.length === 1) {
    winner = classAndName[0];
    note = 'único candidato con nombre compartido';
  } else if (top.classMatch && second?.classMatch
    && top.nameSim >= 0.5 && Math.abs(nameMargin) <= 0.1) {
    winner = top;
    note = 'duplicado de DataRide con mismo nombre';
  }

  if (!winner) {
    return {
      status: 'ambiguous',
      candidates: candidates.slice(0, 4).map((candidate) => ({
        competitionId: candidate.competitionId,
        uciName: candidate.uciName,
        uciClass: candidate.uciClass,
        classMatch: candidate.classMatch,
        genderMatch: candidate.genderMatch,
        nameSim: Number(candidate.nameSim.toFixed(2)),
      })),
    };
  }

  return {
    status: 'unique',
    note,
    candidate: {
      competitionId: winner.competitionId,
      uciName: winner.uciName,
      uciClass: winner.uciClass,
      classMatch: winner.classMatch,
      genderMatch: winner.genderMatch,
      nameSim: Number(winner.nameSim.toFixed(2)),
    },
    candidates: candidates.slice(0, 4).map((candidate) => ({
      competitionId: candidate.competitionId,
      uciName: candidate.uciName,
      uciClass: candidate.uciClass,
      classMatch: candidate.classMatch,
      genderMatch: candidate.genderMatch,
      nameSim: Number(candidate.nameSim.toFixed(2)),
    })),
  };
}

function jsonDays(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

async function fetchJson(path, init = {}) {
  if (!DATA_RIDE_COOKIE) {
    const home = await fetch('https://dataride.uci.ch/', {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    const setCookies = home.headers.getSetCookie
      ? home.headers.getSetCookie()
      : [home.headers.get('set-cookie')].filter(Boolean);
    DATA_RIDE_COOKIE = (setCookies || []).map((cookie) => cookie.split(';')[0]).join('; ');
  }
  const response = await fetch(`${DATARIDE_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': USER_AGENT,
      ...(DATA_RIDE_COOKIE ? { Cookie: DATA_RIDE_COOKIE } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DataRide ${response.status} al consultar ${path}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`DataRide devolvió una respuesta no JSON al consultar ${path}`);
  }
}

async function fetchSeasons() {
  const payload = await fetchJson(`/GetDisciplineSeasons/?disciplineId=${DISCIPLINE_ID}`);
  return Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
}

async function fetchCompetitions(seasonId) {
  const body = new URLSearchParams({
    disciplineId: String(DISCIPLINE_ID),
    take: '500',
    skip: '0',
    page: '1',
    pageSize: '500',
    'sort[0][field]': 'StartDate',
    'sort[0][dir]': 'desc',
    'filter[logic]': 'and',
    'filter[filters][0][field]': 'RaceTypeId',
    'filter[filters][0][operator]': 'eq',
    'filter[filters][0][value]': '0',
    'filter[filters][1][field]': 'CategoryId',
    'filter[filters][1][operator]': 'eq',
    'filter[filters][1][value]': '0',
    'filter[filters][2][field]': 'SeasonId',
    'filter[filters][2][operator]': 'eq',
    'filter[filters][2][value]': String(seasonId),
  }).toString();
  const payload = await fetchJson('/Competitions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function loadTodayRaces(client) {
  const { rows } = await client.query(
    `WITH today_days AS (
       SELECT d.id, d."raceId", d."stageNumber", d."neutralStartTimeUtc",
              d."estimatedFinishTimeUtc",
              row_number() OVER (
                PARTITION BY d."raceId", d."stageNumber"
                ORDER BY d."neutralStartTimeUtc" ASC NULLS LAST, d.id ASC
              ) - 1 AS "sectorIndex"
       FROM public.race_days d
       WHERE d."dateKey" = to_char(now() AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD')
         AND d."isRestDay" = false
         AND d."isCancelledDay" = false
     )
     SELECT r.id, r.name, r."nameEn", r."originalName", r."startDate", r."endDate",
            r."uciCategory", r.gender, r."countryCode", r.year, r."raceFormat", r."resultsOnly",
            jsonb_agg(jsonb_build_object(
              'id', d.id,
              'stageNumber', d."stageNumber",
              'sectorIndex', d."sectorIndex",
              'estimatedFinishTimeUtc', d."estimatedFinishTimeUtc"
            ) ORDER BY d."stageNumber" NULLS FIRST, d."sectorIndex") AS "todayDays"
     FROM public.races r
     JOIN today_days d ON d."raceId" = r.id
     WHERE r."isCancelled" = false
       AND NOT EXISTS (
         SELECT 1 FROM public.race_uci_links l WHERE l."raceId" = r.id
       )
     GROUP BY r.id, r.name, r."nameEn", r."originalName", r."startDate", r."endDate",
              r."uciCategory", r.gender, r."countryCode", r.year, r."raceFormat", r."resultsOnly"
     ORDER BY min(d."estimatedFinishTimeUtc") ASC NULLS LAST, r.id
     LIMIT $1`,
    [MAX_LINKS],
  );
  return rows.map((race) => ({ ...race, todayDays: jsonDays(race.todayDays) }));
}

async function loadOccupiedCompetitions(client) {
  const { rows } = await client.query(
    `SELECT "competitionId"
     FROM public.race_uci_links
     WHERE "disciplineId" = $1 AND "uciRaceId" = 0`,
    [DISCIPLINE_ID],
  );
  return new Set(rows.map((row) => Number(row.competitionId)));
}

async function insertLink(client, race, candidate, seasonId) {
  const { rows } = await client.query(
    `INSERT INTO public.race_uci_links
       ("raceId", "competitionId", "disciplineId", "seasonId", "uciRaceId",
        "autoMatched", "syncStatus", "source", "matchMethod",
        "syncStartOffsetMinutes", "syncStopOffsetMinutes")
     VALUES ($1, $2, $3, $4, 0, true, 'pending', 'uci', 'live-today', -15, 720)
     ON CONFLICT ("raceId") DO NOTHING
     RETURNING "raceId", "competitionId"`,
    [race.id, candidate.competitionId, DISCIPLINE_ID, seasonId],
  );
  return rows[0] || null;
}

async function reserveTodayDays(client, race) {
  const ids = race.todayDays
    .map((day) => day.id)
    .filter(Boolean);
  if (!ids.length) return;
  await client.query(
    `UPDATE public.race_days
     SET "resultsLastAutoSyncAt" = now(), "resultsAutoSyncQueuedAt" = NULL
     WHERE id = ANY($1::text[])`,
    [ids],
  );
}

function runResultsCron(cronArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RESULTS_CRON, ...cronArgs], {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', (error) => {
      log(`No se pudo iniciar el cron de resultados: ${error.message}`);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function processLinkedRace(race) {
  if (!PROCESS_LINKED) return 0;
  const days = race.todayDays;

  const stageDays = days.filter((day) => day.stageNumber != null);
  if (race.raceFormat === 'one_day' || stageDays.length === 0) {
    return runResultsCron(['--race-id', String(race.id)]);
  }

  let code = 0;
  for (const day of stageDays) {
    const cronArgs = ['--race-id', String(race.id), '--stage', String(day.stageNumber)];
    if (day.sectorIndex != null) cronArgs.push('--sector-index', String(day.sectorIndex));
    const result = await runResultsCron(cronArgs);
    code = code || result;
  }
  return code;
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  if (!databaseUrl(env)) throw new Error('Falta DATABASE_URL');

  const { Client } = await import('pg');
  const client = new Client({
    connectionString: databaseUrl(env),
    ssl: databaseUrl(env).includes('localhost') ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  let linked = 0;
  let ambiguous = 0;
  let notFound = 0;
  let collisions = 0;
  let processErrors = 0;
  try {
    const races = await loadTodayRaces(client);
    if (!races.length) {
      log('Enlace DataRide del día: no hay carreras actuales sin fuente.');
      process.stdout.write(JSON.stringify({ candidates: 0, linked: 0, ambiguous: 0, notFound: 0, collisions: 0, processed: 0, changed: false }) + '\n');
      return;
    }

    const seasons = await fetchSeasons();
    const seasonByYear = new Map(seasons.map((season) => [Number(season.Year), season]));
    const competitionsByYear = new Map();
    for (const race of races) {
      const year = Number(race.year);
      const season = seasonByYear.get(year);
      if (!season?.Id) {
        log(`  · ${race.id} «${race.name}»: DataRide no ofrece temporada ${year}`);
        notFound++;
        continue;
      }
      if (!competitionsByYear.has(year)) {
        competitionsByYear.set(year, await fetchCompetitions(season.Id));
      }
    }

    const proposals = [];
    for (const race of races) {
      const season = seasonByYear.get(Number(race.year));
      const competitions = competitionsByYear.get(Number(race.year)) || [];
      if (!season?.Id || !competitions.length) {
        if (season?.Id) notFound++;
        continue;
      }
      const decision = matchTodayRace(race, competitions, { slackDays: SLACK_DAYS });
      if (decision.status === 'unique') {
        proposals.push({ race, seasonId: Number(season.Id), ...decision });
        log(`  ? ${race.id} «${race.name}» → #${decision.candidate.competitionId} «${decision.candidate.uciName}» (${decision.note})`);
      } else if (decision.status === 'ambiguous') {
        ambiguous++;
        log(`  ? ${race.id} «${race.name}»: coincidencia ambigua; queda para revisión manual`);
      } else {
        notFound++;
        log(`  ∅ ${race.id} «${race.name}»: DataRide aún no ofrece una coincidencia`);
      }
    }

    const occupied = await loadOccupiedCompetitions(client);
    const proposedCompetitionIds = new Map();
    for (const proposal of proposals) {
      const id = proposal.candidate.competitionId;
      if (occupied.has(id)) {
        collisions++;
        log(`  · ${proposal.race.id}: #${id} ya está enlazada a otra carrera; se omite`);
        continue;
      }
      const rival = proposedCompetitionIds.get(id);
      if (rival) {
        collisions++;
        log(`  · #${id}: colisión entre «${rival.race.name}» y «${proposal.race.name}»; se omiten ambas`);
        rival.skip = true;
        proposal.skip = true;
        continue;
      }
      proposedCompetitionIds.set(id, proposal);
    }

    for (const proposal of proposals) {
      if (proposal.skip) continue;
      if (DRY_RUN) {
        linked++;
        continue;
      }
      let row;
      try {
        row = await insertLink(client, proposal.race, proposal.candidate, proposal.seasonId);
      } catch (error) {
        // Otra ejecución o el panel puede haber ocupado la competición después
        // de la lectura de control. La restricción única es la última defensa;
        // no convertir esa carrera en un error del servicio.
        if (error.code === '23505') {
          collisions++;
          log(`  · ${proposal.race.id}: la competición #${proposal.candidate.competitionId} se ocupó durante el enlace; se omite`);
          continue;
        }
        throw error;
      }
      if (!row) continue;
      await reserveTodayDays(client, proposal.race);
      linked++;
      const code = await processLinkedRace(proposal.race);
      if (code !== 0) processErrors++;
    }
  } finally {
    await client.end().catch(() => {});
  }

  log(`Enlace DataRide del día: ${linked} enlaces${DRY_RUN ? ' previstos' : ' creados'}, ${ambiguous} ambiguos, ${notFound} sin coincidencia, ${collisions} colisiones`);
  process.stdout.write(JSON.stringify({
    candidates: linked + ambiguous + notFound + collisions,
    linked,
    ambiguous,
    notFound,
    collisions,
    processed: PROCESS_LINKED && !DRY_RUN ? linked - processErrors : 0,
    processErrors,
    changed: linked > 0 && !DRY_RUN,
    dryRun: DRY_RUN,
  }) + '\n');
  if (processErrors > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    log(`FATAL: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
