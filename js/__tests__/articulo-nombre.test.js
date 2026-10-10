import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm', () => ({ createClient: () => ({}) }));

import { articuloNombre, conArticulo, deArticulo } from '../shared.js';

// Paridad con articulo_nombre()/con_articulo()/de_articulo() de tools/site/gen_og_pages.py.
describe('artículo del nombre de carrera', () => {
  it('usa el femenino en las clásicas con nombre compuesto', () => {
    for (const name of ['París-Tours', 'París-Roubaix', 'Milán-San Remo', 'Lieja-Bastoña-Lieja', 'Flecha Valona', 'Coppa Sabatini', 'Vuelta a Burgos']) {
      expect(articuloNombre(name)).toBe('la');
      expect(deArticulo(name)).toBe('de la');
    }
  });

  it('usa el masculino por primera palabra y por patrón', () => {
    for (const name of ['Tour de Francia', 'Giro de Italia', 'UAE Tour', 'Omloop Nieuwsblad', 'EPZ Omloop van Borsele', 'Rhodes GP', 'Orlen Nations Grand Prix', 'Grote Prijs CHW Beveren', 'Chrono des Nations', 'Kuurne-Bruselas-Kuurne', 'Critérium du Dauphiné']) {
      expect(articuloNombre(name)).toBe('el');
      expect(deArticulo(name)).toBe('del');
    }
  });

  it('usa el plural en los Juegos y en las carreras de varios días', () => {
    expect(conArticulo('Juegos del Mediterráneo línea masculino')).toBe('los Juegos del Mediterráneo línea masculino');
    expect(deArticulo('Juegos Asiáticos CRI femenino')).toBe('de los');
    expect(deArticulo('Cuatro Días de Dunkerque')).toBe('de los');
  });

  it('no antepone otro artículo a los nombres que ya lo llevan', () => {
    for (const name of ['La Vuelta', 'La Polynormande', 'Il Lombardia', 'Il Giro d\'Abruzzo']) {
      expect(conArticulo(name)).toBe(name);
      expect(deArticulo(name)).toBe('de');
    }
  });
});
