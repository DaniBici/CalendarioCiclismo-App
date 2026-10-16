import { beforeEach, describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', location: { hash: '', search: '', pathname: '/' },
    window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
  });
  return { client: {}, confirmDialog: vi.fn(), showToast: vi.fn() };
});
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => mocks.client }));
vi.mock('../components/dialog.js', async original => ({ ...await original(), confirmDialog: mocks.confirmDialog }));
vi.mock('../panel/helpers.js', async original => ({ ...await original(), showToast: mocks.showToast }));

const { refreshOperationsMonitor, _operationsForce } = await import('../panel/operations.js');

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const snapshot = (generatedAt, queues = {}) => ({ generatedAt, queues, runs: [], sources: [] });
const MONITOR = 'admin_get_automation_monitor';

function harness({ reads = [], writes = [], confirmations = [] } = {}) {
  const nodes = new Map(['operationsRefreshBtn', 'operationsUpdated', 'operationsJobs', 'operationsSources', 'operationsHistory']
    .map(id => [id, { innerHTML: '', textContent: '', disabled: false }]));
  const button = { dataset: { job: 'cx_results' }, disabled: false, textContent: '', addEventListener: vi.fn() };
  vi.stubGlobal('document', { getElementById: id => nodes.get(id), querySelectorAll: () => [button] });
  const calls = [];
  mocks.client.rpc = vi.fn(async name => {
    calls.push(name);
    const queue = name === MONITOR ? reads : writes;
    const next = queue.shift();
    return next ? await next.promise : { data: name === MONITOR ? snapshot('2026-09-12T20:00:00Z') : {} };
  });
  mocks.confirmDialog.mockImplementation(async () => {
    const next = confirmations.shift();
    return next ? await next.promise : true;
  });
  return { calls, button, node: id => nodes.get(id), writesOf: name => calls.filter(call => call === name).length };
}

beforeEach(() => vi.clearAllMocks());

describe('operaciones compartidas de carretera y CX', () => {
  it('una lectura antigua no sustituye la lectura más reciente', async () => {
    const old = deferred(), fresh = deferred();
    const h = harness({ reads: [old, fresh] });
    const first = refreshOperationsMonitor(), second = refreshOperationsMonitor();
    fresh.resolve({ data: snapshot('2026-09-12T20:05:00Z') });
    await second;
    const updated = h.node('operationsUpdated').textContent;
    expect(updated).toMatch(/:05:00$/);
    expect(h.node('operationsRefreshBtn').disabled).toBe(false);
    old.resolve({ data: snapshot('2026-09-12T19:00:00Z') });
    await first;
    expect(h.node('operationsUpdated').textContent).toBe(updated);
  });

  it('el error de una lectura antigua no sustituye la lectura posterior correcta', async () => {
    const failed = deferred(), recovered = deferred();
    const h = harness({ reads: [failed, recovered] });
    const early = refreshOperationsMonitor(), late = refreshOperationsMonitor();
    failed.reject(new Error('Fallo retirado'));
    await early;
    expect(h.node('operationsRefreshBtn').disabled).toBe(true);
    recovered.resolve({ data: snapshot('2026-09-12T20:10:00Z') });
    await late;
    expect(h.node('operationsUpdated').textContent).toMatch(/:10:00$/);
    expect(h.node('operationsUpdated').textContent).not.toContain('No se pudo');
    expect(h.node('operationsRefreshBtn').disabled).toBe(false);
  });

  it('presenta el error de la lectura vigente y libera el botón de actualización', async () => {
    const failed = deferred();
    const h = harness({ reads: [failed] });
    const reading = refreshOperationsMonitor();
    failed.resolve({ error: { message: 'Monitor no disponible' } });
    await reading;
    expect(h.node('operationsUpdated').textContent).toBe('No se pudo leer el estado operativo');
    expect(h.node('operationsRefreshBtn').disabled).toBe(false);
  });

  it('una doble pulsación y un redibujado durante la confirmación encolan una sola petición CX', async () => {
    const confirmation = deferred(), write = deferred();
    const h = harness({ confirmations: [confirmation], writes: [write] });
    const first = _operationsForce('cx_results', h.button);
    await refreshOperationsMonitor();
    const second = _operationsForce('cx_results', h.button);
    expect(h.button.disabled).toBe(true);
    confirmation.resolve(true);
    await vi.waitFor(() => expect(h.writesOf('cx_enqueue_results_fetch')).toBe(1));
    write.resolve({ data: {} });
    await Promise.all([first, second]);
    expect(h.writesOf('cx_enqueue_results_fetch')).toBe(1);
    expect(mocks.confirmDialog).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith('Pasada de resultados CX encolada', 'success', 4000);
    expect(h.button.disabled).toBe(false);
  });

  it('cancelar no consulta el VPS y conserva el botón disponible', async () => {
    const confirmation = deferred();
    const h = harness({ confirmations: [confirmation] });
    const forcing = _operationsForce('cx_results', h.button);
    confirmation.resolve(false);
    await forcing;
    expect(h.calls).toEqual([]);
    expect(h.button.disabled).toBe(false);
  });

  it('un fallo de encolado permite reintentar CX sin usar la RPC de carretera', async () => {
    const write = deferred();
    const h = harness({ writes: [write] });
    const forcing = _operationsForce('cx_results', h.button);
    write.resolve({ error: { message: 'Cola no disponible' } });
    await forcing;
    expect(h.button.disabled).toBe(false);
    await _operationsForce('cx_results', h.button);
    expect(h.calls.filter(name => name !== MONITOR)).toEqual(['cx_enqueue_results_fetch', 'cx_enqueue_results_fetch']);
    expect(mocks.showToast).toHaveBeenCalledWith('No se pudo encolar la pasada: Cola no disponible', 'error');
  });

  it('mantiene las RPC de carretera y de TV para sus trabajos', async () => {
    const h = harness();
    await _operationsForce('results', { ...h.button, dataset: { job: 'results' } });
    await _operationsForce('broadcasts', { ...h.button, dataset: { job: 'broadcasts' } });
    expect(h.calls.filter(name => name !== MONITOR)).toEqual(['admin_trigger_results_sync', 'admin_trigger_broadcasts_sync']);
  });

  it('ignora un trabajo que no admite pasada forzada', async () => {
    const h = harness();
    await _operationsForce('uci_catalog', { ...h.button, dataset: { job: 'uci_catalog' } });
    expect(h.calls).toEqual([]);
    expect(mocks.confirmDialog).not.toHaveBeenCalled();
  });
});
