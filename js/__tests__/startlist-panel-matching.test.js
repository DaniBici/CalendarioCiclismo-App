import { beforeEach, describe, expect, it, vi } from 'vitest';

// shared.js crea el cliente de Supabase con los globales de js/config.js y, vía i18n.js, lee window.location al cargarse.
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', location: { hash: '', search: '', pathname: '/' },
    window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
  });
  return { client: {} };
});
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => mocks.client }));

const roster = [
  { id: 'kim-le-court', firstName: 'Kim', lastName: 'Le Court', nationality: 'mu' },
  { id: 'julie-martin', firstName: 'Julie', lastName: 'Martin', nationality: 'fr' },
  { id: 'julie-le-roux', firstName: 'Julie', lastName: 'Le Roux', nationality: 'fr' },
];

function element() {
  return { style: {}, dataset: {}, children: [], title: '', innerHTML: '',
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener: vi.fn() };
}

// Carga el módulo real y monta una fila de inscrito con campos simulados dentro de un equipo vinculado.
async function editor({ firstName = '', lastName = '', teamKind = null, load = async () => ({ data: roster }) } = {}) {
  // shared.js instala observadores si hay `document` al cargarse: el DOM simulado se define tras importar.
  vi.unstubAllGlobals();
  vi.resetModules();
  const { _slAutoMatchRiderByTeam } = await import('../panel/startlists.js');
  const { panelState } = await import('../panel/state.js');
  const fields = {
    '.sl-firstname': { value: firstName }, '.sl-lastname': { value: lastName }, '.sl-country': { value: '' },
    '.sl-flag-preview': element(), '.sl-rider-matched': element(), '.sl-rider-suggestion': element(),
  };
  const team = { dataset: { teamId: 'team' } };
  const links = [];
  const dataset = new Proxy({}, { set(target, key, value) { if (key === 'globalRiderId') links.push(value); target[key] = value; return true; } });
  const row = { dataset, closest: selector => (selector === '.sl-edit-team' ? team : null), querySelector: selector => fields[selector] ?? null };
  vi.stubGlobal('document', { contains: node => node === row, createElement: element });
  panelState._editingRaceId = `race-${Math.random()}`;
  panelState._teamsCache = [{ id: 'team', ...(teamKind ? { teamKind } : {}) }];
  mocks.client.rpc = vi.fn(async (...args) => load(...args));
  return { match: () => _slAutoMatchRiderByTeam(row), fields, row, links, rpc: mocks.client.rpc };
}

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('automatcheo de un inscrito con la plantilla de su equipo', () => {
  it.each([
    ['por el nombre', { firstName: 'KIM' }],
    ['por el apellido', { lastName: 'le court' }],
  ])('enlaza a un único candidato %s y normaliza los campos', async (_label, input) => {
    const ui = await editor(input);
    const result = await ui.match();
    expect(result).toMatchObject({ id: 'kim-le-court' });
    expect(ui.row.dataset.globalRiderId).toBe('kim-le-court');
    expect(ui.fields['.sl-firstname'].value).toBe('Kim');
    expect(ui.fields['.sl-lastname'].value).toBe('Le Court');
    expect(ui.fields['.sl-country'].value).toBe('mu');
    expect(ui.rpc).toHaveBeenCalledWith('startlist_team_roster', expect.objectContaining({ p_team_id: 'team' }));
  });

  it('muestra las coincidencias de un nombre ambiguo sin enlazarlo', async () => {
    const ui = await editor({ firstName: 'Julie' });
    expect(await ui.match()).toBeNull();
    expect(ui.row.dataset.globalRiderId).toBeUndefined();
    expect(ui.fields['.sl-rider-suggestion'].style.display).toBe('block');
    expect(ui.fields['.sl-rider-suggestion'].children.slice(1).map(button => button.textContent))
      .toEqual(['Julie Martin', 'Julie Le Roux']);
  });

  it('respeta ambos campos y no enlaza un nombre contradictorio', async () => {
    const ui = await editor({ firstName: 'Julie', lastName: 'Le Court' });
    expect(await ui.match()).toBeNull();
    expect(ui.row.dataset.globalRiderId).toBeUndefined();
    expect(ui.fields['.sl-rider-suggestion'].style.display).toBe('none');
  });

  it('aplica una sola vez si la búsqueda se lanza dos veces seguidas', async () => {
    const ui = await editor({ firstName: 'Kim' });
    const [first, second] = await Promise.all([ui.match(), ui.match()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(ui.links).toEqual(['kim-le-court']);
  });

  it('descarta la respuesta si se edita el nombre mientras busca', async () => {
    let resolveRoster;
    const ui = await editor({ firstName: 'Kim', load: () => new Promise(resolve => { resolveRoster = resolve; }) });
    const matching = ui.match();
    ui.fields['.sl-firstname'].value = 'Julie';
    resolveRoster({ data: roster });
    expect(await matching).toBeNull();
    expect(ui.row.dataset.globalRiderId).toBeUndefined();
    expect(ui.fields['.sl-firstname'].value).toBe('Julie');
  });

  it('no consulta la plantilla de un inscrito ya enlazado ni de una fila vacía', async () => {
    const linked = await editor({ firstName: 'Kim' });
    linked.row.dataset.globalRiderId = 'other-rider';
    expect(await linked.match()).toBeNull();
    const empty = await editor();
    expect(await empty.match()).toBeNull();
    expect(linked.rpc).not.toHaveBeenCalled();
    expect(empty.rpc).not.toHaveBeenCalled();
  });

  it('no usa plantilla para una selección nacional', async () => {
    const ui = await editor({ firstName: 'Kim', teamKind: 'selection' });
    expect(await ui.match()).toBeNull();
    expect(ui.rpc).not.toHaveBeenCalled();
  });

  it('un fallo de lectura no enlaza y permite reintentar la consulta', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn().mockResolvedValueOnce({ error: new Error('Plantilla no disponible') })
      .mockResolvedValue({ data: roster });
    const ui = await editor({ firstName: 'Kim', load });
    expect(await ui.match()).toBeNull();
    expect(ui.row.dataset.globalRiderId).toBeUndefined();
    expect(await ui.match()).toMatchObject({ id: 'kim-le-court' });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
