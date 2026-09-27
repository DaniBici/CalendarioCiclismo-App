import { describe, expect, it } from 'vitest';
import {
  resolveTeams,
  snapshotIsCurrent,
} from '../../scripts/results-fetchers/uci-team-ranking-sync.mjs';

describe('resolveTeams', () => {
  it('distingue equipos con el mismo nombre mediante su código UCI', () => {
    const seasons = [
      {
        teamId: 'groupama-worldteam', seasonName: 'Groupama-FDJ United',
        baseName: 'Groupama-FDJ United', category: 'WT', gender: 'male',
        uciCode: 'GFC', countryCode: 'fr',
      },
      {
        teamId: 'groupama-continental', seasonName: 'Groupama-FDJ United',
        baseName: 'Groupama-FDJ United', category: 'CT', gender: 'male',
        uciCode: 'CGF', countryCode: 'fr',
      },
      {
        teamId: 'liv-worldteam', seasonName: 'Liv-AlUla-Jayco',
        baseName: 'Liv-AlUla-Jayco', category: 'WWT', gender: 'female',
        uciCode: 'LIV', countryCode: 'au',
      },
      {
        teamId: 'liv-continental', seasonName: 'Liv-AlUla-Jayco',
        baseName: 'Liv-AlUla-Jayco', category: 'CTW', gender: 'female',
        uciCode: 'LJA', countryCode: 'au',
      },
    ];
    const rows = [
      { gender: 'male', sourceName: 'GROUPAMA-FDJ UNITED', teamCode: 'GFC', countryCode: 'FR' },
      { gender: 'male', sourceName: 'GROUPAMA-FDJ UNITED', teamCode: 'CGF', countryCode: 'FR' },
      { gender: 'female', sourceName: 'LIV-ALULA-JAYCO', teamCode: 'LIV', countryCode: 'AU' },
      { gender: 'female', sourceName: 'LIV-ALULA-JAYCO', teamCode: 'LJA', countryCode: 'AU' },
    ];

    expect(resolveTeams(rows, seasons).map((row) => row.teamId)).toEqual([
      'groupama-worldteam',
      'groupama-continental',
      'liv-worldteam',
      'liv-continental',
    ]);
  });
});

describe('snapshotIsCurrent', () => {
  const rows = [
    {
      gender: 'male', rank: 1, uciTeamId: 1, teamId: 'male-1',
      displayName: 'Equipo masculino', rankingDate: '2026-08-25',
    },
    {
      gender: 'female', rank: 1, uciTeamId: 2, teamId: 'female-1',
      displayName: 'Equipo femenino', rankingDate: '2026-08-25',
    },
  ];

  it('evita reescribir cuando ambos rankings ya tienen la fecha publicada', () => {
    const snapshot = new Map([
      ['male:1', 'male\u001f1\u001f\u001f1\u001fmale-1\u001f\u001f\u001fEquipo masculino\u001f\u001f\u001f\u001f2026-08-25'],
      ['female:2', 'female\u001f1\u001f\u001f2\u001ffemale-1\u001f\u001f\u001fEquipo femenino\u001f\u001f\u001f\u001f2026-08-25'],
    ]);
    expect(snapshotIsCurrent(rows, snapshot)).toBe(true);
  });

  it('actualiza si cambia el nombre canónico aunque se conserve la fecha UCI', () => {
    const snapshot = new Map([
      ['male:1', 'male\u001f1\u001f\u001f1\u001fmale-1\u001f\u001f\u001fNombre anterior\u001f\u001f\u001f\u001f2026-08-25'],
      ['female:2', 'female\u001f1\u001f\u001f2\u001ffemale-1\u001f\u001f\u001fEquipo femenino\u001f\u001f\u001f\u001f2026-08-25'],
    ]);
    expect(snapshotIsCurrent(rows, snapshot)).toBe(false);
  });
});
