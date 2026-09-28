import { describe, expect, it } from 'vitest';
import { hasScrollRailOverflow } from '../scroll-rail.js';

describe('desbordamiento de carriles con flechas', () => {
  it('ignora el espacio que ocupan las flechas al comprobar si el contenido cabe sin ellas', () => {
    expect(hasScrollRailOverflow(250, 200, 28, 28)).toBe(false);
    expect(hasScrollRailOverflow(260, 200, 28, 28)).toBe(true);
  });

  it('detecta el desbordamiento cuando las flechas todavía están ocultas', () => {
    expect(hasScrollRailOverflow(250, 200)).toBe(true);
  });
});
