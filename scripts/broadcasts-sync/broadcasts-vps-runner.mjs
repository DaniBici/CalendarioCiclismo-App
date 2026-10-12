#!/usr/bin/env node

import {
  finishAutomationRun,
  openAutomationClient,
  recordAutomationSourceRun,
  startAutomationRun,
} from '../automation-monitor.mjs';
import { APPLY_SOURCES, run, SOURCES } from './broadcasts-sync.mjs';
import { CX_SOURCES } from './cx-broadcasts-core.mjs';
import { runCxBroadcasts, summarizeCxSource } from './cx-broadcasts.mjs';
import { fileURLToPath } from 'node:url';

function actionCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.action] = (counts[row.action] || 0) + 1;
    return counts;
  }, {});
}

export function summarizeBroadcastSource(source, report) {
  const rows = report.filter((row) => row.source === source);
  const actions = actionCounts(rows);
  const errors = actions.source_failure || 0;
  const matched = rows.filter((row) => row.match?.status === 'matched'
    || ['applied_insert', 'applied_update', 'unchanged', 'shadow_matched', 'pending_stability']
      .includes(row.action)).length;
  const changed = (actions.applied_insert || 0) + (actions.applied_update || 0);
  const warnings = rows.filter((row) => [
    'unmatched', 'ambiguous', 'manual_conflict', 'optimistic_conflict', 'implausible_change',
    'insufficient_broadcast_evidence',
  ].includes(row.action)).length;
  const issueActions = new Set([
    'source_failure', 'unmatched', 'ambiguous', 'manual_conflict', 'optimistic_conflict',
    'implausible_change', 'insufficient_broadcast_evidence', 'pending_stability', 'manual_lock',
  ]);
  const issues = rows.filter((row) => issueActions.has(row.action)).slice(0, 8).map((row) => ({
    action: row.action,
    title: row.title || null,
    dateKey: row.dateKey || null,
    sourceUrl: row.sourceUrl || null,
    detail: row.detail || row.error || null,
  }));
  const status = errors > 0 ? 'error'
    : warnings > 0 ? 'warning'
    : changed > 0 ? 'success'
    : 'noop';
  return {
    source,
    status,
    itemsFound: rows.filter((row) => row.action !== 'source_failure').length,
    itemsMatched: matched,
    itemsChanged: changed,
    errors,
    summary: { actions, issues },
  };
}

async function runCxPass(client, runId) {
  try {
    const cx = await runCxBroadcasts({ client, applySources: APPLY_SOURCES });
    for (const source of CX_SOURCES) {
      await recordAutomationSourceRun(client, { runId, ...summarizeCxSource(source, cx.report) });
    }
    return cx;
  } catch (error) {
    for (const source of CX_SOURCES) {
      await recordAutomationSourceRun(client, {
        runId,
        source,
        status: 'error',
        errors: 1,
        summary: { issues: [{ action: 'source_failure', detail: error.message }] },
      }).catch(() => {});
    }
    return { mode: 'error', observations: 0, failures: CX_SOURCES.length, degraded: true, report: [] };
  }
}

async function claimManualRequest(client) {
  const { rows } = await client.query('select * from private.claim_broadcasts_manual_request()');
  return rows[0] || null;
}

async function finishManualRequest(client, requestId, success, errorMessage = null) {
  await client.query(
    'select private.finish_broadcasts_manual_request($1, $2, $3)',
    [requestId, success, errorMessage],
  );
}

async function broadcastsSyncDue(client) {
  const { rows } = await client.query('select private.broadcasts_sync_due() as due');
  return rows[0]?.due === true;
}

async function main() {
  const connectionString = process.env.BROADCASTS_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Falta BROADCASTS_DATABASE_URL');

  const client = await openAutomationClient(connectionString);
  let runId = null;
  let request = null;
  try {
    request = await claimManualRequest(client);
    const scheduled = await broadcastsSyncDue(client);
    if (!request && !scheduled) return;

    runId = await startAutomationRun(client, {
      job: 'broadcasts',
      triggerKind: request && scheduled ? 'scheduled_manual' : request ? 'manual' : 'scheduled',
      requestId: request?.request_id || null,
    });

    const result = await run({ client });
    for (const source of SOURCES) {
      await recordAutomationSourceRun(client, {
        runId,
        ...summarizeBroadcastSource(source, result.report),
      });
    }

    // Ciclocross comparte ejecución, cadencia y credencial con carretera, pero
    // una pasada no degrada a la otra.
    const cx = await runCxPass(client, runId);
    result.degraded = result.degraded || cx.degraded;

    const status = result.degraded ? 'partial' : 'success';
    const summary = {
      mode: result.mode,
      applySources: result.applySources,
      observations: result.observations,
      failures: result.failures,
      cx: { mode: cx.mode, observations: cx.observations, failures: cx.failures },
    };
    await finishAutomationRun(client, {
      runId,
      status,
      summary,
      error: result.degraded ? 'Una o más fuentes no pudieron consultarse' : null,
    });
    if (request) {
      await finishManualRequest(
        client,
        request.request_id,
        !result.degraded,
        result.degraded ? 'La pasada terminó con una o más fuentes degradadas' : null,
      );
    }
    console.log(JSON.stringify({ runId, trigger: request ? 'manual' : 'scheduled', ...summary }));
    if (result.degraded) process.exitCode = 1;
  } catch (error) {
    if (request) {
      await finishManualRequest(client, request.request_id, false, error.stack || error.message).catch(() => {});
    }
    if (runId != null) {
      await finishAutomationRun(client, {
        runId,
        status: 'error',
        summary: {},
        error: error.stack || error.message,
      }).catch(() => {});
    }
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`FATAL: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
