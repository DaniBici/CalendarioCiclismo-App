import { describe, expect, it } from 'vitest';
import { extractRidersForNameResolve } from '../results-fetchers/results-upsert.mjs';

describe('identidades de pruebas con dorsales reutilizados', () => {
  it('conserva personas diferentes con el mismo dorsal y deduplica las repeticiones de una persona', () => {
    const rows = [
      { bib: '1', riderDisplay: 'ALFA Ana', firstName: 'Ana', lastName: 'Alfa', isoCode2: 'es' },
      { bib: '1', riderDisplay: 'BETA Bea', firstName: 'Bea', lastName: 'Beta', isoCode2: 'fr' },
    ];
    const data = { stages: [{ classifications: [
      { eventId: 10, rows: [rows[0]] }, { eventId: 20, rows: [rows[1]] },
      { eventId: 30, rows: [rows[0]] },
    ] }] };
    const extracted = extractRidersForNameResolve(data, null, { includeBib: true });
    expect(extracted).toHaveLength(2);
    expect(extracted.map(r => r.eventIds)).toEqual([[10, 30], [20]]);
  });
  it('conserva la licencia UCI separada del identificador de perfil', () => {
    const data = { stages: [{ classifications: [{ eventId: 10, rows: [{
      bib: '7', riderDisplay: 'ALFA Ana', firstName: 'Ana', lastName: 'Alfa',
      isoCode2: 'es', uciId: '10012345678',
    }] }] }] };
    expect(extractRidersForNameResolve(data, null, { includeBib: true })[0].uciLicenseId)
      .toBe('10012345678');
  });

  it('conserva el identificador de perfil UCI', () => {
    const data = { stages: [{ classifications: [{ eventId: 10, rows: [{
      bib: '7', riderDisplay: 'ALFA Ana', firstName: 'Ana', lastName: 'Alfa',
      isoCode2: 'es', uciProfileId: '428096',
    }] }] }] };
    expect(extractRidersForNameResolve(data, null, { includeBib: true })[0].uciProfileId)
      .toBe('428096');
  });
});
