import { describe, expect, it } from 'vitest';
import {
  resolveSeason,
  resolveTeams,
  snapshotIsCurrent,
  storedIsNewer,
  storedSnapshot,
} from '../results-fetchers/uci-team-ranking-sync.mjs';

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
    expect(snapshotIsCurrent(rows, storedSnapshot(rows))).toBe(true);
  });

  it('actualiza si cambia el nombre canónico aunque se conserve la fecha UCI', () => {
    const stored = storedSnapshot([{ ...rows[0], displayName: 'Nombre anterior' }, rows[1]]);
    expect(snapshotIsCurrent(rows, stored)).toBe(false);
  });

  it('sustituye una instantánea provisional de otra fuente con los mismos valores', () => {
    const stored = storedSnapshot(rows.map((row) => ({ ...row, sourceUrl: 'https://example.invalid' })));
    expect(snapshotIsCurrent(rows, stored)).toBe(false);
  });

  it('iguala los puntos numéricos que pg devuelve con dos decimales', () => {
    const fresh = [{ ...rows[0], points: 2018 }, { ...rows[1], points: 2693.1 }];
    const stored = storedSnapshot([
      { ...rows[0], uciTeamId: '1', points: '2018.00' },
      { ...rows[1], uciTeamId: '2', points: '2693.10' },
    ]);
    expect(snapshotIsCurrent(fresh, stored)).toBe(true);
    expect(snapshotIsCurrent([{ ...fresh[0], points: 2018.5 }, fresh[1]], stored)).toBe(false);
  });
});

describe('resolveSeason', () => {
  const msDate = (iso) => `/Date(${Date.parse(iso)})/`;
  const seasons = [
    { Id: 464, Year: 2026, StartDate: msDate('2025-10-19'), EndDate: msDate('2026-10-17') },
    { Id: 480, Year: 2027, StartDate: msDate('2026-10-18'), EndDate: msDate('2027-10-16') },
  ];
  const now = Date.parse('2026-10-25');

  it('mantiene la temporada cerrada mientras la activa no publica fechas', async () => {
    const latest = async (config, season) => (season.Year === 2026 ? { Id: config.rankingId } : null);
    const { season, moments } = await resolveSeason(seasons, latest, now);
    expect(season.Year).toBe(2026);
    expect(moments.map((moment) => moment.Id)).toEqual([238, 35]);
  });

  it('pasa a la temporada activa con su primera fecha en ambos rankings', async () => {
    const latest = async (config) => ({ Id: config.rankingId });
    expect((await resolveSeason(seasons, latest, now)).season.Year).toBe(2027);
  });
});

describe('storedIsNewer', () => {
  const provisional = [
    { gender: 'male', rankingDate: '2026-10-18' },
    { gender: 'female', rankingDate: '2026-10-18' },
  ];

  it('conserva la instantánea provisional frente a una fecha anterior de DataRide', () => {
    expect(storedIsNewer([{ gender: 'male', rankingDate: '2026-10-13' }], provisional)).toBe(true);
  });

  it('deja pasar la primera fecha oficial igual o posterior', () => {
    expect(storedIsNewer([{ gender: 'male', rankingDate: '2026-10-18' }], provisional)).toBe(false);
    expect(storedIsNewer([{ gender: 'female', rankingDate: '2027-01-19' }], provisional)).toBe(false);
  });
});
