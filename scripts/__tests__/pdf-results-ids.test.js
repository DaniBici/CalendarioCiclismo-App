import { describe, it, expect } from 'vitest';
import { fnv1a, fnv1aCodeUnits } from '../results-fetchers/pdf-results-ids.mjs';

// Los IDs sintéticos de los fetchers se guardan en base de datos: un cambio de hash
// crea duplicados. Cada fuente ancla su ID en su propia prueba.
describe('fnv1aCodeUnits — hash de los IDs sintéticos de los fetchers', () => {
  it('es FNV-1a de 32 bits por unidades UTF-16 y solo difiere de fnv1a fuera del BMP', () => {
    expect(fnv1aCodeUnits('')).toBe(0x811c9dc5);
    expect(fnv1aCodeUnits('a')).toBe(0xe40c292c);
    expect(fnv1aCodeUnits('foobar')).toBe(0xbf9cf968);
    expect(fnv1aCodeUnits('año')).toBe(fnv1a('año'));
    expect(fnv1aCodeUnits('🚴')).toBe(1060272980);
    expect(fnv1a('🚴')).toBe(931276136);
  });
});
