import { describe, expect, it } from 'vitest';
import { cxTeamDisplayCase } from '../results-fetchers/cx-team-names.mjs';

describe('grafía de equipos CX en mayúsculas', () => {
  it('capitaliza palabras, deja partículas en minúscula y conserva siglas e iniciales', () => {
    expect(cxTeamDisplayCase('HYD-CIUDAD DE SALAMANCA')).toBe('HYD-Ciudad de Salamanca');
    expect(cxTeamDisplayCase('KUSKUMENDI MTB C.D.')).toBe('Kuskumendi MTB C.D.');
    expect(cxTeamDisplayCase('TENERIFE BIKE POINT - LA SEDE')).toBe('Tenerife Bike Point - La Sede');
    expect(cxTeamDisplayCase('UNIDOS POR UN RETO, C.D.')).toBe('Unidos por un Reto, C.D.');
    expect(cxTeamDisplayCase('IRUÑA KIROLAK  C.C.')).toBe('Iruña Kirolak C.C.');
  });
  it('no toca nombres que ya traen minúsculas', () => {
    expect(cxTeamDisplayCase('Café Dromedario-Flotamet')).toBe('Café Dromedario-Flotamet');
    expect(cxTeamDisplayCase('')).toBeNull();
  });
});
