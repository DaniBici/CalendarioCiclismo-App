import { describe, expect, it } from 'vitest';
import { hasCustomTeamBadgeColors, normalizeTeamBadgeColor } from '../team-badge.js';

const defaultTeam = {
  badgeTorsoCenter: '#ffffff',
  badgeTorsoSides: '#000000',
  badgeShorts: '#000000',
  badgeInnerCircle: null,
};

describe('visibilidad de chapas de equipos', () => {
  it('oculta la paleta por defecto, también con sus variantes hex cortas', () => {
    expect(hasCustomTeamBadgeColors(defaultTeam)).toBe(false);
    expect(hasCustomTeamBadgeColors({
      ...defaultTeam,
      badgeTorsoCenter: '#fff',
      badgeTorsoSides: '#111',
      badgeShorts: '#111111',
    })).toBe(false);
  });

  it('muestra cualquier equipo con al menos un color curado', () => {
    expect(hasCustomTeamBadgeColors({ ...defaultTeam, badgeTorsoCenter: '#e30613' })).toBe(true);
    expect(hasCustomTeamBadgeColors({ ...defaultTeam, badgeInnerCircle: '#ffd700' })).toBe(true);
  });

  it('no convierte datos de color inválidos en una chapa visible', () => {
    expect(hasCustomTeamBadgeColors({ ...defaultTeam, badgeTorsoCenter: 'blue' })).toBe(false);
    expect(normalizeTeamBadgeColor('#AbC')).toBe('#aabbcc');
  });
});
