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
const continuityFile = take('--continuity');
const outputFile = take('--out');
const catalogFiles = args.map(file => resolve(file));
if (!continuityFile || !outputFile || catalogFiles.length < 2) {
  throw new Error('Uso: build-team-continuity-repair.mjs --continuity JSON --out JSON DB-CATALOG...');
}

const continuity = validateTeamContinuityReport(JSON.parse(await readFile(continuityFile, 'utf8')));
const catalogs = await Promise.all(catalogFiles.map(async file => JSON.parse(await readFile(file, 'utf8'))));
const catalog = catalogs.flatMap(file => file.catalog.map(row => ({ ...row, year: file.year })));
const bySeasonProfile = new Map(catalog.map(row => [`${row.year}:${row.gender}:${row.profile}`, row]));
const mappings = [], seasons = [], pending = [...(continuity.pending || [])];
const mappedSources = new Map();

const prepared = continuity.groups.map(group => {
  const rows = group.members.map(member => bySeasonProfile.get(`${member.year}:${member.gender}:${member.profile}`));
  if (rows.some(row => !row)) throw new Error(`catalog_row_missing:${group.proposedTeamId}`);
  return { group, rows };
});
const parent = prepared.map((_, index) => index);
const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]));
const union = (left, right) => { const a = find(left), b = find(right); if (a !== b) parent[b] = a; };
const groupsByExistingId = new Map();
prepared.forEach((item, index) => item.rows.forEach(row => {
  const indexes = groupsByExistingId.get(row.teamId) || [];
  indexes.push(index); groupsByExistingId.set(row.teamId, indexes);
}));
for (const indexes of groupsByExistingId.values()) for (const index of indexes.slice(1)) union(indexes[0], index);
const components = new Map();
prepared.forEach((item, index) => {
  const root = find(index), component = components.get(root) || [];
  component.push(item); components.set(root, component);
});

for (const component of components.values()) {
  const members = component.flatMap(item => item.group.members)
    .sort((a, b) => a.year - b.year || a.profile.localeCompare(b.profile));
  const rows = component.flatMap(item => item.rows)
    .sort((a, b) => a.year - b.year || a.profile.localeCompare(b.profile));
  if (new Set(members.map(member => member.year)).size !== members.length
    || new Set(members.map(member => member.gender)).size !== 1) {
    pending.push({ id: `component:${component[0].group.proposedTeamId}`, status: 'pending',
      reason: 'existing_catalog_component_conflict', members });
    rows.forEach((row, index) => seasons.push({ ...members[index], currentTeamId: row.teamId,
      targetTeamId: null, status: 'pending' }));
    continue;
  }
  const ids = [...new Set(rows.map(row => row.teamId))];
  const activeIds = [...new Set(rows.filter(row => row.historicalCatalogOnly === false).map(row => row.teamId))];
  if (activeIds.length > 1) {
    pending.push({ id: `component:${component[0].group.proposedTeamId}`, status: 'pending',
      reason: 'multiple_active_catalog_identities', teamIds: activeIds, members });
    rows.forEach((row, index) => seasons.push({ ...members[index], currentTeamId: row.teamId,
      targetTeamId: null, status: 'pending' }));
    continue;
  }
  const targetTeamId = activeIds[0] || rows[0].teamId;
  rows.forEach((row, index) => seasons.push({ ...members[index], currentTeamId: row.teamId,
    targetTeamId, status: 'reparable', continuityBasis: component.length > 1
      ? 'existing_catalog_identity_and_mutual_uci_roster_continuity'
      : component[0].group.continuityBasis }));
  for (const sourceTeamId of ids.filter(id => id !== targetTeamId)) {
    if (mappedSources.has(sourceTeamId) && mappedSources.get(sourceTeamId) !== targetTeamId) {
      throw new Error(`source_team_multiple_targets:${sourceTeamId}`);
    }
    mappedSources.set(sourceTeamId, targetTeamId);
    mappings.push({ sourceTeamId, targetTeamId, gender: members[0].gender,
      sourceNames: rows.filter(row => row.teamId === sourceTeamId).map(row => row.sourceName),
      targetName: rows.at(-1).sourceName,
      seasons: members.map(member => member.year),
      evidence: component.flatMap(item => item.group.evidence || []) });
  }
}

const report = { version: 1, complete: true, scope: 'team-continuity-2020-2026',
  generatedAt: new Date().toISOString(),
  sources: { continuityFile, catalogFiles },
  controls: { teamSeasons: seasons.length,
    uniqueCurrentTeamIds: new Set(seasons.map(row => row.currentTeamId)).size,
    uniqueTargetTeamIds: new Set(seasons.filter(row => row.targetTeamId).map(row => row.targetTeamId)).size,
    mappings: mappings.length,
    maleMappings: mappings.filter(row => row.gender === 'male').length,
    femaleMappings: mappings.filter(row => row.gender === 'female').length,
    developmentSeasons: seasons.filter(row => row.structureKind === 'development').length,
    pending: pending.length },
  mappings, seasons, pending };
await mkdir(dirname(outputFile), { recursive: true });
const temporaryFile = `${outputFile}.tmp-${process.pid}`;
await writeFile(temporaryFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryFile, outputFile);
process.stdout.write(`${JSON.stringify(report.controls)}\n`);
