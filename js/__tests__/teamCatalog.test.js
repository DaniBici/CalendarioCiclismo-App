import { describe, expect, it } from 'vitest';
import {
  activeCatalogTeams,
  teamGenderLabel,
  teamListYearOptions,
  teamSeasonRange,
  teamsForSeasonList,
} from '../services/team-catalog.js';

describe('catálogo de equipos del panel', () => {
  const teams = [
    { id: 'current', historicalCatalogOnly: false },
    { id: 'legacy', historicalCatalogOnly: true },
    { id: 'old-without-flag' },
  ];

  it('excluye identidades históricas de los selectores operativos', () => {
    expect(activeCatalogTeams(teams).map(team => team.id)).toEqual(['current', 'old-without-flag']);
  });

  it('ofrece todos los años del listado hasta 2020', () => {
    expect(teamListYearOptions([2019, 2023], { currentYear: 2026, marketYear: 2027 }))
      .toEqual([2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020]);
  });

  it('resume el rango de temporadas y el sexo del equipo', () => {
    expect(teamSeasonRange([2027, 2024, 2025, 2024])).toBe('2024–2027');
    expect(teamSeasonRange([2026])).toBe('2026');
    expect(teamSeasonRange([])).toBe('');
    expect(teamGenderLabel('male')).toBe('Masculino');
    expect(teamGenderLabel('female')).toBe('Femenino');
  });

  it('construye el listado anual desde los datos de temporada', () => {
    const matrix = [
      { id: 'a', name: 'Nombre matriz', category: 'WT', historicalCatalogOnly: false },
      { id: 'b', name: 'Sin temporada', category: 'PT', historicalCatalogOnly: false },
      { id: 'legacy', name: 'Histórico', historicalCatalogOnly: true },
      { id: 'special', name: 'Maillot especial', specialEdition: true },
    ];
    const seasons = [
      { id: 11, teamId: 'a', year: 2025, name: 'Nombre 2025', category: 'PT' },
      { id: 12, teamId: 'legacy', year: 2025, name: 'Histórico 2025', category: 'CT' },
      { id: 13, teamId: 'special', year: 2025, name: 'No debe entrar', category: 'WT' },
    ];

    expect(teamsForSeasonList(matrix, seasons)).toEqual([
      expect.objectContaining({
        id: 'a',
        teamId: 'a',
        seasonYear: 2025,
        name: 'Nombre 2025',
        matrixName: 'Nombre matriz',
        category: 'PT',
      }),
      expect.objectContaining({
        id: 'legacy',
        name: 'Histórico 2025',
        historicalCatalogOnly: true,
      }),
    ]);
  });
});
