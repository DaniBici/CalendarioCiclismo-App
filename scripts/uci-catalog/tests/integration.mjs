#!/usr/bin/env node
// Solo PostgreSQL local desechable. No admite una URL de Supabase ni reutiliza bases.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { normalizeSnapshot, buildPlan } from '../planner.mjs';
import { madridDate } from '../source.mjs';
import { snapshotFixture } from './fixtures.mjs';

const server = new URL(process.env.UCI_TEST_SERVER || 'postgres://postgres@127.0.0.1:55487/postgres');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname) || server.pathname !== '/postgres') throw new Error('local_disposable_server_required');
server.search = '';
const db = `uci_catalog_test_${process.pid}`;
const admin = new pg.Client({ connectionString: server.toString() });
await admin.connect();
const isolation = (await admin.query(`SELECT pg_try_advisory_lock(hashtextextended('uci-catalog-integration-tests',0)) AS locked,
  EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('cc_uci_catalog_owner','cc_uci_catalog_worker','uci_catalog_test_migrator')) AS existing_roles`)).rows[0];
if (!isolation.locked || isolation.existing_roles) {
  await admin.end(); throw new Error('fresh_disposable_catalog_server_required');
}
await admin.query(`CREATE DATABASE ${db}`);
server.pathname = `/${db}`;
const client = new pg.Client({ connectionString: server.toString() }); await client.connect();
const year = Number(madridDate().slice(0, 4));
const migration = await readFile('supabase/migrations/20260904084609_uci_catalog_daily_sync.sql', 'utf8');
const results = [];
const rpc = async (name, values = [], c = client) => (await c.query(`SELECT private.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`, values)).rows[0].result;
async function definition(path, name) {
  const sql = await readFile(`supabase/migrations/${path}`, 'utf8');
  const start = new RegExp(`CREATE(?: OR REPLACE)? FUNCTION (?:public\\.)?${name}\\(`, 'i').exec(sql);
  if (!start) throw new Error(`missing_fixture_function:${name}`);
  const part = sql.slice(start.index), tag = /\bAS\s+(\$[a-z_]*\$)/i.exec(part);
  return part.slice(0, part.indexOf(tag[1] + ';', tag.index + tag[0].length) + tag[1].length + 1);
}
async function rejected(sql, params, pattern, c = client) {
  await c.query('SAVEPOINT expected_failure');
  let error;
  try { await c.query(sql, params); } catch (e) { error = e; }
  await c.query('ROLLBACK TO SAVEPOINT expected_failure'); await c.query('RELEASE SAVEPOINT expected_failure');
  assert.ok(error, 'La operación debía rechazarse'); assert.match(error.message, pattern);
}
async function test(name, fn) {
  await client.query('BEGIN');
  try { await fn(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  finally { await client.query('ROLLBACK'); }
}

async function setup({ mode = 'apply', sameTeam = false, trainee = false, fill = false } = {}) {
  const raw = snapshotFixture(year);
  raw.startedAt = new Date(Date.now() - 1000).toISOString(); raw.completedAt = new Date().toISOString();
  if (trainee) raw.teams[2].riders.push({ ...raw.teams[0].riders[0], affiliationType: 'trainee', sourcePanel: 'Trainees' });
  const snapshot = normalizeSnapshot(raw);
  for (const [profile, t] of Object.entries(snapshot.teams)) {
    await client.query('INSERT INTO public.teams(id,name,gender,category) VALUES($1,$2,$3,$4)', [`team-${profile}`, t.name, t.gender, t.category]);
    await client.query('INSERT INTO private.uci_catalog_team_links(season,profile,team_id,gender,category,source_name,source_code) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [year, profile, `team-${profile}`, t.gender, t.category, t.name, t.code]);
  }
  const team = sameTeam ? 'team-1' : 'team-2';
  await client.query(`INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate","uciProfileId","currentTeamId") VALUES('target','Ana','Ciclista 1','es',$1,'100',$2)`, [fill ? null : '2000-01-01', team]);
  await client.query(`INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateFrom","dateTo",source)
    VALUES('historical','target','male','team-3',$1,$2,$3,'official')`, [year - 1, `${year - 1}-01-01`, `${year - 1}-12-31`]);
  await client.query('INSERT INTO private.uci_catalog_baselines(season,gender,profile,team_id) VALUES($1,$2,$3,$4)', [year, 'male', '100', team]);
  await client.query('UPDATE private.uci_catalog_control SET season=$1,enabled=true', [year]);
  await client.query(`INSERT INTO private.uci_catalog_runs(mode,revision,status,started_at,observed_at,finished_at,snapshot)
    VALUES('shadow','fixture','noop',now()-interval '26 hours',now()-interval '24 hours',now()-interval '24 hours',$1)`, [snapshot]);
  const lease = await rpc('uci_catalog_begin', [mode, 'fixture']);
  await rpc('uci_catalog_observe', [lease.runId, lease.token, snapshot]);
  const context = await rpc('uci_catalog_context', [lease.runId, lease.token]);
  const plan = buildPlan(snapshot, context);
  const changes = await rpc('uci_catalog_stage', [lease.runId, lease.token, plan]);
  const before = await rpc('uci_catalog_state', ['target', 'male']);
  return { lease, changes, before, snapshot, context, plan };
}

try {
  for (const role of ['anon', 'authenticated', 'service_role', 'cc_results_worker']) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  }
  await client.query(`CREATE SCHEMA private;
    CREATE FUNCTION private.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION private.get_automation_monitor() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"runs":[]}'::jsonb $$;
    CREATE TABLE public.teams(id text PRIMARY KEY,name text,gender text,category text,"specialEdition" boolean NOT NULL DEFAULT false,
      "teamKind" text NOT NULL DEFAULT 'uci',"parentTeamId" text);
    CREATE TABLE public.riders_men(id text PRIMARY KEY,"firstName" text NOT NULL,"lastName" text NOT NULL,"otherNames" text,
      nationality text,"birthDate" date,"currentTeamId" text REFERENCES public.teams(id),"uciProfileId" text UNIQUE,"contractUntil" smallint,
      source text NOT NULL DEFAULT 'manual',verified boolean NOT NULL DEFAULT true,"identityKey" text,
      "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.riders_women(LIKE public.riders_men INCLUDING ALL);
    CREATE TABLE public.rider_team_affiliations(id text PRIMARY KEY,"riderId" text NOT NULL,"riderGender" text NOT NULL,
      "teamId" text NOT NULL REFERENCES public.teams(id),year integer NOT NULL,"dateFrom" date,"dateTo" date,
      source text NOT NULL DEFAULT 'manual',verified boolean NOT NULL DEFAULT true,
      "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.rider_transfers(id text PRIMARY KEY,"riderId" text,"riderGender" text,season integer,status text);
    GRANT USAGE ON SCHEMA private,public TO authenticated,service_role,cc_results_worker;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC;`);
  const trainees = await readFile('supabase/migrations/20260904070007_rider_trainee_affiliations.sql', 'utf8');
  await client.query(trainees.slice(trainees.indexOf('ALTER TABLE'), trainees.indexOf('CREATE FUNCTION private.guard_trainee')));
  const guardStart = trainees.indexOf('CREATE FUNCTION private.guard_trainee');
  await client.query(trainees.slice(guardStart, trainees.indexOf('CREATE OR REPLACE FUNCTION public.recompute_current_team')));
  for (const [path, name] of [
    ['075_riders_identity_key.sql', 'fold_name'],
    ['20260904063104_serialize_selection_roster_guards.sql', 'guard_regular_team_roster'],
    ['20260904070007_rider_trainee_affiliations.sql', 'recompute_current_team'],
    ['20260904070007_rider_trainee_affiliations.sql', 'sync_rider_to_affiliation'],
    ['20260904070007_rider_trainee_affiliations.sql', 'sync_affiliation_to_current_team'],
  ]) await client.query(await definition(path, name));
  await client.query(`CREATE TRIGGER guard_regular_team_affiliation BEFORE INSERT OR UPDATE ON public.rider_team_affiliations FOR EACH ROW EXECUTE FUNCTION public.guard_regular_team_roster();
    CREATE TRIGGER guard_regular_current_team_men BEFORE INSERT OR UPDATE OF "currentTeamId" ON public.riders_men FOR EACH ROW EXECUTE FUNCTION public.guard_regular_team_roster();
    CREATE TRIGGER guard_regular_current_team_women BEFORE INSERT OR UPDATE OF "currentTeamId" ON public.riders_women FOR EACH ROW EXECUTE FUNCTION public.guard_regular_team_roster();
    CREATE TRIGGER sync_affiliation_to_current_team AFTER INSERT OR UPDATE OR DELETE ON public.rider_team_affiliations FOR EACH ROW EXECUTE FUNCTION public.sync_affiliation_to_current_team();
    CREATE TRIGGER sync_rider_to_affiliation_men AFTER INSERT OR UPDATE OF "currentTeamId" ON public.riders_men FOR EACH ROW EXECUTE FUNCTION public.sync_rider_to_affiliation('male');
    CREATE TRIGGER sync_rider_to_affiliation_women AFTER INSERT OR UPDATE OF "currentTeamId" ON public.riders_women FOR EACH ROW EXECUTE FUNCTION public.sync_rider_to_affiliation('female');`);
  for (const table of ['riders_men', 'riders_women', 'rider_team_affiliations']) {
    await client.query(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY; CREATE POLICY public_read ON public.${table} FOR SELECT USING(true)`);
  }
  // Reproducir el rol postgres administrado: CREATEROLE, sin SUPERUSER.
  await admin.query('CREATE ROLE uci_catalog_test_migrator NOLOGIN CREATEROLE');
  await client.query(`ALTER SCHEMA public OWNER TO uci_catalog_test_migrator;
    ALTER SCHEMA private OWNER TO uci_catalog_test_migrator;
    DO $$ DECLARE o record; BEGIN
      FOR o IN SELECT c.oid::regclass AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','private') AND c.relkind='r' LOOP
        EXECUTE format('ALTER TABLE %s OWNER TO uci_catalog_test_migrator',o.name); END LOOP;
      FOR o IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname IN ('public','private') LOOP
        EXECUTE format('ALTER FUNCTION %s OWNER TO uci_catalog_test_migrator',o.name); END LOOP;
    END $$`);
  await client.query('SET SESSION AUTHORIZATION uci_catalog_test_migrator');
  try { await client.query(migration); } finally { await client.query('RESET SESSION AUTHORIZATION'); }
  await test('shadow conserva exactamente el estado público', async () => {
    const s = await setup({ mode: 'shadow' }); assert.equal(s.changes.length, 1, JSON.stringify(s.plan));
    await rejected('SELECT private.uci_catalog_apply($1,$2)', [s.changes[0].id, s.lease.token], /writes_disabled/);
    assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), s.before);
  });
  await test('traslado atómico D−1/D, campo vacío e idempotencia', async () => {
    await client.query("SET LOCAL timezone='UTC'");
    const s = await setup({ fill: true }); assert.equal(s.changes.length, 1);
    const result = await rpc('uci_catalog_apply', [s.changes[0].id, s.lease.token]); assert.equal(result.day, madridDate());
    const state = await rpc('uci_catalog_state', ['target', 'male']);
    assert.equal(state.rider.currentTeamId, 'team-1'); assert.equal(state.rider.birthDate, '2000-01-01');
    assert.deepEqual(state.affiliations.find(a => a.id === 'historical'), s.before.affiliations.find(a => a.id === 'historical'));
    assert.equal(state.affiliations.find(a => a.source === 'uci_catalog').dateFrom, result.day);
    const previous = new Date(`${result.day}T12:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
    assert.equal(state.affiliations.find(a => a.teamId === 'team-2').dateTo, previous.toISOString().slice(0, 10));
    assert.equal((await rpc('uci_catalog_apply', [s.changes[0].id, s.lease.token])).status, 'alreadyApplied');
    assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), state);
  });
  await test('rollback íntegro y bloqueo de reaplicación', async () => {
    const s = await setup({ fill: true }); await rpc('uci_catalog_apply', [s.changes[0].id, s.lease.token]);
    assert.equal((await rpc('uci_catalog_rollback', [s.changes[0].id])).status, 'reverted');
    assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), s.before);
    await rejected('SELECT private.uci_catalog_apply($1,$2)', [s.changes[0].id, s.lease.token], /not_pending/);
  });
  await test('fallo entre cierre y alta revierte ambos y los triggers', async () => {
    const s = await setup();
    await client.query(`CREATE FUNCTION private.test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.source='uci_catalog' THEN RAISE EXCEPTION 'fixture_crash'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_fail BEFORE INSERT ON public.rider_team_affiliations FOR EACH ROW EXECUTE FUNCTION private.test_fail()`);
    await rejected('SELECT private.uci_catalog_apply($1,$2)', [s.changes[0].id, s.lease.token], /fixture_crash/);
    assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), s.before);
  });
  await test('edición posterior al plan y afiliación insertada invalidan la aplicación', async () => {
    const s = await setup();
    await client.query(`INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateTo") VALUES('concurrent','target','male','team-3',$1,$2)`, [year - 2, `${year - 2}-12-31`]);
    await rejected('SELECT private.uci_catalog_apply($1,$2)', [s.changes[0].id, s.lease.token], /concurrent_edit/);
  });
  await test('lease caducado o sustituido impide escribir', async () => {
    const s = await setup(); await client.query(`UPDATE private.uci_catalog_control SET token=gen_random_uuid()`);
    await rejected('SELECT private.uci_catalog_apply($1,$2)', [s.changes[0].id, s.lease.token], /lease_lost/);
    assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), s.before);
  });
  await test('stagiaire con ventana reglamentaria conserva equipo e histórico', async () => {
    const s = await setup({ sameTeam: true, trainee: true }); assert.equal(s.changes.length, 1);
    await rpc('uci_catalog_apply', [s.changes[0].id, s.lease.token]);
    const after = await rpc('uci_catalog_state', ['target', 'male']);
    assert.deepEqual(after.rider, s.before.rider);
    const trainee = after.affiliations.find(a => a.affiliationType === 'trainee');
    assert.equal(trainee.dateFrom, `${year}-08-01`); assert.equal(trainee.dateTo, `${year}-12-31`);
    assert.equal(trainee.dateBasis, 'regulatory_window');
    await rpc('uci_catalog_rollback', [s.changes[0].id]); assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), s.before);
  });
  await test('rollback rechaza una edición posterior', async () => {
    const s = await setup(); await rpc('uci_catalog_apply', [s.changes[0].id, s.lease.token]);
    await client.query(`UPDATE public.riders_men SET "otherNames"='Edición posterior' WHERE id='target'`);
    await rejected('SELECT private.uci_catalog_rollback($1)', [s.changes[0].id], /rollback_concurrent_edit/);
  });
  await test('segunda ejecución reconoce la instancia activa', async () => {
    await setup(); assert.equal((await rpc('uci_catalog_begin', ['shadow', 'second'])).skipped, 'locked');
  });
  await test('rechaza una captura caducada o una evidencia que no describe sus datos', async () => {
    const s = await setup(); const stale = structuredClone(s.snapshot); stale.collectedAt = new Date(Date.now() - 86400000).toISOString();
    await rejected('SELECT private.uci_catalog_observe($1,$2,$3)', [s.lease.runId, s.lease.token, stale], /invalid_snapshot/);
    const tampered = structuredClone(s.snapshot); tampered.records['100'].regular = ['2'];
    await rejected('SELECT private.uci_catalog_observe($1,$2,$3)', [s.lease.runId, s.lease.token, tampered], /invalid_source_record/);
  });
  await test('la validación SQL protege contratos aunque se reemita un hash actualizado', async () => {
    const s = await setup(); await client.query(`UPDATE public.riders_men SET "contractUntil"=$1 WHERE id='target'`, [year + 2]);
    const hash = (await client.query("SELECT md5(private.uci_catalog_state('target','male')::text) AS hash")).rows[0].hash;
    const action = { ...s.plan.actions[0], expectedHash: hash };
    assert.equal(await rpc('uci_catalog_check', [s.lease.runId, action]), 'affiliation_or_contract_review');
  });
  await test('la revisión persiste la decisión y no cambia fichas', async () => {
    const s = await setup();
    await rpc('uci_catalog_review_case', [`rider:${year}:101`, 'locked', 'Identidad pendiente de documento oficial']);
    const row = (await client.query('SELECT status,decision FROM private.uci_catalog_cases WHERE key=$1', [`rider:${year}:101`])).rows[0];
    assert.equal(row.status, 'locked'); assert.ok(row.decision);
    await rpc('uci_catalog_review_team', [s.lease.runId, '1', 'team-1']);
    assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), s.before);
  });
  await test('una exclusión de staff no genera acción ni caso de corredor', async () => {
    const s = await setup();
    const plan = buildPlan(s.snapshot, { ...s.context, exclusions: ['100'] });
    assert.equal(plan.actions.some(action => action.profile === '100'), false);
    assert.equal(plan.cases.some(row => row.key.includes(':100')), false);
  });
  await test('barrera de medianoche revierte una fecha transaccional desfasada', async () => {
    const s = await setup();
    const localHour = new Date().getUTCHours();
    const zone = localHour < 12 ? 'Etc/GMT+12' : 'Pacific/Kiritimati';
    await client.query(`ALTER FUNCTION private.uci_catalog_apply(uuid,uuid) SET timezone='${zone}'`);
    await rejected('SELECT private.uci_catalog_apply($1,$2)', [s.changes[0].id, s.lease.token], /midnight_retry|season_not_adopted/);
    assert.deepEqual(await rpc('uci_catalog_state', ['target', 'male']), s.before);
  });
  await test('permisos del worker: RPC habilitada y DML directo rechazado', async () => {
    const s = await setup();
    await client.query('SET SESSION AUTHORIZATION cc_uci_catalog_worker');
    try {
      await rejected(`UPDATE public.riders_men SET "currentTeamId"=NULL WHERE id='target'`, [], /permission denied/);
      await rejected('SELECT private.uci_catalog_rollback($1)', [s.changes[0].id], /permission denied/);
      await rpc('uci_catalog_apply', [s.changes[0].id, s.lease.token]);
    } finally { await client.query('RESET SESSION AUTHORIZATION'); }
  });
  // Las dos conexiones requieren fixtures confirmados; la base completa se elimina al terminar.
  await client.query('BEGIN'); const concurrent = await setup(); await client.query('COMMIT');
  const other = new pg.Client({ connectionString: server.toString() }); await other.connect();
  try {
    await client.query('BEGIN'); await other.query('BEGIN');
    await other.query("SELECT pg_advisory_xact_lock(hashtextextended('regular-team-roster:team-1',0))");
    await rejected('SELECT private.uci_catalog_apply($1,$2)', [concurrent.changes[0].id, concurrent.lease.token], /component_busy/);
    await other.query('ROLLBACK'); await client.query('ROLLBACK');
    results.push({ name: 'cede ante el mutex de equipos de otro escritor', status: 'passed' });
    await client.query('BEGIN'); await rpc('uci_catalog_apply', [concurrent.changes[0].id, concurrent.lease.token]);
    await other.query(`BEGIN; SET LOCAL lock_timeout='100ms'`);
    await rejected(`INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year) VALUES('parallel','target','male','team-3',$1)`, [year], /lock timeout/, other);
    await other.query('ROLLBACK'); await client.query('ROLLBACK');
    results.push({ name: 'exclusión de inserción concurrente desde otra conexión', status: 'passed' });
    console.log('PASS exclusión de inserción concurrente desde otra conexión');
  } finally { await other.end(); }
  console.log(JSON.stringify({ postgres: (await client.query('SHOW server_version')).rows[0].server_version, results }));
} finally {
  await client.query('ROLLBACK').catch(() => {}); await client.end();
  await admin.query(`DROP DATABASE ${db} WITH (FORCE)`);
  await admin.query('DROP ROLE IF EXISTS cc_uci_catalog_worker,cc_uci_catalog_owner,uci_catalog_test_migrator');
  await admin.end();
}
