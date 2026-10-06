#!/usr/bin/env node
/**
 * belgiancycling-startlists-sync.mjs — ingestión de las listas de inscritos de
 * Belgian Cycling desde el VPS (rol `cc_results_worker`).
 *
 * Carril independiente del de Tissot: el PDF "DEELNEMERSLIJST - LISTE DES
 * PARTANTS" no aporta UCI ID ni nacionalidad, así que la resolución de
 * identidad y de equipos vive íntegramente en `prepare_startlist_import` /
 * `apply_startlist_import`, que la envoltura `vps_import_belgiancycling_startlist`
 * aplica en una transacción y crea los equipos ausentes como clubes. Las
 * excepciones de identidad dejan la lista sin aplicar (blocked) para revisión
 * manual; la fuente no adivina fichas.
 *
 * Solo trata `raceFormat='one_day'` con enlace
 * `race_uci_links.source='belgiancycling'` y `belgianCyclingCode`. Una vez
 * aplicada la lista (o si existe una no provisional), la carrera se omite sin
 * descargar el PDF.
 *
 * Uso:
 *   node scripts/results-fetchers/belgiancycling-startlists-sync.mjs [--race-id <id>] [--dry-run]
 *
 * Requiere DATABASE_URL con el rol `cc_results_worker`.
 */
'use strict';

import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const HERE = dirname(fileURLToPath(import.meta.url));
const FETCHER = join(HERE, 'belgiancycling-startlist-fetch.mjs');
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

// Documento normalizado que consume `prepare_startlist_import`. La fuente no
// publica UCI ID ni país: la resolución de identidad es nominal, contra las
// plantillas de temporada, y los equipos ausentes los crea la propia RPC.
export function buildNormalizedDocument(doc) {
  return {
    raceId: doc.raceId,
    expectedRiderCount: doc.expectedRiderCount,
    sourceUrl: doc.sourceUrl,
    teams: (doc.teams || []).map((team) => ({
      teamName: team.teamName,
      ...(team.teamId ? { teamId: team.teamId } : {}),
      riders: (team.riders || []).map((rider) => ({
        dorsal: rider.dorsal,
        firstName: rider.firstName,
        lastName: rider.lastName,
        ...(rider.globalRiderId ? { globalRiderId: rider.globalRiderId } : {}),
        ...(rider.countryCode ? { countryCode: rider.countryCode } : {}),
        ...(rider.birthDate ? { birthDate: rider.birthDate } : {}),
        ...(rider.uciProfileId ? { uciProfileId: rider.uciProfileId } : {}),
      })),
    })),
  };
}

const asDateKey = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value || null);

// El apellido compuesto UCI puede llevar la ficha como prefijo (fuente
// 'TOMAS MORGADO' → ficha 'Morgado'), como portador del fuente entero o como
// sufijo; el plegado canónico ya está calculado en SQL.
const lastNameMatch = (fl, fln) => fl === fln || fln.startsWith(`${fl} `) || fln.endsWith(` ${fl}`);

// El margen del PDF recorta nombres ('Juan Sebasti' por 'Juan Sebastián'): el
// ÚLTIMO token del nombre fuente puede ser prefijo del canónico, con longitud
// mínima para no cruzar 'Rui' con 'Ruiz'. Todos los tokens de la FICHA deben
// aparecer en el nombre fuente (la fuente trae los nombres completos).
const nameTokensMatch = (srcTokens, fichaTokens) => fichaTokens.every((ft) =>
  srcTokens.includes(ft)
  || srcTokens.some((st) => st.length >= 4 && ft.startsWith(st)));

// Regla conservadora de variantes nominales (fuente UCI estilo «PEDERSEN
// Breiner Henrik» vs ficha «Henrik Pedersen»): candidatos del MISMO apellido
// fuente cuyo nombre de pila canónico (fold_name) aparece como token del nombre
// fuente. Solo fichas verificadas (nacimiento y país) y con un único candidato;
// los nombres exactos los resuelve prepare_startlist_import por su propia vía.
export function applyVariantResolutions(document, catalog, tokenFolds, lastNameFolds) {
  const matched = new Map();
  let resolved = 0;
  const teams = document.teams || [];
  for (let ti = 0; ti < teams.length; ti += 1) {
    const riders = teams[ti].riders || [];
    for (let ri = 0; ri < riders.length; ri += 1) {
      const rider = riders[ri];
      const key = `${ti}|${ri}`;
      if (rider.globalRiderId) { matched.set(key, { id: rider.globalRiderId }); continue; }
      const fln = lastNameFolds.get(rider.lastName);
      const folded = tokenFolds.get(rider.firstName);
      if (!fln || !folded) continue;
      const srcTokens = folded.split(/[^a-z0-9]+/).filter(Boolean);
      const matches = (catalog || []).filter((c) => lastNameMatch(c.fl, fln)
        && nameTokensMatch(srcTokens, c.ff.split(/[^a-z0-9]+/).filter(Boolean)));
      const verified = matches.filter((c) => c.b && c.c);
      if (verified.length !== 1) continue;
      const row = verified[0];
      rider.globalRiderId = row.id;
      rider.countryCode = row.c;
      rider.birthDate = asDateKey(row.b);
      if (row.u) rider.uciProfileId = row.u;
      matched.set(key, row);
      resolved += 1;
    }
  }
  return { resolved, matched };
}

// teamId por mayoría estricta de las plantillas actuales del catálogo entre los
// corredores identificados del bloque; sin mayoría, desempate por nombre plegado
// del bloque descartando las gemelas históricas (uci-hist-*), que nunca son el
// equipo vigente de una carrera en curso; sin candidato único se deja sin
// enlazar y prepare decide.
export function resolveTeamIds(document, matched, teamFolds, teamsCatalog) {
  let linked = 0;
  const teams = document.teams || [];
  for (let ti = 0; ti < teams.length; ti += 1) {
    const team = teams[ti];
    if (team.teamId) continue;
    const tally = new Map();
    let identifiable = 0;
    const riders = team.riders || [];
    for (let ri = 0; ri < riders.length; ri += 1) {
      const row = matched.get(`${ti}|${ri}`);
      if (!row || !row.ct) continue;
      identifiable += 1;
      tally.set(row.ct, (tally.get(row.ct) || 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && identifiable > 0 && best[1] * 2 > identifiable) {
      team.teamId = best[0];
      linked += 1;
      continue;
    }
    const folded = teamFolds.get(team.teamName);
    if (!folded) continue;
    // fold_team_name elimina «Team» y colapsa elite, filial y gemelas; el
    // desempate usa fold_name, que las distingue, junto a la exclusión histórica.
    const byName = (teamsCatalog || []).filter((t) => t.fn === folded && !t.id.startsWith('uci-hist-'));
    if (byName.length === 1) {
      team.teamId = byName[0].id;
      linked += 1;
    }
  }
  return linked;
}

async function resolveDocument(client, gender, document) {
  const riders = (document.teams || []).flatMap((team) => team.riders || []);
  const lastNames = [...new Set(riders.map((r) => r.lastName).filter(Boolean))];
  const firstNames = [...new Set(riders.map((r) => r.firstName).filter(Boolean))];
  const teamNames = [...new Set((document.teams || []).map((t) => t.teamName).filter(Boolean))];
  if (!lastNames.length) return { resolvedRiders: 0, linkedTeams: 0 };
  const table = gender === 'female' ? 'public.riders_women' : 'public.riders_men';
  // Catálogo completo plegado en SQL (una pasada, ~14k filas) y emparejamiento
  // en JS: igualdad, prefijo y sufijo del apellido más token de nombre.
  // Consultas SECUENCIALES: el cliente pg es una sola conexión y encolar
  // consultas concurrentes sobre ella (Promise.all) es un patrón deprecado que
  // se ha colgado contra el pooler. Cada consulta acota su tiempo.
  const catalogRes = await client.query(
    `select id, "firstName" f, "lastName" l, "otherNames" o, "birthDate" b, "nationality" c,
            "uciProfileId" u, "currentTeamId" ct,
            public.fold_name("firstName") ff, public.fold_name("lastName") fl
       from ${table}`,
  );
  const foldsRes = await client.query(
    `select x, public.fold_name(x) ff
       from jsonb_array_elements_text($1::jsonb) as t(x)`,
    [JSON.stringify([...lastNames, ...firstNames, ...teamNames])],
  );
  const teamsRes = await client.query(
    `select id, public.fold_name(name) fn from public.teams where name is not null`,
  );
  const tokenFolds = new Map(foldsRes.rows.map((row) => [row.x, row.ff]));
  const lastNameFolds = new Map(lastNames.map((name) => {
    const row = foldsRes.rows.find((r) => r.x === name);
    return [name, row ? row.ff : null];
  }));
  const teamFolds = new Map(teamNames.map((name) => {
    const row = foldsRes.rows.find((r) => r.x === name);
    return [name, row ? row.ff : null];
  }));
  const teamsCatalog = teamsRes.rows;
  const { resolved: resolvedRiders, matched } = applyVariantResolutions(document, catalogRes.rows, tokenFolds, lastNameFolds);
  const linkedTeams = resolveTeamIds(document, matched, teamFolds, teamsCatalog);
  return { resolvedRiders, linkedTeams };
}

function runFetcher(fetchArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FETCHER, ...fetchArgs], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
    child.once('error', () => resolve(1));
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function syncRace(client, target) {
  // Ya aplicada (y no provisional) → no descargar el PDF de nuevo.
  if (target.startlistImportedAt != null && target.startlistProvisional !== true) {
    log(`  ${target.raceId}: inscritos ya aplicados`);
    return { status: 'unchanged' };
  }
  const dir = mkdtempSync(join(tmpdir(), 'cc-bc-sl-'));
  try {
    const code = await runFetcher([
      '--code', String(target.belgianCyclingCode), '--race-id', target.raceId,
      '--date', String(target.startDate),
      ...(target.gender ? ['--gender', target.gender] : []), '--out', dir,
    ]);
    if (code === 3) { log(`  ${target.raceId}: lista aún no publicada`); return { status: 'pending' }; }
    if (code !== 0) { log(`  ${target.raceId}: el fetcher terminó con ${code}`); return { status: 'error' }; }

    const doc = JSON.parse(readFileSync(join(dir, `${target.raceId}.json`), 'utf8'));
    const document = buildNormalizedDocument(doc);
    if (!document.expectedRiderCount) { log(`  ${target.raceId}: lista vacía`); return { status: 'unchanged' }; }
    const resolution = await resolveDocument(client, target.gender, document);

    if (DRY_RUN) {
      log(`  [dry-run] ${target.raceId}: ${document.teams.length} equipos / ${document.expectedRiderCount} inscritos`
        + ` · variantes ${resolution.resolvedRiders} · equipos ${resolution.linkedTeams}`);
      return { status: 'dry-run' };
    }

    const { rows } = await client.query(
      'select public.vps_import_belgiancycling_startlist($1::jsonb) as report',
      [JSON.stringify({
        raceId: target.raceId,
        sourceUrl: doc.sourceUrl,
        lastUpdate: doc.lastUpdate ?? null,
        provisional: doc.provisional === true,
        signature: doc.signature ?? null,
        document,
      })],
    );
    const report = rows[0]?.report || {};
    if (report.unchanged) {
      log(`  ${target.raceId}: sin cambios desde ${doc.lastUpdate ? `${doc.lastUpdate.dateKey} ${doc.lastUpdate.time}` : 'la última versión'}`);
      return { status: 'unchanged' };
    }
    log(`  ${target.raceId}: status=${report.status || '?'} applied=${report.applied}`
      + `${doc.provisional ? ' [provisional]' : ''}`
      + `${report.ready === false ? ` (excepciones: ${(report.issues || []).length})` : ''}`);
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
  await client.query('SET statement_timeout = 60000');
  const summary = { processed: 0, applied: 0, blocked: 0, pending: 0, unchanged: 0, errored: 0, changed: false };
  try {
    const params = [];
    let where = `l.source = 'belgiancycling' and l."belgianCyclingCode" is not null
      and r."raceFormat" = 'one_day'
      and coalesce(r."isCancelled", false) = false
      and r."startDate" between to_char(current_date - 2, 'YYYY-MM-DD') and to_char(current_date + 21, 'YYYY-MM-DD')`;
    if (ONLY_RACE) { params.push(ONLY_RACE); where += ` and l."raceId" = $${params.length}`; }
    const { rows: targets } = await client.query(
      `select l."raceId" as "raceId", l."belgianCyclingCode", r."startDate", r.gender,
              r."startlistImportedAt", r."startlistProvisional"
         from public.race_uci_links l
         join public.races r on r.id = l."raceId"
        where ${where}
        order by r."startDate", l."raceId"`, params,
    );
    if (!targets.length) { log('Startlists Belgian Cycling: sin carreras de un día en ventana.'); }
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
