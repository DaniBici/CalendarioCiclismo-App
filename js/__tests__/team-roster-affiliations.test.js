import { describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', location: { hash: '', search: '', pathname: '/' },
    window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
  });
  return { client: {} };
});
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => mocks.client }));

const { MARKET_SEASON } = await import('../panel/constants.js');
const { _syncMarketSituationAffiliation } = await import('../panel/team-situation.js');

describe('situación de mercado y afiliaciones', () => {
  it('limita los borrados del mercado a afiliaciones habituales del género y la temporada correctos', async () => {
    const filters = [];
    const query = { eq: (key, value) => { filters.push([key, value]); return query; },
      then: resolve => resolve({ error: null }) };
    mocks.client.from = vi.fn(() => ({ delete: () => query }));
    await _syncMarketSituationAffiliation({ riderId: 'rider', riderGender: 'female', type: 'retirement' });
    expect(mocks.client.from).toHaveBeenCalledWith('rider_team_affiliations');
    expect(filters).toEqual([['affiliationType', 'regular'], ['riderGender', 'female'], ['riderId', 'rider'], ['year', MARKET_SEASON]]);
  });
});
