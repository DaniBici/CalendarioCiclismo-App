import { CATEGORIES } from '../../uci-catalog/source.mjs';

export function snapshotFixture(year = 2026) {
  const snapshot = { version: 1, year, complete: true, startedAt: `${year}-09-04T01:00:00Z`,
    completedAt: `${year}-09-04T02:30:00Z`, teams: [], riders: [], errors: [], stats: {}, manifest: [] };
  Object.entries(CATEGORIES).forEach(([category, [gender]], i) => {
    const id = String(i + 1), profile = String(100 + i);
    snapshot.teams.push({ uciTeamProfileId: id, teamName: `Team ${id}`, teamCode: `T${id}`, gender,
      categoryName: category, countryCode: 'ESP', sha256: `team-${id}`,
      riders: [{ uciProfileId: profile, givenName: 'Ana', familyName: `Ciclista ${id}`, countryCode: 'ESP',
        sourcePanel: 'Riders', affiliationType: 'regular' }] });
    snapshot.riders.push({ uciProfileId: profile, givenName: 'Ana', familyName: `Ciclista ${id}`,
      nationality: 'ESP', birthDate: '2000-01-01', sha256: `rider-${profile}`,
      history: [{ year: String(year), url: `/team-details/${id}` }] });
  });
  return snapshot;
}

export function contextFixture(snapshot) {
  const year = snapshot.year;
  return { year, observedAt: `${year}-09-04T02:30:00Z`, previous: { observedAt: `${year}-09-03T02:30:00Z`, snapshot: structuredClone(snapshot) },
    links: Object.entries(snapshot.teams).map(([profile, t]) => ({ profile, teamId: `team-${profile}`, gender: t.gender,
      category: t.category, currentCategory: t.category, sourceName: t.name, sourceCode: t.code, specialEdition: false, teamKind: 'uci' })),
    riders: Object.entries(snapshot.records).map(([profile, r]) => ({ id: `rider-${profile}`, uciProfileId: profile, gender: r.gender,
      ...r.bio, currentTeamId: `team-${r.regular[0]}`, contractUntil: null })),
    states: Object.fromEntries(Object.entries(snapshot.records).map(([profile, r]) => [`${r.gender}:rider-${profile}`, {
      hash: 'original-state', affiliations: [{ id: `aff-${profile}`, teamId: `team-${r.regular[0]}`,
        year, affiliationType: 'regular', dateFrom: null, dateTo: null }],
    }])), baselines: Object.fromEntries(Object.entries(snapshot.records).map(([profile, r]) => [`${r.gender}:${profile}`, `team-${r.regular[0]}`])), blocked: [] };
}
