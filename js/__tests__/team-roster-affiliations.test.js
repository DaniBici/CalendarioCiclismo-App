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

const { panelState } = await import('../panel/state.js');
const { CURRENT_TEAM_SEASON, MARKET_SEASON } = await import('../panel/constants.js');
const { _syncRosterVisibility, saveAffiliationDates, removeRiderFromTeam } = await import('../panel/team-roster.js');
const { _syncMarketSituationAffiliation } = await import('../panel/team-situation.js');

const rider = { id: 'rider', firstName: 'Nombre', lastName: 'Apellido', nationality: 'ES', currentTeamId: 'host' };
const affiliation = { id: 'aff-1', riderId: 'rider', riderGender: 'male', affiliationType: 'regular',
  sourceKind: 'affiliation', dateFrom: null, dateTo: null };

// Carga la plantilla por la ruta pública del módulo (RPC de lectura + fichas).
async function loadRoster(rows) {
  const nodes = new Map(['teamRosterPanel', 'teamRosterYear', 'teamRosterList', 'teamRosterCount']
    .map(id => [id, { style: {}, textContent: '', innerHTML: '', dataset: {}, querySelectorAll: () => [] }]));
  vi.stubGlobal('document', { getElementById: id => nodes.get(id) ?? null });
  const calls = [];
  mocks.client.rpc = vi.fn(async (name, args) => {
    calls.push([name, args]);
    return { data: name === 'admin_get_team_roster' ? rows : {}, error: null };
  });
  mocks.client.from = vi.fn(() => ({ select: () => ({ in: async () => ({ data: [rider] }) }) }));
  panelState._teamsCache = [{ id: 'host', category: 'CT' }];
  panelState._editingTeamSeasonYear = CURRENT_TEAM_SEASON;
  _syncRosterVisibility('host', false);
  await vi.waitFor(() => expect(nodes.get('teamRosterCount').textContent).not.toBe(''));
  calls.length = 0;
  return { calls, count: () => nodes.get('teamRosterCount').textContent };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.confirmDialog.mockResolvedValue(true);
});

describe('plantillas con vínculos de prueba', () => {
  it('edita las fechas de la fila habitual por su id real y no altera una prueba', async () => {
    const roster = await loadRoster([affiliation, { ...affiliation, id: 'aff-trainee', affiliationType: 'trainee' }]);
    await saveAffiliationDates('rider', 'male', '2024-01-01', null, null, 'aff-1');
    expect(roster.calls).toEqual([['admin_edit_regular_team_affiliation', expect.objectContaining({
      p_action: 'update', p_team_id: 'host', p_year: CURRENT_TEAM_SEASON, p_affiliation_id: 'aff-1', p_date_from: '2024-01-01', p_date_to: null,
    })]]);
    roster.calls.length = 0;
    await saveAffiliationDates('rider', 'male', null, null, null, 'aff-trainee');
    expect(roster.calls).toEqual([]);
  });

  it('rechaza un rango de fechas invertido sin escribir', async () => {
    const roster = await loadRoster([affiliation]);
    await saveAffiliationDates('rider', 'male', '2026-09-01', '2026-03-01', null, 'aff-1');
    expect(roster.calls).toEqual([]);
    expect(mocks.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('no escribe fechas en una observación anual de solo lectura', async () => {
    const roster = await loadRoster([{ ...affiliation, readOnly: true }]);
    await saveAffiliationDates('rider', 'male', '2026-01-01', null, null, 'aff-1');
    expect(roster.calls).toEqual([]);
  });

  it('retira por RPC solo la afiliación habitual seleccionada y la saca de la lista', async () => {
    const roster = await loadRoster([affiliation]);
    expect(roster.count()).toBe('1 corredor');
    await removeRiderFromTeam('rider', 'male', { affiliationId: 'aff-1' });
    expect(roster.calls).toEqual([['admin_edit_regular_team_affiliation', expect.objectContaining({
      p_action: 'remove', p_year: CURRENT_TEAM_SEASON, p_affiliation_id: 'aff-1',
    })]]);
    expect(roster.count()).toBe('');
  });

  it('no retira una prueba por la RPC de afiliaciones habituales', async () => {
    const roster = await loadRoster([{ ...affiliation, affiliationType: 'trainee' }]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await removeRiderFromTeam('rider', 'male', { affiliationId: 'aff-1' });
    expect(roster.calls).toEqual([]);
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('stagiaire'), 'error');
    expect(roster.count()).toBe('1 corredor');
  });

  it('no escribe si se cancela la confirmación de retirada', async () => {
    const roster = await loadRoster([affiliation]);
    mocks.confirmDialog.mockResolvedValue(false);
    await removeRiderFromTeam('rider', 'male', { affiliationId: 'aff-1' });
    expect(roster.calls).toEqual([]);
    expect(roster.count()).toBe('1 corredor');
  });
});

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
