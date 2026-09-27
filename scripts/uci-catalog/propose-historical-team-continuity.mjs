#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { applyHistoricalExceptions, validateHistoricalSnapshot } from './historical.mjs';
import { buildTeamContinuityReport } from './team-continuity.mjs';

const args = process.argv.slice(2);
const takeOption = name => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`Falta valor para ${name}`);
  args.splice(index, 2);
  return resolve(value);
};
const outputFile = takeOption('--out');
const exceptionsFile = takeOption('--exceptions');
const decisionsFile = takeOption('--decisions');
if (args.length < 2) {
  throw new Error('Uso: propose-historical-team-continuity.mjs [--exceptions JSON] [--out JSON] SNAPSHOT...');
}
const exceptions = exceptionsFile ? JSON.parse(await readFile(exceptionsFile, 'utf8')) : [];
const decisions = JSON.parse(await readFile(decisionsFile
  || new URL('./historical-team-continuity-decisions.json', import.meta.url), 'utf8'));
const snapshots = await Promise.all(args.map(async file => JSON.parse(await readFile(resolve(file), 'utf8'))));
const materialized = snapshots.map(snapshot => snapshot.year <= 2025
  ? applyHistoricalExceptions(snapshot, exceptions) : snapshot);
materialized.filter(snapshot => snapshot.year <= 2025)
  .forEach(snapshot => validateHistoricalSnapshot(snapshot));

const report = buildTeamContinuityReport(materialized, { decisions });
const output = `${JSON.stringify(report, null, 2)}\n`;
if (outputFile) {
  await mkdir(dirname(outputFile), { recursive: true });
  const temporaryFile = `${outputFile}.tmp-${process.pid}`;
  await writeFile(temporaryFile, output, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, outputFile);
} else process.stdout.write(output);
