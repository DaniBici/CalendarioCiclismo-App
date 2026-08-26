import { describe, expect, it } from 'vitest';
import { isTourDelPorvenir } from '../category-filter.js';

describe('excepción del Tour del Porvenir en los filtros web', () => {
  it('reconoce el nombre canónico sin depender de mayúsculas', () => {
    expect(isTourDelPorvenir('Tour del Porvenir')).toBe(true);
    expect(isTourDelPorvenir('TOUR DEL PORVENIR')).toBe(true);
  });

  it('no incorpora otras carreras sub-23', () => {
    expect(isTourDelPorvenir('Giro Next Gen')).toBe(false);
    expect(isTourDelPorvenir('Tour de Bretagne')).toBe(false);
    expect(isTourDelPorvenir(null)).toBe(false);
  });
});
