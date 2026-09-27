#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector, parseRider } from '../uci-catalog/source.mjs';
import { countryCode as iso3to2 } from '../uci-catalog/countries.mjs';

const normCountry = value => (/^[a-z]{2}$/.test(String(value || '')) ? String(value) : iso3to2(value));

export function summarizeRider(entry, parsed, page, { year } = {}) {
  const expect = entry.expect || {};
  const checks = {};
  if (expect.birthDate) checks.birthDate = parsed.birthDate === expect.birthDate;
  if (expect.countryCode) checks.countryCode = normCountry(parsed.nationality) === normCountry(expect.countryCode);
  const mismatch = Object.values(checks).some(ok => !ok);
  const team = year ? parsed.history.find(t => String(t.year) === String(year) && !t.format) || null : null;
  return {
    dorsal: entry.dorsal ?? null, uciProfileId: entry.uciProfileId,
    status: mismatch ? 'mismatch' : 'verified',
    givenName: parsed.givenName, familyName: parsed.familyName,
    birthDate: parsed.birthDate, countryCode: normCountry(parsed.nationality),
    team: team ? { teamName: team.teamName, teamCode: team.teamCode } : null,
    evidenceSha256: page.sha256,
    ...(Object.keys(checks).length ? { checks } : {}),
  };
}

export async function verifyRiders(riders, { collector, year } = {}) {
  if (!Array.isArray(riders) || !riders.length) throw new Error('La lista de corredores debe ser un array no vacío.');
  const col = collector || new Collector({ directory: null });
  const results = [];
  for (const entry of riders) {
    if (!entry || typeof entry !== 'object') throw new Error('Cada entrada debe ser un objeto con uciProfileId.');
    if (!/^\d+$/.test(String(entry.uciProfileId ?? ''))) {
      results.push({ dorsal: entry?.dorsal ?? null, uciProfileId: entry?.uciProfileId ?? null, status: 'missing-id' });
      continue;
    }
    try {
      const page = await col.get(`/rider-details/${entry.uciProfileId}`);
      results.push(summarizeRider(entry, parseRider(page.text), page, { year }));
    } catch (error) {
      if (error.message === 'uci_http_404') {
        results.push({ dorsal: entry.dorsal ?? null, uciProfileId: entry.uciProfileId, status: 'not-found' });
        continue;
      }
      error.results = results;
      throw error;
    }
  }
  return results;
}

function main() {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : null; };
  const input = arg('in');
  if (!input || process.argv.length > 7) throw new Error('Uso: rider-verify.mjs --in verificaciones.json [--out resultado.json] [--year AÑO].');
  const source = JSON.parse(readFileSync(input, 'utf8'));
  if (!Array.isArray(source.riders)) throw new Error('El archivo de entrada debe contener un array "riders".');
  const year = arg('year') || source.year || null;
  const run = async () => {
    const collector = new Collector({ directory: null });
    const results = await verifyRiders(source.riders, { collector, year });
    return {
      verifiedAt: new Date().toISOString(),
      ...(source.raceId ? { raceId: source.raceId } : {}),
      ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
      ...(year ? { year } : {}),
      results,
      stats: collector.stats,
    };
  };
  run().then(report => {
    const out = arg('out');
    if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }).catch(error => {
    if (error.results?.length) process.stdout.write(`${JSON.stringify(error.results, null, 2)}\n`);
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
