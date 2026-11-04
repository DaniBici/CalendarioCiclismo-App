import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => ({}) }));

import { buildCxRoundList } from '../shared.js';

const rounds = [
  { id: 'a', n: 1, total: 3, name: 'Primera', href: '/ciclocross/primera/' },
  { id: 'b', n: 2, total: 3, name: 'Segunda <b>', href: '/ciclocross/segunda/' },
  { id: 'c', n: 3, total: 3, name: 'Tercera', href: '' },
];

describe('lista de rondas de ciclocross de la columna lateral', () => {
  it('no se pinta con una sola ronda o ninguna', () => {
    expect(buildCxRoundList([], 'a', 'Torneo')).toBe('');
    expect(buildCxRoundList([rounds[0]], 'a', 'Torneo')).toBe('');
  });

  it('usa el marcado de la lista de etapas y marca la ronda actual', () => {
    const html = buildCxRoundList(rounds, 'b', 'Torneo');
    expect(html).toContain('<nav class="stage-list" aria-label="Torneo">');
    expect(html).toContain('<a class="stage-list__item" href="/ciclocross/primera/">');
    expect(html).toContain('<a class="stage-list__item" href="/ciclocross/segunda/" aria-current="page">');
    expect(html).toContain('<span class="stage-list__n">2/3</span>');
    expect(html).toContain('Segunda &lt;b&gt;');
  });

  it('una ronda sin URL es texto, no enlace', () => {
    const html = buildCxRoundList(rounds, 'a', 'Torneo');
    expect(html).toContain('<span class="stage-list__item"><span class="stage-list__n">3/3</span>');
    expect([...html.matchAll(/href="/g)]).toHaveLength(2);
  });
});
