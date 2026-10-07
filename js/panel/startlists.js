// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Inscritos: listado y editor de startlists
// ─────────────────────────────────────────────────────────────────

import {
  panelDayNavigationHtml, wirePanelDayNavigation,
} from './catalog-ui.js';
import { supabase, esc, normalizeTeamName } from '../shared.js';
import { isSelectionTeam } from '../services/team-roster.js';
import { activeCatalogTeams } from '../services/team-catalog.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { confirmDialog, alertDialog } from '../components/dialog.js';
import { madridDateKey } from '../services/timezone.js';
import {
  saveEnrichedStartlist, hasAssignedStartlistDorsals, loadCompleteStartlistCatalog,
  orderStartlistTeamsForSave, selectUpcomingStartlistRaces,
} from '../startlist/import.js';
import { startlistRosterCandidates } from '../results/panel-logic.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { ensureRaceYearLoaded, loadPanelAgendaDay, renderRoadPanelAgenda } from './agenda.js';
import { _openTeamCombo } from './results-pickers.js';
import {
  _slOpenRiderMatchPicker, _slRiderFlagPreview, _slTeamRowHtml, _slUpdateRowEnrichUI,
} from './startlist-picker.js';
import { fetchTeams } from './teams.js';

// ── Render devices (horizontal bars) ─────────────────────────────
// ═════════════════════════════════════════════════════════════════
//  INSCRITOS / STARTLISTS
// ═════════════════════════════════════════════════════════════════

let _startlistsInitialized = false;
let _startlistsDateKey = madridDateKey(new Date());
let _startlistsRequest = 0;

export function setupStartlistsView() {
  if (!_startlistsInitialized) {
    _startlistsInitialized = true;
    const root=document.getElementById('startlistsView');
    root.querySelector('.sidebar__header').innerHTML=panelDayNavigationHtml({pickerId:'startlistsDate',addId:'newStartlistBtn',addLabel:'+ Nueva lista de inscritos',title:'Inscritos'});
    wirePanelDayNavigation({picker:root.querySelector('[data-date]'),previous:root.querySelector('[data-previous]'),next:root.querySelector('[data-next]'),today:root.querySelector('[data-today]')},{getDate:()=>_startlistsDateKey,todayDate:()=>madridDateKey(new Date()),onChange:date=>{_startlistsDateKey=date;void loadExistingStartlists();}});
    root.querySelector('#newStartlistBtn').addEventListener('click',()=>void openNewStartlist());
  }
  void loadExistingStartlists();
}

function _newStartlistRaceOptions(query = '') {
  return selectUpcomingStartlistRaces(panelState.allRaces, madridDateKey(new Date()), query);
}

async function openNewStartlist() {
  await ensureRaceYearLoaded(new Date().getFullYear() + 1);
  openDrawer({
    title: 'Nueva lista de inscritos',
    level: 1,
    render: (body) => {
      body.innerHTML = `
        <div class="u-stack u-gap-100">
          <div>
            <label for="newStartlistRaceSearch" class="panel-view-label u-block u-mb-040">Carrera</label>
            <input id="newStartlistRaceSearch" type="search" placeholder="Buscar por nombre, fecha o ID…" autocomplete="off" class="panel-input u-py-055 u-px-070 u-mb-050">
            <select id="newStartlistRace" size="10" aria-label="Carrera de destino" class="panel-input u-p-035"></select>
            <div id="newStartlistRaceCount" class="u-fs-1 u-c-dim u-mt-035"></div>
          </div>
          <div id="newStartlistStatus" class="u-fs-2 u-c-dim" role="status">Selecciona una carrera para abrir el editor de inscritos.</div>
          <div class="u-row panel-drawer-footer">
            <button class="btn btn--ghost" id="cancelNewStartlistBtn" type="button">Cancelar</button>
            <button class="btn btn--primary" id="continueNewStartlistBtn" type="button" disabled>Abrir editor</button>
          </div>
        </div>`;

      const search = body.querySelector('#newStartlistRaceSearch');
      const select = body.querySelector('#newStartlistRace');
      const status = body.querySelector('#newStartlistStatus');
      const count = body.querySelector('#newStartlistRaceCount');
      const continueBtn = body.querySelector('#continueNewStartlistBtn');

      const updateReadyState = () => {
        continueBtn.disabled = !select.value;
        status.textContent = select.value
          ? 'Carrera seleccionada. Abre el editor para completar la lista de inscritos.'
          : 'Selecciona una carrera para abrir el editor de inscritos.';
      };

      const renderRaces = () => {
        const previous = select.value;
        const races = _newStartlistRaceOptions(search.value);
        select.innerHTML = races.map(race => {
          const date = race.startDate ? `${race.startDate} · ` : '';
          const existing = race.startlistImportedAt ? ' · lista existente' : '';
          return `<option value="${esc(race.id)}">${esc(`${date}${race.name || race.id}${existing}`)}</option>`;
        }).join('');
        if (races.some(race => race.id === previous)) select.value = previous;
        else select.selectedIndex = -1;
        count.textContent = races.length === 250
          ? 'Se muestran los primeros 250 resultados. Usa el buscador para acotar.'
          : `${races.length} carreras`;
        updateReadyState();
      };

      search.addEventListener('input', renderRaces);
      select.addEventListener('change', updateReadyState);
      body.querySelector('#cancelNewStartlistBtn').addEventListener('click', () => closeDrawer(1));
      continueBtn.addEventListener('click', async () => {
        if (!select.value) return;
        continueBtn.disabled = true;
        continueBtn.textContent = 'Abriendo…';
        await window.openStartlistEditor(select.value);
      });

      renderRaces();
    },
  });
}

async function loadExistingStartlists() {
  const container=document.getElementById('existingStartlists'),dateKey=_startlistsDateKey,request=++_startlistsRequest;
  container.innerHTML='<p class="panel-catalog-empty" role="status">Cargando…</p>';
  try {
    const days=await loadPanelAgendaDay(dateKey);
    if(request!==_startlistsRequest)return;
    renderRoadPanelAgenda(container,days,dateKey,{onRaceDay:(_dayId,raceId)=>void window.openStartlistEditor(raceId),onPendingRace:raceId=>void window.openStartlistEditor(raceId),onlyFirstStageDay:true,hideStageLabel:true});
  } catch(error) {
    if(request!==_startlistsRequest)return;
    container.innerHTML='<p class="cx-error" role="alert"></p><button type="button" class="btn btn--ghost">Reintentar</button>';
    container.querySelector('[role=alert]').textContent=error.message;
    container.querySelector('button').onclick=()=>void loadExistingStartlists();
  }
}

// Borra la lista guardada de la carrera abierta en el editor (botón «Eliminar
// lista» del pie del drawer).
async function deleteStartlist() {
  const raceId = panelState._editingRaceId;
  if (!raceId || _slSaving) return;
  if (!await confirmDialog('¿Eliminar la lista de inscritos de esta carrera?', { danger: true })) return;
  const steps = [
    () => supabase.from('startlist_riders').delete().eq('raceId', raceId),
    () => supabase.from('startlist_teams').delete().eq('raceId', raceId),
    () => supabase.from('races').update({ startlistImportedAt: null, startlistProvisional: false }).eq('id', raceId),
  ];
  for (const step of steps) {
    const { error } = await step();
    if (error) { showToast('No se pudo eliminar la lista: ' + error.message, 'error'); return; }
  }
  const race = panelState.allRaces.find(r => r.id === raceId);
  if (race) {
    race.startlistImportedAt = null;
    race.startlistProvisional = false;
  }
  showToast('Lista de inscritos eliminada', 'success');
  closeStartlistEditor();
  loadExistingStartlists();
}

// ── Editor de startlist ──────────────────────────────────────────
let _slPreparedImport = null;
let _slSaving = false;
let _slRosterMatchCache = new Map(); // plantilla por equipo/temporada/género
let _slAutoMatchSequence = 0;
let _slTeamAliases = [];

// ─── Rider matching ───────────────────────────────────────────────
// Los enlaces se revisan en el editor; las altas se aplican con la lista.

export function _slRefreshRiderMatchBtn(riderEl, rider /* opcional, para tooltip */) {
  const btn = riderEl.querySelector('.sl-rider-match-btn');
  if (!btn) return;
  const id = riderEl.dataset.globalRiderId || '';
  if (id) {
    btn.textContent = '✓ BD';
    btn.style.color = 'var(--green)';
    btn.title = rider
      ? `Match en BD: ${rider.firstName || ''} ${rider.lastName || ''}. Click para cambiar/desligar.`
      : 'Match en BD. Click para cambiar/desligar.';
  } else {
    btn.textContent = riderEl.dataset.birthDate ? 'Alta preparada' : '🔗';
    btn.style.color = 'var(--text-dim)';
    btn.title = 'Buscar o forzar un match en la BD de corredores';
  }
}

// Temporada de la carrera que se está editando. Las afiliaciones son anuales;
// no se debe limitar la búsqueda al currentTeamId, que es solo una caché del
// equipo vigente.
function _slEditingRaceSeason() {
  const race = panelState.allRaces.find(r => r.id === panelState._editingRaceId);
  const year = Number.parseInt(String(race?.startDate || race?.endDate || '').slice(0, 4), 10);
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

// La RPC consulta el equipo y sus vínculos deportivos de la temporada de la
// carrera. Resuelve maillots especiales y fechas sin modificar afiliaciones.
async function _slLoadTeamRosterForMatch(teamId) {
  const raceId = panelState._editingRaceId;
  const team = (panelState._teamsCache || []).find(t => t.id === teamId);
  if (isSelectionTeam(team)) return [];
  const cacheKey = `${raceId}:${teamId}`;
  const cached = _slRosterMatchCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const { data, error } = await supabase.rpc('startlist_team_roster', {
      p_race_id: raceId,
      p_team_id: teamId,
    });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('No se recibió la plantilla de inscritos.');
    return data.map(rider => ({
      ...rider,
      globalRiderId: rider.id,
      name: `${rider.firstName || ''} ${rider.lastName || ''}`.trim(),
    }));
  })();

  _slRosterMatchCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    _slRosterMatchCache.delete(cacheKey);
    throw error;
  }
}

function _slApplyAutomaticRiderMatch(riderEl, rider) {
  const globalRiderId = rider?.globalRiderId || rider?.id;
  if (!globalRiderId) return;
  riderEl.dataset.globalRiderId = globalRiderId;
  riderEl.dataset.birthDate = rider.birthDate || '';
  riderEl.dataset.uciProfileId = rider.uciProfileId || '';
  delete riderEl.dataset.rejectedCandidateIds;
  const firstName = rider.firstName || '';
  const lastName = rider.lastName || '';
  const firstInput = riderEl.querySelector('.sl-firstname');
  const lastInput = riderEl.querySelector('.sl-lastname');
  if (firstInput) firstInput.value = firstName;
  if (lastInput) lastInput.value = lastName;

  const country = riderEl.querySelector('.sl-country');
  const flag = riderEl.querySelector('.sl-flag-preview');
  if (country && rider.nationality) {
    country.value = rider.nationality;
    if (flag) flag.innerHTML = _slRiderFlagPreview(rider.nationality);
  }
  const matched = riderEl.querySelector('.sl-rider-matched');
  if (matched) {
    matched.style.display = 'inline';
    matched.title = rider.affiliationType === 'trainee' ? 'Asociado como ciclista a prueba (stagiaire)' : 'Corredor asociado';
  }
  _slRefreshRiderMatchBtn(riderEl, rider);
  const suggestion = riderEl.querySelector('.sl-rider-suggestion');
  if (suggestion) {
    suggestion.style.display = 'none';
    suggestion.dataset.dismissed = '1';
  }
}

// Al salir del nombre o del apellido, busca dentro de la plantilla del equipo.
// Una respuesta pendiente no puede reemplazar una edición posterior.
async function _slAutoMatchRiderByTeam(riderEl) {
  if (!riderEl || riderEl.dataset.globalRiderId) return null;
  const teamEl = riderEl.closest('.sl-edit-team');
  const teamId = teamEl?.dataset.teamId || '';
  const firstName = riderEl.querySelector('.sl-firstname')?.value.trim() || '';
  const lastName = riderEl.querySelector('.sl-lastname')?.value.trim() || '';
  if (!teamId || (!firstName && !lastName)) return null;

  const raceId = panelState._editingRaceId;
  const requestToken = String(++_slAutoMatchSequence);
  riderEl.dataset.slAutoMatchToken = requestToken;
  try {
    const roster = await _slLoadTeamRosterForMatch(teamId);
    if (panelState._editingRaceId !== raceId || !document.contains(riderEl)
        || riderEl.dataset.slAutoMatchToken !== requestToken
        || riderEl.dataset.globalRiderId
        || riderEl.closest('.sl-edit-team')?.dataset.teamId !== teamId
        || riderEl.querySelector('.sl-firstname')?.value.trim() !== firstName
        || riderEl.querySelector('.sl-lastname')?.value.trim() !== lastName) return null;

    const candidates = startlistRosterCandidates(lastName, firstName, roster);
    if (candidates.length === 1) {
      _slApplyAutomaticRiderMatch(riderEl, candidates[0]);
      return candidates[0];
    }
    const slot = riderEl.querySelector('.sl-rider-suggestion');
    if (slot) {
      slot.replaceChildren();
      slot.style.display = candidates.length > 1 ? 'block' : 'none';
      if (candidates.length > 1) {
        const label = document.createElement('span');
        label.textContent = 'Varias coincidencias en las plantillas vinculadas: ';
        slot.appendChild(label);
        candidates.forEach(candidate => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'btn btn--ghost';
          button.textContent = `${candidate.firstName} ${candidate.lastName}${candidate.rosterTeamName ? ` · ${candidate.rosterTeamName}` : ''}`;
          button.addEventListener('click', () => _slApplyAutomaticRiderMatch(riderEl, candidate));
          slot.appendChild(button);
        });
      }
    }
    return null;
  } catch (error) {
    console.warn('[startlist roster match]', error);
    return null;
  }
}

function _slAutoDorsalForRider(riderEl) {
  const dorsal = riderEl.querySelector('.sl-dorsal');
  if (!dorsal || dorsal.value.trim()) return;
  if (!_slEditorHasAssignedDorsals()) return;
  const teamEl = riderEl.closest('.sl-edit-team');
  if (!teamEl) return;
  const teams = [...document.querySelectorAll('#startlistEditorContent .sl-edit-team')];
  const teamIndex = teams.indexOf(teamEl);
  const riders = [...teamEl.querySelectorAll('.sl-edit-rider')];
  const riderIndex = riders.indexOf(riderEl);
  if (teamIndex < 0 || riderIndex < 0) return;
  dorsal.value = String((teamIndex * 10) + riderIndex + 1);
}

function _slCreateRiderRow(teamEl) {
  const ridersDiv = teamEl?.querySelector('.sl-edit-riders');
  if (!ridersDiv) return null;
  const row = document.createElement('div');
  row.className = 'sl-edit-rider';
  row.dataset.rowKey = crypto.randomUUID();
  row.innerHTML = `<div class="sl-edit-rider__main">
    <input type="number" class="sl-dorsal" value="" placeholder="—" min="1">
    <span class="sl-flag-preview u-icon-box"><span class="flag-placeholder"></span></span>
    <input type="text" class="sl-country" value="" placeholder="es" maxlength="5" title="ISO 3166-1 alpha-2 (2 letras)">
    <input type="text" class="sl-firstname u-input-sm" value="" placeholder="Nombre">
    <input type="text" class="sl-lastname u-input-sm" value="" placeholder="Apellido">
    <button type="button" class="sl-rider-match-btn" data-action="picker" title="Buscar o forzar un match en la BD de corredores">🔗</button>
    <span class="sl-rider-matched sl-verify-mark u-c-ok" style="display:none">✓</span>
    <button type="button" class="btn btn--ghost sl-remove-rider-btn">✕</button>
  </div>
  <div class="sl-rider-suggestion" style="display:none"></div>`;
  ridersDiv.appendChild(row);
  _slUpdateTeamOrderControls();
  return row;
}

function _slEditorTeamsSource() {
  return [...document.querySelectorAll('#startlistEditorContent .sl-edit-team')].map(team => ({
    riders: [...team.querySelectorAll('.sl-dorsal')].map(input => ({ dorsal: input.value.trim() })),
  }));
}

function _slEditorHasAssignedDorsals() {
  return hasAssignedStartlistDorsals(_slEditorTeamsSource());
}

function _slUpdateTeamOrderControls() {
  const teams = [...document.querySelectorAll('#slTeamsList .sl-edit-team')];
  const manualOrder = teams.length > 1 && !_slEditorHasAssignedDorsals();
  teams.forEach((team, index) => {
    const controls = team.querySelector('.sl-team-order-controls');
    if (controls) controls.style.display = manualOrder ? 'inline-flex' : 'none';
    const up = team.querySelector('.sl-team-up-btn');
    const down = team.querySelector('.sl-team-down-btn');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === teams.length - 1;
  });
}

function _slMoveTeamRow(team, direction) {
  const list = team?.parentElement;
  if (!list || _slEditorHasAssignedDorsals()) return;
  if (direction === 'up' && team.previousElementSibling) {
    list.insertBefore(team, team.previousElementSibling);
  } else if (direction === 'down' && team.nextElementSibling) {
    list.insertBefore(team.nextElementSibling, team);
  }
  _slUpdateTeamOrderControls();
}

function _slFocusSurnameInput(riderEl) {
  const input = riderEl?.querySelector('.sl-lastname');
  if (!input) return false;
  input.focus();
  input.select?.();
  return true;
}

function _slFocusFirstSurname(teamEl, addIfEmpty = false) {
  const first = teamEl?.querySelector('.sl-edit-rider .sl-lastname');
  if (first) return _slFocusSurnameInput(first);
  if (!addIfEmpty) return false;
  const row = _slCreateRiderRow(teamEl);
  if (!row) return false;
  _slAutoDorsalForRider(row);
  return _slFocusSurnameInput(row);
}

function _slFocusAdjacentSurname(riderEl, backwards = false) {
  const teamEl = riderEl?.closest('.sl-edit-team');
  const inputs = [...(teamEl?.querySelectorAll('.sl-edit-rider .sl-lastname') || [])];
  const current = riderEl?.querySelector('.sl-lastname');
  const index = inputs.indexOf(current);
  const target = inputs[index + (backwards ? -1 : 1)];
  if (target) return _slFocusSurnameInput(target);
  if (backwards || index < 0) return false;

  // El último apellido del bloque crea automáticamente el siguiente corredor
  // y mantiene el foco en la misma columna.
  const row = _slCreateRiderRow(teamEl);
  if (!row) return false;
  _slAutoDorsalForRider(row);
  return _slFocusSurnameInput(row);
}

// ── Gate por sexo (equipo ↔ carrera) ────────────────────────────────────────
// Filtra la lista de equipos candidatos por el sexo de la carrera: excluye SOLO
// los equipos del sexo OPUESTO. Los del mismo sexo y los que aún no tienen sexo
// asignado (gender null) se mantienen. Si la carrera no tiene sexo (raceGender
// null), no se filtra nada. Esto evita que una startlist femenina se
// automatchee/asigne a un equipo masculino homónimo (y viceversa), error que
// "Women/Femmes" como stopword hace probable en findMatchingTeam.
export function _teamsFilteredByGender(teams, raceGender) {
  if (!raceGender) return [...teams];
  return teams.filter(t => !t.gender || t.gender === raceGender);
}

// Devuelve { ok:true } o { ok:false, reason } si el equipo elegido es del sexo
// OPUESTO al de la carrera. Un equipo sin sexo asignado (o carrera sin sexo) se permite.
export function _validateGenderMismatch(team, raceGender) {
  if (!team || !team.gender || !raceGender || team.gender === raceGender) return { ok: true };
  const label = s => (s === 'female' ? 'femenina/o' : s === 'male' ? 'masculina/o' : s);
  return {
    ok: false,
    reason: `«${team.name}» es un equipo ${label(team.gender)} y esta carrera es ${label(raceGender)}. Asigna el equipo del sexo correcto.`,
  };
}

// Sexo de la carrera del editor de inscritos en curso ('male'|'female'|null).
function _slEditingRaceGender() {
  const race = panelState.allRaces.find(r => r.id === panelState._editingRaceId);
  return (race && race.gender) || null;
}
// Atajos ligados a la carrera en edición (editor de inscritos).
function _slGenderFilteredTeams(teams) {
  return _teamsFilteredByGender(teams, _slEditingRaceGender());
}
function _validateGenderForRace(team) {
  return _validateGenderMismatch(team, _slEditingRaceGender());
}

// Índice por carrera: normaliza el catálogo una vez, no por fila o pulsación.
function _slBuildTeamMatchIndex() {
  panelState._slTeamMatchIndex = new Map();
  const add = (key, team) => {
    if (!key) return;
    const matches = panelState._slTeamMatchIndex.get(key) || [];
    if (!matches.some(t => t.id === team.id)) matches.push(team);
    panelState._slTeamMatchIndex.set(key, matches);
  };
  const available = _slGenderFilteredTeams(activeCatalogTeams(panelState._teamsCache).filter(t => !t.specialEdition));
  const byId = new Map(available.map(t => [t.id, t]));
  available.forEach(team => {
    [team.name, ...(team.nameAliases || '').split('\n')].forEach(name => add(normalizeTeamName(name), team));
    (team.foldedNames || []).forEach(name => add(name, team));
  });
  _slTeamAliases.forEach(alias => {
    const team = byId.get(alias.teamId);
    if (team) add(normalizeTeamName(alias.alias), team);
  });
}

function _slFindUniqueTeam(teamName, teams = null) {
  const matches = (panelState._slTeamMatchIndex.get(normalizeTeamName(teamName)) || [])
    .filter(team => !teams || teams.some(t => t.id === team.id));
  return matches.length === 1 ? matches[0] : null;
}

function _slAutoMatchAll() {
  document.querySelectorAll('#startlistEditorContent .sl-edit-team').forEach(row => {
    if (!row.dataset.teamId) {
      const match = _slFindUniqueTeam(row.querySelector('.sl-team-name').value.trim());
      if (match) row.dataset.teamId = match.id;
    }
    _slUpdateRowEnrichUI(row);
  });
}

async function _slCreateMissingTeam(row) {
  const raceId = panelState._editingRaceId;
  const input = row.querySelector('.sl-team-name');
  const name = input.value.trim();
  if (!name || row.dataset.creatingTeam) return;
  row.dataset.creatingTeam = '1';
  row.inert = true;
  try {
    const { data, error } = await supabase.rpc('ensure_startlist_team', {
      p_race_id: raceId, p_team_name: name, p_team_gender: _slEditingRaceGender(),
    });
    if (error) throw error;
    const resolved = Array.isArray(data) ? data[0] : data;
    if (!resolved?.team_id) throw new Error(resolved?.action === 'ambiguous'
      ? 'Varios equipos coinciden. Selecciona el correcto.' : 'No se pudo crear el equipo.');
    const { data: team, error: teamError } = await supabase.from('teams').select('*').eq('id', resolved.team_id).single();
    if (teamError) throw teamError;
    panelState._teamsCache = [...(panelState._teamsCache || []).filter(t => t.id !== team.id), team];
    if (panelState._editingRaceId !== raceId || !document.contains(row)) return;
    _slBuildTeamMatchIndex();
    row.dataset.teamId = team.id;
    delete row.dataset.teamResolutionError;
    input.value = team.name;
    _slUpdateRowEnrichUI(row);
    row.querySelectorAll('.sl-edit-rider').forEach(rider => { void _slAutoMatchRiderByTeam(rider); });
    showToast(resolved.action === 'created' ? 'Equipo creado y asociado' : 'Equipo asociado', 'success');
  } catch (error) {
    if (panelState._editingRaceId === raceId && document.contains(row)) {
      row.dataset.teamResolutionError = error.message;
      _slUpdateRowEnrichUI(row);
    }
  } finally {
    delete row.dataset.creatingTeam;
    row.inert = false;
  }
}

// Valida que un equipo specialEdition sea compatible con la carrera en edición.
// Devuelve { ok:true } o { ok:false, reason } para bloquear la asignación.
// Reglas: si el specialEdition declara una carrera concreta (specialEditionRaceId),
// solo vale en esa carrera. Si declara un rango [validFrom..validTo], las fechas de
// la carrera deben caer dentro (validFrom null = sin límite inferior). Un specialEdition
// SIN vigencia declarada no se puede validar → se permite.
export function _validateSpecialEditionForRace(team, race) {
  if (!team || !team.specialEdition) return { ok: true };
  if (!race) return { ok: true };

  // Patrón 1: maillot atado a UNA carrera concreta.
  if (team.specialEditionRaceId) {
    if (team.specialEditionRaceId === race.id) return { ok: true };
    const target = panelState.allRaces.find(r => r.id === team.specialEditionRaceId);
    return {
      ok: false,
      reason: `«${team.name}» es un maillot especial reservado para ${target ? `«${target.name}»` : 'otra carrera'}. No corresponde a «${race.name}».`,
    };
  }

  // Patrón 2: rango de fechas (denominación de tramo).
  const from = team.specialEditionValidFrom || null;
  const to   = team.specialEditionValidTo   || null;
  if (from || to) {
    const rStart = race.startDate || race.endDate || null;
    const rEnd   = race.endDate   || race.startDate || null;
    if (!rStart || !rEnd) return { ok: true }; // carrera sin fechas → no se puede validar
    // Solapamiento de [rStart..rEnd] con [from..to] (límites null = abiertos).
    const afterFrom = !from || rEnd >= from;
    const beforeTo  = !to   || rStart <= to;
    if (afterFrom && beforeTo) return { ok: true };
    const rango = `${from || 'inicio de temporada'} → ${to || 'sin fin'}`;
    return {
      ok: false,
      reason: `«${team.name}» es un maillot especial vigente solo en ${rango}. «${race.name}» (${rStart}) queda fuera de ese tramo.`,
    };
  }

  return { ok: true }; // sin vigencia declarada
}

function _slOpenTeamPicker(rowEl) {
  if (!panelState._teamsCache || panelState._teamsCache.length === 0) {
    alertDialog('No hay equipos globales. Crea equipos en la pestaña Equipos primero.');
    return;
  }
  const current = rowEl.dataset.teamId || '';
  const currentName = rowEl.querySelector('.sl-team-name').value.trim();
  // Candidatos filtrados por sexo de la carrera (excluye el sexo opuesto).
  const genderTeams = _slGenderFilteredTeams(activeCatalogTeams(panelState._teamsCache));
  // Si la fila ya tenía asignado un equipo del sexo opuesto (dato heredado),
  // lo incluimos igualmente para que se vea seleccionado y se pueda corregir.
  if (current && !genderTeams.some(t => t.id === current)) {
    const cur = panelState._teamsCache.find(t => t.id === current);
    if (cur) genderTeams.push(cur);
  }
  // La sugerencia se calcula sobre candidatos NO specialEdition (las ediciones
  // especiales nunca se automatchean).
  const suggestion = _slFindUniqueTeam(currentName, genderTeams.filter(t => !t.specialEdition));
  const race = panelState.allRaces.find(r => r.id === panelState._editingRaceId);
  _openTeamCombo({
    title: 'Asignar equipo',
    teams: genderTeams,
    currentId: current,
    suggestionId: suggestion?.id || '',
    validate: (team) => {
      const v = _validateSpecialEditionForRace(team, race);
      if (!v.ok) return v;
      return _validateGenderForRace(team);
    },
    onPick: (val) => {
      rowEl.dataset.teamId = val || '';
      delete rowEl.dataset.teamResolutionError;
      _slUpdateRowEnrichUI(rowEl);
      rowEl.querySelectorAll('.sl-edit-rider').forEach(rider => { void _slAutoMatchRiderByTeam(rider); });
    },
  });
}

// Estructura del editor de inscritos dentro del drawer (mismos ids).
function startlistEditorBodyHtml() {
  return `
    <div id="startlistEditorContent"></div>
    <div class="u-row panel-save-row">
      <button class="btn btn--primary" id="saveStartlistBtn" disabled>Guardar cambios</button>
      <span class="u-fs-2 u-c-dim" id="startlistSaveStatus"></span>
      <button class="btn btn--ghost u-c-red u-ml-auto" id="deleteStartlistBtn" style="display:none">Eliminar lista</button>
    </div>`;
}

// Listeners del editor de inscritos (por apertura del drawer).
function wireStartlistEditor() {
  document.getElementById('saveStartlistBtn').addEventListener('click', saveStartlistEdits);
  document.getElementById('deleteStartlistBtn').addEventListener('click', deleteStartlist);
  const content = document.getElementById('startlistEditorContent');
  content.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.sl-dorsal, .sl-firstname, .sl-lastname')) {
      e.preventDefault();
      saveStartlistEdits();
    }
  });
  // Delegado para el picker manual de match (botón ✓ BD / 🔗 en cada rider)
  content.addEventListener('click', (e) => {
    const btn = e.target.closest('.sl-rider-match-btn');
    if (!btn) return;
    const riderEl = btn.closest('.sl-edit-rider');
    if (riderEl) _slOpenRiderMatchPicker(riderEl);
  });
}

window.openStartlistEditor = async function(raceId) {
  panelState._editingRaceId = raceId;
  _slRosterMatchCache.clear();
  const race = panelState.allRaces.find(r => r.id === raceId);
  _slPreparedImport = null;
  panelState._editingRaceProvisional = !!(race && race.startlistProvisional);

  // El editor vive ahora en el drawer (paradigma único). Se monta su cuerpo y
  // sus listeners; el resto de la función pobla #startlistEditorContent igual.
  openDrawer({
    title: race ? `Dorsales — ${race.name}` : `Dorsales — ${raceId}`,
    level: 1,
    render: (body) => {
      body.innerHTML = startlistEditorBodyHtml();
      wireStartlistEditor();
    },
  });

  const content = document.getElementById('startlistEditorContent');
  content.innerHTML = '<div class="u-c-dim">Cargando…</div>';

  const season = _slEditingRaceSeason();
  // Catálogos completos y filas de la carrera en paralelo.
  const [{ data: teams, error: teamsError }, _teams, aliases] = await Promise.all([
    supabase.from('startlist_teams').select('*').eq('raceId', raceId).order('sortOrder'),
    fetchTeams(),
    loadCompleteStartlistCatalog((from, to, count) => supabase.from('team_name_aliases')
      .select('id, teamId, alias', count ? { count: 'exact' } : {})
      .eq('year', season).order('id').range(from, to))
      .then(data => ({ data })).catch(error => ({ error })),
  ]);
  if (panelState._editingRaceId !== raceId) return;
  if (teamsError || aliases.error || !panelState._teamsCache) {
    content.textContent = `No se pudo cargar la lista: ${teamsError?.message || aliases.error?.message || 'catálogo de equipos no disponible'}`;
    document.getElementById('saveStartlistBtn').disabled = true;
    return;
  }
  _slTeamAliases = aliases.data || [];
  _slBuildTeamMatchIndex();
  const teamIds = (teams || []).map(t => t.id);
  // Vista resuelta: para los inscritos con globalRiderId, nombre/country vienen
  // del catálogo riders_men/women (canónico). Así el editor abre mostrando los
  // datos oficiales, no el snapshot histórico que pudo quedar desactualizado.
  const { data: riders, error: ridersError } = teamIds.length
    ? await supabase.from('startlist_riders_resolved').select('*').in('teamId', teamIds).order('dorsal')
    : { data: [] };
  if (panelState._editingRaceId !== raceId) return;
  if (ridersError) {
    content.textContent = `No se pudieron cargar los corredores: ${ridersError.message}`;
    document.getElementById('saveStartlistBtn').disabled = true;
    return;
  }

  const ridersByTeam = {};
  (riders || []).forEach(r => {
    if (!ridersByTeam[r.teamId]) ridersByTeam[r.teamId] = [];
    ridersByTeam[r.teamId].push(r);
  });

  const toolbar = `<div class="u-mb-075">
    <label class="panel-check-label u-gap-050 u-fs-2">
      <input type="checkbox" id="slProvisionalToggle" ${panelState._editingRaceProvisional ? 'checked' : ''}>
      <span>Lista provisional</span>
    </label>
  </div>`;

  let html = `${toolbar}<div id="slTeamsList">`;
  (teams || []).forEach(team => {
    html += _slTeamRowHtml({
      teamName:    team.teamName,
      teamId:      team.teamId || null,
      isConfirmed: team.isConfirmed || false,
      riders:      ridersByTeam[team.id] || [],
    });
  });
  if (!(teams || []).length) {
    html += _slTeamRowHtml({ teamName: '', teamId: null, riders: [] });
  }
  html += `</div><button class="btn btn--ghost u-py-035 u-px-075 u-fs-1 u-mt-025" id="addTeamBtn">+ Añadir equipo</button>`;
  content.innerHTML = html;
  _slUpdateTeamOrderControls();

  // Las identidades ambiguas requieren revisión antes del guardado.
  _slAutoMatchAll();
  document.getElementById('saveStartlistBtn').disabled = false;
  // Solo hay algo que borrar si la carrera ya tiene equipos guardados.
  document.getElementById('deleteStartlistBtn').style.display = (teams || []).length ? '' : 'none';

  document.getElementById('slProvisionalToggle').addEventListener('change', (e) => {
    panelState._editingRaceProvisional = e.target.checked;
    document.querySelectorAll('#startlistEditorContent .sl-confirmed-cell').forEach(el => {
      el.style.display = panelState._editingRaceProvisional ? 'inline-flex' : 'none';
    });
  });

  // Selección explícita para ambigüedades y alta de equipos ausentes.
  content.addEventListener('click', (ev) => {
    const row = ev.target.closest('.sl-edit-team');
    if (!row) return;
    if (ev.target.closest('.sl-team-up-btn')) {
      _slMoveTeamRow(row, 'up');
    } else if (ev.target.closest('.sl-team-down-btn')) {
      _slMoveTeamRow(row, 'down');
    } else if (ev.target.closest('.sl-remove-team-btn')) {
      row.remove();
      _slUpdateTeamOrderControls();
    } else if (ev.target.closest('.sl-remove-rider-btn')) {
      ev.target.closest('.sl-edit-rider')?.remove();
      _slUpdateTeamOrderControls();
    } else if (ev.target.closest('.sl-assign-team') || ev.target.closest('.sl-change-team')) {
      _slOpenTeamPicker(row);
    } else if (ev.target.closest('.sl-create-team')) {
      void _slCreateMissingTeam(row);
    }
  });
  // Flujo rápido de carga por bloques de equipo. Desde el nombre del equipo se
  // entra al primer apellido; desde el último apellido se crea otra fila del
  // mismo equipo. Tab/Shift+Tab desde nombre o apellido numera y busca antes
  // de mover el foco; focusout conserva el matching al salir con el ratón.
  content.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    if (ev.target.matches('.sl-team-name')) {
      if (ev.shiftKey || !ev.target.value.trim()) return;
      const teamEl = ev.target.closest('.sl-edit-team');
      if (_slFocusFirstSurname(teamEl, true)) ev.preventDefault();
      return;
    }
    if (!ev.target.matches('.sl-firstname, .sl-lastname')) return;
    const riderEl = ev.target.closest('.sl-edit-rider');
    if (!riderEl) return;
    _slAutoDorsalForRider(riderEl);
    void _slAutoMatchRiderByTeam(riderEl);
    if (ev.target.matches('.sl-lastname') && _slFocusAdjacentSurname(riderEl, ev.shiftKey)) ev.preventDefault();
  });
  content.addEventListener('focusout', (ev) => {
    if (!ev.target.matches('.sl-firstname, .sl-lastname')) return;
    const rider = ev.target.closest('.sl-edit-rider');
    if (rider) {
      _slAutoDorsalForRider(rider);
      void _slAutoMatchRiderByTeam(rider);
    }
  });
  content.addEventListener('input', (ev) => {
    if (ev.target.matches('.sl-dorsal')) {
      _slUpdateTeamOrderControls();
      return;
    }
    if (ev.target.matches('.sl-country')) {
      const code = ev.target.value.trim().toLowerCase();
      const preview = ev.target.parentElement.querySelector('.sl-flag-preview');
      if (preview) preview.innerHTML = _slRiderFlagPreview(code);
      return;
    }
    // Al editar nombre/apellido a mano, se invalida el enlace previo.
    if (ev.target.matches('.sl-firstname') || ev.target.matches('.sl-lastname')) {
      const riderEl = ev.target.closest('.sl-edit-rider');
      if (!riderEl) return;
      delete riderEl.dataset.globalRiderId;
      delete riderEl.dataset.slAutoMatchToken;
      delete riderEl.dataset.birthDate;
      delete riderEl.dataset.uciProfileId;
      delete riderEl.dataset.rejectedCandidateIds;
      const badge = riderEl.querySelector('.sl-rider-matched');
      if (badge) badge.style.display = 'none';
      _slRefreshRiderMatchBtn(riderEl);
      const suggestions = riderEl.querySelector('.sl-rider-suggestion');
      if (suggestions) { suggestions.replaceChildren(); suggestions.style.display = 'none'; }
      return;
    }
    if (!ev.target.matches('.sl-team-name')) return;
    const row = ev.target.closest('.sl-edit-team');
    // El cambio de texto invalida cualquier elección anterior. Solo se recupera
    // una coincidencia exacta única; los homónimos requieren selección manual.
    row.dataset.teamId = '';
    delete row.dataset.teamResolutionError;
    const match = _slFindUniqueTeam(ev.target.value.trim());
    if (match) row.dataset.teamId = match.id;
    _slUpdateRowEnrichUI(row);
  });

  document.getElementById('addTeamBtn').addEventListener('click', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = _slTeamRowHtml({ teamName: '', teamId: null, riders: [] });
    const teamDiv = wrapper.firstElementChild;
    document.getElementById('slTeamsList').appendChild(teamDiv);
    _slUpdateRowEnrichUI(teamDiv);
    _slUpdateTeamOrderControls();
  });

  content.scrollIntoView({ behavior: 'smooth' });
};

window.addRiderRow = function(btn) {
  return _slCreateRiderRow(btn.closest('.sl-edit-team'));
};

function closeStartlistEditor() {
  panelState._editingRaceId = null;
  _slPreparedImport = null;
  panelState._editingRaceProvisional = false;
  closeDrawer(1);
}

function _slShowImportIssues(report) {
  const labels = { MISSING_COUNTRY: 'Falta nacionalidad', MISSING_BIRTH_DATE: 'Falta fecha de nacimiento verificada',
    REVIEW_RIDER: 'Revisa las fichas candidatas', IDENTITY_CONFLICT: 'La fecha o el identificador UCI no coincide', AMBIGUOUS_TEAM: 'Selecciona el equipo correcto' };
  const rows = [...document.querySelectorAll('#startlistEditorContent .sl-edit-rider')];
  document.querySelectorAll('#startlistEditorContent .sl-rider-suggestion').forEach(el => { el.replaceChildren(); el.style.display = 'none'; });
  for (const issue of report.issues || []) {
    const row = rows.find(el => issue.rowKey && el.dataset.rowKey === issue.rowKey)
      || rows.find(el => Number(el.querySelector('.sl-dorsal').value) === issue.dorsal);
    const slot = row?.querySelector('.sl-rider-suggestion');
    if (!slot) continue;
    slot.style.display = 'block';
    const text = document.createElement('div');
    text.textContent = labels[issue.code] || issue.code;
    slot.appendChild(text);
    for (const candidate of issue.candidates || []) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn--ghost';
      button.textContent = `${candidate.firstName} ${candidate.lastName} · ${candidate.nationality || '—'} · ${candidate.birthDate || '—'}`;
      button.addEventListener('click', () => {
        _slApplyAutomaticRiderMatch(row, candidate);
        slot.replaceChildren(); slot.style.display = 'none';
      });
      slot.appendChild(button);
    }
    if (issue.canCreate) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn--ghost';
      button.textContent = 'Revisados: ninguno corresponde a este corredor';
      button.addEventListener('click', () => {
        row.dataset.rejectedCandidateIds = JSON.stringify(issue.candidates.map(c => c.id));
        slot.replaceChildren(); slot.style.display = 'none';
        _slOpenRiderMatchPicker(row);
      });
      slot.appendChild(button);
    }
  }
  const detail = (report.issues || []).map(issue => {
    const subject = issue.dorsal > 0 ? `Dorsal ${issue.dorsal}`
      : [issue.firstName, issue.lastName].filter(Boolean).join(' ') || issue.teamName || 'Corredor sin dorsal';
    return `${subject}: ${labels[issue.code] || issue.code}`;
  }).join(' · ');
  document.getElementById('startlistSaveStatus').textContent = `Completa los datos pendientes para guardar. ${detail}`;
}

async function saveStartlistEdits() {
  if (!panelState._editingRaceId || _slSaving) return;
  if (document.querySelector('#startlistEditorContent [data-creating-team]')) {
    showToast('Espera a que termine el alta del equipo.', 'error');
    return;
  }
  const raceId = panelState._editingRaceId;
  const status = document.getElementById('startlistSaveStatus');
  const button = document.getElementById('saveStartlistBtn');
  const editor = document.getElementById('startlistEditorContent');
  _slSaving = true; button.disabled = true; editor.inert = true;
  status.textContent = 'Guardando inscritos…';
  try {
    await Promise.all([...editor.querySelectorAll('.sl-edit-rider')]
      .filter(row => !row.dataset.globalRiderId)
      .map(row => _slAutoMatchRiderByTeam(row)));
    if (panelState._editingRaceId !== raceId || !document.contains(editor)) return;
    const teams = [...document.querySelectorAll('#startlistEditorContent .sl-edit-team')].map(el => ({
      teamName: el.querySelector('.sl-team-name').value.trim(),
      teamId: el.dataset.teamId || null,
      isConfirmed: el.querySelector('.sl-is-confirmed')?.checked || false,
      riders: [...el.querySelectorAll('.sl-edit-rider')].filter(row =>
        ['.sl-dorsal', '.sl-firstname', '.sl-lastname', '.sl-country'].some(selector => row.querySelector(selector)?.value.trim())
      ).map(row => ({
        rowKey: row.dataset.rowKey,
        startlistRiderId: row.dataset.startlistRiderId || null,
        dorsal: row.querySelector('.sl-dorsal').value.trim(),
        firstName: row.querySelector('.sl-firstname').value.trim(),
        lastName: row.querySelector('.sl-lastname').value.trim(),
        countryCode: row.querySelector('.sl-country').value.trim().toLowerCase(),
        globalRiderId: row.dataset.globalRiderId || null,
        birthDate: row.dataset.birthDate || null,
        otherNames: row.dataset.otherNames || null,
        uciProfileId: row.dataset.uciProfileId || null,
        sourceUrl: row.dataset.sourceUrl || null,
        rejectedCandidateIds: JSON.parse(row.dataset.rejectedCandidateIds || '[]'),
      })),
    }));
    const orderedTeams = orderStartlistTeamsForSave(teams);
    const source = { raceId, teams: orderedTeams,
      expectedRiderCount: orderedTeams.reduce((sum, team) => sum + team.riders.length, 0) };
    const { report } = await saveEnrichedStartlist((name, args) => supabase.rpc(name, args), source,
      panelState._editingRaceProvisional, _slPreparedImport, prepared => {
        if (panelState._editingRaceId === raceId) _slPreparedImport = prepared;
      });
    if (panelState._editingRaceId !== raceId) return;
    if (report.status !== 'applied') { _slShowImportIssues(report); return; }
    const race = panelState.allRaces.find(r => r.id === raceId);
    if (race) Object.assign(race, { startlistImportedAt: report.importedAt, startlistProvisional: panelState._editingRaceProvisional });
    _slPreparedImport = null;
    if (report.createdTeams) await fetchTeams({ force: true });
    await openStartlistEditor(raceId);
    document.getElementById('startlistSaveStatus').textContent = `Guardado: ${report.teams} equipos, ${report.riders} corredores. Altas: ${report.createdTeams} equipos y ${report.createdRiders} corredores.`;
    showToast('Inscritos actualizados', 'success');
    void loadExistingStartlists();
  } catch (error) {
    if (error.code === '40001') _slPreparedImport = null;
    status.textContent = 'Error: ' + error.message;
  } finally {
    _slSaving = false; button.disabled = false; editor.inert = false;
  }
}
