import { describe, expect, it } from 'vitest';
import { canHaveTeamRoster, isSelectionTeam } from '../services/team-roster.js';

describe('plantillas de equipos regulares', () => {
  it('excluye selecciones nacionales y regionales aunque difieran sus metadatos', () => {
    for (const team of [
      { category: 'NTM' },
      { category: 'NTW', teamKind: 'club' },
      { category: 'CLUBM', teamKind: 'selection', selectionScope: 'regional' },
    ]) {
      expect(isSelectionTeam(team)).toBe(true);
      expect(canHaveTeamRoster(team)).toBe(false);
    }
  });

  it('admite clubes y equipos UCI de ambos géneros', () => {
    for (const category of ['CLUBM', 'CLUBW', 'WT', 'WWT', 'PT', 'PRW', 'CT', 'CTW']) {
      expect(canHaveTeamRoster({ category, teamKind: 'club' })).toBe(true);
    }
  });

  it('mantiene fuera las ediciones especiales y los equipos inexistentes', () => {
    expect(canHaveTeamRoster({ category: 'WT', specialEdition: true })).toBe(false);
    expect(canHaveTeamRoster(null)).toBe(false);
  });
});
