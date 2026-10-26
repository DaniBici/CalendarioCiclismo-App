#!/usr/bin/env node
/**
 * Enlaza las NAC españolas del día con su prueba de smartweb cuando todavía no
 * tienen enlace CX. Equivalente a cx-acn-linker.mjs.
 *
 * El `websiteUrl` de la carrera apunta a la ficha de la prueba en la
 * federación (`…/smartweb/inscripciones/prueba/<id>-…`). El enlace se crea solo
 * si la cuenta atrás del índice de clasificaciones confirma la fecha de la
 * carrera. `categoryKeys` usa los rótulos habituales de las federaciones para
 * las categorías del calendario propio; un rótulo distinto deja la categoría
 * pendiente hasta que se corrija el enlace en el panel.
 *
 * Uso en producción (runner cc-cx-results como cc_results_worker):
 *   node scripts/results-fetchers/cx-smartweb-linker.mjs [--dry-run] [--limit 8]
 */
import { fileURLToPath } from 'node:url';
import { databaseUrl } from '../db/env.mjs';
import { parseSmartwebIndex, smartwebIndexUrl } from './smartweb-cx-fetch.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => { const index = args.indexOf(`--${name}`); return index === -1 ? fallback : args[index + 1]; };
const DRY_RUN = args.includes('--dry-run');
const MAX_LINKS = Math.max(1, parseInt(getArg('limit') || '8', 10) || 8);

// Rótulos de las clasificaciones en smartweb (FCCV, FCPA, FGC, CyL, Madrid, RFEC).
export const SMARTWEB_LABELS = Object.freeze({ ME: 'ELITE-SUB23', WE: 'FEM ELITE-SUB23', MJ: 'JUNIOR', WJ: 'FEM JUNIOR', MU: 'SUB23', WU: 'FEM SUB23' });

/**
 * Carrera propia y su índice smartweb → enlace a crear o motivo para omitirla.
 * `categories`: categorías no canceladas del calendario propio.
 */
export function planSmartwebLink(race, categories, index) {
  let sourceUrl;
  try { sourceUrl = smartwebIndexUrl(race.websiteUrl); } catch { return { status: 'skip', reason: 'La web de la carrera no es una prueba smartweb' }; }
  if (!index) return { sourceUrl, status: 'fetch' };
  if (!index.dateKey) return { status: 'skip', reason: 'El índice smartweb no publica la fecha de la prueba' };
  if (index.dateKey < race.dateKey || index.dateKey > (race.endDateKey || race.dateKey)) {
    return { status: 'skip', reason: `Prueba smartweb del ${index.dateKey}, no del ${race.dateKey}` };
  }
  const categoryKeys = Object.fromEntries(categories.filter(category => SMARTWEB_LABELS[category]).map(category => [SMARTWEB_LABELS[category], category]));
  if (!Object.keys(categoryKeys).length) return { status: 'skip', reason: 'Sin categorías CX en el calendario propio' };
  return { status: 'link', sourceUrl, categoryKeys };
}

async function loadCandidateRaces(client) {
  const { rows } = await client.query(`/* cx_smartweb_linker_candidates */
    SELECT to_jsonb(r) AS race,
      (SELECT coalesce(jsonb_agg(c.category ORDER BY c."sortOrder"),'[]') FROM public.cx_race_categories c WHERE c."raceId"=r.id AND NOT c."isCancelled") AS categories
    FROM public.cx_races r
    WHERE r."editorialStatus"='published' AND NOT r."isCancelled" AND r.class='NAC' AND r."countryCode" LIKE 'ES%'
      AND r."websiteUrl" ~ '/smartweb/inscripciones/'
      AND NOT EXISTS (SELECT 1 FROM public.cx_race_timing_links l WHERE l."raceId"=r.id)
      AND NOT EXISTS (SELECT 1 FROM public.cx_race_uci_links l WHERE l."raceId"=r.id)
      AND extract(month FROM r."dateKey") IN (8,9,10,11,12,1,2)
      AND EXISTS (SELECT 1 FROM public.cx_race_categories c WHERE c."raceId"=r.id AND NOT c."isCancelled"
        AND coalesce(c."dateKey",r."dateKey") BETWEEN (now() AT TIME ZONE 'Europe/Madrid')::date - 1
          AND (now() AT TIME ZONE 'Europe/Madrid')::date + 1)
    ORDER BY r."dateKey",r.id`);
  return rows;
}

async function main() {
  if (!databaseUrl()) throw new Error('Falta DATABASE_URL');
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl(), ssl: databaseUrl().includes('localhost') ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  const summary = { dryRun: DRY_RUN, candidates: 0, linked: [], skipped: [] };
  try {
    const candidates = await loadCandidateRaces(client);
    summary.candidates = candidates.length;
    for (const { race, categories } of candidates) {
      if (summary.linked.length >= MAX_LINKS) break;
      let plan = planSmartwebLink(race, categories, null);
      if (plan.status === 'fetch') {
        try {
          const response = await fetch(plan.sourceUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          plan = planSmartwebLink(race, categories, parseSmartwebIndex(await response.text()));
        } catch (error) { plan = { status: 'skip', reason: `Índice smartweb no disponible: ${error.message}` }; }
      }
      if (plan.status !== 'link') { summary.skipped.push({ raceId: race.id, reason: plan.reason }); continue; }
      if (DRY_RUN) { summary.linked.push({ raceId: race.id, sourceUrl: plan.sourceUrl, categoryKeys: plan.categoryKeys, dryRun: true }); continue; }
      const { rows } = await client.query(`INSERT INTO public.cx_race_timing_links
        ("raceId",provider,"sourceUrl","categoryKeys","syncEnabled","syncStartOffsetMinutes","syncStopOffsetMinutes","syncIntervalMinutes")
        VALUES ($1,'smartweb',$2,$3::jsonb,true,-15,720,5) ON CONFLICT DO NOTHING RETURNING "raceId"`, [race.id, plan.sourceUrl, JSON.stringify(plan.categoryKeys)]);
      if (rows[0]) summary.linked.push({ raceId: race.id, sourceUrl: plan.sourceUrl });
      else summary.skipped.push({ raceId: race.id, reason: 'Conflicto de enlace smartweb; requiere revisión' });
    }
    console.log(JSON.stringify(summary));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(`cx-smartweb-linker: ${error.message}`); process.exitCode = 1; });
}
