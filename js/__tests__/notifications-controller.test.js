import { beforeEach, describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    SUPABASE_URL: 'https://local.invalid', SUPABASE_ANON_KEY: '', location: { hash: '', search: '', pathname: '/' },
    window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
  });
  return { client: {}, area: 'road', fillCxRaceSelect: vi.fn(), confirmDialog: vi.fn(), showToast: vi.fn(), getAuthHeaders: vi.fn() };
});
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => mocks.client }));
vi.mock('../components/dialog.js', async original => ({ ...await original(), confirmDialog: mocks.confirmDialog }));
vi.mock('../panel/helpers.js', async original => ({ ...await original(), showToast: mocks.showToast }));
vi.mock('../panel/uploads.js', async original => ({ ...await original(), getAuthHeaders: mocks.getAuthHeaders }));
vi.mock('../panel/cx.js', async original => ({ ...await original(), panelArea: () => mocks.area, fillCxRaceSelect: mocks.fillCxRaceSelect }));

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const CONTROLS = ['push-title', 'push-subtitle', 'push-imageUrl', 'push-deepLinkType', 'push-deepLinkTab', 'push-deepLinkCxRace',
  'push-deepLinkRace', 'push-scheduledAt', 'push-schedule-toggle', 'sendPushBtn'];

// Carga el módulo real con un DOM mínimo (nodos creados al pedirlos) y colas de respuestas controladas por la prueba.
async function harness({ fills = [], counts = [], confirmations = [], responses = [], area = 'road' } = {}) {
  // shared.js instala observadores si hay `document` al cargarse: el DOM simulado se define tras importar.
  vi.unstubAllGlobals();
  vi.resetModules();
  mocks.area = area;
  const nodes = new Map(), queries = [];
  const card = { querySelectorAll: () => CONTROLS.map(id => node(id)) };
  function node(id) {
    if (!nodes.has(id)) {
      nodes.set(id, { id, value: '', textContent: '', innerHTML: '', disabled: false, checked: false, hidden: false, open: false,
        style: {}, dataset: {}, listeners: new Map(),
        addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); },
        async dispatch(name) { await Promise.all((this.listeners.get(name) || []).map(fn => fn({ target: this }))); },
        closest: () => card, querySelector: () => ({}), querySelectorAll: () => [], appendChild() {}, setAttribute() {}, removeAttribute() {} });
    }
    return nodes.get(id);
  }
  vi.stubGlobal('fetch', vi.fn(async () => {
    const next = responses.shift();
    return next ? await next.promise : { ok: true, json: async () => ({ sent: 1, totalDevices: 1 }) };
  }));
  mocks.client.from = table => {
    const query = { table, filters: [], select(columns, options) { this.columns = columns; this.options = options; return this; },
      then(resolve, reject) {
        const audience = this.filters.some(([key]) => key === 'push_subscription_categories.category');
        if (audience) queries.push(this);
        const next = audience ? counts.shift() : null;
        return (next ? next.promise : Promise.resolve({ data: [], count: 1 })).then(resolve, reject);
      } };
    for (const method of ['eq', 'in', 'order', 'limit']) query[method] = (key, value) => { query.filters.push([key, value]); return query; };
    return query;
  };
  mocks.fillCxRaceSelect.mockImplementation(async (_client, target, selected = '', options = {}) => {
    const next = fills.shift();
    const rows = next ? await next.promise : ['cx-a', 'cx-b'];
    if (options.isCurrent && !options.isCurrent()) return;
    target.innerHTML = rows.join(',');
    target.value = selected && rows.includes(selected) ? selected : '';
  });
  mocks.confirmDialog.mockImplementation(async () => {
    const next = confirmations.shift();
    return next ? await next.promise : false;
  });
  mocks.getAuthHeaders.mockResolvedValue({});
  const api = await import('../panel/notifications.js');
  vi.stubGlobal('document', { getElementById: node, querySelectorAll: () => [], createElement: () => ({ style: {}, appendChild() {} }) });
  const h = { ...api, queries, node, setup: async () => { await api.setupNotificationsView(); await settle(); queries.length = 0; },
    select: async value => { node('push-deepLinkType').value = value; await node('push-deepLinkType').dispatch('change'); },
    sentBody: () => JSON.parse(globalThis.fetch.mock.calls[0][1].body) };
  return h;
}

beforeEach(() => vi.clearAllMocks());

describe('destinos CX del formulario común de Notificaciones', () => {
  it('limpiar borra la carrera y retira la consulta pendiente; un destino CX en carga queda bloqueado', async () => {
    const read = deferred(), h = await harness({ fills: [read] });
    await h.setup();
    h.node('push-deepLinkCxRace').value = 'cx-a';
    h._clearPushForm();
    await h.select('cxRace');
    expect(h.node('push-deepLinkCxRace').value).toBe('');
    expect(h.node('push-deepLinkCxRace').disabled).toBe(true);
    expect(() => h.getPushAudienceTarget()).toThrow();
    h.node('push-title').value = 'Borrador';
    await h.sendPushNotification();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    read.resolve(['cx-a']);
    await settle();

    const later = deferred(), pending = await harness({ fills: [later] });
    await pending.setup();
    await pending.select('cxRace');
    pending._clearPushForm();
    pending.node('push-title').value = 'Borrador posterior';
    later.reject(Error('Lectura anterior'));
    await settle();
    expect(pending.node('push-deepLinkCxRace').value).toBe('');
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(pending.node('push-title').value).toBe('Borrador posterior');
    expect(pending.getPushAudienceTarget()).toMatchObject({ category: 'general' });
  });

  it('una carga antigua no sustituye la selección CX vigente', async () => {
    const old = deferred(), fresh = deferred(), h = await harness({ fills: [old, fresh] });
    await h.setup();
    await h.select('cxRace');
    await h.select('tab');
    await h.select('cxRace');
    fresh.resolve(['cx-b']);
    await settle();
    h.node('push-deepLinkCxRace').value = 'cx-b';
    await h.node('push-deepLinkCxRace').dispatch('change');
    old.resolve(['cx-a']);
    await settle();
    expect(h.node('push-deepLinkCxRace').value).toBe('cx-b');
    expect(h.getPushAudienceTarget()).toMatchObject({ category: 'cyclocross', cxRaceId: 'cx-b', deepLink: 'cxRace/cx-b' });
  });

  it('una doble pulsación durante el recuento y la confirmación no duplica la petición', async () => {
    const count = deferred(), confirmation = deferred();
    const h = await harness({ counts: [count], confirmations: [confirmation] });
    await h.setup();
    h.node('push-title').value = 'Aviso CX';
    await h.select('cxRace');
    await settle();
    h.node('push-deepLinkCxRace').value = 'cx-a';
    const first = h.sendPushNotification();
    await settle();
    const second = h.sendPushNotification();
    expect(h.node('sendPushBtn').disabled).toBe(true);
    expect(h.node('push-title').disabled).toBe(true);
    count.resolve({ count: 2 });
    await settle();
    expect(mocks.confirmDialog).toHaveBeenCalledTimes(1);
    confirmation.resolve(true);
    await Promise.all([first, second]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0].filters).toContainEqual(['push_cx_race_subscriptions.raceId', 'cx-a']);
    expect(h.sentBody()).toMatchObject({ title: 'Aviso CX', category: 'cyclocross', cxRaceId: 'cx-a', deepLink: 'cxRace/cx-a' });
    expect(h.node('sendPushBtn').disabled).toBe(false);
    expect(h.node('push-title').value).toBe('');
    expect(h.node('push-deepLinkCxRace').value).toBe('');
  });

  it('cancelar la confirmación conserva borrador y destino sin enviar', async () => {
    const h = await harness();
    await h.setup();
    h.node('push-title').value = 'Conservar';
    await h.select('cxRace');
    await settle();
    h.node('push-deepLinkCxRace').value = 'cx-a';
    await h.sendPushNotification();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(h.node('push-title').value).toBe('Conservar');
    expect(h.node('push-deepLinkCxRace').value).toBe('cx-a');
    expect(h.node('sendPushBtn').disabled).toBe(false);
  });

  it('un catálogo fallido impide usar el destino anterior, descarta errores antiguos y permite reintentar', async () => {
    const failing = deferred(), h = await harness({ fills: [failing] });
    await h.setup();
    h.node('push-deepLinkCxRace').value = 'cx-a';
    await h.select('cxRace');
    failing.reject(Error('Catálogo no disponible'));
    await settle();
    expect(() => h.getPushAudienceTarget()).toThrow();
    expect(h.node('push-title').disabled).toBe(false);
    await h.select('tab');
    await h.select('cxRace');
    await settle();
    expect(h.node('push-deepLinkCxRace').disabled).toBe(false);

    const previous = deferred(), stale = await harness({ fills: [previous] });
    await stale.setup();
    await stale.select('cxRace');
    await stale.select('tab');
    mocks.showToast.mockClear();
    stale.node('push-deepLinkTab').value = 'cyclocross';
    previous.reject(Error('Consulta retirada'));
    await settle();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(stale.getPushAudienceTarget()).toMatchObject({ category: 'cyclocross', deepLink: 'cyclocross' });
    await stale.select('cxRace');
    await settle();
    expect(stale.node('push-deepLinkCxRace').disabled).toBe(false);

    const retried = deferred(), retry = await harness({ fills: [retried] });
    await retry.setup();
    retry.node('push-title').value = 'Título conservado';
    await retry.select('cxRace');
    retried.reject(Error('Catálogo no disponible'));
    await settle();
    expect(retry.node('push-cx-retry').style.display).toBe('');
    await retry.node('push-cx-retry').dispatch('click');
    await settle();
    expect(retry.node('push-title').value).toBe('Título conservado');
    expect(retry.node('push-deepLinkCxRace').value).toBe('');
    expect(retry.node('push-cx-retry').style.display).toBe('none');
  });

  it('un fallo de envío o de recuento conserva los campos, presenta el error y libera los controles', async () => {
    const confirmation = deferred(), failed = deferred();
    const h = await harness({ confirmations: [confirmation], responses: [failed] });
    await h.setup();
    h.node('push-title').value = 'Reintentar';
    await h.select('cxRace');
    await settle();
    h.node('push-deepLinkCxRace').value = 'cx-a';
    const sending = h.sendPushNotification();
    await settle();
    confirmation.resolve(true);
    failed.resolve({ ok: false, json: async () => ({ error: 'Fallo local' }) });
    await sending;
    expect(h.node('push-title').value).toBe('Reintentar');
    expect(h.node('push-deepLinkCxRace').value).toBe('cx-a');
    expect(h.node('sendPushBtn').disabled).toBe(false);
    expect(h.node('pushSendError').textContent).toBe('Fallo local');

    const rejected = deferred(), counting = await harness({ counts: [rejected] });
    await counting.setup();
    counting.node('push-title').value = 'Conservar tras error';
    const pending = counting.sendPushNotification();
    rejected.reject(Error('Recuento no disponible'));
    await pending;
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(counting.node('pushSendError').textContent).toBe('Recuento no disponible');
    expect(counting.node('push-title').value).toBe('Conservar tras error');
    expect(counting.node('sendPushBtn').disabled).toBe(false);
  });

  it('programar conserva el mismo destino CX y evita duplicar la petición durante la confirmación', async () => {
    const confirmation = deferred(), h = await harness({ confirmations: [confirmation] });
    await h.setup();
    await h.select('cxRace');
    await settle();
    h.node('push-deepLinkCxRace').value = 'cx-a';
    h.node('push-title').value = 'Programada CX';
    h.node('push-schedule-toggle').checked = true;
    h.node('push-scheduledAt').value = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    const first = h.sendPushNotification();
    await settle();
    await h.sendPushNotification();
    confirmation.resolve(true);
    await first;
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(h.sentBody()).toMatchObject({ category: 'cyclocross', cxRaceId: 'cx-a', deepLink: 'cxRace/cx-a', scheduledAt: expect.any(String) });
    expect(h.node('push-schedule-toggle').checked).toBe(false);
    expect(h.node('sendPushBtn').disabled).toBe(false);
  });

  it('conserva el público general y los identificadores de carretera para sus propios destinos', async () => {
    const h = await harness();
    await h.setup();
    await h.select('race');
    h.node('push-deepLinkRace').value = 'road-a';
    expect(h.getPushAudienceTarget()).toMatchObject({ category: 'general', deepLink: 'race/road-a' });
    h.node('push-title').value = 'Ruta';
    await h.sendPushNotification();
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0].filters).toContainEqual(['push_subscription_categories.category', 'general']);
    expect(h.queries[0].columns).not.toContain('push_cx_race_subscriptions');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('separación de las notificaciones por área del panel', () => {
  it('en carretera el público es general', async () => {
    const h = await harness({ area: 'road' });
    await h.setup();
    expect(h.node('pushAreaLabel').textContent).toBe('Carretera');
    expect(h.getPushAudienceTarget()).toMatchObject({ category: 'general' });
    expect(h.node('pushAudience').hidden).toBe(true);
  });

  it('en ciclocross el público es ciclocross sin destino concreto', async () => {
    const h = await harness({ area: 'cx' });
    await h.setup();
    expect(h.node('pushAreaLabel').textContent).toBe('Ciclocross');
    expect(h.getPushAudienceTarget()).toMatchObject({ category: 'cyclocross', deepLink: 'cyclocross' });
    expect(h.node('pushAudience').hidden).toBe(false);
  });

  it('el cambio de área reajusta el formulario al reabrir la vista', async () => {
    const h = await harness({ area: 'road' });
    await h.setup();
    mocks.area = 'cx';
    await h.setupNotificationsView();
    expect(h.node('pushAreaLabel').textContent).toBe('Ciclocross');
    expect(h.getPushAudienceTarget()).toMatchObject({ category: 'cyclocross' });
  });
});
