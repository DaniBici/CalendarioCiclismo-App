import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm', () => ({ createClient: () => ({}) }));

import { isArchivedSeason } from '../shared.js';

describe('noindex de las temporadas 2020-2025', () => {
  it('acota el archivo a las temporadas 2020-2025', () => {
    for (const year of [2020, 2023, 2025, '2024']) expect(isArchivedSeason(year)).toBe(true);
    for (const year of [2019, 2026, 2027, null, undefined, '']) expect(isArchivedSeason(year)).toBe(false);
  });
});
