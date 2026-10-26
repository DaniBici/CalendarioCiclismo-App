import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => ({}) }));

import { prepareStartlistData } from '../startlist/data.js';

const RACE = { id: 'r1', year: 2026, raceFormat: 'stage_race', endDate: '2026-10-18' };

describe('prepareStartlistData', () => {
  it('aplica solo la temporada del año de la carrera y ordena equipos por primer dorsal', () => {
    const team = id => ({ id, name: `Base ${id}`, headerBg: '#000000', headerText: '#ffffff', team_seasons: [
      { teamId: id, year: 2025, name: `${id} 2025`, headerBg: '#111111' },
      { teamId: id, year: 2026, name: `${id} 2026`, headerBg: '#222222' },
    ] });
    const data = prepareStartlistData(RACE, {
      teamRows: [
        { id: 'a', teamId: 't1', teamName: 'A', sortOrder: 1, team: team('t1') },
        { id: 'b', teamId: 't2', teamName: 'B', sortOrder: 2, team: team('t2') },
      ],
      riders: [
        { id: 'x', teamId: 'a', dorsal: 11 },
        { id: 'y', teamId: 'b', dorsal: 1 },
        { id: 'z', teamId: 'b', dorsal: 0 },
        { id: 'w', teamId: 'b', dorsal: 2 },
      ],
    });
    expect(data.teams.map(tm => [tm.id, tm.displayName])).toEqual([['b', 't2 2026'], ['a', 't1 2026']]);
    expect(data.globalTeamById.t1.headerBg).toBe('#222222');
    expect(data.ridersByTeam.b.map(r => r.id)).toEqual(['y', 'w', 'z']);
    expect(data.totalTeams).toBe(2);
    expect(data.totalRiders).toBe(4);
  });

  it('tacha con la fila de la última etapa del corredor y sin equipos devuelve null', () => {
    const data = prepareStartlistData(RACE, {
      teamRows: [{ id: 'a', teamId: null, teamName: 'A', sortOrder: 1, team: null }],
      riders: [{ id: 'x', teamId: 'a', dorsal: 1, globalRiderId: 'g1' }],
      uciStages: [{ id: 's2', stageNumber: 2, rowCount: 10 }, { id: 's3', stageNumber: 3, rowCount: 10 }, { id: 's4', stageNumber: 4, rowCount: 0 }],
      outRows: [
        { globalRiderId: 'g1', irm: 'DNF', stageRef: 's3' },
        { globalRiderId: 'g1', irm: 'LAP', stageRef: 's2' },
      ],
    });
    expect(data.riderOutMap.get('g1')).toEqual({ irm: 'DNF', stageNumber: 3 });
    expect(prepareStartlistData(RACE, { teamRows: [] })).toBeNull();
  });
});
