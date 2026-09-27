#!/usr/bin/env node
import { gunzipSync } from 'node:zlib';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseUciTeamRoster } from '../results-fetchers/uci-team-roster.mjs';

const file = resolve(process.argv[2] || '');
if (!file.endsWith('/snapshot.json')) throw new Error('Uso: enrich-historical-cache.mjs RUTA/snapshot.json');
const directory = file.slice(0, -'/snapshot.json'.length);
const snapshot = JSON.parse(await readFile(file, 'utf8'));
for (const team of snapshot.teams) {
  const html = gunzipSync(await readFile(`${directory}/${team.sha256}.gz`)).toString('utf8');
  const roster = parseUciTeamRoster(html);
  if (roster.details?.teamCode !== team.teamCode || roster.details?.teamName !== team.teamName) {
    throw new Error(`historical_cached_team_mismatch:${team.uciTeamProfileId}`);
  }
  team.rosterStatus = roster.regular.length ? 'published' : 'empty_at_source';
  team.sourceWebsite = roster.details?.website?.url || null;
  team.jerseyUrl = roster.details?.pictureTeamJersey || null;
}
await writeFile(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
await rename(`${file}.tmp`, file);
console.log(JSON.stringify({ year: snapshot.year, teams: snapshot.teams.length,
  emptySourceRosters: snapshot.teams.filter(team => team.rosterStatus === 'empty_at_source').length,
  missingJerseyUrls: snapshot.teams.filter(team => !team.jerseyUrl).length }));
