#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { Collector } from './source.mjs';
import { validateHistoricalSnapshot } from './historical.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--root') || args.some((value, index) => index % 2 === 0
  && !['--root', '--from', '--to', '--interval-ms', '--exceptions'].includes(value))) {
  throw new Error('Uso: collect-historical.mjs --root DIRECTORIO [--from AAAA] [--to AAAA] [--interval-ms N] [--exceptions JSON]');
}
const root = resolve(option('--root'));
const from = args.includes('--from') ? Number(option('--from')) : 2020;
const to = args.includes('--to') ? Number(option('--to')) : 2025;
const intervalMs = args.includes('--interval-ms') ? Number(option('--interval-ms')) : 1000;
let exceptions = [];
if (args.includes('--exceptions')) exceptions = JSON.parse(await readFile(resolve(option('--exceptions')), 'utf8'));
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2020 || to > 2025 || from > to
  || !Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 5000) throw new Error('invalid_historical_range');

await mkdir(root, { recursive: true, mode: 0o700 });
for (let year = from; year <= to; year++) {
  const directory = `${root}/${year}`;
  try {
    const existing = JSON.parse(await readFile(`${directory}/snapshot.json`, 'utf8'));
    const summary = validateHistoricalSnapshot(existing, exceptions);
    console.log(JSON.stringify({ event: 'already_collected', ...summary }));
    continue;
  } catch { /* ausente o incompleto: recolectar/reanudar */ }

  let resumeManifest = [];
  try { resumeManifest = JSON.parse(await readFile(`${directory}/failure.json`, 'utf8')).manifest || []; } catch { /* primera ejecución */ }
  const collector = new Collector({ directory, intervalMs, resumeManifest });
  let nextLog = 0;
  try {
    const snapshot = await collector.collect(year, stats => {
      if (Date.now() > nextLog) {
        console.log(JSON.stringify({ event: 'collecting', year, ...stats }));
        nextLog = Date.now() + 60000;
      }
    });
    await writeFile(`${directory}/snapshot.json.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(`${directory}/snapshot.json.tmp`, `${directory}/snapshot.json`);
    const summary = validateHistoricalSnapshot(snapshot, exceptions);
    console.log(JSON.stringify({ event: 'collected', ...summary, ...snapshot.stats }));
  } catch (error) {
    await writeFile(`${directory}/failure.json`, JSON.stringify({ code: error.message, stats: collector.stats,
      manifest: collector.manifest }), { mode: 0o600 }).catch(() => {});
    console.error(JSON.stringify({ event: 'failed', year, code: error.message }));
    process.exitCode = 1;
    break;
  }
}
