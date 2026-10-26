import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La página de agenda CX es un módulo con arranque propio: se importa de verdad, con navegador y servicios simulados.
const mocks = vi.hoisted(() => {
  Object.assign(globalThis, {
    SUPABASE_URL: '', SUPABASE_ANON_KEY: '', MutationObserver: class { observe() {} },
    window: { location: { hostname: '', pathname: '/', search: '', hash: '' } },
  });
  class Element {
    children = []; dataset = {}; classList = { toggle() {}, add() {}, remove() {} }; offsetHeight = 50; style = {};
    addEventListener() {}
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute() {} removeAttribute() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
  }
  return { Element, state: {}, client: {}, navigationButtons: [] };
});
vi.mock('../supabase-client.js', () => ({ getSupabaseClient: () => ({}) }));
vi.mock('../cintillo.js', () => ({ initCintillo: async () => {} }));
vi.mock('../services/today-season.js', () => ({ cyclocrossHome: () => false }));
vi.mock('../components/date-navigation.js', () => ({
  dateNavigationButton: options => { mocks.navigationButtons.push(options); return new mocks.Element(); },
}));
vi.mock('../components/day-swipe.js', () => ({ initDaySwipe: () => {} }));
vi.mock('../components/cx-logo.js', () => ({ cxLogoImage: () => null }));
vi.mock('../cx/standings-table.js', () => ({
  cxStandingsTableHtml: options => { mocks.state.standingsTable(options); return ''; }, cxWireStandingsScroll: () => {} }));
vi.mock('../cx/tournament-seo.js', () => ({
  cxTournamentDescription: (...args) => { mocks.state.description(...args); return 'descripción'; } }));
vi.mock('../cx/timing.js', async original => ({ ...await original(), cxCategoryTiming: () => ({ displayState: 'time', temporalState: 'scheduled' }) }));
vi.mock('../i18n.js', async original => ({ ...await original(), initI18n: async () => {}, getLang: () => 'es', getLocale: () => 'es-ES',
  t: (key, params) => (params ? `${key}(${Object.values(params).join('|')})` : key) }));
vi.mock('../shared.js', async original => ({ ...await original(),
  supabase: mocks.client, setMeta: () => {}, setMetaProperty: () => {}, openPhBanner: () => {}, wirePhDescriptions: () => {},
  getPinnedFilter: () => mocks.state.pinnedFilter ?? null, renderFilterPins: () => {}, handleFilterEvent: () => null, setPressed: () => {},
  announce: message => mocks.state.announced.push(message), buildRaceHeader: () => '<div></div>', filterBroadcastsByRegion: rows => rows }));
vi.mock('../services/cx-data.js', async original => ({ ...await original(),
  cxSeasonRows: async () => { mocks.state.calls.push('temporada'); return mocks.state.rows; },
  cxMonth: async (_client, _season, year, month) => {
    mocks.state.calls.push(`${year}-${String(month).padStart(2, '0')}`);
    return mocks.state.monthRows ?? mocks.state.rows;
  },
  cxTournamentMetadata: async () => mocks.state.tournament,
  cxNextDate: (...args) => { mocks.state.nextDateCalls.push(args); return Promise.resolve(mocks.state.nextDate); },
  cxSeasonRounds: async () => mocks.state.rounds,
  cxAllRows: async (_client, table) => mocks.state.tables[table] ?? [] }));

const race = (id, dateKey, extra = {}) => ({ id, name: `Prueba ${id}`, slug: id, dateKey, seasonKey: '2026-27', cx_race_categories: [], ...extra });

// Importa la página con el estado indicado y devuelve los nodos y registros que la prueba necesita.
async function open({ rows = [], monthRows = null, tournamentId = null, tournament = null, nextDate = null, standings = [], states = [],
  search = '', hash = '', pinnedFilter = null } = {}) {
  vi.resetModules();
  const location = { search, pathname: '/ciclocross/', origin: 'http://localhost', hash };
  const history = { replaceState: (_state, _title, url) => { location.search = url.includes('?') ? url.slice(url.indexOf('?')) : ''; } };
  const list = new mocks.Element(), error = new mocks.Element(), standingsNode = new mocks.Element();
  const generalNav = new mocks.Element(), sections = new mocks.Element(), bar = new mocks.Element(), navigation = new mocks.Element();
  const root = new mocks.Element();
  root.dataset = { cxTournamentId: tournamentId };
  root.style = { setProperty: vi.fn() };
  const nodes = { '#cxAgendaList': list, '#cxDateBar': bar, '.agenda-date': new mocks.Element(), '#cxAgendaError': error, '.cx-agenda-sticky': navigation,
    '#cxStandings': standingsNode, '[data-cx-general-nav]': generalNav, '[data-cx-tournament-sections]': sections };
  root.querySelector = selector => nodes[selector];
  const clicks = [];
  list.addEventListener = (type, handler) => { if (type === 'click') clicks.push(handler); };
  Object.assign(mocks.state, { rows, monthRows, tournament, nextDate, calls: [], announced: [], nextDateCalls: [], rounds: new Map(),
    pinnedFilter, tables: { cx_standings_state: states, cx_tournament_standings: standings, cx_teams: [] },
    description: vi.fn(), standingsTable: vi.fn() });
  mocks.navigationButtons.length = 0;
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', history);
  vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [], head: { append() {} }, hidden: false,
    getElementById: () => root, createElement: () => new mocks.Element(), addEventListener() {}, documentElement: { style: { setProperty() {} } } });
  vi.stubGlobal('window', { scrollY: 0, innerWidth: 1200, addEventListener() {}, scrollTo() {}, location });
  vi.stubGlobal('ResizeObserver', class { observe() {} });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  await import('../ciclocross.js');
  // Un clic delegado en la lista, como el del botón «Ir al siguiente día».
  const clickNextDay = day => clicks.forEach(handler => handler({ target: { closest: selector => (selector === '[data-cx-next-day]' ? { dataset: { cxNextDay: day } } : null) } }));
  return { ...mocks.state, list, error, sections, generalNav, standingsNode, location, clickNextDay };
}

// Los fixtures usan septiembre de 2026; el reloj se congela para que «hoy» no avance con el runner.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('vista Hoy de la agenda CX', () => {
  const rows = [race('a', '2026-09-19'), race('b', '2026-10-04', { countryCode: 'ES' }), race('c', '2026-10-04'), race('d', '2026-10-11', { isCancelled: true })];
  it('carga la temporada una vez y abre en el próximo día con carreras', async () => {
    const agenda = await open({ rows });
    expect(agenda.calls).toEqual(['temporada']);
    expect(agenda.location.search).toBe('?date=2026-09-19');
    expect(agenda.announced.at(-1)).toContain('today.races_one(1)');
  });

  it('con el filtro Todas avanza desde un día sin carreras', async () => {
    const agenda = await open({ rows, search: '?date=2026-09-25' });
    expect(agenda.location.search).toBe('?date=2026-10-04');
    expect(agenda.announced.at(-1)).toContain('today.races_other(2)');
  });

  it('con otro filtro muestra el aviso del día vacío y permite pasar al siguiente día con carreras', async () => {
    const agenda = await open({ rows, search: '?date=2026-09-19', pinnedFilter: 'spain' });
    expect(agenda.location.search).toBe('?date=2026-09-19');
    expect(agenda.announced.at(-1)).toBe('today.noRacesFilter');
    agenda.clickNextDay('2026-10-04');
    await vi.waitFor(() => expect(agenda.location.search).toBe('?date=2026-10-04'));
    expect(agenda.calls).toEqual(['temporada', '2026-10']);
    expect(agenda.announced.at(-1)).toContain('today.races_one(1)');
  });

  it('al cambiar de día relee su mes y retira las pruebas que ya no figuran', async () => {
    const agenda = await open({ rows, monthRows: [rows[2]], search: '?date=2026-10-04' });
    expect(agenda.announced.at(-1)).toContain('today.races_other(2)');
    agenda.clickNextDay('2026-10-04');
    await vi.waitFor(() => expect(agenda.calls).toEqual(['temporada', '2026-10']));
    await vi.waitFor(() => expect(agenda.announced.at(-1)).toContain('today.races_one(1)'));
  });

  it('abre el día de la URL y convierte los enlaces antiguos de mes en su primer día con carreras', async () => {
    expect((await open({ rows, search: '?date=2026-10-04' })).location.search).toBe('?date=2026-10-04');
    expect((await open({ rows, hash: '#2026-10' })).location.search).toBe('?date=2026-10-04');
  });
});

describe('página de torneo con todas las pruebas en una sola página', () => {
  const tournament = { id: 't', name: 'Circuito local', slug: 'circuito', seasonKey: '2026-27', countryCode: 'ES' };
  const withTournament = extra => ({ tournamentId: 't', cx_tournaments: tournament, ...extra });
  const rows = [race('a', '2026-09-19', withTournament()), race('b', '2027-01-30', withTournament()),
    race('c', '2026-09-19', withTournament({ tournamentId: 'otro' })), race('d', '2026-10-10', withTournament({ isCancelled: true }))];

  it('carga la temporada una vez y reúne solo las pruebas vigentes del torneo', async () => {
    const agenda = await open({ tournamentId: 't', tournament, rows, nextDate: '2027-01-30' });
    expect(agenda.calls).toEqual(['temporada']);
    expect(agenda.description).toHaveBeenCalledTimes(1);
    expect(agenda.description.mock.calls[0][1].map(item => item.id)).toEqual(['a', 'b']);
    expect(agenda.nextDateCalls).toEqual([[mocks.client, '2026-27', '2026-09-12', 't', []]]);
    expect(agenda.list.children).toHaveLength(1);
  });

  it('muestra la sección general solo si hay generales publicadas', async () => {
    const pointsScheme = { categories: { ME: { mode: 'points' }, WE: { mode: 'points' } } };
    const withScheme = { ...tournament, pointsScheme };
    const empty = await open({ tournamentId: 't', tournament: withScheme, rows, search: '?view=general' });
    expect(empty.sections.hidden).toBe(true);
    expect(empty.list.hidden).toBe(false);

    const standings = [{ category: 'WE', rank: 1, riderDisplay: 'Líder' }];
    const agenda = await open({ tournamentId: 't', tournament: withScheme, rows, standings,
      states: [{ category: 'WE', status: 'ready' }], search: '?view=general' });
    expect(agenda.sections.hidden).toBe(false);
    expect(agenda.list.hidden).toBe(true);
    expect(agenda.generalNav.hidden).toBe(false);
    await vi.waitFor(() => expect(agenda.standingsTable).toHaveBeenCalledTimes(1));
    expect(agenda.standingsTable.mock.calls[0][0].rows).toEqual(standings);
  });

  it('no pinta pruebas si el torneo no tiene ninguna', async () => {
    const agenda = await open({ tournamentId: 't', tournament, rows: [rows[2]] });
    expect(agenda.list.children).toHaveLength(0);
    expect(agenda.error.textContent).toBe('');
  });
});
