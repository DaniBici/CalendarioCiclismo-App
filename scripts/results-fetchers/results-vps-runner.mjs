#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  finishAutomationRun,
  openAutomationClient,
  startAutomationRun,
} from '../automation-monitor.mjs';

const CRON = fileURLToPath(new URL('./results-cron.mjs', import.meta.url));
const LIVE_LINKER = fileURLToPath(new URL('./dataride-live-linker.mjs', import.meta.url));
const CX_LIVE_LINKER = fileURLToPath(new URL('./cx-live-linker.mjs', import.meta.url));
const BORNAN_STARTLISTS_SYNC = fileURLToPath(new URL('./bornan-startlists-sync.mjs', import.meta.url));

// El timer despierta cada minuto porque las fuentes live lo necesitan. El
// descubrimiento de DataRide es una observación más lenta: una consulta cada
// cinco minutos basta para detectar una competición que acaba de publicarse y
// evita repetir el barrido de competiciones en cada tick sin estado persistente.
export function shouldPollLiveLinks(date = new Date(), intervalMinutes = 5) {
  return Number.isInteger(intervalMinutes) && intervalMinutes > 0
    && date.getUTCMinutes() % intervalMinutes === 0;
}

export function argsForManualRequest(request) {
  if (request.race_id) {
    return [
      '--race-id', String(request.race_id),
      ...(request.stage_number != null ? ['--stage', String(request.stage_number)] : []),
      '--require-result',
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

function runLiveLinker(linker, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [linker, ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    child.once('error', (error) => {
      console.error(`No se pudo iniciar el enlazador live: ${error.message}`);
      resolve(1);
    });
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function claimManualRequest(client) {
  const { rows } = await client.query(
    'select * from private.claim_results_manual_request()',
  );
  return rows[0] || null;
}

async function finishManualRequest(client, requestId, success, errorMessage = null) {
  await client.query(
    'select private.finish_results_manual_request($1, $2, $3)',
    [requestId, success, errorMessage],
  );
}

export function runnerOptions(argv=[]) {
  const options={discipline:'10',dryRun:false};let specified=false;
  for(let index=0;index<argv.length;index++){
    if(argv[index]==='--discipline'&&!specified){options.discipline=argv[++index];specified=true;}
    else if(argv[index]==='--dry-run')options.dryRun=true;
    else throw new Error('Opción del runner inválida');
  }
  if(!['10','3'].includes(options.discipline)||options.dryRun&&options.discipline!=='3')throw new Error('Disciplina o dry-run del runner inválidos');
  return options;
}
async function main() {
  const options=runnerOptions(process.argv.slice(2));
  if(options.discipline==='3'){
    if(!options.dryRun&&shouldPollLiveLinks()){
      const code=await runLiveLinker(CX_LIVE_LINKER,[]);
      if(code!==0)console.error(`El enlazador live CX terminó con código ${code}`);
    }
    const {runCxResultsRuntime}=await import('./cx-results-cron.mjs');
    await runCxResultsRuntime({dryRun:options.dryRun});return;
  }
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');

  const client = await openAutomationClient(process.env.DATABASE_URL);
  let runId = null;
  const steps = [];
  try {
    const request = await claimManualRequest(client);
    runId = await startAutomationRun(client, {
      job: 'results',
      triggerKind: request ? 'scheduled_manual' : 'scheduled',
      requestId: request?.request_id || null,
    });

    if (request) {
      const args = argsForManualRequest(request);
      console.error(`Solicitud manual VPS #${request.request_id}: ${args.join(' ')}`);
      const code = await runCron(args);
      steps.push({ name: 'manual', code, args });
      await finishManualRequest(
        client,
        request.request_id,
        code === 0,
        code === 0 ? null : request.race_id
          ? `El volcado dirigido no terminó correctamente (código ${code})`
          : `results-cron terminó con código ${code}`,
      );
    }

    if (shouldPollLiveLinks()) {
      const code = await runLiveLinker(LIVE_LINKER, ['--process-linked']);
      steps.push({ name: 'dataride_live_links', code });
      // Inscritos de los Juegos servidos por Bornan: misma cadencia lenta; la
      // lista pasa de provisional a oficial cuando aparece el Start List.
      const bornanSlCode = await runLiveLinker(BORNAN_STARTLISTS_SYNC, []);
      steps.push({ name: 'bornan_startlists', code: bornanSlCode });
    }

    const configuredCode = await runCron(['--configured']);
    steps.push({ name: 'configured', code: configuredCode });

    const failed = steps.some((step) => step.code !== 0);
    await finishAutomationRun(client, {
      runId,
      status: failed ? 'error' : 'success',
      summary: { steps },
      error: failed ? 'Una o más fases de resultados terminaron con error' : null,
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
