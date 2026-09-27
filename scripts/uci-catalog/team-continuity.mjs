const fold = value => String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

const websiteKey = value => {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().replace(/^www[.]/, ''); }
  catch { return null; }
};

const structureKind = name => /\b(DEVELOPMENT|DEVO|U23|ROOKIES|ACADEMY)\b/.test(fold(name))
  ? 'development' : 'senior';
const genericNameTokens = new Set(['TEAM','CYCLING','CLUB','PRO','RACING','CONTINENTAL','DE','THE','AND',
  'WOMEN','LADIES','DEVELOPMENT','DEVO','ACADEMY','U23','PRESENTED','POWERED']);
const distinctiveTokens = name => new Set(fold(name).split(' ')
  .filter(token => token.length >= 4 && !genericNameTokens.has(token)));
const regularRoster = team => new Set((team.riders || [])
  .filter(rider => rider.affiliationType !== 'trainee')
  .map(rider => String(rider.uciProfileId)));
const intersectionSize = (left, right) => {
  let count = 0;
  for (const value of left) if (right.has(value)) count++;
  return count;
};
const candidateOrder = (left, right) => right.overlap - left.overlap
  || right.coefficient - left.coefficient || right.jaccard - left.jaccard
  || left.to.profile.localeCompare(right.to.profile);
const uniqueFirst = candidates => {
  const sorted = [...candidates].sort(candidateOrder);
  if (!sorted.length) return null;
  if (sorted.length > 1 && sorted[0].overlap === sorted[1].overlap
    && sorted[0].coefficient === sorted[1].coefficient
    && sorted[0].jaccard === sorted[1].jaccard) return null;
  return sorted[0];
};
const entryKey = entry => `${entry.year}:${entry.gender}:${entry.profile}`;

export function continuityEntries(snapshots) {
  return [...snapshots].sort((a, b) => a.year - b.year).flatMap(snapshot => snapshot.teams.map(team => ({
    year: Number(snapshot.year), profile: String(team.uciTeamProfileId), name: team.teamName.trim(),
    normalizedName: fold(team.teamName), code: team.teamCode, gender: team.gender,
    country: team.countryCode, category: team.categoryName,
    sourceUrl: `https://www.uci.org/team-details/${team.uciTeamProfileId}`,
    sourceWebsite: team.sourceWebsite || null, websiteKey: websiteKey(team.sourceWebsite),
    structureKind: structureKind(team.teamName), roster: regularRoster(team),
  })));
}

export function buildTeamContinuityReport(snapshots, {
  minimumOverlap = 5, minimumCoefficient = 0.5,
  sponsorChangeOverlap = 8, sponsorChangeCoefficient = 0.5, decisions = [],
} = {}) {
  const entries = continuityEntries(snapshots);
  const years = [...new Set(entries.map(entry => entry.year))].sort((a, b) => a - b);
  const byYear = new Map(years.map(year => [year, entries.filter(entry => entry.year === year)]));
  const candidates = [];
  for (let index = 0; index < years.length - 1; index++) {
    const fromYear = years[index], toYear = years[index + 1];
    if (toYear !== fromYear + 1) continue;
    for (const from of byYear.get(fromYear)) for (const to of byYear.get(toYear)) {
      if (from.gender !== to.gender || !from.roster.size || !to.roster.size) continue;
      const overlap = intersectionSize(from.roster, to.roster);
      if (!overlap) continue;
      candidates.push({ from, to, overlap,
        coefficient: overlap / Math.min(from.roster.size, to.roster.size),
        jaccard: overlap / (from.roster.size + to.roster.size - overlap) });
    }
  }

  const byFrom = new Map(), byTo = new Map();
  for (const candidate of candidates) {
    const from = entryKey(candidate.from), to = entryKey(candidate.to);
    if (!byFrom.has(from)) byFrom.set(from, []);
    if (!byTo.has(to)) byTo.set(to, []);
    byFrom.get(from).push(candidate); byTo.get(to).push(candidate);
  }
  const bestFrom = new Map([...byFrom].map(([key, rows]) => [key, uniqueFirst(rows)]));
  const bestTo = new Map([...byTo].map(([key, rows]) => [key, uniqueFirst(rows)]));

  const parent = new Map(entries.map(entry => [entryKey(entry), entryKey(entry)]));
  const componentYears = new Map(entries.map(entry => [entryKey(entry), new Set([entry.year])]));
  const find = key => parent.get(key) === key ? key : (parent.set(key, find(parent.get(key))), parent.get(key));
  const union = (leftKey, rightKey) => {
    const left = find(leftKey), right = find(rightKey);
    if (left === right) return true;
    const leftYears = componentYears.get(left), rightYears = componentYears.get(right);
    if ([...leftYears].some(year => rightYears.has(year))) return false;
    parent.set(right, left); componentYears.set(left, new Set([...leftYears, ...rightYears]));
    return true;
  };

  const verifiedEdges = [], pending = [];
  const decisionsById = new Map(decisions.map(decision => [decision.id, decision]));
  for (const candidate of candidates) {
    const fromKey = entryKey(candidate.from), toKey = entryKey(candidate.to);
    if (bestFrom.get(fromKey) !== candidate || bestTo.get(toKey) !== candidate) continue;
    if (candidate.overlap < minimumOverlap || candidate.coefficient < minimumCoefficient) continue;
    const signals = [];
    if (candidate.from.normalizedName === candidate.to.normalizedName) signals.push('same_name');
    if (candidate.from.code && candidate.from.code === candidate.to.code) signals.push('same_uci_code');
    if (candidate.from.websiteKey && candidate.from.websiteKey === candidate.to.websiteKey) signals.push('same_official_website');
    const fromTokens = distinctiveTokens(candidate.from.name);
    if ([...distinctiveTokens(candidate.to.name)].some(token => fromTokens.has(token))) {
      signals.push('shared_distinctive_name_token');
    }
    const id = `team-continuity:${candidate.from.year}:${candidate.from.profile}:${candidate.to.profile}`;
    const decision = decisionsById.get(id);
    const evidence = { overlap: candidate.overlap, fromRoster: candidate.from.roster.size,
      toRoster: candidate.to.roster.size, coefficient: Number(candidate.coefficient.toFixed(6)),
      jaccard: Number(candidate.jaccard.toFixed(6)), signals, manualEvidence: decision?.evidence || [] };
    let reason = null;
    if (decision?.status === 'pending') reason = decision.reason || 'manual_review';
    else if (decision?.status === 'verified_same_matrix') reason = null;
    else if (candidate.from.structureKind !== candidate.to.structureKind && !signals.length) reason = 'senior_development_boundary';
    else if (!signals.length && !(candidate.overlap >= sponsorChangeOverlap
      && candidate.coefficient >= sponsorChangeCoefficient)) reason = 'insufficient_corroboration';
    if (reason) {
      pending.push({ id,
        status: 'pending', reason, from: withoutRoster(candidate.from), to: withoutRoster(candidate.to), evidence });
      continue;
    }
    if (!union(fromKey, toKey)) {
      pending.push({ id,
        status: 'pending', reason: 'same_year_component_collision',
        from: withoutRoster(candidate.from), to: withoutRoster(candidate.to), evidence });
      continue;
    }
    verifiedEdges.push({ from: fromKey, to: toKey, evidence });
  }

  const grouped = new Map();
  for (const entry of entries) {
    const root = find(entryKey(entry));
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(entry);
  }
  const groups = [...grouped.values()].map(members => {
    members.sort((a, b) => a.year - b.year || a.profile.localeCompare(b.profile));
    const first = members[0], memberKeys = new Set(members.map(entryKey));
    const edges = verifiedEdges.filter(edge => memberKeys.has(edge.from) && memberKeys.has(edge.to));
    return { proposedTeamId: `uci-hist-${first.gender}-${first.year}-${first.profile}`,
      status: members.length > 1 ? 'verified_same_matrix' : 'independent_matrix_candidate',
      continuityBasis: members.length > 1 ? 'mutual_uci_roster_continuity' : 'single_team_season',
      evidence: edges, members: members.map(withoutRoster) };
  }).sort((left, right) => left.members[0].year - right.members[0].year
    || left.proposedTeamId.localeCompare(right.proposedTeamId));

  return { version: 2, complete: true, generatedAt: new Date().toISOString(),
    rule: 'Continuidad por mejor cruce bidireccional de plantilla UCI entre temporadas consecutivas, con sexo idéntico, control senior/filial y corroboración estructural o solapamiento reforzado.',
    thresholds: { minimumOverlap, minimumCoefficient, sponsorChangeOverlap, sponsorChangeCoefficient },
    summary: { teamSeasons: entries.length, proposedMatrices: groups.length,
      verifiedMatrices: groups.filter(group => group.members.length > 1).length,
      verifiedEdges: verifiedEdges.length, pendingEdges: pending.length,
      maleMatrices: groups.filter(group => group.members[0].gender === 'male').length,
      femaleMatrices: groups.filter(group => group.members[0].gender === 'female').length,
      developmentMatrices: groups.filter(group => group.members[0].structureKind === 'development').length },
    groups, pending };
}

function withoutRoster({ roster, ...entry }) { return entry; }

export function validateTeamContinuityReport(report) {
  if (![1, 2].includes(report?.version) || report?.complete !== true || !Array.isArray(report.groups)) {
    throw new Error('team_continuity_report_invalid');
  }
  const seen = new Set();
  for (const group of report.groups) {
    const years = new Set();
    for (const member of group.members || []) {
      const key = entryKey(member);
      if (seen.has(key) || years.has(member.year)) throw new Error('team_continuity_component_collision');
      seen.add(key); years.add(member.year);
      if (!['male', 'female'].includes(member.gender) || member.gender !== group.members[0].gender) {
        throw new Error('team_continuity_gender_conflict');
      }
    }
  }
  return report;
}
