#!/usr/bin/env node
/**
 * bornan-startlists-sync.mjs — inscritos de unos Juegos del sistema Bornan
 * (p. ej. Juegos Asiáticos 2026) desde el VPS.
 *
 * Flujo por carrera de un día enlazada a Bornan:
 *   1. `bornan-startlist-fetch.mjs --mode official` intenta el PDF «Start List»
 *      (fija dorsales y, en CRI, la hora de salida). Si todavía no existe,
 *      `--mode provisional` lee la API de inscritos (sin dorsal).
 *   2. Resuelve el equipo por selección nacional (ISO-2 + género) y deja que la
 *      importación resuelva la identidad de cada corredor por nombre, nacimiento
 *      y `uciProfileId`.
 *   3. `prepare_startlist_import` + `apply_startlist_import` marcan la lista como
 *      provisional mientras no haya Start List oficial; al publicarse esta, la
 *      convierten en oficial (con dorsales).
 *
 * Uso:
 *   node scripts/results-fetchers/bornan-startlists-sync.mjs [--race-id <id>] [--dry-run]
 *
 * Requiere DATABASE_URL con el rol `cc_results_worker` (o `postgres`).
 */
'use strict';

import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ISO2, parseCode } from './bornan-results-fetch.mjs';
import { databaseUrl } from '../db/env.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => { const index = args.indexOf(`--${name}`); return index === -1 ? fallback : args[index + 1]; };
const hasFlag = (name) => args.includes(`--${name}`);
const HERE = dirname(fileURLToPath(import.meta.url));
const FETCHER = join(HERE, 'bornan-startlist-fetch.mjs');
const ONLY_RACE = getArg('race-id');
const DRY_RUN = hasFlag('dry-run');
const FORCE = hasFlag('force');
const OVERRIDES_PATH = getArg('overrides');
const OVERRIDES = OVERRIDES_PATH ? JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) : {};
const log = (...v) => process.stderr.write(`${v.join(' ')}\n`);

// Nombre de país de la selección cuando el catálogo aún no la tiene. Debe plegar
// a un alias de `team_selection_aliases` para que `ensure_startlist_team` cree
// una selección nacional y no un club.
const NOC_NAMES = {
  AFG: 'Afghanistan', BAN: 'Bangladesh', BHU: 'Bhutan', BRN: 'Bahrain', BRU: 'Brunei',
  CAM: 'Cambodia', CHN: 'China', HKG: 'Hong Kong', IND: 'India', INA: 'Indonesia',
  IRQ: 'Iraq', IRI: 'Iran', JPN: 'Japan', JOR: 'Jordan', KAZ: 'Kazakhstan',
  KUW: 'Kuwait', KGZ: 'Kyrgyzstan', KOR: 'South Korea', KSA: 'Saudi Arabia', LAO: 'Laos',
  LBN: 'Lebanon', MAC: 'Macao', MAS: 'Malaysia', MDV: 'Maldives', MGL: 'Mongolia',
  MYA: 'Myanmar', NEP: 'Nepal', PRK: 'North Korea', OMA: 'Oman', PAK: 'Pakistan',
  PLE: 'Palestine', PHI: 'Philippines', QAT: 'Qatar', SGP: 'Singapore', SRI: 'Sri Lanka',
  SYR: 'Syria', TPE: 'Chinese Taipei', TJK: 'Tajikistan', THA: 'Thailand', TLS: 'Timor-Leste',
  TKM: 'Turkmenistan', UAE: 'United Arab Emirates', UZB: 'Uzbekistan', VIE: 'Vietnam', YEM: 'Yemen',
};

export function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }),
  );
}

const lower = (value) => String(value ?? '').toLowerCase();

export const rowKeyOf = (rider) => String(rider.reg || `${rider.nation}-${rider.lastName}-${rider.firstName || ''}`.replace(/\s+/g, ''));

// Resuelve la ficha del catálogo de cada corredor con criterios decisivos:
// identityKey+nacimiento, uciProfileId+nacimiento, y como último recurso
// apellido+nacimiento o nombre+nacimiento únicos. Sin coincidencia, se deja a la
// importación (ficha nueva o revisión manual).
export async function resolveIdentities(client, gender, riders) {
  const resolved = new Map();
  if (!riders.length) return resolved;
  const table = gender === 'female' ? 'riders_women' : 'riders_men';
  const values = riders.map((rider, index) => {
    const q = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;
    return `(${index}, ${q(rider.firstName)}, ${q(rider.lastName)}, ${q(rider.birthDate)}, ${q(rider.uciProfileId ?? '')})`;
  });
  const { rows } = await client.query(
    `with src(idx, first_name, last_name, dob, uci) as (values ${values.join(',')}),
          s2 as (select idx, first_name, last_name, nullif(dob,'')::date d, uci from src),
          cat as (select id, "firstName" f, "lastName" l, "birthDate" d, "uciProfileId" u, "identityKey" k from public.${table})
     select s.idx,
            c.id,
            (c.k = public.compute_identity_key(s.first_name, s.last_name) and c.d = s.d) as key_hit,
            (s.uci <> '' and c.u = s.uci and (c.d is null or s.d is null or c.d = s.d)) as uci_hit,
            (c.d = s.d and public.fold_name(c.l) = public.fold_name(s.last_name)) as last_hit,
            (c.d = s.d and public.fold_name(c.f) = public.fold_name(s.first_name)) as first_hit
       from s2 s join cat c on
            (c.k = public.compute_identity_key(s.first_name, s.last_name))
         or (s.uci <> '' and c.u = s.uci)
         or (c.d = s.d and (public.fold_name(c.l) = public.fold_name(s.last_name)
              or public.fold_name(c.f) = public.fold_name(s.first_name)))`,
  );
  const byIdx = new Map();
  for (const row of rows) {
    if (!byIdx.has(row.idx)) byIdx.set(row.idx, []);
    byIdx.get(row.idx).push(row);
  }
  riders.forEach((rider, index) => {
    const candidates = byIdx.get(index) ?? [];
    const unique = (predicate) => {
      const ids = [...new Set(candidates.filter(predicate).map((row) => row.id))];
      return ids.length === 1 ? ids[0] : null;
    };
    const id = unique((row) => row.key_hit)
      ?? unique((row) => row.uci_hit)
      ?? unique((row) => row.last_hit)
      ?? unique((row) => row.first_hit);
    if (id) resolved.set(rowKeyOf(rider), id);
  });
  return resolved;
}

// Firma estable de origen: rowKey (Reg o país+nombre), dorsal, país y ficha
// resuelta. No usa los nombres, que el plan reescribe a su forma canónica, para
// no reaplicar una lista idéntica en cada pasada.
export function sourceSignature(riders, globalByKey, teams = []) {
  const riderLines = riders.map((rider) => {
    const key = rowKeyOf(rider);
    return `r:${key}|${rider.bib ?? 0}|${lower(ISO2[rider.nation])}|${globalByKey?.get(key) ?? ''}`;
  });
  const teamLines = (teams ?? []).map((team) => `t:${team.teamName}|${team.teamId ?? ''}`);
  return [...riderLines, ...teamLines].sort().join('\n');
}

export function storedSignature(storedRiders, storedTeams = []) {
  const riderLines = Object.entries(storedRiders ?? {})
    .map(([key, value]) => `r:${key}|${value.dorsal ?? 0}|${lower(value.countryCode)}|${value.globalRiderId ?? ''}`);
  const teamLines = (storedTeams ?? []).map((team) => `t:${team.teamName}|${team.teamId ?? ''}`);
  return [...riderLines, ...teamLines].sort().join('\n');
}

// Agrupa los corredores por selección y resuelve su teamId de catálogo si existe.
export function buildDocument({ raceId, gender, riders, sourceUrl, teamByKey, globalByKey }) {
  const groups = new Map();
  for (const rider of riders) {
    const iso2 = ISO2[rider.nation] ?? null;
    const key = rider.nation;
    if (!groups.has(key)) {
      const existing = iso2 ? teamByKey.get(`${iso2}|${gender}`) : null;
      groups.set(key, {
        teamName: existing?.name ?? NOC_NAMES[rider.nation] ?? rider.nation,
        ...(existing?.id ? { teamId: existing.id } : {}),
        riders: [],
      });
    }
    const globalRiderId = globalByKey?.get(rowKeyOf(rider)) ?? null;
    const team = groups.get(key);
    team.riders.push({
      rowKey: rowKeyOf(rider),
      dorsal: rider.bib ?? 0,
      firstName: rider.firstName,
      lastName: rider.lastName,
      countryCode: iso2,
      ...(rider.birthDate ? { birthDate: rider.birthDate } : {}),
      ...(globalRiderId ? { globalRiderId } : {}),
    });
  }
  return {
    raceId,
    expectedRiderCount: riders.length,
    sourceUrl,
    teams: [...groups.values()],
  };
}

function runFetcher(fetchArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FETCHER, ...fetchArgs], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
    child.once('error', () => resolve(1));
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function resolveTeamCatalog(client, raceId, gender, needed) {
  const map = new Map();
  const codes = [...new Set(needed.map((item) => item.code).filter(Boolean))];
  if (codes.length) {
    const { rows } = await client.query(
      `select t."selectionCode" code, t.gender, t.id, t.name
         from public.teams t
        where t."teamKind" = 'selection' and t."selectionScope" = 'national'
          and t."selectionCode" = any($1)`,
      [codes],
    );
    for (const row of rows) map.set(`${row.code}|${row.gender}`, { id: row.id, name: row.name });
  }
  // Asegura la selección nacional cuando el catálogo aún no la tiene: sin teamId
  // el plan reutilizaría por nombre un club homónimo (p. ej. «SYRIA»).
  for (const item of needed) {
    if (!item.code) continue;
    const key = `${item.code}|${gender}`;
    if (map.has(key)) continue;
    const { rows } = await client.query(
      'select team_id as id from public.ensure_startlist_team($1, $2, $3)',
      [raceId, item.name, gender],
    );
    const id = rows[0]?.id;
    if (!id) { log(`  ${raceId}: no se pudo asegurar la selección ${item.name}`); continue; }
    const { rows: [team] } = await client.query('select id, name from public.teams where id = $1', [id]);
    map.set(key, { id: team.id, name: team.name });
  }
  return map;
}

async function syncRace(client, target) {
  const parsed = parseCode(target.bornanCode);
  const dir = mkdtempSync(join(tmpdir(), 'cc-bornan-sl-'));
  try {
    let official = false;
    let code = await runFetcher(['--code', target.bornanCode, '--race-id', target.raceId, '--out', dir, '--mode', 'official', '--date', target.startDate]);
    if (code === 3) {
      code = await runFetcher(['--code', target.bornanCode, '--race-id', target.raceId, '--out', dir, '--mode', 'provisional', '--date', target.startDate]);
    } else if (code === 0) {
      official = true;
    }
    if (code === 3) { log(`  ${target.raceId}: la fuente todavía no publica inscritos`); return { status: 'pending' }; }
    if (code !== 0) { log(`  ${target.raceId}: el fetcher terminó con ${code}`); return { status: 'error' }; }

    const fetched = JSON.parse(readFileSync(join(dir, `${target.raceId}.json`), 'utf8'));
    const needed = [...new Map(fetched.riders.map((rider) => [rider.nation, {
      code: ISO2[rider.nation] ?? null,
      name: NOC_NAMES[rider.nation] ?? rider.nation,
    }])).values()];
    const teamByKey = await resolveTeamCatalog(client, target.raceId, target.gender, needed);
    const resolved = await resolveIdentities(client, target.gender, fetched.riders);
    const state = (await client.query('select public.vps_startlist_state($1) as s', [target.raceId])).rows[0]?.s ?? {};
    const storedRiders = state.riders ?? {};
    const globalByKey = new Map(resolved);
    for (const rider of fetched.riders) {
      const key = rowKeyOf(rider);
      if (storedRiders[key]?.globalRiderId) globalByKey.set(key, storedRiders[key].globalRiderId);
    }
    const document = buildDocument({
      raceId: target.raceId, gender: target.gender, riders: fetched.riders,
      sourceUrl: fetched.sourceUrl, teamByKey, globalByKey,
    });
    if (!document.expectedRiderCount) { log(`  ${target.raceId}: lista vacía`); return { status: 'unchanged' }; }

    const desiredSig = sourceSignature(fetched.riders, globalByKey, document.teams);
    const storedSig = storedSignature(storedRiders, state.teams);
    if (!FORCE && desiredSig === storedSig) {
      log(`  ${target.raceId}: sin cambios (${official ? 'oficial' : 'provisional'})`);
      return { status: 'unchanged' };
    }

    if (DRY_RUN) {
      log(`  [dry-run] ${target.raceId}: ${document.teams.length} equipos / ${document.expectedRiderCount} corredores (${official ? 'oficial' : 'provisional'})`);
      return { status: 'dry-run', official };
    }

    const prepared = (await client.query(
      'select public.prepare_startlist_import($1, $2::jsonb, $3) as report',
      [target.raceId, JSON.stringify(document), !official],
    )).rows[0]?.report || {};
    const overrides = OVERRIDES[target.raceId] ?? {};
    const applied = (await client.query(
      'select public.apply_startlist_import($1, $2::jsonb) as report',
      [prepared.importId, JSON.stringify(overrides)],
    )).rows[0]?.report || {};
    if (applied.status !== 'applied') {
      const issues = applied.issues || prepared.issues || [];
      const byCode = {};
      for (const issue of issues) byCode[issue.code] = (byCode[issue.code] || 0) + 1;
      log(`  ${target.raceId}: excepciones pendientes (${issues.length}) ${JSON.stringify(byCode)} — revisar`);
      for (const issue of issues.slice(0, 25)) {
        const candidates = (issue.candidates ?? []).map((candidate) => candidate.id).join(',');
        log(`     ${issue.code} ${issue.teamName || ''} ${issue.lastName || ''} ${issue.firstName || ''} -> ${candidates}`.trimEnd());
      }
      return { status: 'blocked', report: applied };
    }
    log(`  ${target.raceId}: status=${applied.status} riders=${applied.riders} teams=${applied.teams}`
      + `${applied.createdRiders ? ` nuevas=${applied.createdRiders}` : ''} (${official ? 'oficial' : 'provisional'})`);
    return { status: 'applied', official, report: applied };
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
    let where = `l.source = 'bornan' and r."raceFormat" = 'one_day'
      and coalesce(r."isCancelled", false) = false
      and (r."startlistImportedAt" is null or r."startlistProvisional" = true)
      and r."startDate" between to_char(current_date - 2, 'YYYY-MM-DD') and to_char(current_date + 21, 'YYYY-MM-DD')`;
    if (ONLY_RACE) { params.push(ONLY_RACE); where += ` and l."raceId" = $${params.length}`; }
    const { rows: targets } = await client.query(
      `select l."raceId" as "raceId", l."bornanCode", r.gender, r."startDate",
              r."startlistImportedAt", r."startlistProvisional"
         from public.race_uci_links l
         join public.races r on r.id = l."raceId"
        where ${where}
        order by r."startDate", l."raceId"`, params,
    );
    if (!targets.length) log('Startlists Bornan: sin carreras de un día en ventana.');
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
  main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exitCode = 1; });
}
