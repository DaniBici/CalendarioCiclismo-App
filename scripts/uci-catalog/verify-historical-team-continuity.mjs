#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateTeamContinuityReport } from './team-continuity.mjs';

const args = process.argv.slice(2);
const take = name => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`Falta valor para ${name}`);
  args.splice(index, 2);
  return resolve(value);
};
const inputFile = take('--input');
const outputFile = take('--out');
if (!inputFile || !outputFile || args.length) {
  throw new Error('Uso: verify-historical-team-continuity.mjs --input PROPUESTA --out DECISIONES');
}

const proposal = validateTeamContinuityReport(JSON.parse(await readFile(inputFile, 'utf8')));
const groups = proposal.groups.map(group => ({ ...group,
  continuity: group.status === 'verified_same_matrix' ? 'same_matrix' : 'new_matrix' }));
const report = { ...proposal, verifiedAt: new Date().toISOString(), groups,
  summary: { ...proposal.summary,
    verifiedSameMatrix: groups.filter(group => group.status === 'verified_same_matrix').length,
    independentMatrices: groups.filter(group => group.status !== 'verified_same_matrix').length } };
const output = `${JSON.stringify(report, null, 2)}\n`;
await mkdir(dirname(outputFile), { recursive: true });
const temporaryFile = `${outputFile}.tmp-${process.pid}`;
await writeFile(temporaryFile, output, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryFile, outputFile);
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
