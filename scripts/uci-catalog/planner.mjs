import { CATEGORIES, sha256, madridDate } from './source.mjs';
import { countryCode } from './countries.mjs';
import { foldName } from '../../js/name-fold.js';

const sourceName = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();
const compatibleGivenName = (left, right) => {
  const a = new Set(sourceName(left).split(' ').filter(Boolean));
  const b = new Set(sourceName(right).split(' ').filter(Boolean));
  return [...a].every(token => b.has(token)) || [...b].every(token => a.has(token));
};

export function normalizeSnapshot(snapshot) {
  if (snapshot.version !== 1 || snapshot.complete !== true || !snapshot.teams?.length) throw new Error('incomplete_capture');
  const records = {}, teams = {};
  const details = new Map(snapshot.riders.map(r => [r.uciProfileId, r]));
  for (const t of snapshot.teams) {
    if (!CATEGORIES[t.categoryName] || teams[t.uciTeamProfileId]) throw new Error('invalid_team');
    teams[t.uciTeamProfileId] = {
      name: t.teamName, code: t.teamCode, gender: t.gender, category: CATEGORIES[t.categoryName][1],
      country: countryCode(t.countryCode), sha256: t.sha256, members: t.riders.length,
    };
    for (const r of t.riders) {
      const id = r.uciProfileId;
      if (!/^\d{1,10}$/.test(id)) throw new Error('invalid_profile');
      const detail = details.get(id);
      const record = records[id] ||= { gender: t.gender, bio: detail ? {
        firstName: detail.givenName, lastName: detail.familyName,
        birthDate: detail.birthDate, nationality: countryCode(detail.nationality || r.countryCode),
      } : null, regular: [], trainees: [], panels: [], history: detail?.history || [],
      profileHash: detail?.sha256 || null, conflict: false };
      if (record.gender !== t.gender) record.conflict = true;
      if (detail && (!compatibleGivenName(detail.givenName, r.givenName) || sourceName(detail.familyName) !== sourceName(r.familyName)
        || (detail.nationality && detail.nationality !== r.countryCode))) record.conflict = true;
      record[r.affiliationType === 'trainee' ? 'trainees' : 'regular'].push(t.uciTeamProfileId);
      for (const panel of r.sourcePanels || [r.sourcePanel]) record.panels.push({ team: t.uciTeamProfileId, panel });
    }
  }
  for (const record of Object.values(records)) {
    record.regular.sort(); record.trainees.sort(); record.panels.sort((a, b) => a.team.localeCompare(b.team));
    if (record.regular.some(team => record.trainees.includes(team))) record.conflict = true;
    // La huella semántica excluye cabeceras HTTP, hashes del HTML e historial ajeno al año.
    record.evidence = { gender: record.gender, bio: record.bio, regular: record.regular,
      trainees: record.trainees, panels: record.panels, conflict: record.conflict };
  }
  return { version: 1, year: snapshot.year, complete: true, teams, records,
    collectedAt: snapshot.completedAt, startedAt: snapshot.startedAt, stats: snapshot.stats,
    manifestHash: sha256(snapshot.manifest), errors: snapshot.errors };
}

// Mismo plegado que public.fold_name (js/name-fold.js); no genera identificadores ni slugs.
const name = r => foldName(`${r.firstName} ${r.lastName}`);
export function buildPlan(snapshot, context, now = new Date()) {
  const day = madridDate(now), actions = [], cases = [], counts = { unchanged: 0 };
  if (snapshot.year !== Number(day.slice(0, 4)) || context.year !== snapshot.year) throw new Error('season_not_adopted');
  const previous = context.previous;
  const stableAge = previous && Date.parse(context.observedAt) - Date.parse(previous.observedAt);
  const stableCycle = stableAge >= 20 * 3600000 && stableAge <= 52 * 3600000;
  const issue = (key, reason, detail = {}) => cases.push({ key, reason, detail });
  const exclusions = new Set((context.exclusions || []).map(String));
  const links = new Map(context.links.map(l => [l.profile, l]));
  const knownProfiles = new Map();
  for (const r of context.riders) {
    if (!r.uciProfileId) continue;
    const group = knownProfiles.get(r.uciProfileId) || []; group.push(r); knownProfiles.set(r.uciProfileId, group);
  }
  const validTeams = new Map();
  for (const [id, t] of Object.entries(snapshot.teams)) {
    const link = links.get(id);
    if (!link || link.sourceName !== t.name || link.category !== t.category || link.gender !== t.gender
      || link.sourceCode !== t.code || link.currentCategory !== t.category || link.specialEdition || link.teamKind === 'selection') {
      issue(`team:${snapshot.year}:${id}`, 'team_catalog_review', { profile: id, name: t.name }); continue;
    }
    validTeams.set(id, link.teamId);
  }
  if (previous) {
    for (const [id, t] of Object.entries(previous.snapshot.teams)) {
      const current = snapshot.teams[id];
      if (!current || current.members < t.members * .8) issue(`coverage:${snapshot.year}:${id}`, 'source_roster_drop', { before: t.members, after: current?.members || 0 });
    }
    for (const id of Object.keys(previous.snapshot.records)) {
      if (!exclusions.has(id) && !snapshot.records[id]) issue(`absence:${snapshot.year}:${id}`, 'source_absence', { profile: id });
    }
  }
  for (const [profile, record] of Object.entries(snapshot.records)) {
    if (exclusions.has(profile)) continue;
    const key = `rider:${snapshot.year}:${profile}`;
    if (!record.bio || record.conflict) { issue(key, 'source_identity_conflict'); continue; }
    const matches = knownProfiles.get(profile) || [];
    if (matches.length !== 1 || matches[0].gender !== record.gender) {
      const candidates = context.riders.filter(r => r.gender === record.gender && (
        name(r) === name(record.bio) || (r.birthDate && r.birthDate === record.bio.birthDate && r.nationality === record.bio.nationality)));
      issue(key, matches.length ? 'identity_conflict' : 'identity_unresolved', { candidates: candidates.map(r => r.id), bio: record.bio }); continue;
    }
    const rider = matches[0], state = context.states[`${rider.gender}:${rider.id}`];
    if (!state || context.blocked.includes(key)) { issue(key, 'manual_lock'); continue; }
    const bio = record.bio;
    if (name(rider) !== name(bio) || (rider.birthDate && rider.birthDate !== bio.birthDate)
      || (rider.nationality && rider.nationality !== bio.nationality)) { issue(key, 'biography_review'); continue; }
    const stable = stableCycle && sha256(record.evidence) === sha256(previous.snapshot.records[profile]?.evidence || null);
    const propose = (kind, teamProfile = null) => {
      if (!stable) { issue(`${key}:${kind}:${teamProfile || ''}`, 'awaiting_stability'); return; }
      actions.push({ profile, riderId: rider.id, gender: rider.gender, kind, teamProfile, expectedHash: state.hash });
    };
    if ((!rider.birthDate && bio.birthDate) || (!rider.nationality && bio.nationality)) propose('fill');
    if (record.regular.length > 1) issue(key, 'multiple_regular_teams');
    else if (record.regular.length === 1) {
      const target = validTeams.get(record.regular[0]);
      if (!target) issue(key, 'team_catalog_review');
      else if (rider.currentTeamId === target) counts.unchanged++;
      else if (!context.baselines[`${rider.gender}:${profile}`]
        || context.baselines[`${rider.gender}:${profile}`] !== rider.currentTeamId) issue(key, 'baseline_conflict');
      else if (!rider.currentTeamId) issue(key, 'initial_affiliation_review');
      else if (day.endsWith('-01-01')) issue(key, 'season_transition_review');
      else {
        const active = state.affiliations.filter(a => a.affiliationType === 'regular' && a.year === snapshot.year
          && (!a.dateFrom || a.dateFrom <= day) && (!a.dateTo || a.dateTo >= day));
        const future = state.affiliations.some(a => a.affiliationType === 'regular' && (a.year > snapshot.year || a.dateFrom > day));
        const history = record.history.filter(h => String(h.year) === String(snapshot.year));
        if (active.length !== 1 || active[0].teamId !== rider.currentTeamId || active[0].dateTo
          || active[0].dateFrom >= day || future || rider.contractUntil > snapshot.year) issue(key, 'affiliation_or_contract_review');
        else if (!history.some(h => h.url === `/team-details/${record.regular[0]}`)) issue(key, 'source_history_conflict');
        else propose('move', record.regular[0]);
      }
    }
    for (const profile of record.trainees) {
      const target = validTeams.get(profile);
      if (!target) { issue(key, 'team_catalog_review'); continue; }
      if (state.affiliations.some(a => a.year === snapshot.year && a.teamId === target && a.affiliationType === 'trainee')) continue;
      if (day < `${snapshot.year}-08-01` || state.affiliations.some(a => a.year === snapshot.year && a.teamId === target && a.affiliationType === 'regular')) issue(key, 'trainee_review');
      else propose('trainee', profile);
    }
  }
  const grouped = new Map();
  for (const { kind, teamProfile, ...action } of actions) {
    const key = `${action.gender}:${action.riderId}`;
    if (!grouped.has(key)) grouped.set(key, { ...action, operations: [] });
    grouped.get(key).operations.push({ kind, teamProfile });
  }
  const components = [...grouped.values()];
  const limit = Math.min(50, Math.max(1, Math.floor(Object.keys(snapshot.records).length * .02)));
  const suspended = cases.some(c => c.reason === 'source_roster_drop') || components.length > limit;
  if (components.length > limit) issue(`run:${snapshot.year}`, 'change_budget_exceeded', { proposed: components.length, limit });
  return { version: 1, day, actions: suspended ? [] : components, suspended,
    proposed: components.length, cases, counts, limit };
}
