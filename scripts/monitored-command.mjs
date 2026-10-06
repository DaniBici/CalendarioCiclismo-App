#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  finishAutomationRun,
  openAutomationClient,
  startAutomationRun,
} from './automation-monitor.mjs';
import { databaseUrl } from './db/env.mjs';

function option(name) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || null;
}

function commandArgs() {
  const separator = process.argv.indexOf('--');
  if (separator < 0 || separator === process.argv.length - 1) {
    throw new Error('Falta el comando después de --');
  }
  return process.argv.slice(separator + 1);
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.once('error', (error) => {
      console.error(`No se pudo iniciar ${command}: ${error.message}`);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const job = option('job');
  const triggerKind = option('trigger') || 'scheduled';
  const [command, ...args] = commandArgs();
  if (!job) throw new Error('Falta --job');
  if (!databaseUrl()) throw new Error('Falta DATABASE_URL');

  const client = await openAutomationClient(databaseUrl());
  let runId = null;
  try {
    runId = await startAutomationRun(client, { job, triggerKind });
    const code = await runCommand(command, args);
    await finishAutomationRun(client, {
      runId,
      status: code === 0 ? 'success' : 'error',
      summary: { command, args, exitCode: code },
      error: code === 0 ? null : `${command} terminó con código ${code}`,
    });
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    if (runId != null) {
      await finishAutomationRun(client, {
        runId,
        status: 'error',
        summary: { command, args },
        error: error.stack || error.message,
      }).catch(() => {});
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FATAL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
