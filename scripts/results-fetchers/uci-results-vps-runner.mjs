#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CRON = fileURLToPath(new URL('./uci-results-cron.mjs', import.meta.url));

export function argsForManualRequest(request) {
  if (request.race_id) {
    return [
      '--race-id', String(request.race_id),
      ...(request.stage_number != null ? ['--stage', String(request.stage_number)] : []),
    ];
  }
  return ['--scope', 'today', '--ignore-window'];
}

function runCron(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CRON, ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', (error) => {
      console.error(`No se pudo iniciar el cron: ${error.message}`);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function withClient(callback) {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost')
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function claimManualRequest() {
  return withClient(async (client) => {
    const { rows } = await client.query(
      'select * from private.claim_uci_results_manual_request()',
    );
    return rows[0] || null;
  });
}

async function finishManualRequest(requestId, success, errorMessage = null) {
  await withClient((client) => client.query(
    'select private.finish_uci_results_manual_request($1, $2, $3)',
    [requestId, success, errorMessage],
  ));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');

  let failed = false;
  const request = await claimManualRequest();
  if (request) {
    const args = argsForManualRequest(request);
    console.error(`Solicitud manual VPS #${request.request_id}: ${args.join(' ')}`);
    const code = await runCron(args);
    await finishManualRequest(
      request.request_id,
      code === 0,
      code === 0 ? null : `uci-results-cron terminó con código ${code}`,
    );
    failed = code !== 0;
  }

  const configuredCode = await runCron(['--configured']);
  if (failed || configuredCode !== 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`FATAL: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

