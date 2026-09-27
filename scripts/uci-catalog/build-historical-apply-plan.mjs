#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { applyHistoricalExceptions, validateHistoricalMovementDecisions, validateHistoricalSnapshot } from './historical.mjs';
import { normalizeSnapshot } from './planner.mjs';
import { countryCode } from './countries.mjs';
import { CATEGORIES, sha256 } from './source.mjs';
import { buildPreferredTeamWordCase, normalizeTeamDisplayName } from './team-name-case.mjs';

const args = process.argv.slice(2);
const take = name => { const index = args.indexOf(name); if (index < 0) return null;
  const value = args[index + 1]; if (!value) throw new Error(`Falta valor para ${name}`);
  args.splice(index, 2); return resolve(value); };
const exceptionsFile = take('--exceptions');
const movementsFile = take('--movements');
const continuityFile = take('--continuity');
const currentFile = take('--current');
const outputFile = take('--out');
if (!exceptionsFile || !movementsFile || !continuityFile || !currentFile || !outputFile || args.length !== 6) {
  throw new Error('Uso: build-historical-apply-plan.mjs --exceptions JSON --movements JSON --continuity JSON --current JSON --out JSON SNAPSHOT...');
}
const [exceptions, movements, continuity, current, ...snapshots] = await Promise.all([
  exceptionsFile, movementsFile, continuityFile, currentFile, ...args.map(file => resolve(file)),
].map(async file => JSON.parse(await readFile(file, 'utf8'))));
const materialized = snapshots.map(snapshot => applyHistoricalExceptions(snapshot, exceptions))
  .sort((a, b) => a.year - b.year);
materialized.forEach(snapshot => validateHistoricalSnapshot(snapshot));
const movementCandidates = materialized.flatMap(snapshot => {
  const normalized = normalizeSnapshot(snapshot);
  return Object.entries(normalized.records).filter(([, record]) => record.regular.length > 1
    || record.regular.some(team => record.trainees.includes(team)))
    .map(([profile, record]) => ({ year: snapshot.year, profile, regular: record.regular, trainees: record.trainees }));
});
validateHistoricalMovementDecisions(movementCandidates, movements);

const httpsEvidence = (check, summary) => {
  const url = [check?.finalUrl, check?.url].find(value => /^https:\/\/[^/ ]+\//.test(value || ''));
  return url ? [{ url, externalToUci: true, consultedAt: check.checkedAt || check.consultedAt,
    summary }] : null;
};
const teamDecision = new Map();
for (const group of continuity.groups) {
  const verifiedEvidence = group.status === 'verified_same_matrix'
    ? httpsEvidence(group.externalCheck, `La web externa confirma la continuidad de ${group.members.map(item => item.year).join(', ')}.`) : null;
  const shared = Boolean(verifiedEvidence);
  for (const member of group.members) {
    const key = `${member.year}:${member.profile}`;
    teamDecision.set(key, { teamId: shared ? group.proposedTeamId : `uci-hist-${member.gender}-${member.year}-${member.profile}`,
      continuity: shared ? (member === group.members[0] ? 'new_matrix' : 'same_matrix') : 'new_matrix',
      evidence: shared ? verifiedEvidence : [{ url: member.sourceUrl, externalToUci: false,
        consultedAt: materialized.find(item => item.year === member.year).completedAt,
        summary: 'La ficha UCI identifica la entidad de esta temporada; no se presume continuidad externa.' }] });
  }
}
for (const match of current.decisions.filter(item => item.verified)) {
  const evidence = httpsEvidence(match, `La web externa y la coincidencia única de nombre y código confirman la continuidad entre 2025 y 2026.`);
  if (!evidence) continue;
  const historical = teamDecision.get(`2025:${match.profile}`);
  if (!historical) throw new Error('missing_2025_team_decision');
  const group = continuity.groups.find(item => item.members.some(member => member.year === 2025 && member.profile === match.profile));
  const members = group?.status === 'verified_same_matrix' ? group.members : group.members.filter(member => member.year === 2025);
  for (const member of members) teamDecision.set(`${member.year}:${member.profile}`,
    { teamId: match.teamId, continuity: 'same_matrix', evidence });
}

const teams = [], riders = [], rosters = [];
const preferredTeamCase = buildPreferredTeamWordCase(
  materialized.flatMap(snapshot => snapshot.teams.map(team => team.teamName)),
);
for (const snapshot of materialized) {
  const normalized = normalizeSnapshot(snapshot);
  for (const team of snapshot.teams) {
    const decision = teamDecision.get(`${snapshot.year}:${team.uciTeamProfileId}`);
    const category = CATEGORIES[team.categoryName]?.[1];
    const country = countryCode(team.countryCode) || (team.teamName.trim() === 'WCC TEAM' ? 'ch' : null);
    if (!decision || !category || !country) throw new Error(`historical_team_plan_invalid:${snapshot.year}:${team.uciTeamProfileId}:${team.categoryName}:${team.countryCode}`);
    teams.push({ year: snapshot.year, profile: String(team.uciTeamProfileId), teamId: decision.teamId,
      continuity: decision.continuity,
      name: normalizeTeamDisplayName(team.teamName, { preferredCase: preferredTeamCase }), code: team.teamCode,
      gender: team.gender, category, country, evidence: decision.evidence, appearance: null });
  }
  for (const [profile, record] of Object.entries(normalized.records)) {
    if (!record.bio) throw new Error('historical_rider_bio_missing');
    const exception = exceptions.find(item => (item.year === snapshot.year || item.appliesToYears?.includes(snapshot.year))
      && String(item.uciProfileId) === profile);
    const evidence = exception?.evidence || [{ url: `https://www.uci.org/rider-details/${profile}`,
      externalToUci: false, consultedAt: snapshot.completedAt,
      summary: 'La ficha individual UCI aporta nombre, nacionalidad y nacimiento.' }];
    riders.push({ year: snapshot.year, profile, gender: record.gender, riderId: null,
      firstName: record.bio.firstName.trim(), lastName: record.bio.lastName.trim(),
      country: record.bio.nationality, birthDate: record.bio.birthDate, uciLicenseId: null, evidence });
  }
  for (const team of snapshot.teams) for (const rider of team.riders) {
    rosters.push({ year: snapshot.year, teamProfile: String(team.uciTeamProfileId),
      riderProfile: String(rider.uciProfileId), gender: team.gender, type: rider.affiliationType,
      sourceHash: team.sha256, observedAt: snapshot.completedAt });
  }
}
const teamIdBySeasonProfile = new Map(teams.map(item => [`${item.year}:${item.profile}`, item.teamId]));
const affiliations = movements.decisions.flatMap(decision => decision.affiliations.map(affiliation => {
  const teamId = teamIdBySeasonProfile.get(`${decision.year}:${affiliation.uciTeamProfileId}`);
  if (!teamId) throw new Error(`historical_movement_target_missing:${decision.year}:${decision.uciRiderProfileId}`);
  return { year: decision.year, riderProfile: String(decision.uciRiderProfileId),
    gender: riders.find(item => item.year === decision.year && item.profile === String(decision.uciRiderProfileId)).gender,
    teamProfile: String(affiliation.uciTeamProfileId), teamId, type: affiliation.type,
    dateFrom: affiliation.dateFrom, dateTo: affiliation.dateTo,
    dateFromPrecision: affiliation.dateFromPrecision, dateToPrecision: affiliation.dateToPrecision,
    sourceUrl: decision.evidence.find(item => item.externalToUci)?.url,
    verifiedAt: decision.resolvedAt || decision.evidence.find(item => item.externalToUci)?.consultedAt || movements.generatedAt,
    evidence: decision.evidence };
}));
const inputs = { snapshots: materialized.map(snapshot => ({ year: snapshot.year,
  manifestHash: normalizeSnapshot(snapshot).manifestHash })), exceptions, movements,
  continuitySummary: continuity.summary, currentSummary: current.summary };
const plan = { version: 1, complete: true, scope: '2020-2025', applyAllowed: true,
  generatedAt: new Date().toISOString(), sourceHash: sha256(inputs), inputs,
  summary: { teamSeasons: teams.length, riderSeasons: riders.length, rosterObservations: rosters.length,
    affiliations: affiliations.length,
    uniqueTeamIds: new Set(teams.map(item => item.teamId)).size,
    sameMatrixTeamSeasons: teams.filter(item => item.continuity === 'same_matrix').length,
    newMatrixTeamSeasons: teams.filter(item => item.continuity === 'new_matrix').length },
  teams, riders, rosters, affiliations };
await mkdir(dirname(outputFile), { recursive: true });
const temporaryFile = `${outputFile}.tmp-${process.pid}`;
await writeFile(temporaryFile, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await rename(temporaryFile, outputFile);
process.stdout.write(`${JSON.stringify({ sourceHash: plan.sourceHash, ...plan.summary })}\n`);
