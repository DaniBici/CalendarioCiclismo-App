#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const take = name => { const index = args.indexOf(name); if (index < 0) return null;
  const value = args[index + 1]; if (!value) throw new Error(`Falta valor para ${name}`);
  args.splice(index, 2); return value; };
const planFile = resolve(take('--plan') || '');
const mode = take('--mode');
const batch = take('--batch');
const year = Number(take('--year'));
const kind = take('--kind');
const offset = Number(take('--offset') || 0);
const limit = Number(take('--limit') || 0);
if (!planFile || !mode || !batch || args.length) throw new Error('Argumentos inválidos');
const plan = JSON.parse(await readFile(planFile, 'utf8'));
if (!plan.complete || !plan.applyAllowed || !/^historical-identities-2020-2025-[0-9]{8}(?:-[a-z0-9-]+)?$/.test(batch)) {
  throw new Error('Plan o lote inválido');
}
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const text = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;

const manifest = { version: plan.version, complete: plan.complete, scope: plan.scope,
  applyAllowed: plan.applyAllowed, sourceHash: plan.sourceHash, year, summary: plan.summary };
if (mode === 'begin') {
  process.stdout.write(`select private.begin_historical_identity_batch(${text(batch)},${literal(manifest)});\n`);
} else if (mode === 'chunk') {
  const rows = (plan[kind] || []).filter(item => item.year === year).slice(offset, offset + limit);
  if (!rows.length || !['teams','riders','rosters'].includes(kind)) throw new Error('Chunk vacío o tipo inválido');
  const payloads = { teams: [], riders: [], rosters: [], [kind]: rows };
  process.stdout.write(`select private.apply_historical_identity_chunk(${text(batch)},${literal(payloads.teams)},${literal(payloads.riders)},${literal(payloads.rosters)});\n`);
} else if (mode === 'affiliations') {
  const rows = plan.affiliations.filter(item => item.year === year);
  if (!rows.length) process.stdout.write('select true as no_affiliations;\n');
  else process.stdout.write(rows.map(item => `select private.upsert_historical_affiliation(${[
    batch,item.riderProfile,item.gender,item.teamId,item.teamProfile,item.year,item.type,item.dateFrom,item.dateTo,
    item.dateFromPrecision,item.dateToPrecision,item.sourceUrl,item.verifiedAt,
  ].map(text).join(',')},${literal(item.evidence)});`).join('\n') + '\n');
} else if (mode === 'finish') {
  process.stdout.write(`select private.finish_historical_identity_batch(${text(batch)});\n`);
} else if (mode === 'pilot') {
  const movementProfiles = new Set(plan.affiliations.map(item => `${item.year}:${item.riderProfile}`));
  const exceptionProfiles = new Set(['2020:496008','2021:348452','2021:896246','2020:1025745','2021:1025745']);
  const selectedRiders = plan.riders.filter(item => movementProfiles.has(`${item.year}:${item.profile}`)
    || exceptionProfiles.has(`${item.year}:${item.profile}`) || item.country === 'xx');
  for (const y of [2020,2021,2022,2023,2024,2025]) for (const gender of ['male','female']) {
    const rider = plan.riders.find(item => item.year === y && item.gender === gender);
    if (rider && !selectedRiders.includes(rider)) selectedRiders.push(rider);
  }
  const selectedRiderKeys = new Set(selectedRiders.map(item => `${item.year}:${item.profile}`));
  const selectedRosters = plan.rosters.filter(item => selectedRiderKeys.has(`${item.year}:${item.riderProfile}`));
  const teamKeys = new Set(selectedRosters.map(item => `${item.year}:${item.teamProfile}`));
  plan.affiliations.forEach(item => teamKeys.add(`${item.year}:${item.teamProfile}`));
  const emptyTeam = plan.teams.find(item => item.year === 2021 && item.profile === '15371');
  if (emptyTeam) teamKeys.add(`${emptyTeam.year}:${emptyTeam.profile}`);
  for (const item of plan.teams.filter(team => teamKeys.has(`${team.year}:${team.profile}`) && team.continuity === 'same_matrix')) {
    const prerequisite = plan.teams.find(team => team.teamId === item.teamId && team.continuity === 'new_matrix');
    if (prerequisite) teamKeys.add(`${prerequisite.year}:${prerequisite.profile}`);
  }
  const selectedTeams = plan.teams.filter(item => teamKeys.has(`${item.year}:${item.profile}`));
  const pilotManifest = { ...manifest, pilot: true, cases: selectedTeams.length + selectedRiders.length
    + selectedRosters.length + plan.affiliations.length };
  const affiliations = plan.affiliations.map(item => `perform private.upsert_historical_affiliation(${[
    batch,item.riderProfile,item.gender,item.teamId,item.teamProfile,item.year,item.type,item.dateFrom,item.dateTo,
    item.dateFromPrecision,item.dateToPrecision,item.sourceUrl,item.verifiedAt,
  ].map(text).join(',')},${literal(item.evidence)});`).join('\n');
  process.stdout.write(`begin;
select private.begin_historical_identity_batch(${text(batch)},${literal(pilotManifest)});
select private.apply_historical_identity_chunk(${text(batch)},${literal(selectedTeams)},${literal(selectedRiders)},${literal([])});
select private.apply_historical_identity_chunk(${text(batch)},${literal([])},${literal([])},${literal(selectedRosters)});
do $pilot$ begin
${affiliations}
end $pilot$;
select private.finish_historical_identity_batch(${text(batch)});
select jsonb_build_object(
  'batch',${text(batch)},
  'teams',(select count(*) from private.historical_identity_changes where "batchId"=${text(batch)} and entity='team-season'),
  'riders',(select count(*) from private.historical_identity_changes where "batchId"=${text(batch)} and entity='rider-profile'),
  'rosters',(select count(*) from private.historical_team_roster_observations where "batchId"=${text(batch)}),
  'affiliations',(select count(*) from private.historical_identity_changes where "batchId"=${text(batch)} and entity in ('regular-affiliation','trainee-affiliation')),
  'monthPrecision',(select count(*) from public.rider_team_affiliations where source='historical_verified' and ('month'=any(array["dateFromPrecision","dateToPrecision"]))),
  'trainees',(select count(*) from public.rider_team_affiliations where source='historical_verified' and "affiliationType"='trainee'),
  'currentState',private.historical_current_state(),
  'historicalVisibleToLegacyPolicies',(select count(*) from public.teams where coalesce("historicalCatalogOnly",false)=false and id like 'uci-hist-%')
) as pilot_report;
rollback;\n`);
} else throw new Error('Modo inválido');
