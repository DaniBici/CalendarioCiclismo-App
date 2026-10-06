#!/usr/bin/env node
/**
 * tissot-startlists-sync.mjs — ingestión de startlists y órdenes de salida de
 * Tissot con el rol `cc_results_worker`.
 *
 * Retirado del runner del VPS el 2026-09-25: no se ejecuta de forma automática.
 * Se conserva solo como código del repositorio para una ejecución manual.
 *
 * Flujo por carrera de un día enlazada a Tissot:
 *   1. `tissot-startlist-fetch.mjs` extrae la startlist publicada (y, en CRI, el
 *      orden de salida con hora local) y la deja en un JSON crudo.
 *   2. Este script resuelve identidad y equipo contra Supabase (sin inventar):
 *      `uciRiderId` → riders_men/women.uciLicenseId → id/nombre/país;
 *      respaldo por dorsal y nombre/alias exacto de la startlist existente;
 *      `globalRiderId` → startlist_riders/startlist_teams → selección canónica;
 *      respaldo por país y, en último término, por el nombre de Tissot.
 *   3. Llama a `vps_import_tissot_startlist`, que aplica la startlist oficial
 *      (prepare+apply) y, si procede, el orden de salida. Es idempotente.
 *
 * Solo trata `raceFormat='one_day'`: en una vuelta por etapas la startlist de
 * Tissot es la de CADA etapa, no la lista de inscritos de la carrera. Cuando se
 * necesite esa vía, requiere su propio diseño.
 *
 * Uso:
 *   node scripts/results-fetchers/tissot-startlists-sync.mjs [--race-id <id>] [--dry-run]
 *
 * Requiere DATABASE_URL con el rol `cc_results_worker`.
 */
'use strict';

import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { countryCode as countryFromNation } from '../uci-catalog/countries.mjs';
import { databaseUrl } from '../db/env.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const hasFlag = (name) => args.includes(`--${name}`);

const HERE = dirname(fileURLToPath(import.meta.url));
const FETCHER = join(HERE, 'tissot-startlist-fetch.mjs');
const ONLY_RACE = getArg('race-id');
const DRY_RUN = hasFlag('dry-run');
const log = (...v) => process.stderr.write(`${v.join(' ')}\n`);

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }),
  );
}

// "BELGIUM" | "UNITED STATES" | "GUINEA-BISSAU" → "Belgium" | "United States" | "Guinea-Bissau"
export function titleCase(name) {
  return String(name || '').toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

const nameKey = name => String(name || '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd')
  .match(/[\p{L}\p{N}]+/gu)?.sort().join(' ') || '';

function resolveRider(rider, ctx) {
  const byLicense = rider.uciRiderId ? ctx.riderByUci.get(String(rider.uciRiderId)) : null;
  if (byLicense) return byLicense;
  const key = nameKey(`${rider.firstName || ''} ${rider.lastName || ''}`);
  const nation = rider.nation === 'REF' ? null : countryFromNation(rider.nation);
  const candidates = (ctx.ridersByBib?.get(String(rider.bib)) || []).filter(candidate =>
    key && candidate.names.some(name => nameKey(name) === key)
    && (!nation || !candidate.countryCode || nation === candidate.countryCode.toLowerCase())
    && (!candidate.uciLicenseId || !rider.uciRiderId || candidate.uciLicenseId === String(rider.uciRiderId)));
  return candidates.length === 1 ? candidates[0] : null;
}

// Documento normalizado que consume `prepare_startlist_import`. Función pura para
// poder testear la prioridad de resolución sin base de datos.
export function buildNormalizedDocument(doc, ctx) {
  const groups = new Map();
  for (const r of doc.riders || []) {
    const resolved = resolveRider(r, ctx);
    const globalRiderId = resolved?.id ?? null;
    const countryCode = resolved?.countryCode ?? null;
    const team = (globalRiderId && ctx.teamByGlobalId.get(globalRiderId))
      || (countryCode && ctx.teamByCountry.get(countryCode))
      || null;
    const teamName = team?.teamName || titleCase(r.teamHint || r.nation || 'Sin equipo');
    if (!groups.has(teamName)) groups.set(teamName, { teamName, teamId: team?.teamId, riders: [] });
    if (team?.teamId && !groups.get(teamName).teamId) groups.get(teamName).teamId = team.teamId;
    groups.get(teamName).riders.push({
      rowKey: `bib${r.bib}`,
      dorsal: r.bib,
      firstName: resolved?.firstName || r.firstName,
      lastName: resolved?.lastName || r.lastName,
      countryCode,
      globalRiderId,
      uciProfileId: resolved?.uciProfileId || null,
      ...(ctx.gender == null && resolved?.gender ? { riderGender: resolved.gender } : {}),
    });
  }
  return {
    raceId: doc.raceId,
    expectedRiderCount: (doc.riders || []).length,
    sourceUrl: doc.sourceUrl,
    teams: [...groups.values()].map(({ teamName, teamId, riders }) => ({ teamName, ...(teamId ? { teamId } : {}), riders })),
  };
}

export async function resolveContext(client, raceId, gender, uciIds) {
  const ids = [...new Set((uciIds || []).filter(Boolean).map(String))];
  const men = gender === 'female' || !ids.length ? [] : (await client.query(
    'select "uciLicenseId" u, "uciProfileId" p, id, "firstName" f, "lastName" l, nationality c from public.riders_men where "uciLicenseId" = any($1)', [ids],
  )).rows;
  const women = gender === 'male' || !ids.length ? [] : (await client.query(
    'select "uciLicenseId" u, "uciProfileId" p, id, "firstName" f, "lastName" l, nationality c from public.riders_women where "uciLicenseId" = any($1)', [ids],
  )).rows;
  const riderByUci = new Map();
  const ambiguousLicenses = new Set();
  for (const row of [...men.map(r => ({ ...r, gender: 'male' })), ...women.map(r => ({ ...r, gender: 'female' }))]) {
    if (riderByUci.has(row.u)) ambiguousLicenses.add(row.u);
    riderByUci.set(row.u, { id: row.id, firstName: row.f, lastName: row.l, countryCode: row.c,
      uciProfileId: row.p, uciLicenseId: row.u, gender: row.gender });
  }
  for (const license of ambiguousLicenses) riderByUci.delete(license);

  const roster = (await client.query(
    `select sr.dorsal, r.*, array(select a."aliasKey" from public.rider_identity_aliases a
        where a."riderId" = r.id and a.gender = r.gender) aliases
       from public.startlist_riders sr
       join lateral (
         select id, "firstName", "lastName", "otherNames", nationality as "countryCode",
                "uciProfileId", "uciLicenseId", 'male'::text gender
           from public.riders_men where id = sr."globalRiderId"
         union all
         select id, "firstName", "lastName", "otherNames", nationality,
                "uciProfileId", "uciLicenseId", 'female'::text
           from public.riders_women where id = sr."globalRiderId"
       ) r on r.gender = coalesce($2::text, sr."riderGender", r.gender)
      where sr."raceId" = $1`, [raceId, gender],
  )).rows;
  const ridersByBib = new Map();
  for (const row of roster) {
    const key = String(row.dorsal);
    const candidates = ridersByBib.get(key) || [];
    candidates.push({ ...row, names: [`${row.firstName || ''} ${row.lastName || ''}`, row.otherNames, ...(row.aliases || [])].filter(Boolean) });
    ridersByBib.set(key, candidates);
  }

  const links = (await client.query(
    `select sr."globalRiderId" g, sr."countryCode" c, st."teamName" n, st."teamId" t
       from public.startlist_riders sr
       join public.startlist_teams st on st.id = sr."teamId" and st."raceId" = sr."raceId"
      where sr."raceId" = $1`, [raceId],
  )).rows;
  const teamByGlobalId = new Map();
  const countryCount = new Map();
  for (const row of links) {
    if (row.g) teamByGlobalId.set(row.g, { teamName: row.n, teamId: row.t });
    if (row.c) {
      const key = row.c.toLowerCase();
      const entry = countryCount.get(key) || new Map();
      const team = entry.get(row.n) || { teamName: row.n, teamId: row.t, n: 0 };
      team.n++;
      entry.set(row.n, team);
      countryCount.set(key, entry);
    }
  }
  const teamByCountry = new Map();
  for (const [country, teams] of countryCount) {
    const best = [...teams.values()].sort((a, b) => b.n - a.n)[0];
    teamByCountry.set(country, { teamName: best.teamName, teamId: best.teamId });
  }
  return { riderByUci, ridersByBib, teamByGlobalId, teamByCountry, gender };
}

function runFetcher(fetchArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FETCHER, ...fetchArgs], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
    child.once('error', () => resolve(1));
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function syncRace(client, target) {
  const needStartlist = target.startlistImportedAt == null || target.startlistProvisional === true;
  const wantOrder = target.startOrderImportedAt == null;
  if (!needStartlist && (!wantOrder || !['itt', 'ttt'].includes(target.primaryType))) {
    log(`  ${target.raceId}: sin cambios`);
    return { status: 'unchanged' };
  }
  const comp = `${target.tissotCode}${target.year}`;
  const sel = target.tissotEventNumber != null
    ? ['--tissot-event', String(target.tissotEventNumber)]
    : ['--stage', String(target.stageNumber ?? 1)];
  const dir = mkdtempSync(join(tmpdir(), 'cc-tissot-sl-'));
  try {
    const code = await runFetcher([
      '--competition', comp, ...sel, '--race-id', target.raceId,
      ...(target.gender ? ['--gender', target.gender] : []), '--out', dir,
    ]);
    if (code === 3) { log(`  ${target.raceId}: startlist aún no publicada`); return { status: 'pending' }; }
    if (code !== 0) { log(`  ${target.raceId}: el fetcher terminó con ${code}`); return { status: 'error' }; }

    const doc = JSON.parse(readFileSync(join(dir, `${target.raceId}.json`), 'utf8'));
    const ctx = await resolveContext(client, target.raceId, target.gender, doc.riders.map((r) => r.uciRiderId));
    const document = buildNormalizedDocument(doc, ctx);
    if (!document.expectedRiderCount) { log(`  ${target.raceId}: startlist vacía`); return { status: 'unchanged' }; }
    // Un relevo mixto exige el teamId canónico de cada selección; si alguna ficha
    // no resolvió su equipo, se deja para revisión en lugar de reventar la RPC.
    if (ctx.gender == null) {
      const missing = document.teams.filter((t) => !t.teamId).map((t) => t.teamName);
      if (missing.length) {
        log(`  ${target.raceId}: relevo mixto sin teamId para ${missing.join(', ')} — revisar`);
        return { status: 'blocked' };
      }
    }

    // CRI → orden individual (por dorsal). CRE → orden por equipo (dorsal=0).
    const needIndividualOrder = wantOrder && target.primaryType === 'itt' && (doc.startOrder || []).length > 0;
    const needTeamOrder = wantOrder && target.primaryType === 'ttt' && (doc.startOrderTeams || []).length > 0;
    if (!needStartlist && !needIndividualOrder && !needTeamOrder) { log(`  ${target.raceId}: sin cambios`); return { status: 'unchanged' }; }

    const startOrder = needIndividualOrder
      ? doc.startOrder.map((e) => ({ order: e.order, dorsal: e.bib, startTime: e.startTime })).filter((e) => e.dorsal != null)
      : null;
    const startOrderTeams = needTeamOrder
      ? doc.startOrderTeams.map((e) => ({ order: e.order, teamName: e.teamName, startTime: e.startTime }))
      : null;

    if (DRY_RUN) {
      log(`  [dry-run] ${target.raceId}: ${document.teams.length} equipos / ${document.expectedRiderCount} corredores`
        + `${startOrder ? ` · orden ${startOrder.length}` : ''}`
        + `${startOrderTeams ? ` · orden equipos ${startOrderTeams.length}` : ''}`);
      return { status: 'dry-run' };
    }

    const { rows } = await client.query(
      'select public.vps_import_tissot_startlist($1::jsonb) as report',
      [JSON.stringify({ raceId: target.raceId, raceDayId: target.raceDayId, timezone: target.timezone, sourceUrl: doc.sourceUrl, document, startOrder, startOrderTeams })],
    );
    const report = rows[0]?.report || {};
    log(`  ${target.raceId}: status=${report.status || '?'} applied=${report.applied}`
      + `${report.startOrderRows ? ` orden=${report.startOrderRows}` : ''}`
      + `${report.ready === false ? ' (excepciones pendientes)' : ''}`);
    return { status: report.applied ? 'applied' : 'blocked', report };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
  const summary = { processed: 0, applied: 0, blocked: 0, pending: 0, unchanged: 0, errored: 0, changed: false };
  try {
    const params = [];
    let where = `l.source = 'tissot' and r."raceFormat" = 'one_day'
      and coalesce(r."isCancelled", false) = false
      and r."startDate" between to_char(current_date - 2, 'YYYY-MM-DD') and to_char(current_date + 21, 'YYYY-MM-DD')`;
    if (ONLY_RACE) { params.push(ONLY_RACE); where += ` and l."raceId" = $${params.length}`; }
    const { rows: targets } = await client.query(
      `select l."raceId" as "raceId", l."tissotCode", l."tissotEventNumber", r.year, r.gender,
              r."startlistImportedAt", r."startlistProvisional",
              rd.id as "raceDayId", rd."stageNumber", rd."primaryType", rd."startOrderImportedAt", rd.timezone
         from public.race_uci_links l
         join public.races r on r.id = l."raceId"
         left join public.race_days rd on rd."raceId" = r.id and rd."isRestDay" = false
        where ${where}
        order by r."startDate", l."raceId"`, params,
    );
    if (!targets.length) { log('Startlists Tissot: sin carreras de un día en ventana.'); }
    for (const target of targets) {
      summary.processed++;
      const result = await syncRace(client, target);
      if (result.status === 'applied') { summary.applied++; summary.changed = true; }
      else if (result.status === 'blocked') summary.blocked++;
      else if (result.status === 'pending') summary.pending++;
      else if (result.status === 'unchanged') summary.unchanged++;
      else if (result.status === 'error') summary.errored++;
    }
  } finally {
    await client.end();
  }
  process.stdout.write(JSON.stringify(summary) + '\n');
  if (summary.errored) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log(`FATAL: ${e.stack || e.message}`); process.exitCode = 1; });
}
