import { afterEach, describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
vi.hoisted(() => Object.assign(globalThis, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', window: { location: { hostname: '', pathname: '/', search: '' } } }));
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => ({}) }));

import { formatTimeUser } from '../shared.js';

// Referencia: toLocaleTimeString/toLocaleString con la zona en cada llamada.
function reference(ts) {
  const d = new Date(ts);
  const userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const madridStr = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const madridOffset = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' })).getTime();
  const userOffset = new Date(d.toLocaleString('en-US', { timeZone: userTZ })).getTime();
  if (Math.round((userOffset - madridOffset) / 60000) === 0) return { display: madridStr, tooltip: null };
  return { display: d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: userTZ }), tooltip: madridStr };
}

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe('formatTimeUser con formateadores memorizados', () => {
  it('da lo mismo que toLocale* en varias zonas, también en los cambios de hora y la zona del visitante cambiada', () => {
    const instants = ['2026-03-29T00:59:00+00:00', '2026-03-29T01:00:00+00:00', '2026-10-25T00:59:00Z', '2026-10-25T01:30:00Z',
      '2026-07-14T12:05:00+00:00', '2026-12-31T23:30:00Z', '2027-04-05T16:45:00+00:00'];
    for (const timeZone of ['Europe/Madrid', 'Etc/GMT', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Atlantic/Canary']) {
      process.env.TZ = timeZone;
      for (const instant of instants) expect(formatTimeUser(instant), `${timeZone} ${instant}`).toEqual(reference(instant));
    }
  });

  it('sin hora, null; con una fecha inválida, como toLocale*', () => {
    expect(formatTimeUser(null)).toBeNull();
    expect(formatTimeUser('')).toBeNull();
    expect(formatTimeUser('no es una fecha')).toEqual(reference('no es una fecha'));
  });
});
