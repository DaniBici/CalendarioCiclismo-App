#!/usr/bin/env node
/**
 * Pasada anual del enlace determinista de carretera: las carreras de un año
 * con `uciCalendarId` y sin ningún enlace se enlazan con su competición
 * DataRide mediante el directorio de competiciones UCI
 * (`uci-directory-link.mjs`). La invocan `uci-link-discover-cron.mjs` y
 * `uci-link-evening.mjs` antes de la heurística, que ya no enlaza esas carreras.
 *
 * Nunca pisa un enlace (`ON CONFLICT ("raceId") DO NOTHING`), no reutiliza una
 * competición ya enlazada y omite las dos carreras cuando ambas apuntan a la
 * misma. DataRide solo lista competiciones con resultados o en curso: las
 * ausentes se reintentan en la pasada siguiente.
 *
 * Uso:
 *   node scripts/results-fetchers/uci-calendar-id-links.mjs --year 2027 [--dry-run]
 *
 * Requiere AGENT_DATABASE_URL o DATABASE_URL. `--dry-run` escribe el SQL por
 * stdout sin ejecutarlo. Resumen JSON en la última línea de stdout.
 */
'use strict';

import { fileURLToPath } from 'node:url';
import { databaseUrl, loadEnv, PG_CONNECTION_LIMITS } from '../db/env.mjs';
import { fetchCategoryCodes, fetchCompetitions, fetchSeasons, seasonForRace } from './dataride-live-linker.mjs';
import { UCI_CALENDAR_MATCH_METHOD, directoryByCalendarId, resolveByCalendarId, usesCalendarIdLink } from './uci-directory-link.mjs';

const DISCIPLINE_ID = 10;

function sqlLiteral(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function linkInsertSql({ raceId, competitionId, seasonId }) {
  return `INSERT INTO public.race_uci_links ("raceId","competitionId","disciplineId","seasonId","uciRaceId","autoMatched","syncStatus","source","matchMethod")
VALUES (${sqlLiteral(raceId)},${sqlLiteral(competitionId)},${DISCIPLINE_ID},${sqlLiteral(seasonId)},0,TRUE,'pending','uci',${sqlLiteral(UCI_CALENDAR_MATCH_METHOD)})
ON CONFLICT ("raceId") DO NOTHING;`;
}

/**
 * Enlaza las carreras de `year` con `uciCalendarId`. Devuelve el resumen con
 * los enlaces creados (o previstos en `dryRun`) y los motivos de las demás.
 */
export async function linkRoadYearByCalendarId({ client, year, dryRun = false, log = () => {} }) {
  const { rows } = await client.query(
    `SELECT r.id, r.name, r.gender, r."uciCategory", r."uciCalendarId", r."startDate", r.year
     FROM public.races r
     WHERE r.year = $1 AND r."isCancelled" = false AND r."uciCalendarId" IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.race_uci_links l WHERE l."raceId" = r.id)
     ORDER BY r."startDate", r.id`,
    [year],
  );
  const races = rows.filter(usesCalendarIdLink);
  const summary = { year, candidates: races.length, linked: [], pending: 0, ambiguous: [], incoherent: [], collisions: [], sql: [] };
  if (!races.length) return summary;

  // Directorio por solape con el año civil: cubre las carreras de finales de
  // año que la UCI asigna a la temporada siguiente.
  const directory = await directoryByCalendarId({ query: { disciplineCode: 'ROA', dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` } });
  const seasons = await fetchSeasons();
  const catalogs = new Map();
  const categoryCache = new Map();
  const categoriesOf = (competitionId) => {
    if (!categoryCache.has(competitionId)) categoryCache.set(competitionId, fetchCategoryCodes(competitionId));
    return categoryCache.get(competitionId);
  };

  const proposals = [];
  for (const race of races) {
    const season = seasonForRace(race, seasons);
    if (!season?.Id) { summary.pending++; continue; }
    if (!catalogs.has(season.Id)) catalogs.set(season.Id, await fetchCompetitions(season.Id));
    let result;
    try {
      result = await resolveByCalendarId(race, { directory, competitions: catalogs.get(season.Id), categoriesOf, gender: race.gender });
    } catch (error) {
      log(`  · «${race.name}»: desempate DataRide fallido (${error.message}); se reintenta`);
      summary.pending++;
      continue;
    }
    if (result.status === 'match') {
      proposals.push({ race, seasonId: Number(season.Id), competitionId: Number(result.competition.CompetitionId), uciName: result.competition.CompetitionName, rule: result.rule });
    } else if (result.status === 'ambiguous') {
      summary.ambiguous.push({ raceId: race.id, name: race.name, uciCalendarId: Number(race.uciCalendarId), candidates: result.candidates });
    } else if (result.incoherent) {
      summary.incoherent.push({ raceId: race.id, name: race.name, uciCalendarId: Number(race.uciCalendarId), reason: result.reason });
    } else {
      summary.pending++;
    }
  }

  const { rows: occupiedRows } = await client.query(
    `SELECT "competitionId" FROM public.race_uci_links WHERE "disciplineId" = $1 AND "uciRaceId" = 0`,
    [DISCIPLINE_ID],
  );
  const occupied = new Set(occupiedRows.map((row) => Number(row.competitionId)));
  const byCompetition = new Map();
  for (const proposal of proposals) {
    byCompetition.set(proposal.competitionId, [...(byCompetition.get(proposal.competitionId) || []), proposal]);
  }

  for (const proposal of proposals) {
    const { race, competitionId } = proposal;
    if (occupied.has(competitionId) || byCompetition.get(competitionId).length > 1) {
      summary.collisions.push({ raceId: race.id, name: race.name, competitionId });
      log(`  · «${race.name}» → #${competitionId}: competición ya enlazada o compartida; se omite`);
      continue;
    }
    const sql = linkInsertSql({ raceId: race.id, competitionId, seasonId: proposal.seasonId });
    const entry = { raceId: race.id, name: race.name, uciCalendarId: Number(race.uciCalendarId), competitionId, uciName: proposal.uciName, rule: proposal.rule };
    if (dryRun) {
      summary.sql.push(`-- «${race.name}» D2CP${race.uciCalendarId} → #${competitionId} ${proposal.uciName} (${proposal.rule})\n${sql}`);
      summary.linked.push({ ...entry, dryRun: true });
      continue;
    }
    try {
      const result = await client.query(`${sql.slice(0, -1)} RETURNING "raceId"`);
      if (!result.rowCount) continue;
    } catch (error) {
      if (error.code === '23505') {
        summary.collisions.push({ raceId: race.id, name: race.name, competitionId });
        continue;
      }
      throw error;
    }
    occupied.add(competitionId);
    summary.linked.push(entry);
    log(`  + «${race.name}» D2CP${race.uciCalendarId} → #${competitionId} ${proposal.uciName} (${proposal.rule})`);
  }
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const yearIndex = args.indexOf('--year');
  const year = Number(yearIndex === -1 ? NaN : args[yearIndex + 1]);
  if (!Number.isInteger(year)) throw new Error('Uso: --year AAAA [--dry-run]');
  const dryRun = args.includes('--dry-run');
  loadEnv();
  const url = databaseUrl();
  if (!url) throw new Error('Falta AGENT_DATABASE_URL o DATABASE_URL');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false }, ...PG_CONNECTION_LIMITS });
  await client.connect();
  try {
    const summary = await linkRoadYearByCalendarId({ client, year, dryRun, log: (line) => process.stderr.write(`${line}\n`) });
    if (dryRun && summary.sql.length) process.stdout.write(`${summary.sql.join('\n\n')}\n`);
    const { sql, ...rest } = summary;
    process.stdout.write(`${JSON.stringify({ ...rest, linked: rest.linked.length, changed: !dryRun && rest.linked.length > 0 })}\n`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { process.stderr.write(`uci-calendar-id-links: ${error.message}\n`); process.exitCode = 1; });
}
