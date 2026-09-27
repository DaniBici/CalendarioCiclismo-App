#!/usr/bin/env node
import pg from 'pg';
import { readFile, writeFile, mkdir, readdir, lstat, rm, statfs } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Collector } from './source.mjs';
import { normalizeSnapshot, buildPlan } from './planner.mjs';

export function clientConfig(connectionString) {
  if (!connectionString) throw new Error('missing_catalog_database_url');
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('invalid_catalog_database_url'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('invalid_catalog_database_url');
  // pg permite que parámetros de URL sustituyan ssl, user y otros ajustes.
  // La identidad viene de la autoridad; TLS y límites los fija este cliente.
  url.search = '';
  if (!decodeURIComponent(url.username).match(/^cc_uci_catalog_worker(?:\.|$)/)) throw new Error('wrong_database_role');
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000, statement_timeout: 30000, query_timeout: 35000,
    application_name: 'cc-uci-catalog' };
}
export const errorCode = error => {
  const message = String(error?.message || 'unknown_error');
  if (/^(?:apply_rejected:|plan_rejected:)?[a-z][a-z0-9_]{1,100}$/.test(message)) return message;
  return /^[A-Z0-9_]{2,35}$/.test(error?.code || '') ? error.code : 'catalog_error';
};

export async function pruneState(directory, now = Date.now()) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let size = 0;
  const sum = async path => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('state_symlink_rejected');
    if (stat.isDirectory()) { for (const name of await readdir(path)) await sum(join(path, name)); }
    else size += stat.size;
  };
  for (const name of await readdir(directory)) {
    if (!/^capture-\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}$/.test(name)) continue;
    const path = join(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('state_symlink_rejected');
    if (stat.mtimeMs < now - 7 * 86400000) await rm(path, { recursive: true });
    else await sum(path);
  }
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < 4 * 1024 ** 3 || size > 1024 ** 3) throw new Error('state_disk_budget');
}

export async function run({ mode = 'shadow', directory = '/var/lib/cc-uci-catalog' } = {}) {
  if (!['shadow', 'apply'].includes(mode)) throw new Error('invalid_mode');
  await pruneState(directory);
  const client = new pg.Client(clientConfig(process.env.UCI_CATALOG_DATABASE_URL));
  const heartbeat = new pg.Client(clientConfig(process.env.UCI_CATALOG_DATABASE_URL));
  let lease, timer, lost = false, collector, renewing = false;
  const rpc = async (fn, values = []) => {
    const result = await client.query(`SELECT private.${fn}(${values.map((_, i) => `$${i + 1}`).join(',')}) AS result`, values);
    return result.rows[0].result;
  };
  try {
    await client.connect(); await heartbeat.connect();
    const revision = execFileSync('git', ['-c', `safe.directory=${process.cwd()}`, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim();
    lease = await rpc('uci_catalog_begin', [mode, revision]);
    if (lease.skipped) return lease;
    collector = new Collector({ directory: join(directory, `capture-${new Date().toISOString().slice(0, 10)}-${lease.runId}`) });
    timer = setInterval(async () => {
      if (renewing || lost) return;
      renewing = true;
      try { await heartbeat.query('SELECT private.uci_catalog_renew($1,$2)', [lease.runId, lease.token]); }
      catch { lost = true; collector.stopped = true; }
      finally { renewing = false; }
    }, 30000);
    const checkLease = () => { if (lost) throw new Error('uci_lease_lost'); };
    let nextLog = 0;
    const raw = await collector.collect(lease.year, stats => {
      checkLease();
      if (Date.now() >= nextLog) { console.log(JSON.stringify({ event: 'collecting', ...stats })); nextLog = Date.now() + 60000; }
    });
    checkLease();
    await writeFile(join(collector.directory, 'snapshot.json'), JSON.stringify(raw), { mode: 0o600 });
    const snapshot = normalizeSnapshot(raw);
    await rpc('uci_catalog_observe', [lease.runId, lease.token, snapshot]);
    checkLease();
    const context = await rpc('uci_catalog_context', [lease.runId, lease.token]);
    const plan = buildPlan(snapshot, context);
    await writeFile(join(collector.directory, 'plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
    const changes = await rpc('uci_catalog_stage', [lease.runId, lease.token, plan]);
    const failed = [];
    if (mode === 'apply') for (const change of changes) {
      checkLease();
      try { await rpc('uci_catalog_apply', [change.id, lease.token]); }
      catch (error) {
        const code = errorCode(error);
        failed.push({ changeId: change.id, code });
        console.error(JSON.stringify({ event: 'change_rejected', changeId: change.id, code }));
      }
    }
    checkLease();
    const result = await rpc('uci_catalog_finish', [lease.runId, lease.token, failed.length ? 'apply_conflicts' : null]);
    console.log(JSON.stringify({ event: 'completed', runId: lease.runId, ...result }));
    if (failed.length) process.exitCode = 1;
    return result;
  } catch (error) {
    const code = errorCode(error);
    if (lease?.runId && !lost) await rpc('uci_catalog_finish', [lease.runId, lease.token, code]).catch(() => {});
    console.error(JSON.stringify({ event: 'failed', code })); process.exitCode = 1;
    return { status: 'error', code };
  } finally {
    clearInterval(timer);
    await Promise.allSettled([client.end(), heartbeat.end()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--shadow', '--apply'].includes(args[0])) {
    await run({ mode: args[0].slice(2), directory: process.env.UCI_CATALOG_STATE_DIR || '/var/lib/cc-uci-catalog' });
  } else if (args[0] === '--dry-run' && args.length === 4) {
    const snapshot = normalizeSnapshot(JSON.parse(await readFile(args[1], 'utf8')));
    const context = JSON.parse(await readFile(args[2], 'utf8'));
    const plan = buildPlan(snapshot, context);
    await writeFile(args[3], JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ event: 'dry_run', proposed: plan.proposed, cases: plan.cases.length, suspended: plan.suspended }));
  } else throw new Error('Uso: run.mjs --shadow | --apply | --dry-run SNAPSHOT CONTEXTO PLAN');
}
