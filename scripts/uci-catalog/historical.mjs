import { readFile } from 'node:fs/promises';
import { CATEGORIES_BY_YEAR, sha256 } from './source.mjs';
import { normalizeSnapshot } from './planner.mjs';

export const HISTORICAL_TEAM_COUNTS = Object.freeze({
  2020: Object.freeze({ CTM: 170, CTW: 46, PRT: 19, WTT: 19, WTW: 8 }),
  2021: Object.freeze({ CTM: 161, CTW: 51, PRT: 19, WTT: 19, WTW: 9 }),
  2022: Object.freeze({ CTM: 177, CTW: 49, PRT: 16, WTT: 18, WTW: 14 }),
  2023: Object.freeze({ CTM: 175, CTW: 59, PRT: 18, WTT: 18, WTW: 15 }),
  2024: Object.freeze({ CTM: 178, CTW: 56, PRT: 17, WTT: 18, WTW: 15 }),
  2025: Object.freeze({ CTM: 169, CTW: 35, PRT: 17, PRW: 7, WTT: 18, WTW: 15 }),
});

const countBy = values => values.reduce((out, value) => ({ ...out, [value]: (out[value] || 0) + 1 }), {});
const sameObject = (left, right) => sha256(left) === sha256(right);
const validExternalWebsite = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !['http', 'https'].includes(url.hostname.toLowerCase());
  } catch { return false; }
};

export function applyHistoricalExceptions(snapshot, exceptions = []) {
  const corrected = structuredClone(snapshot);
  const byProfile = new Map(exceptions.filter(item => item?.year === snapshot?.year
    || item?.appliesToYears?.includes(snapshot?.year)).map(item => [String(item.uciProfileId), item]));
  const used = [...(corrected.externalExceptions || [])];
  for (const [profile, exception] of byProfile) {
    const rider = corrected.riders.find(item => String(item.uciProfileId) === profile);
    if (!rider || exception.status !== 'resolved' || !exception.identityOverride
      || normalizedName(rider.givenName) !== normalizedName(exception.givenName)
      || normalizedName(rider.familyName) !== normalizedName(exception.familyName)
      || !/^\d{4}-\d{2}-\d{2}$/.test(exception.birthDate || '') || !/^[A-Z]{3}$/.test(exception.nationality || '')
      || !(exception.evidence || []).some(item => item.externalToUci === true && item.consultedAt
        && item.summary && /^https:\/\/[^/ ]+\//.test(item.url || ''))) {
      continue;
    }
    rider.givenName = exception.givenName;
    rider.familyName = exception.familyName;
    rider.nationality = exception.nationality;
    rider.birthDate = exception.birthDate;
    rider.sha256 = sha256({ source: rider.sha256, identityOverride: exception });
    used.push(exception);
  }
  for (const error of corrected.errors || []) {
    const exception = byProfile.get(String(error.uciProfileId));
    if (!exception || error.code !== 'uci_http_404' || !exception.givenName || !exception.familyName
      || !['resolved', 'pending'].includes(exception.status)
      || (exception.status === 'resolved' && (!/^\d{4}-\d{2}-\d{2}$/.test(exception.birthDate || '')
        || !/^[A-Z]{3}$/.test(exception.nationality || '')))) {
      throw new Error('historical_profile_errors');
    }
    const rosterRows = corrected.teams.flatMap(team => team.riders).filter(rider => String(rider.uciProfileId) === String(error.uciProfileId));
    if (!rosterRows.length || rosterRows.some(rider => normalizedName(rider.givenName) !== normalizedName(exception.givenName)
      || normalizedName(rider.familyName) !== normalizedName(exception.familyName) || rider.countryCode !== exception.nationality)) {
      throw new Error('historical_exception_roster_mismatch');
    }
    const evidence = exception.evidence || [];
    const hosts = new Set(evidence.filter(item => item.externalToUci === true && item.consultedAt && item.summary)
      .map(item => { try { return new URL(item.url).hostname; } catch { return null; } }).filter(Boolean));
    if (hosts.size < 2) throw new Error('historical_exception_evidence_insufficient');
    if (exception.status === 'resolved') corrected.riders.push({ uciProfileId: String(error.uciProfileId),
      givenName: exception.givenName, familyName: exception.familyName, nationality: exception.nationality,
      birthDate: exception.birthDate, headerTeam: null, history: [], sha256: sha256(evidence), externalException: true });
    used.push(exception);
  }
  corrected.errors = [];
  corrected.externalExceptions = used;
  return corrected;
}

export function validateHistoricalSnapshot(snapshot, exceptions = []) {
  snapshot = applyHistoricalExceptions(snapshot, exceptions);
  const year = Number(snapshot?.year);
  const expected = HISTORICAL_TEAM_COUNTS[year];
  if (!expected || snapshot?.version !== 1 || snapshot?.complete !== true) throw new Error('invalid_historical_snapshot');
  if (!sameObject(countBy(snapshot.teams.map(team => team.categoryName)), expected)) throw new Error('historical_team_counts_mismatch');
  if (snapshot.teams.length !== Object.values(expected).reduce((sum, count) => sum + count, 0)) throw new Error('historical_team_total_mismatch');
  if (snapshot.teams.some(team => team.jerseyUrl != null && !/^https:\/\/[^/ ]+\//.test(team.jerseyUrl))) {
    throw new Error('historical_invalid_jersey_url');
  }
  if (snapshot.teams.some(team => team.sourceWebsite != null && !validExternalWebsite(team.sourceWebsite))) {
    throw new Error('historical_invalid_team_website');
  }
  if (!sameObject([...new Set(snapshot.teams.map(team => team.categoryName))].sort(), [...CATEGORIES_BY_YEAR[year]].sort())) {
    throw new Error('historical_categories_mismatch');
  }

  const teamIds = snapshot.teams.map(team => String(team.uciTeamProfileId));
  const riderIds = [...new Set(snapshot.teams.flatMap(team => team.riders.map(rider => String(rider.uciProfileId))))].sort();
  const exceptionIds = new Set((snapshot.externalExceptions || []).filter(item => !item.identityOverride)
    .map(item => String(item.uciProfileId)));
  const pendingIds = new Set((snapshot.externalExceptions || []).filter(item => item.status === 'pending')
    .map(item => String(item.uciProfileId)));
  const coveredRiderIds = riderIds.filter(id => !pendingIds.has(id));
  if (new Set(teamIds).size !== teamIds.length) throw new Error('historical_duplicate_team');
  if (snapshot.riders.length !== coveredRiderIds.length
    || !sameObject(snapshot.riders.map(rider => String(rider.uciProfileId)).sort(), coveredRiderIds)) {
    throw new Error('historical_rider_coverage_mismatch');
  }

  const paths = countBy((snapshot.manifest || []).map(item => item.path));
  const indexNumbers = Object.keys(paths).map(path => new RegExp(`^/api/teams/ROA/${year}\\?page=(\\d+)$`).exec(path))
    .filter(Boolean).map(match => Number(match[1])).sort((a, b) => a - b);
  const indexPages = indexNumbers.at(-1);
  if (!indexPages || !sameObject(indexNumbers, Array.from({ length: indexPages }, (_, index) => index + 1))) {
    throw new Error('historical_index_manifest_mismatch');
  }
  for (let page = 1; page <= indexPages; page++) {
    if (paths[`/api/teams/ROA/${year}?page=${page}`] !== 2) throw new Error('historical_index_manifest_mismatch');
  }
  if (teamIds.some(id => paths[`/team-details/${id}`] !== 1)) throw new Error('historical_team_manifest_mismatch');
  if (riderIds.some(id => paths[`/rider-details/${id}`] !== (exceptionIds.has(id) ? undefined : 1))) {
    throw new Error('historical_rider_manifest_mismatch');
  }
  if (Object.keys(paths).length !== indexPages + teamIds.length + riderIds.length - exceptionIds.size) {
    throw new Error('historical_unexpected_manifest_path');
  }
  for (const item of snapshot.manifest) {
    if (item.status !== 200 || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isInteger(item.bytes) || item.bytes < 1) {
      throw new Error('historical_invalid_manifest_item');
    }
  }

  const normalized = normalizeSnapshot(snapshot);
  const records = Object.values(normalized.records);
  if (records.some(record => !record.bio?.firstName || !record.bio?.lastName
    || !/^\d{4}-\d{2}-\d{2}$/.test(record.bio?.birthDate || '') || !/^[a-z]{2}$/.test(record.bio?.nationality || ''))) {
    throw new Error('historical_rider_biography_incomplete');
  }
  return {
    year,
    teams: snapshot.teams.length,
    riders: riderIds.length,
    categories: expected,
    regularTraineeConflicts: records.filter(record => record.regular.some(team => record.trainees.includes(team))).length,
    identityConflicts: records.filter(record => record.conflict).length,
    externalProfileExceptions: exceptionIds.size,
    unresolvedProfileExceptions: pendingIds.size,
    emptySourceRosters: snapshot.teams.filter(team => team.rosterStatus === 'empty_at_source').length,
    missingJerseyUrls: snapshot.teams.filter(team => !team.jerseyUrl).length,
    manifestEntries: snapshot.manifest.length,
    manifestHash: normalized.manifestHash,
  };
}

export async function validateHistoricalFiles(files, exceptions = []) {
  if (files.length !== 6) throw new Error('historical_year_set_mismatch');
  const summaries = [];
  for (const file of files) summaries.push(validateHistoricalSnapshot(JSON.parse(await readFile(file, 'utf8')), exceptions));
  summaries.sort((a, b) => a.year - b.year);
  if (!sameObject(summaries.map(item => item.year), [2020, 2021, 2022, 2023, 2024, 2025])) throw new Error('historical_year_set_mismatch');
  return { version: 1, complete: true, years: summaries, teams: summaries.reduce((sum, item) => sum + item.teams, 0),
    uniqueRiderSeasons: summaries.reduce((sum, item) => sum + item.riders, 0) };
}

const normalizedName = value => String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function validateHistoricalMovementDecisions(movementCandidates, movementFile) {
  const decisions = movementFile?.decisions || [];
  if (movementFile?.version !== 1 || movementFile?.complete !== true || !Array.isArray(decisions)) {
    throw new Error('historical_movement_file_invalid');
  }
  const expected = new Map(movementCandidates.map(candidate => [`${candidate.year}:${candidate.profile}`, candidate]));
  const seen = new Set();
  for (const decision of decisions) {
    const key = `${decision.year}:${decision.uciRiderProfileId}`;
    const candidate = expected.get(key);
    if (!candidate || seen.has(key) || decision.status !== 'resolved' || !Array.isArray(decision.affiliations)
      || decision.affiliations.length < 1 || !Array.isArray(decision.evidence) || decision.evidence.length < 1) {
      throw new Error('historical_movement_decision_invalid');
    }
    const sourceProfiles = new Set([...candidate.regular, ...candidate.trainees]);
    if (decision.affiliations.some(item => !sourceProfiles.has(String(item.uciTeamProfileId))
      || !['regular', 'trainee'].includes(item.type)
      || !['day', 'month', 'year', 'unknown'].includes(item.dateFromPrecision)
      || !['day', 'month', 'year', 'unknown'].includes(item.dateToPrecision)
      || (item.dateFrom && !String(item.dateFrom).startsWith(`${decision.year}-`))
      || (item.dateTo && !String(item.dateTo).startsWith(`${decision.year}-`))
      || (item.dateFrom && item.dateTo && item.dateFrom > item.dateTo))) {
      throw new Error('historical_movement_affiliation_invalid');
    }
    if (!decision.evidence.some(item => item.externalToUci === true && item.consultedAt
      && item.summary && /^https:\/\/[^/ ]+\//.test(item.url || ''))) {
      throw new Error('historical_movement_evidence_insufficient');
    }
    seen.add(key);
  }
  const unresolved = [...expected.keys()].filter(key => !seen.has(key));
  return { candidates: expected.size, resolved: seen.size, unresolved: unresolved.length, unresolvedKeys: unresolved };
}

export function analyzeHistoricalSnapshots(snapshots, exceptions = [], movementFile = null) {
  const materialized = snapshots.map(snapshot => applyHistoricalExceptions(snapshot, exceptions));
  const validated = materialized.map(snapshot => validateHistoricalSnapshot(snapshot));
  if (!sameObject(validated.map(item => item.year).sort(), [2020, 2021, 2022, 2023, 2024, 2025])) {
    throw new Error('historical_year_set_mismatch');
  }
  const teams = materialized.flatMap(snapshot => snapshot.teams.map(team => ({ year: snapshot.year,
    profile: String(team.uciTeamProfileId), name: team.teamName, normalizedName: normalizedName(team.teamName),
    code: team.teamCode, gender: team.gender, category: team.categoryName, country: team.countryCode,
    sourceWebsite: team.sourceWebsite || null, jerseyUrl: team.jerseyUrl || null })));
  const candidates = new Map();
  const addCandidate = (key, reason, team) => {
    const candidate = candidates.get(key) || { key, reason, entries: [] };
    candidate.entries.push(team); candidates.set(key, candidate);
  };
  for (const team of teams) {
    addCandidate(`code:${team.gender}:${team.code}`, 'shared_code_needs_external_evidence', team);
    addCandidate(`name:${team.gender}:${team.normalizedName}`, 'shared_name_needs_external_evidence', team);
    if (team.sourceWebsite) {
      try {
        const website = new URL(team.sourceWebsite);
        const host = website.hostname.toLowerCase().replace(/^www[.]/, '');
        addCandidate(`website:${team.gender}:${host}`, 'shared_external_website_candidate', team);
      } catch { /* URL inválida: la validación de decisiones no la aceptará como evidencia. */ }
    }
  }
  const continuityCandidates = [...candidates.values()].filter(candidate => {
    candidate.entries.sort((a, b) => a.year - b.year || a.profile.localeCompare(b.profile));
    return new Set(candidate.entries.map(entry => entry.profile)).size > 1;
  }).map(candidate => ({ ...candidate,
    sameYearCollision: new Set(candidate.entries.map(entry => entry.year)).size !== candidate.entries.length,
    nameChanged: new Set(candidate.entries.map(entry => entry.normalizedName)).size > 1,
    codeChanged: new Set(candidate.entries.map(entry => entry.code)).size > 1,
  })).sort((a, b) => a.key.localeCompare(b.key));

  const riders = new Map();
  const movementCandidates = [];
  for (const snapshot of materialized) {
    const normalized = normalizeSnapshot(snapshot);
    for (const [profile, record] of Object.entries(normalized.records)) {
      const aggregate = riders.get(profile) || { profile, genders: new Set(), biographies: new Map(), seasons: [] };
      aggregate.genders.add(record.gender);
      if (record.bio) aggregate.biographies.set(sha256(record.bio), record.bio);
      aggregate.seasons.push({ year: snapshot.year, regular: record.regular, trainees: record.trainees, conflict: record.conflict });
      riders.set(profile, aggregate);
      if (record.regular.length > 1 || record.regular.some(team => record.trainees.includes(team))) {
        movementCandidates.push({ year: snapshot.year, profile, regular: record.regular, trainees: record.trainees,
          reason: record.regular.length > 1 ? 'multiple_regular_rosters' : 'regular_and_trainee_same_team' });
      }
    }
  }
  const riderIdentityConflicts = [...riders.values()].filter(rider => rider.genders.size > 1 || rider.biographies.size > 1)
    .map(rider => ({ profile: rider.profile, genders: [...rider.genders], biographies: [...rider.biographies.values()],
      seasons: rider.seasons })).sort((a, b) => a.profile.localeCompare(b.profile));
  const movementResolution = movementFile
    ? validateHistoricalMovementDecisions(movementCandidates, movementFile)
    : { candidates: movementCandidates.length, resolved: 0, unresolved: movementCandidates.length,
      unresolvedKeys: movementCandidates.map(candidate => `${candidate.year}:${candidate.profile}`) };
  return { version: 1, complete: movementResolution.unresolved === 0, summary: { teamSeasons: teams.length, uniqueRiderProfiles: riders.size,
    continuityCandidates: continuityCandidates.length, riderIdentityConflicts: riderIdentityConflicts.length,
    movementCandidates: movementCandidates.length, resolvedMovementCandidates: movementResolution.resolved,
    unresolvedMovementCandidates: movementResolution.unresolved }, continuityCandidates, riderIdentityConflicts,
    movementCandidates, movementResolution };
}
