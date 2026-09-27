#!/usr/bin/env node
/**
 * Enlaza las carreras CX propias del día con competiciones DataRide CRO cuando
 * todavía no tienen fuente de resultados. Es el equivalente CX de
 * dataride-live-linker.mjs y aplica los mismos criterios conservadores:
 * país ISO, solape de fecha con margen, categoría UCI coincidente y una señal
 * nominal o de clase fuerte (nacionales, continentales y Copa del Mundo).
 * Las coincidencias ambiguas o sin señal quedan intactas para revisión manual.
 *
 * Uso en producción (runner cc-cx-results como cc_results_worker):
 *   node scripts/results-fetchers/cx-live-linker.mjs
 *
 * Requiere DATABASE_URL con el rol `cc_results_worker`.
 */
'use strict';

import { fileURLToPath } from 'node:url';
import { createCxDataRideClient } from './cx-dataride-results.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const hasFlag = (name) => args.includes(`--${name}`);

const DRY_RUN = hasFlag('dry-run');
const MAX_LINKS = Math.max(1, parseInt(getArg('limit') || '8', 10) || 8);
const SLACK_DAYS = Math.max(0, parseInt(getArg('slack') || '1', 10) ?? 1);
const DAY_MS = 86_400_000;
const STRONG_CLASSES = new Set(['CN', 'CH', 'CDM', 'CM']);
const STOPWORDS = new Set(['cyclo', 'cross', 'cyclocross', 'the', 'of', 'de', 'del', 'la', 'el', 'les', 'des',
  'national', 'nacional', 'nacionales', 'championship', 'championships', 'campeonato', 'campeonatos',
  'round', 'cup', 'trophy', 'trofeo', 'grand', 'prix', 'gp', 'class', 'international', 'world']);

export function parseDataRideEpoch(value) {
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) : NaN;
}

export function nameSignal(race, competitionName) {
  const tokens = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const left = new Set([...tokens(race.name), ...tokens(race.nameEn), ...tokens(race.abbrev)]
    .filter((token) => token.length > 2 && !STOPWORDS.has(token)));
  const right = tokens(competitionName).filter((token) => token.length > 2 && !STOPWORDS.has(token));
  return right.some((token) => left.has(token));
}

export function matchCxCompetition(race, competitions, { now = new Date(), slackDays = SLACK_DAYS } = {}) {
  const at = new Date(now).getTime();
  const raceStart = Date.parse(race.dateKey) - slackDays * DAY_MS;
  const raceEnd = Date.parse(race.endDateKey || race.dateKey) + slackDays * DAY_MS;
  if (!Number.isFinite(raceStart) || !Number.isFinite(raceEnd)) return { status: 'none', reason: 'Fecha de carrera inválida' };
  if (at < raceStart || at > raceEnd) return { status: 'none', reason: 'Carrera fuera del día' };
  if (!race.countryCode) return { status: 'none', reason: 'Falta país propio' };
  const matches = [];
  for (const comp of competitions) {
    const start = parseDataRideEpoch(comp.StartDate);
    const end = Number.isFinite(parseDataRideEpoch(comp.EndDate)) ? parseDataRideEpoch(comp.EndDate) : start;
    if (!Number.isFinite(start) || end < start) continue;
    if (comp.CountryIsoCode2 !== race.countryCode) continue;
    if (end < raceStart || start > raceEnd) continue;
    if (comp.ClassCode !== race.class) continue;
    if (!STRONG_CLASSES.has(race.class) && !nameSignal(race, comp.CompetitionName)) continue;
    matches.push(comp);
  }
  if (!matches.length) return { status: 'none', reason: 'Sin candidato DataRide dentro de criterios' };
  if (matches.length > 1) return { status: 'ambiguous', reason: 'Varias competiciones cumplen los criterios', matches };
  return { status: 'match', competition: matches[0] };
}

async function loadCandidateRaces(client) {
  const { rows } = await client.query(`/* cx_live_linker_candidates */
    SELECT to_jsonb(r) AS race,
      (SELECT jsonb_agg(to_jsonb(c)) FROM public.cx_race_categories c WHERE c."raceId"=r.id
        AND coalesce(c."dateKey",r."dateKey") BETWEEN (now() AT TIME ZONE 'Europe/Madrid')::date - 1
          AND (now() AT TIME ZONE 'Europe/Madrid')::date + 1) AS today
    FROM public.cx_races r
    WHERE r."editorialStatus"='published' AND NOT r."isCancelled" AND NOT EXISTS
      (SELECT 1 FROM public.cx_race_uci_links l WHERE l."raceId"=r.id)
      AND extract(month FROM r."dateKey") IN (8,9,10,11,12,1,2)
      AND EXISTS(SELECT 1 FROM public.cx_race_categories c WHERE c."raceId"=r.id AND NOT c."isCancelled"
        AND coalesce(c."dateKey",r."dateKey") BETWEEN (now() AT TIME ZONE 'Europe/Madrid')::date - 1
          AND (now() AT TIME ZONE 'Europe/Madrid')::date + 1)
    ORDER BY r."dateKey",r.id
    LIMIT $1`, [MAX_LINKS]);
  return rows.map((row) => ({ race: row.race, today: row.today || [] })).filter((item) => item.today.length);
}

async function loadOccupiedCompetitions(client) {
  const { rows } = await client.query(`SELECT "competitionId" FROM public.cx_race_uci_links WHERE "disciplineId"=3`);
  return new Set(rows.map((row) => Number(row.competitionId)));
}

async function insertLink(client, race, competition, seasonId) {
  const { rows } = await client.query(`INSERT INTO public.cx_race_uci_links
    ("raceId","competitionId","seasonId","uciRaceId","syncEnabled","syncStartOffsetMinutes","syncStopOffsetMinutes")
    VALUES ($1,$2,$3,0,true,-15,720)
    ON CONFLICT DO NOTHING RETURNING "raceId","competitionId"`,
  [race.id, competition.CompetitionId, seasonId]);
  return rows[0] || null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  const dataRide = createCxDataRideClient();
  const summary = { dryRun: DRY_RUN, candidates: 0, linked: [], skipped: [] };
  try {
    const [candidates, occupied, seasons] = await Promise.all([
      loadCandidateRaces(client), loadOccupiedCompetitions(client), dataRide.seasons()]);
    summary.candidates = candidates.length;
    const catalogs = new Map();
    for (const { race } of candidates) {
      const suffix = String(race.seasonKey || '').split('-')[1];
      const season = suffix ? seasons.find((row) => String(row.Year).slice(-2) === suffix.slice(-2)) : null;
      if (!season) { summary.skipped.push({ raceId: race.id, reason: 'Temporada DataRide CX no encontrada' }); continue; }
      if (!catalogs.has(season.Id)) catalogs.set(season.Id, await dataRide.competitionsForSeason(season.Id));
      const result = matchCxCompetition(race, catalogs.get(season.Id));
      if (result.status !== 'match') { summary.skipped.push({ raceId: race.id, reason: result.reason }); continue; }
      if (occupied.has(result.competition.CompetitionId)) { summary.skipped.push({ raceId: race.id, reason: 'Competición ya enlazada' }); continue; }
      if (DRY_RUN) { summary.linked.push({ raceId: race.id, competitionId: result.competition.CompetitionId, dryRun: true }); continue; }
      const inserted = await insertLink(client, race, result.competition, season.Id);
      if (inserted) { occupied.add(result.competition.CompetitionId); summary.linked.push(inserted); }
      else summary.skipped.push({ raceId: race.id, reason: 'Conflicto de enlace; requiere revisión' });
    }
    console.log(JSON.stringify(summary));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => { console.error(`cx-live-linker: ${error.message}`); process.exitCode = 1; });
}
