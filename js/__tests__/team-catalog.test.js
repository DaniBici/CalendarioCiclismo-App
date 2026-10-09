import { describe, expect, it } from 'vitest';
import {
  activeCatalogTeams,
  teamListYearOptions,
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

  it('ofrece los años del listado desde 2026', () => {
    expect(teamListYearOptions([2019, 2025], { currentYear: 2026, marketYear: 2027 }))
      .toEqual([2027, 2026]);
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
