import { execFileSync } from 'node:child_process';

export function deployedRevision() {
  if (process.env.CC_DEPLOY_REVISION) return process.env.CC_DEPLOY_REVISION.slice(0, 80);
  try {
    return execFileSync('git', [
      '-c', `safe.directory=${process.cwd()}`,
      'rev-parse', '--short=12', 'HEAD',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export async function openAutomationClient(connectionString) {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString,
    ssl: connectionString?.includes('localhost')
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

export async function startAutomationRun(client, {
  job,
  triggerKind = 'scheduled',
  requestId = null,
  revision = deployedRevision(),
}) {
  const { rows } = await client.query(
    'select private.start_automation_run($1, $2, $3, $4) as id',
    [job, triggerKind, requestId, revision],
  );
  return rows[0].id;
}

export function finishAutomationRun(client, {
  runId,
  status,
  summary = {},
  error = null,
}) {
  return client.query(
    'select private.finish_automation_run($1, $2, $3::jsonb, $4)',
    [runId, status, JSON.stringify(summary), error],
  );
}

export function recordAutomationSourceRun(client, {
  runId,
  source,
  status,
  itemsFound = 0,
  itemsMatched = 0,
  itemsChanged = 0,
  errors = 0,
  summary = {},
}) {
  return client.query(
    'select private.record_automation_source_run($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    [runId, source, status, itemsFound, itemsMatched, itemsChanged, errors, JSON.stringify(summary)],
  );
}
