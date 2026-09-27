#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const take = name => { const index = args.indexOf(name); if (index < 0) return null;
  const value = args[index + 1]; if (!value) throw new Error(`Falta valor para ${name}`);
  args.splice(index, 2); return resolve(value); };
const inputFile = take('--input'), outputFile = take('--out');
if (!inputFile || !outputFile || args.length) throw new Error('Uso: verify-current-team-continuity.mjs --input CANDIDATOS --out DECISIONES');
const input = JSON.parse(await readFile(inputFile, 'utf8'));
const stop = new Set(['TEAM','CYCLING','CLUB','PRO','RACING','CONTINENTAL','DE','THE','AND','WOMEN','DEVELOPMENT']);
const check = async match => {
  const consultedAt = new Date().toISOString();
  const tokens = match.historicalName.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(token => token.length >= 4 && !stop.has(token));
  try {
    const { stdout } = await execFileAsync('curl', ['-L','--connect-timeout','3','--max-time','6',
      '--max-filesize','300000','-sS','-A','CalendarioCiclismo-HistoricalAudit/1.0',
      '-w','\n__CC_META__%{http_code} %{url_effective}',match.website], { encoding: 'utf8', maxBuffer: 400_000 });
    const marker = stdout.lastIndexOf('\n__CC_META__');
    if (marker < 0) throw new Error('missing_curl_metadata');
    const body = stdout.slice(0, marker).normalize('NFKD').replace(/\p{Diacritic}/gu, '').toUpperCase();
    const [statusValue, ...finalParts] = stdout.slice(marker + 12).trim().split(' ');
    const status = Number(statusValue), finalUrl = finalParts.join(' ');
    const matchedTokens = [...new Set(tokens)].filter(token => body.includes(token));
    const verified = status >= 200 && status < 400 && matchedTokens.length > 0;
    return { ...match, continuity: verified ? 'same_matrix' : 'new_matrix', verified, consultedAt,
      status, finalUrl, matchedTokens, reason: verified ? 'external_site_reachable_and_team_token_present' : 'external_site_not_conclusive' };
  } catch { return { ...match, continuity: 'new_matrix', verified: false, consultedAt, status: null,
    finalUrl: null, matchedTokens: [], reason: 'fetch_failed' }; }
};
const decisions = [];
for (let index = 0; index < input.matches.length; index += 16) {
  decisions.push(...await Promise.all(input.matches.slice(index, index + 16).map(check)));
}
const report = { version: 1, complete: true, generatedAt: new Date().toISOString(),
  rule: 'La continuidad 2025-2026 exige nombre y código únicos, más respuesta externa con identificador distintivo.',
  summary: { candidates: decisions.length, verifiedSameMatrix: decisions.filter(item => item.verified).length,
    independentMatrices: decisions.filter(item => !item.verified).length,
    fetchFailures: decisions.filter(item => item.status == null).length }, decisions };
await mkdir(dirname(outputFile), { recursive: true });
const temporaryFile = `${outputFile}.tmp-${process.pid}`;
await writeFile(temporaryFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryFile, outputFile);
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
