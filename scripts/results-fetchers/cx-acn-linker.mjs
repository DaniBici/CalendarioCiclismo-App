#!/usr/bin/env node
/**
 * Enlaza las carreras CX propias del día con eventos de ACN Timing (Chronorace)
 * cuando todavía no tienen enlace de cronometraje. Equivalente a cx-live-linker.mjs.
 *
 * Los eventos se descubren en las páginas de resultados de los organizadores que
 * publican con ACN (hoy HG Cross, antes Exact Cross). El emparejamiento es
 * conservador: país, fecha civil (margen de un día) y lugar de celebración
 * deben coincidir y solo puede haber un candidato por carrera y evento. Lo
 * ambiguo queda para el enlace manual del panel.
 *
 * Uso en producción (runner cc-cx-results como cc_results_worker):
 *   node scripts/results-fetchers/cx-acn-linker.mjs [--dry-run] [--limit 8]
 */
import { fileURLToPath } from 'node:url';
import { countryCode } from '../uci-catalog/countries.mjs';
import { databaseUrl } from '../db/env.mjs';
import { acnCategories, acnTarget, resolveAcnContext } from './acn-cx-fetch.mjs';

export const ACN_DISCOVERY_PAGES = Object.freeze(['https://hgcross.be/uitslagen/']);
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const EVENT_API = 'https://prod.chronorace.be/api/Event/view/';
const RESULTS_API = 'https://results.chronorace.be/api/results/';
const DAY_MS = 86_400_000;
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => { const index = args.indexOf(`--${name}`); return index === -1 ? fallback : args[index + 1]; };
const DRY_RUN = args.includes('--dry-run');
const MAX_LINKS = Math.max(1, parseInt(getArg('limit') || '8', 10) || 8);
const MAX_EVENT_LOOKUPS = 12;

const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Enlaces ACN de una página de organizador: `{ eventId, ctx|null }`, sin duplicados.
export function parseAcnEventLinks(html) {
  const found = new Map();
  for (const match of String(html).matchAll(/href=["']([^"']*(?:acn-timing\.com|chronorace\.be)[^"']*)["']/gi)) {
    try {
      const target = acnTarget(match[1].replace(/&#0?38;|&amp;/g, '&'));
      if (!found.has(target.eventId) || (!found.get(target.eventId).ctx && target.ctx)) found.set(target.eventId, target);
    } catch { /* enlace ACN de otro tipo */ }
  }
  return [...found.values()];
}

// `20261011_hg` → `2026-10-11`; sin prefijo de fecha → null.
export function acnContextDate(ctx) {
  const match = /^(\d{4})(\d{2})(\d{2})_/.exec(String(ctx ?? ''));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Evento ACN (`Event/view`) ↔ carrera propia: país, fecha (±slackDays) y lugar. */
export function matchAcnEvent(race, events, { slackDays = 1 } = {}) {
  if (!race.countryCode || !race.venue) return { status: 'none', reason: 'Falta país o lugar propio' };
  const start = Date.parse(race.dateKey) - slackDays * DAY_MS;
  const end = Date.parse(race.endDateKey || race.dateKey) + slackDays * DAY_MS;
  const venue = fold(race.venue);
  const matches = events.filter(event => {
    const day = Date.parse(String(event.StartDate || '').slice(0, 10));
    const place = fold(event.Location);
    return Number.isFinite(day) && day >= start && day <= end
      && countryCode(event.Country)?.toUpperCase() === race.countryCode
      && place && (place === venue || venue.includes(place) || place.includes(venue));
  });
  if (!matches.length) return { status: 'none', reason: 'Sin evento ACN dentro de criterios' };
  if (matches.length > 1) return { status: 'ambiguous', reason: 'Varios eventos ACN cumplen los criterios', matches };
  return { status: 'match', event: matches[0] };
}

const getJson = async url => {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.json();
};

async function loadCandidateRaces(client) {
  const { rows } = await client.query(`/* cx_acn_linker_candidates */
    SELECT to_jsonb(r) AS race FROM public.cx_races r
    WHERE r."editorialStatus"='published' AND NOT r."isCancelled"
      AND NOT EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=r.id)
      AND extract(month FROM r."dateKey") IN (8,9,10,11,12,1,2)
      AND EXISTS (SELECT 1 FROM public.cx_race_categories c WHERE c."raceId"=r.id AND NOT c."isCancelled"
        AND coalesce(c."dateKey",r."dateKey") BETWEEN (now() AT TIME ZONE 'Europe/Madrid')::date - 1
          AND (now() AT TIME ZONE 'Europe/Madrid')::date + 1)
    ORDER BY r."dateKey",r.id`);
  return rows.map(row => row.race);
}

async function discoverEvents(pages, { fetchText, fetchEvent }, window) {
  const targets = new Map();
  for (const page of pages) {
    for (const target of parseAcnEventLinks(await fetchText(page))) targets.set(target.eventId, target);
  }
  const events = []; let lookups = 0;
  for (const target of targets.values()) {
    const dated = acnContextDate(target.ctx);
    if (dated && (Date.parse(dated) < window.from || Date.parse(dated) > window.to)) continue;
    if (!dated && lookups >= MAX_EVENT_LOOKUPS) continue;
    if (!dated) lookups++;
    try { events.push({ ...(await fetchEvent(target.eventId)), ctxHint: target.ctx }); } catch { /* evento no disponible */ }
  }
  return events;
}

async function main() {
  if (!databaseUrl()) throw new Error('Falta DATABASE_URL');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl(), ssl: databaseUrl().includes('localhost') ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  const summary = { dryRun: DRY_RUN, candidates: 0, linked: [], skipped: [] };
  try {
    const races = await loadCandidateRaces(client);
    summary.candidates = races.length;
    if (!races.length) { console.log(JSON.stringify(summary)); return; }
    const { rows: occupiedRows } = await client.query(`SELECT "eventId" FROM public.cx_race_timing_links WHERE provider='acn'`);
    const occupied = new Set(occupiedRows.map(row => row.eventId));
    const from = Math.min(...races.map(race => Date.parse(race.dateKey))) - DAY_MS;
    const to = Math.max(...races.map(race => Date.parse(race.endDateKey || race.dateKey))) + DAY_MS;
    const events = (await discoverEvents(ACN_DISCOVERY_PAGES, {
      fetchText: async url => (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })).text(),
      fetchEvent: id => getJson(`${EVENT_API}${id}`),
    }, { from, to })).filter(event => !occupied.has(String(event.EventId)));
    for (const race of races) {
      if (summary.linked.length >= MAX_LINKS) break;
      const result = matchAcnEvent(race, events);
      if (result.status !== 'match') { summary.skipped.push({ raceId: race.id, reason: result.reason }); continue; }
      const eventId = String(result.event.EventId);
      const ctx = result.event.ctxHint || await resolveAcnContext(eventId);
      const { found } = acnCategories(await getJson(`${RESULTS_API}generic/uci/${encodeURIComponent(ctx)}/dh?key=cms`));
      if (!found.length) { summary.skipped.push({ raceId: race.id, reason: 'El evento ACN no publica categorías CX individuales' }); continue; }
      if (DRY_RUN) { summary.linked.push({ raceId: race.id, eventId, ctx, dryRun: true }); continue; }
      const { rows } = await client.query(`INSERT INTO public.cx_race_timing_links
        ("raceId",provider,"eventId",ctx,"syncEnabled","syncStartOffsetMinutes","syncStopOffsetMinutes","syncIntervalMinutes")
        VALUES ($1,'acn',$2,$3,true,-15,720,5) ON CONFLICT DO NOTHING RETURNING "raceId","eventId"`, [race.id, eventId, ctx]);
      if (rows[0]) { occupied.add(eventId); summary.linked.push({ ...rows[0], ctx }); }
      else summary.skipped.push({ raceId: race.id, reason: 'Conflicto de enlace ACN; requiere revisión' });
    }
    console.log(JSON.stringify(summary));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(`cx-acn-linker: ${error.message}`); process.exitCode = 1; });
}
