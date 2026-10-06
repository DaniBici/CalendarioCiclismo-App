#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  finishAutomationRun,
  openAutomationClient,
  startAutomationRun,
} from '../automation-monitor.mjs';
import { databaseUrl } from '../db/env.mjs';

const CRON = fileURLToPath(new URL('./results-cron.mjs', import.meta.url));

function runHistoricalCron() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CRON, '--scope', 'backlog', '--historical', '--limit', '1'], {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', (error) => {
      console.error(`No se pudo iniciar el backlog histórico: ${error.message}`);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  if (!databaseUrl()) throw new Error('Falta DATABASE_URL');

  const client = await openAutomationClient(databaseUrl());
  let runId = null;
  const steps = [];
  try {
    runId = await startAutomationRun(client, {
      job: 'results',
      triggerKind: 'scheduled_historical',
    });
    const code = await runHistoricalCron();
    steps.push({ name: 'historical_backlog', code, years: [2020, 2021, 2022, 2023, 2024, 2025] });
    const failed = code !== 0;
    await finishAutomationRun(client, {
      runId,
      status: failed ? 'error' : 'success',
      summary: { steps },
      error: failed ? `results-cron histórico terminó con código ${code}` : null,
    });
    if (failed) process.exitCode = 1;
  } catch (error) {
    if (runId != null) {
      await finishAutomationRun(client, {
        runId,
        status: 'error',
        summary: { steps },
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
