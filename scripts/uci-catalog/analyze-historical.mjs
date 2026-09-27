#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeHistoricalSnapshots } from './historical.mjs';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--out');
let outputFile = null;
if (outputIndex >= 0) {
  outputFile = resolve(args[outputIndex + 1]);
  args.splice(outputIndex, 2);
}
const exceptionIndex = args.indexOf('--exceptions');
let exceptions = [];
if (exceptionIndex >= 0) {
  exceptions = JSON.parse(await readFile(resolve(args[exceptionIndex + 1]), 'utf8'));
  args.splice(exceptionIndex, 2);
}
const movementIndex = args.indexOf('--movements');
let movements = null;
if (movementIndex >= 0) {
  movements = JSON.parse(await readFile(resolve(args[movementIndex + 1]), 'utf8'));
  args.splice(movementIndex, 2);
}
const files = args.map(file => resolve(file));
if (files.length !== 6) throw new Error('Uso: analyze-historical.mjs [--exceptions JSON] [--movements JSON] [--out JSON] SNAPSHOT-2020 ... SNAPSHOT-2025');
const snapshots = await Promise.all(files.map(async file => JSON.parse(await readFile(file, 'utf8'))));
const output = `${JSON.stringify(analyzeHistoricalSnapshots(snapshots, exceptions, movements), null, 2)}\n`;
if (outputFile) {
  await mkdir(resolve(outputFile, '..'), { recursive: true });
  const temporaryFile = `${outputFile}.tmp-${process.pid}`;
  await writeFile(temporaryFile, output, 'utf8');
  await rename(temporaryFile, outputFile);
} else {
  process.stdout.write(output);
}
