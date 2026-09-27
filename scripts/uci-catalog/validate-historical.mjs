#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateHistoricalFiles } from './historical.mjs';

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
const files = args.map(file => resolve(file));
if (files.length !== 6) throw new Error('Uso: validate-historical.mjs [--exceptions JSON] [--out JSON] SNAPSHOT-2020 ... SNAPSHOT-2025');
const output = `${JSON.stringify(await validateHistoricalFiles(files, exceptions), null, 2)}\n`;
if (outputFile) {
  await mkdir(dirname(outputFile), { recursive: true });
  const temporaryFile = `${outputFile}.tmp-${process.pid}`;
  await writeFile(temporaryFile, output, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, outputFile);
} else process.stdout.write(output);
