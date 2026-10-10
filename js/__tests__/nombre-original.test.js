import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm', () => ({ createClient: () => ({}) }));

import { originalNameDistinto } from '../shared.js';

// Paridad con nombre_original_distinto() de tools/site/gen_og_pages.py.
describe('nombre original entre paréntesis', () => {
  it('omite el original cuando repite el nombre propio', () => {
    expect(originalNameDistinto('Il Lombardia', 'Il Lombardia')).toBe('');
    expect(originalNameDistinto('París-Chauny', 'Paris-Chauny')).toBe('');
    expect(originalNameDistinto('Gran Piemonte', 'GranPiemonte')).toBe('');
    expect(originalNameDistinto('Tour of Istanbul', 'Tour of İstanbul')).toBe('');
    expect(originalNameDistinto('Chrono des Nations femenina', 'Chrono des Nations')).toBe('');
    expect(originalNameDistinto('Flandrien 0.0 Classic (Super-8)', 'Flandrien 0.0 Classic')).toBe('');
  });

  it('conserva el original cuando aporta información', () => {
    expect(originalNameDistinto('Tour de Francia', 'Tour de France')).toBe('Tour de France');
    expect(originalNameDistinto('Gooikse Pijl', 'Lotto Gooikse Pijl')).toBe('Lotto Gooikse Pijl');
    expect(originalNameDistinto('Tour of Huangshan', '环黄山国际公路自行车赛')).toBe('环黄山国际公路自行车赛');
    expect(originalNameDistinto('Vuelta a Alta Austria', 'Oberösterreich Rundfahrt')).toBe('Oberösterreich Rundfahrt');
  });

  it('devuelve vacío sin original', () => {
    for (const original of [undefined, null, '', '   ']) expect(originalNameDistinto('Tour de Francia', original)).toBe('');
  });
});
