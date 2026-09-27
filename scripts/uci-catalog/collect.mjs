#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { Collector, madridDate } from './source.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--out') || args.some((v, i) => i % 2 === 0 && !['--out', '--year', '--interval-ms'].includes(v))) {
  throw new Error('Uso: collect.mjs --out DIRECTORIO [--year AAAA] [--interval-ms N]');
}
const directory = resolve(option('--out'));
const year = args.includes('--year') ? Number(option('--year')) : Number(madridDate().slice(0, 4));
if (!Number.isInteger(year) || year < 2005 || year > Number(madridDate().slice(0, 4))) throw new Error('invalid_year');
const intervalMs = args.includes('--interval-ms') ? Number(option('--interval-ms')) : 1000;
if (!Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 5000) throw new Error('invalid_interval');
let resumeManifest = [];
try { resumeManifest = JSON.parse(await readFile(`${directory}/failure.json`, 'utf8')).manifest || []; } catch { /* primera ejecución */ }
const collector = new Collector({ directory, intervalMs, resumeManifest });
let nextLog = 0;
try {
  const snapshot = await collector.collect(year, stats => {
    if (Date.now() > nextLog) { console.log(JSON.stringify({ event: 'collecting', ...stats })); nextLog = Date.now() + 60000; }
  });
  await writeFile(`${directory}/snapshot.json.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(`${directory}/snapshot.json.tmp`, `${directory}/snapshot.json`);
  console.log(JSON.stringify({ event: 'collected', teams: snapshot.teams.length, riders: snapshot.riders.length,
    ...snapshot.stats, profileErrors: snapshot.errors.length }));
} catch (e) {
  await writeFile(`${directory}/failure.json`, JSON.stringify({ code: e.message, stats: collector.stats, manifest: collector.manifest }), { mode: 0o600 }).catch(() => {});
  console.error(JSON.stringify({ event: 'failed', code: e.message })); process.exitCode = 1;
}
