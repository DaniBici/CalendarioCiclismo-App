import { describe, it, expect } from 'vitest';
import { resolveCxPushTarget, cxPushRaceAvailable, cxPushSubscriberQuery } from '../cx/push.js';
import { fetchAllRows } from '../services/paged-query.js';

describe('destinos push CX', () => {
  it('resuelve enlaces por ID y ancla, incluidos formularios anteriores con categoría general', () => {
    for (const anchor of ['', '#ME', '#inscritos-WJ', '#general-WU', '#general']) {
      expect(resolveCxPushTarget({ category: 'general', deepLink: `cxRace/cx-1${anchor}` }))
        .toEqual({ category: 'cyclocross', cxRaceId: 'cx-1', deepLink: `cxRace/cx-1${anchor}` });
    }
    expect(resolveCxPushTarget({ category: 'cyclocross', cxRaceId: 'cx-1' }).deepLink).toBe('cxRace/cx-1');
    expect(resolveCxPushTarget({ category: 'cyclocross' }).deepLink).toBe('cyclocross');
    expect(resolveCxPushTarget({ category: 'general', deepLink: 'cyclocross' }).category).toBe('cyclocross');
    expect(resolveCxPushTarget({ category: 'general', deepLink: 'race/cx-1' })).toEqual({ category: 'general', deepLink: 'race/cx-1' });
  });
  it('rechaza ambigüedades, enlaces mal formados y mezcla con filtros de carretera', () => {
    for (const deepLink of ['cxRace/', 'cxRace/cx-1/', 'cxRace/cx-1#', 'cxRace/cx-1#foo', 'cxRace/cx-1#ME#WE', 'cxRace/../cx-1']) {
      expect(() => resolveCxPushTarget({ category: 'general', deepLink })).toThrow();
    }
    for (const extra of [{ cxRaceId: 'cx-2' }, { raceId: 'cx-1' }, { raceDayId: 'day-1' }]) {
      expect(() => resolveCxPushTarget({ category: 'cyclocross', deepLink: 'cxRace/cx-1', ...extra })).toThrow();
    }
    expect(() => resolveCxPushTarget({ category: 'results', deepLink: 'cxRace/cx-1' })).toThrow();
    expect(() => resolveCxPushTarget({ category: 'cyclocross', deepLink: 'today' })).toThrow();
    expect(() => resolveCxPushTarget({ category: 'general', cxRaceId: 'cx-1', deepLink: 'race/cx-1' })).toThrow();
    expect(() => resolveCxPushTarget({ category: 'general', deepLink: 1 })).toThrow();
  });
  it('excluye carreras retiradas, canceladas o fuera de agosto-febrero, incluido el final multidía', () => {
    const race = { seasonKey: '2027-28', dateKey: '2028-02-29', endDateKey: null, editorialStatus: 'published', isCancelled: false };
    expect(cxPushRaceAvailable(race)).toBe(true);
    expect(cxPushRaceAvailable({ ...race, dateKey: '2027-08-01' })).toBe(true);
    expect(cxPushRaceAvailable({ ...race, endDateKey: '2028-03-01' })).toBe(false);
    expect(cxPushRaceAvailable({ ...race, dateKey: '2027-02-29' })).toBe(false);
    for (const month of ['03', '04', '05', '06', '07']) expect(cxPushRaceAvailable({ ...race, dateKey: `2028-${month}-01` })).toBe(false);
    expect(cxPushRaceAvailable({ ...race, isCancelled: true })).toBe(false);
    expect(cxPushRaceAvailable({ ...race, editorialStatus: 'draft' })).toBe(false);
    expect(cxPushRaceAvailable({ ...race, seasonKey: '2027-29' })).toBe(false);
    expect(cxPushRaceAvailable(null)).toBe(false);
  });
});

// Simula las relaciones privadas y la paginación, sin cargar el emisor ni APNs/FCM.
function fixtureClient(rows, failAt = -1) {
  const calls = [];
  const client = { calls, from(table) {
    expect(table).toBe('push_subscriptions');
    let columns = '', options = {}, predicates = [], order;
    const fieldValue = (row, field) => {
      if (field === 'push_subscription_categories.category') {
        if (!columns.includes('push_subscription_categories!inner')) throw new Error('Falta relación interna de categorías');
        return row.categories;
      }
      if (field === 'push_cx_race_subscriptions.raceId') {
        if (!columns.includes('push_cx_race_subscriptions!inner')) throw new Error('Falta relación interna CX');
        return row.cxRaces;
      }
      return [row[field]];
    };
    const result = (from = 0, to = rows.length) => {
      const selected = rows.filter(row => predicates.every(([field, values]) => fieldValue(row, field).some(value => values.includes(value))))
        .sort((a, b) => order ? a[order].localeCompare(b[order]) : 0);
      return { data: options.head ? null : selected.slice(from, to + 1).map(({ deviceToken, platform }) => ({ deviceToken, platform })), count: selected.length, error: from === failAt ? new Error('Página fallida') : null };
    };
    const query = {
      select(value, opts = {}) { columns = value; options = opts; return query; },
      eq(field, value) { predicates.push([field, [value]]); return query; },
      in(field, values) { predicates.push([field, values]); return query; },
      order(field) { order = field; return query; },
      range(from, to) { calls.push([from, to]); return Promise.resolve(result(from, to)); },
      then(fulfilled, rejected) { return Promise.resolve(result()).then(fulfilled, rejected); },
    };
    return query;
  } };
  return client;
}

describe('público push CX', () => {
  const base = { platform: 'ios', region: 'SPAIN', countryGroup: 'ES', language: 'es', isActive: true, categories: ['general', 'cyclocross'], cxRaces: ['shared-id'], roadRaces: [] };
  const rows = [
    { ...base, deviceToken: 'eligible' },
    { ...base, deviceToken: 'road-collision', cxRaces: [], roadRaces: ['shared-id'], followAll: true },
    { ...base, deviceToken: 'other-cx', cxRaces: ['other-id'] },
    { ...base, deviceToken: 'category-off', categories: ['general', 'results'] },
    { ...base, deviceToken: 'inactive', isActive: false },
    { ...base, deviceToken: 'other-region', region: 'EUROPE' },
    { ...base, deviceToken: 'android', platform: 'android' },
    { ...base, deviceToken: 'other-country', countryGroup: 'FR' },
    { ...base, deviceToken: 'english', language: 'en' },
  ];
  const filters = { cxRaceId: 'shared-id', regions: ['SPAIN'], platforms: ['ios'], countryGroups: ['ES'], languages: ['es'] };
  it('exige categoría y seguimiento CX, aunque carretera use el mismo ID o follow-all', async () => {
    const client = fixtureClient(rows);
    const received = await fetchAllRows(() => cxPushSubscriberQuery(client, filters).order('deviceToken'));
    expect(received.map(row => row.deviceToken)).toEqual(['eligible']);
    const { count, data } = await cxPushSubscriberQuery(client, filters, { count: 'exact', head: true });
    expect(count).toBe(received.length);
    expect(data).toBeNull();
  });
  it('un aviso de pestaña exige opt-in CX pero no seguimiento de una carrera', async () => {
    const received = await fetchAllRows(() => cxPushSubscriberQuery(fixtureClient(rows), { ...filters, cxRaceId: undefined }).order('deviceToken'));
    expect(received.map(row => row.deviceToken)).toEqual(['eligible', 'other-cx', 'road-collision']);
  });
  it('consume más de 500 destinatarios sin omitir la última página y propaga un fallo de consulta', async () => {
    const client = fixtureClient(Array.from({ length: 501 }, (_, i) => ({ ...base, deviceToken: `t${String(i).padStart(3, '0')}` })));
    const received = await fetchAllRows(() => cxPushSubscriberQuery(client, filters).order('deviceToken'));
    expect(received).toHaveLength(501);
    expect(received.at(-1).deviceToken).toBe('t500');
    expect(client.calls).toEqual([[0, 499], [500, 999]]);
    await expect(fetchAllRows(() => cxPushSubscriberQuery(fixtureClient(rows, 0), filters))).rejects.toThrow('Página fallida');
  });
});
