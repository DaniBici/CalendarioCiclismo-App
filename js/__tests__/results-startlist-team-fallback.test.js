import { describe, expect, it } from 'vitest';
import { isNoTeamPlaceholderTeam } from '../no-team-placeholder.js';

describe('isNoTeamPlaceholderTeam', () => {
  it('reconoce las etiquetas sin equipo solo sin teamId y sin plegar clubes reales', () => {
    expect(isNoTeamPlaceholderTeam({ teamName: 'UN-Attached  Leinster' })).toBe(true);
    expect(isNoTeamPlaceholderTeam({ teamName: 'Private Member' })).toBe(true);
    expect(isNoTeamPlaceholderTeam({ teamName: 'Individual', teamId: 't-1' })).toBe(false);
    expect(isNoTeamPlaceholderTeam({ teamName: 'Leinster Cycling Club' })).toBe(false);
    expect(isNoTeamPlaceholderTeam(null)).toBe(false);
  });
});
