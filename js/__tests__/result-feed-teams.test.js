import { describe, it, expect } from 'vitest';
import { resolveRiderTeams, enrichResultFeed, resolveCxWinnerTeams } from '../services/result-feed-context.js';

// Cliente falso: cada .in() filtra las filas de la tabla; order/eq/gt no-ops.
function fakeClient(data, { failOn } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async () => ({ data: [] }),
    from: table => {
      calls.push(table);
      return {
        rows: data[table] || [],
        select() { return this; },
        in(field, ids) { this.rows = this.rows.filter(row => ids.includes(row[field])); return this; },
        eq() { return this; }, gt() { return this; }, order() { return this; },
        range: async function (a, b) {
          return failOn === table ? { error: new Error('sin conexión') } : { data: this.rows.slice(a, b + 1) };
        },
      };
    },
  };
}

const startlist = [
  { id: 1, raceId: 'r', globalRiderId: 'a', teamId: 'p1' },   // equipo enlazado
  { id: 2, raceId: 'r', globalRiderId: 'b', teamId: 'p2' },   // sin enlazar
  { id: 3, raceId: 'r', globalRiderId: 'c', teamId: 'p1' },   // dos equipos en la carrera
  { id: 4, raceId: 'r', globalRiderId: 'c', teamId: 'p2' },
  { id: 5, raceId: 'other', globalRiderId: 'a', teamId: 'p2' }, // otra carrera: no cruza
];
const data = {
  startlist_riders_resolved: startlist,
  startlist_teams: [{ id: 'p1', teamId: 't1', teamName: 'Lotto Dstny' }, { id: 'p2', teamId: null, teamName: 'Equipo local' }],
  teams: [{ id: 't1', name: 'Lotto Intermarché' }],
};

describe('resolveRiderTeams', () => {
  it('usa el nombre canónico si está enlazado y el de la startlist si no', async () => {
    const map = await resolveRiderTeams(fakeClient(data), [
      { raceId: 'r', globalRiderId: 'a' }, { raceId: 'r', globalRiderId: 'b' },
    ]);
    expect(map.get('r:a')).toBe('Lotto Intermarché');
    expect(map.get('r:b')).toBe('Equipo local');
  });
  it('acota por carrera', async () => {
    const map = await resolveRiderTeams(fakeClient(data), [{ raceId: 'other', globalRiderId: 'a' }]);
    expect(map.get('other:a')).toBe('Equipo local');
    expect(map.has('r:a')).toBe(false);
  });
  it('deja sin equipo al corredor con más de uno en la carrera', async () => {
    const map = await resolveRiderTeams(fakeClient(data), [{ raceId: 'r', globalRiderId: 'c' }]);
    expect(map.has('r:c')).toBe(false);
    // La CRE lo usa para no dar ganador por equipo.
    expect(map.ambiguous.has('r:c')).toBe(true);
    expect(map.ambiguous.has('r:a')).toBe(false);
  });
  it('sin pares no consulta y un fallo devuelve el mapa vacío', async () => {
    const client = fakeClient(data);
    expect((await resolveRiderTeams(client, [])).size).toBe(0);
    expect(client.calls).toEqual([]);
    for (const failOn of ['startlist_riders_resolved', 'startlist_teams', 'teams']) {
      const map = await resolveRiderTeams(fakeClient(data, { failOn }), [{ raceId: 'r', globalRiderId: 'a' }]);
      expect(map.size).toBe(0);
    }
  });
});

describe('equipo en el feed', () => {
  it('añade winnerTeam al ganador y team a los líderes de la destacada', async () => {
    const client = fakeClient({
      ...data,
      race_days: [{ id: 'd', raceId: 'r', dateKey: '2026-09-04', stageNumber: 2 }, { id: 'd3', raceId: 'r', dateKey: '2026-09-05', stageNumber: 3 }],
      race_classifications: [{ raceId: 'r', classKind: 'gc' }, { raceId: 'r', classKind: 'points' }, { raceId: 'r', classKind: 'teams' }],
      race_uci_stages: [
        { id: 'st', raceId: 'r', raceDayId: 'd', classKind: 'stage', stageNumber: 2 },
        { id: 'gc', raceId: 'r', raceDayId: 'd', classKind: 'gc', stageNumber: 2 },
        { id: 'pt', raceId: 'r', raceDayId: 'd', classKind: 'points', stageNumber: 2 },
        { id: 'tm', raceId: 'r', raceDayId: 'd', classKind: 'teams', stageNumber: 2 },
      ],
      race_uci_results: [
        { stageRef: 'st', raceId: 'r', globalRiderId: 'a', riderDisplay: 'A' },
        { stageRef: 'gc', raceId: 'r', globalRiderId: 'b', riderDisplay: 'B' },
        { stageRef: 'pt', raceId: 'r', globalRiderId: 'c', riderDisplay: 'C' },
        { stageRef: 'tm', raceId: 'r', teamId: 't1', riderDisplay: 'Equipo' },
      ],
    });
    const race = { id: 'r', raceFormat: 'stage_race' };
    const entries = [{ race, date: '2026-09-04', kind: 'inhouse', rd: { id: 'd' }, _stageRef: 'st' }];
    client.rpc = async () => ({ data: [{ dateKey: '2026-09-04', raceId: 'r' }] });
    await enrichResultFeed(client, entries);
    expect(entries[0].winner).toBe('A');
    expect(entries[0].winnerTeam).toBe('Lotto Intermarché');
    const byKind = Object.fromEntries(entries[0].leaders.map(c => [c.classKind, c.winners[0]]));
    expect(byKind.gc).toMatchObject({ name: 'B', team: 'Equipo local' });
    expect(byKind.points.team).toBeUndefined();          // ambiguo → sin equipo
    expect(byKind.teams.team).toBeUndefined();           // ya es un equipo
    expect(JSON.stringify(entries)).not.toContain('_gid');
  });
});

describe('resolveCxWinnerTeams', () => {
  const entries = [
    { race: { id: 'cx1' }, categories: [{ category: 'ME', winnerName: 'A Uno' }, { category: 'WE', winnerName: 'B Dos' }, { category: 'MJ', winnerName: 'C Tres' }] },
  ];
  const rows = [
    { id: 1, raceId: 'cx1', category: 'ME', riderDisplay: 'A Uno', teamName: 'Equipo A' },
    { id: 2, raceId: 'cx1', category: 'WE', riderDisplay: 'Otra', teamName: 'Primera' },
    { id: 3, raceId: 'cx1', category: 'WE', riderDisplay: 'B Dos', teamName: 'Equipo B' },
    { id: 4, raceId: 'cx1', category: 'MJ', riderDisplay: 'C Tres', teamName: '  ' },
    { id: 5, raceId: 'otro', category: 'ME', riderDisplay: 'X', teamName: 'Ajeno' },
  ];
  it('mapea carrera:categoría → equipo y prefiere la fila del ganador publicado', async () => {
    const map = await resolveCxWinnerTeams(fakeClient({ cx_results: rows }), entries);
    expect(map.get('cx1:ME')).toBe('Equipo A');
    expect(map.get('cx1:WE')).toBe('Equipo B');
    expect(map.has('cx1:MJ')).toBe(false);
    expect(map.has('otro:ME')).toBe(false);
  });
  it('un fallo de lectura devuelve el mapa vacío', async () => {
    const map = await resolveCxWinnerTeams(fakeClient({ cx_results: rows }, { failOn: 'cx_results' }), entries);
    expect(map.size).toBe(0);
  });
});
