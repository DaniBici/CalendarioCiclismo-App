import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = ['team-roster.js', 'team-situation.js']
  .map(file => readFileSync(new URL(`../panel/${file}`, import.meta.url), 'utf8'))
  .join('\n')
  .replace(/^export /gm, '');
function contextFor(name, values) {
  const start = source.indexOf('function ' + name + '(');
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  const body = source.slice(start, next < 0 ? undefined : start + 1 + next);
  const context = vm.createContext(values);
  vm.runInContext((source.slice(start - 6, start) === 'async ' ? 'async ' : '') + body, context);
  return context;
}
function client() {
  const calls = [];
  const query = { error: null };
  for (const key of ['from', 'update', 'delete', 'eq', 'rpc']) query[key] = (...args) => {
    calls.push([key, ...args]); return query;
  };
  return { supabase: query, calls };
}
const row = { id: 'real-aff-id', riderId: 'rider', riderGender: 'male',
  affiliationType: 'regular', rider: { id: 'rider', firstName: 'Nombre', lastName: 'Apellido' } };

describe('plantillas con vínculos de prueba', () => {
  it('edita la fila habitual por su id real sin recrear ni alterar una prueba', async () => {
    const db = client();
    const ctx = contextFor('saveAffiliationDates', { ...db, _rosterRows: [{ ...row }],
      panelState: { _rosterTeamId: 'host', _editingTeamSeasonYear: 2024 }, showToast() {}, console });
    await ctx.saveAffiliationDates('rider', 'male', '2024-01-01', null, null, 'real-aff-id');
    expect(db.calls).toContainEqual(['rpc', 'admin_edit_regular_team_affiliation', expect.objectContaining({
      p_action: 'update', p_year: 2024, p_affiliation_id: 'real-aff-id',
    })]);
    ctx._rosterRows[0].affiliationType = 'trainee';
    db.calls.length = 0;
    await ctx.saveAffiliationDates('rider', 'male', null, null, null, 'real-aff-id');
    expect(db.calls).toEqual([]);
  });
  it('retira por RPC solo la afiliación habitual seleccionada', async () => {
    const db = client();
    const ctx = contextFor('removeRiderFromTeam', { ...db, panelState: { _rosterTeamId: 'host', _editingTeamSeasonYear: 2024 }, CURRENT_TEAM_SEASON: 2026,
      _rosterRows: [{ ...row }], confirmDialog: async () => true,
      renderTeamRoster() {}, showToast() {}, console });
    await ctx.removeRiderFromTeam('rider', 'male', { affiliationId: 'real-aff-id' });
    expect(db.calls).toContainEqual(['rpc', 'admin_edit_regular_team_affiliation', expect.objectContaining({
      p_action: 'remove', p_year: 2024, p_affiliation_id: 'real-aff-id',
    })]);
    expect(ctx._rosterRows).toEqual([]);
  });
  it('muestra el badge de stagiaire sin edición de fechas ni retirada, a diferencia de la fila habitual', () => {
    const list = { innerHTML: '', querySelectorAll: () => [] };
    const ctx = contextFor('renderTeamRoster', {
      _rosterRows: [{ ...row, affiliationType: 'trainee', dateBasis: 'regulatory_window',
        rider: { ...row.rider, currentTeamId: 'home' },
        sourceUrl: 'https://www.uci.org/team-details/123', dateFrom: '2026-08-01', dateTo: '2026-12-31' }],
      panelState: { _rosterTeamId: 'host', _teamsCache: [{ id: 'home', name: 'Equipo habitual' }], _editingTeamSeasonYear: 2026 }, CURRENT_TEAM_SEASON: 2026,
      document: { getElementById: id => id === 'teamRosterList' ? list : null },
      esc: s => String(s ?? ''), _slRiderFlagPreview: () => '',
    });
    ctx.renderTeamRoster();
    expect(list.innerHTML.match(/roster-stagiaire-badge/g)).toHaveLength(1);
    expect(list.innerHTML).not.toContain('roster-save-dates');
    expect(list.innerHTML).not.toContain('roster-remove');

    ctx._rosterRows[0].affiliationType = 'regular';
    ctx.renderTeamRoster();
    expect(list.innerHTML).not.toContain('roster-stagiaire-badge');
    expect(list.innerHTML).toContain('roster-save-dates');
  });
  it('oculta la procedencia UCI y el equipo actual en una plantilla de solo lectura', () => {
    const year = 2025;
    const list = { innerHTML: '', querySelectorAll: () => [] };
    const ctx = contextFor('renderTeamRoster', {
      _rosterRows: [{ ...row, readOnly: true,
        rider: { ...row.rider, currentTeamId: 'current' } }],
      panelState: { _rosterTeamId: 'historical', _teamsCache: [{ id: 'current', name: 'Equipo actual' }],
        _editingTeamSeasonYear: year }, CURRENT_TEAM_SEASON: 2026,
      document: { getElementById: id => id === 'teamRosterList' ? list : null },
      esc: s => String(s ?? ''), _slRiderFlagPreview: () => '',
    });
    ctx.renderTeamRoster();
    expect(list.innerHTML).not.toContain('Plantilla UCI');
    expect(list.innerHTML).not.toContain('Equipo actual:');
    expect(list.innerHTML).toContain('Solo lectura');
  });
  it('mantiene el borde neutro y las fechas editables en un alta futura en otro equipo', () => {
    const [dateFrom, dateTo, currentTeamId] = ['2026-10-01', null, 'home'];
    const list = { innerHTML: '', querySelectorAll: () => [] };
    const ctx = contextFor('renderTeamRoster', {
      _rosterRows: [{ ...row, dateFrom, dateTo, rider: { ...row.rider, currentTeamId } }],
      panelState: { _rosterTeamId: 'host', _teamsCache: [{ id: 'home', name: 'Otro equipo' }], _editingTeamSeasonYear: 2026 }, CURRENT_TEAM_SEASON: 2026,
      document: { getElementById: id => id === 'teamRosterList' ? list : null },
      esc: s => String(s ?? ''), _slRiderFlagPreview: () => '',
    });
    ctx.renderTeamRoster();
    expect(list.innerHTML).toContain('class="roster-row u-wrap"');
    expect(list.innerHTML).not.toContain('roster-row--error');
    expect(list.innerHTML).not.toContain('border:1px solid #f59e0b');
    expect(list.innerHTML).toContain('class="roster-from u-chip-input" value="' + (dateFrom || '') + '"');
    expect(list.innerHTML).toContain('class="roster-to u-chip-input" value="' + (dateTo || '') + '"');
    expect(list.innerHTML).toContain('roster-save-dates');
    expect(list.innerHTML).toContain('roster-edit-rider');
    expect(list.innerHTML).toContain('roster-remove');
    expect(list.innerHTML).not.toContain('disabled');
  });
  it('limita los borrados del mercado a afiliaciones habituales del género correcto', async () => {
    const db = client();
    const ctx = contextFor('_syncMarketSituationAffiliation', { ...db, MARKET_SEASON: 2027 });
    await ctx._syncMarketSituationAffiliation({ riderId: 'rider', riderGender: 'female', type: 'retirement' });
    expect(db.calls).toContainEqual(['eq', 'affiliationType', 'regular']);
    expect(db.calls).toContainEqual(['eq', 'riderGender', 'female']);
  });
});
