#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { recomputeCxStandings } from '../../js/cx-standings.js';

export async function computeAndPublish(client, tournamentId, category, { dryRun = false } = {}) {
  const { rows: [{ snapshot }] } = await client.query('SELECT public.cx_standings_snapshot($1,$2) AS snapshot', [tournamentId, category]);
  const calculation = recomputeCxStandings(snapshot.input);
  if (dryRun) return { digest: snapshot.digest, calculation, published: null };
  const { rows: [{ published }] } = await client.query('SELECT public.cx_publish_standings($1,$2,$3,$4::jsonb) AS published',
    [tournamentId, category, snapshot.digest, JSON.stringify(calculation)]);
  return { digest: snapshot.digest, calculation, published };
}

export async function processStandingsQueue(client, { limit = 20, report = () => {} } = {}) {
  const processed = [];
  for (let index = 0; index < limit; index++) {
    // Claim en una transacción breve. No mantener el lock de cola al publicar:
    // los triggers invalidadores adquieren locks de entrada antes que el de cola.
    const { rows: [{ claimed }] } = await client.query('SELECT private.cx_claim_standings() AS claimed');
    if (!claimed) break;
    try {
      const value = await computeAndPublish(client, claimed.tournamentId, claimed.category);
      processed.push({ claimed, ...value }); report(value);
    } catch (error) {
      let review=false;
      if(error.code==='22023'){
        const {rows:[{protected:protectedGeneral}]}=await client.query(`SELECT EXISTS(SELECT 1 FROM public.cx_standings_state
          WHERE "tournamentId"=$1 AND category=$2 AND status='manual') OR EXISTS(SELECT 1 FROM public.cx_tournament_standings
          WHERE "tournamentId"=$1 AND category=$2 AND source<>'computed') AS protected`,[claimed.tournamentId,claimed.category]);
        review=protectedGeneral;
      }
      await client.query(`UPDATE private.cx_standings_queue SET status=$1,"finishedAt"=now(),"lastError"=$2
        WHERE "tournamentId"=$3 AND category=$4 AND generation=$5 AND status='running'`,
      [review?'review':error.code === '40001' ? 'pending' : 'error', error.message, claimed.tournamentId, claimed.category, claimed.generation]);
      const issue=review?{review:true,reviewReason:error.message}:{error:error.message};
      processed.push({claimed,...issue});report({...issue,tournamentId:claimed.tournamentId,category:claimed.category});
    }
  }
  return processed;
}

function options(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (['--dry-run', '--queue'].includes(key)) args[key.slice(2)] = true;
    else if (['--input', '--output', '--tournament', '--category', '--limit'].includes(key)) {
      const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${key}`);
      args[key.slice(2)] = value;
    } else throw new Error(`Opción desconocida: ${key}`);
  }
  return args;
}
async function main() {
  const args = options(process.argv.slice(2));
  let output;
  if (args.input) {
    if (args.queue || args.tournament || args.category) throw new Error('--input es un cotejo offline sin publicación');
    const input = JSON.parse(await readFile(args.input, 'utf8'));
    output = recomputeCxStandings(input.input || input);
  } else {
    if (!args.queue && (!args.tournament || !args.category)) throw new Error('Usar --input o --tournament/--category o --queue');
    if (args.queue && (args.tournament || args.category || args['dry-run'])) throw new Error('--queue no admite destino ni dry-run');
    const limit = Number(args.limit || 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit inválido');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requerido por el runtime del worker');
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      output = args.queue ? await processStandingsQueue(client, { limit })
        : await computeAndPublish(client, args.tournament, args.category, { dryRun: !!args['dry-run'] });
    } finally { await client.end(); }
  }
  const text = JSON.stringify(output, null, 2) + '\n';
  if (args.output) await writeFile(args.output, text); else process.stdout.write(text);
  if (output.status === 'needs_review' || output.calculation?.status === 'needs_review' || Array.isArray(output) && output.some(value => value.error)) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
