import { beforeEach, describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', location: { hash: '', search: '', pathname: '/' },
    window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
  });
  return { client: {}, openDrawer: vi.fn(), fillCxRaceSelect: vi.fn(), fillCxTournamentSelect: vi.fn(),
    confirmDialog: vi.fn(), showToast: vi.fn(), attachInlineUpload: vi.fn() };
});
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => mocks.client }));
vi.mock('../components/drawer.js', async original => ({ ...await original(), openDrawer: mocks.openDrawer }));
vi.mock('../components/dialog.js', async original => ({ ...await original(), confirmDialog: mocks.confirmDialog }));
vi.mock('../panel/helpers.js', async original => ({ ...await original(), showToast: mocks.showToast }));
vi.mock('../panel/uploads.js', async original => ({ ...await original(), attachInlineUpload: mocks.attachInlineUpload }));
vi.mock('../panel/cx.js', async original => ({ ...await original(), panelArea: () => 'road',
  fillCxRaceSelect: mocks.fillCxRaceSelect, fillCxTournamentSelect: mocks.fillCxTournamentSelect }));

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const cx = { id: 'old-highlight', targetType: 'cxRace', cxRaceId: 'cx-a', customTitle: 'Título CX', customTitleEn: 'CX title', customDetail: 'Detalle', position: 3 };

// Ejecuta el editor real con controles sustituibles, un cliente en memoria y un cajón que reconstruye sus nodos al pintar.
async function harness({ fills = [], writes = [], confirmations = [], days = [] } = {}) {
  vi.unstubAllGlobals();
  vi.resetModules();
  let nodes = new Map(), radios = [], current = null;
  const logs = [], rows = new Map(), panelNodes = new Map();
  const makeNode = () => ({ value: '', textContent: '', innerHTML: '', hidden: false, checked: false, disabled: false, style: {},
    listeners: new Map(), addEventListener(name, fn) { this.listeners.set(name, fn); }, querySelectorAll: () => [] });
  // El cuerpo del cajón toma sus identificadores del marcado real del editor: un id ausente rompe la prueba.
  const body = {
    set innerHTML(html) {
      nodes = new Map();
      for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, makeNode());
      radios = [...html.matchAll(/name="hl-targetType" value="([^"]+)"( checked)?/g)]
        .map(([, value, checked]) => ({ ...makeNode(), value, checked: !!checked }));
    },
    querySelector: selector => nodes.get(selector.slice(1)),
    querySelectorAll: () => [...nodes.values(), ...radios], setAttribute: vi.fn(),
  };
  const close = () => { const old = current; current = null; old?.onClose?.(); body.innerHTML = ''; };
  const radioFor = selector => radios.find(radio => radio.value === selector.match(/value="([^"]+)"/)?.[1]);
  const document = {
    getElementById: id => nodes.get(id) ?? (panelNodes.has(id) ? panelNodes.get(id) : panelNodes.set(id, makeNode()).get(id)),
    querySelectorAll: () => radios,
    querySelector: selector => selector.includes(':checked') ? radios.find(radio => radio.checked)
      : new Proxy(radioFor(selector), { set(node, key, value) {
        if (key === 'checked' && value) radios.forEach(radio => { radio.checked = false; });
        node[key] = value;
        return true;
      } }),
  };
  const next = queue => { const entry = queue.shift(); return entry ? entry.promise : null; };
  mocks.client.from = table => ({
    update: payload => ({ eq: async (_key, id) => {
      logs.push({ kind: 'update', table, id, payload });
      const wait = next(writes); if (wait) await wait;
      rows.set(id, { ...rows.get(id), ...payload, id });
      return {};
    } }),
    upsert: async payload => {
      logs.push({ kind: 'upsert', table, id: payload.id, payload });
      rows.set(payload.id, payload);
      const wait = next(writes); if (wait) await wait;
      return {};
    },
    delete: () => ({ eq: async (_key, id) => {
      logs.push({ kind: 'delete', table, id });
      const wait = next(writes); if (wait) await wait;
      rows.delete(id);
      return {};
    } }),
    select: () => {
      const filters = {};
      const chain = {
        eq: (key, value) => {
          filters[key] = value;
          return key === 'id' ? { single: async () => ({ data: { raceId: 'road-a' } }) } : chain;
        },
        in: async () => ({ data: [] }),
        order: async () => {
          if (table !== 'race_days') return { data: [...rows.values()] };
          const wait = next(days);
          return { data: wait ? await wait : [{ id: `day-${filters.raceId}` }] };
        },
      };
      return chain;
    },
  });
  mocks.openDrawer.mockImplementation(options => {
    current?.onClose?.();
    const handle = { body, onClose: options.onClose, isCurrent: () => current === handle,
      close: () => { if (current === handle) close(); } };
    current = handle;
    options.render(body);
    return handle;
  });
  mocks.fillCxRaceSelect.mockImplementation(async (_client, node, selected) => {
    const wait = next(fills); if (wait) await wait;
    node.innerHTML = '<option>Prueba CX</option>';
    node.value = selected || '';
  });
  mocks.fillCxTournamentSelect.mockImplementation(async (_client, node, selected) => {
    node.innerHTML = '<option>Torneo CX</option>';
    node.value = selected || '';
  });
  mocks.confirmDialog.mockImplementation(async () => {
    const wait = next(confirmations);
    return wait ? await wait : true;
  });
  const api = await import('../panel/highlights.js');
  const { panelState } = await import('../panel/state.js');
  panelState.allRaces = [{ id: 'road-a', name: 'Ruta A' }, { id: 'road-b', name: 'Ruta B' }];
  vi.stubGlobal('document', document);
  return { ...api, panelState, logs, rows, node: id => nodes.get(id), isOpen: () => !!current,
    close: () => current?.close(),
    setType: type => radios.forEach(radio => { radio.checked = radio.value === type; }) };
}

beforeEach(() => vi.clearAllMocks());

describe('consultas y escrituras del editor común de Cintillo', () => {
  it('descarta el error de una consulta CX al cerrar, con o sin otro destacado abierto', async () => {
    const old = deferred(), h = await harness({ fills: [old] });
    const opening = h.openHighlightEditor(cx);
    h.close();
    await h.openHighlightEditor({ ...cx, id: 'new-highlight' });
    h.node('highlightSaveStatus').textContent = 'Borrador vigente';
    h.node('hl-customTitle').value = 'Título nuevo';
    old.reject(Error('Consulta retirada'));
    await opening;
    expect(h.node('highlightSaveStatus').textContent).toBe('Borrador vigente');
    expect(h.node('hl-customTitle').value).toBe('Título nuevo');
    expect(h.isOpen()).toBe(true);

    const pending = deferred(), alone = await harness({ fills: [pending] });
    const closing = alone.openHighlightEditor(cx);
    alone.close();
    pending.reject(Error('Consulta tardía'));
    await expect(closing).resolves.toBeUndefined();
    expect(alone.isOpen()).toBe(false);
  });

  it('no borra la carrera y jornada del segundo editor al completar la consulta CX anterior', async () => {
    const old = deferred(), h = await harness({ fills: [old] });
    const opening = h.openHighlightEditor(cx);
    await h.openHighlightEditor({ id: 'new-highlight', targetType: 'race', raceId: 'road-b' });
    expect(h.node('hl-race-selected-name').textContent).toBe('Ruta B');
    h.node('hl-raceDayId').value = 'day-road-b';
    old.resolve();
    await opening;
    expect(h.node('hl-raceDayId').value).toBe('day-road-b');
    expect(h.node('hl-race-selected').style.display).toBe('flex');
  });

  it('una respuesta de jornadas anterior no sustituye la selección de carretera vigente', async () => {
    const old = deferred(), h = await harness({ days: [old] });
    await h.openHighlightEditor(cx);
    h.setType('raceDay');
    const selecting = h._selectHighlightRace(h.panelState.allRaces[0]);
    await h._selectHighlightRace(h.panelState.allRaces[1]);
    old.resolve([{ id: 'stale-day' }]);
    await selecting;
    expect(h.node('hl-raceDayId').innerHTML).toContain('day-road-b');
    expect(h.node('hl-raceDayId').innerHTML).not.toContain('stale-day');
  });

  it('permite reintentar la carga CX manteniendo títulos y destino, y guarda sus referencias', async () => {
    const failing = deferred(), h = await harness({ fills: [failing] });
    const opening = h.openHighlightEditor(cx);
    failing.reject(Error('Catálogo no disponible'));
    await opening;
    expect(h.node('hl-cx-retry').hidden).toBe(false);
    expect(h.node('hl-customTitle').value).toBe('Título CX');
    h.node('hl-cx-retry').listeners.get('click')();
    await vi.waitFor(() => expect(h.node('hl-cx-race-id').disabled).toBe(false));
    expect(h.node('hl-cx-race-id').value).toBe('cx-a');
    await h.saveHighlight();
    expect(h.logs[0]).toMatchObject({ kind: 'update', id: 'old-highlight', payload: {
      targetType: 'cxRace', cxRaceId: 'cx-a', raceId: null, raceDayId: null,
      customTitle: 'Título CX', customTitleEn: 'CX title', customDetail: 'Detalle' } });
    expect(h.isOpen()).toBe(false);
  });

  it('bloquea el doble guardado y conserva el ID en el reintento de un alta o una edición fallidas', async () => {
    const lost = deferred(), h = await harness({ writes: [lost] });
    await h.openHighlightEditor(null);
    h.setType('cxRace');
    h.node('hl-cx-race-id').value = 'cx-a';
    h.node('hl-customTitle').value = 'Alta CX';
    const saving = h.saveHighlight();
    expect(h.node('saveHighlightBtn').disabled).toBe(true);
    await h.saveHighlight();
    expect(h.logs).toHaveLength(1);
    lost.reject(Error('Respuesta perdida'));
    await saving;
    expect(h.node('saveHighlightBtn').disabled).toBe(false);
    expect(h.node('hl-customTitle').value).toBe('Alta CX');
    await h.saveHighlight();
    expect(h.logs).toHaveLength(2);
    expect(h.logs[0].id).toBe(h.logs[1].id);
    expect(h.rows.size).toBe(1);

    const failing = deferred(), edit = await harness({ writes: [failing] });
    await edit.openHighlightEditor(cx);
    edit.node('hl-customDetail').value = 'Nuevo detalle';
    const editing = edit.saveHighlight();
    failing.reject(Error('Escritura fallida'));
    await editing;
    expect(edit.node('highlightSaveStatus').textContent).toBe('Error: Escritura fallida');
    expect(edit.node('hl-customDetail').value).toBe('Nuevo detalle');
    await edit.saveHighlight();
    expect(edit.logs.map(row => row.id)).toEqual(['old-highlight', 'old-highlight']);
  });

  it('un guardado o una confirmación de borrado anteriores no afectan al nuevo borrador', async () => {
    const old = deferred(), h = await harness({ writes: [old] });
    await h.openHighlightEditor(cx);
    const saving = h.saveHighlight();
    h.close();
    await h.openHighlightEditor({ ...cx, id: 'new-highlight' });
    h.node('hl-customTitle').value = 'Borrador nuevo';
    old.resolve();
    await saving;
    expect(h.node('hl-customTitle').value).toBe('Borrador nuevo');
    expect(h.isOpen()).toBe(true);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(h.logs[0].id).toBe('old-highlight');

    const confirmation = deferred(), removal = await harness({ confirmations: [confirmation] });
    await removal.openHighlightEditor(cx);
    const removing = removal.deleteHighlight();
    removal.close();
    await removal.openHighlightEditor({ ...cx, id: 'new-highlight' });
    confirmation.resolve(true);
    await removing;
    expect(removal.logs).toHaveLength(0);
    expect(removal.isOpen()).toBe(true);
  });

  it('cancelar la eliminación conserva el formulario y confirmar elimina su propio ID', async () => {
    const cancel = deferred(), h = await harness({ confirmations: [cancel] });
    await h.openHighlightEditor(cx);
    const removing = h.deleteHighlight();
    cancel.resolve(false);
    await removing;
    expect(h.logs).toHaveLength(0);
    expect(h.isOpen()).toBe(true);
    await h.deleteHighlight();
    expect(h.logs[0]).toMatchObject({ kind: 'delete', id: 'old-highlight' });
    expect(h.isOpen()).toBe(false);
  });

  it('una selección CX vacía no envía escritura ni pierde los campos', async () => {
    const h = await harness();
    await h.openHighlightEditor(cx);
    h.node('hl-cx-race-id').value = '';
    await h.saveHighlight();
    expect(h.logs).toHaveLength(0);
    expect(h.node('highlightSaveStatus').textContent).toBe('Selecciona una carrera de ciclocross.');
    expect(h.node('hl-customTitle').value).toBe('Título CX');
  });
});
