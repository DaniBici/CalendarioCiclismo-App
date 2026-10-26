import { describe, expect, it } from 'vitest';
import { localizedTeamName } from '../services/national-team-name.js';

const nation = (name, countryCode, selectionCode = countryCode) =>
  ({ name, teamKind: 'selection', selectionScope: 'national', countryCode, selectionCode });

describe('localizedTeamName', () => {
  it('traduce las selecciones nacionales por código, con las denominaciones fijas', () => {
    expect(localizedTeamName('France', nation('France', 'fr'), false)).toBe('Francia');
    expect(localizedTeamName('Great Britain', nation('Great Britain', 'gb'), false)).toBe('Gran Bretaña');
    expect(localizedTeamName('Czech Republic', nation('Czech Republic', 'cz'), false)).toBe('República Checa');
    expect(localizedTeamName('Ivory Coast', nation('Ivory Coast', 'ci'), false)).toBe('Costa de Marfil');
    expect(localizedTeamName('NICARAGUA', nation('NICARAGUA', 'ni'), false)).toBe('Nicaragua');
    expect(localizedTeamName('Individual Neutral Athletes', nation('Individual Neutral Athletes', null, 'ain'), false))
      .toBe('Deportistas Individuales Neutrales');
  });

  it('conserva la categoría de edad', () => {
    expect(localizedTeamName('Canada U23', nation('Canada U23', 'ca'), false)).toBe('Canadá sub23');
  });

  it('deja el nombre en inglés, en equipos que no son selección nacional y sin código conocido', () => {
    expect(localizedTeamName('France', nation('France', 'fr'), true)).toBe('France');
    expect(localizedTeamName('Euskadi', { name: 'Euskadi', teamKind: 'selection', selectionScope: 'regional', countryCode: 'es' }, false)).toBe('Euskadi');
    expect(localizedTeamName('Kenya', null, false)).toBe('Kenya');
    expect(localizedTeamName('Refugee Cycling Team', nation('Refugee Cycling Team', null, 'ref'), false)).toBe('Refugee Cycling Team');
  });
});
