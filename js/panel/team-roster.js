// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Plantilla y temporada del equipo
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { canHaveTeamRoster } from '../services/team-roster.js';
import { confirmDialog } from '../components/dialog.js';
import { setGenderToggleActive, wireGenderToggle } from '../components/gender-toggle.js';
import { automaticTeamHeaderText } from '../team-appearance.js';
import { panelState } from './state.js';
import { CURRENT_TEAM_SEASON, MARKET_SEASON } from './constants.js';
import { showToast } from './helpers.js';
import { _slRiderFlagPreview } from './startlist-picker.js';
import {
  closeTeamEditor, DEFAULT_TEAM, fetchTeamSeasonsForYear, fetchTeamSeasonYears,
  populateTeamsYearSelect, renderTeamsList,
} from './teams.js';
import { openRiderEditor } from './riders.js';
import { renderMarketTeams, renderTransfersList } from './fichajes.js';

// ═════════════════════════════════════════════════════════════════
//  PLANTILLA DEL EQUIPO (afiliaciones + observaciones UCI históricas)
// ═════════════════════════════════════════════════════════════════
//
// La plantilla se construye desde rider_team_affiliations del AÑO EN CURSO,
// NO desde currentTeamId: un corredor puede tener afiliación a este equipo en
// 2026 aunque su currentTeamId apunte a otro (fichajes, catálogo oro).
//
// ⚠️ Las fechas de vínculo se escriben SIEMPRE directo sobre
// rider_team_affiliations, actualizando el id real de la fila. NUNCA vía
// currentTeamId: el trigger sync_rider_to_affiliation borra la afiliación SIMPLE
// (fechas NULL) del corredor para el año — de CUALQUIER equipo, no solo este —
// y la reescribiría con fechas NULL, robando afiliaciones a otros equipos.

let _rosterRows   = [];                 // [{ riderId, riderGender, dateFrom, dateTo, rider }]
let _rosterAddGender = 'male';          // género activo del buscador (equipos sin género)

// Muestra/oculta el panel de plantilla según el estado del equipo y lo carga.
export function _syncRosterVisibility(teamId, specialEdition, season = null) {
  const panel = document.getElementById('teamRosterPanel');
  if (!panel) return;
  const team = (panelState._teamsCache || []).find(t => t.id === teamId);
  // Una categoría de selección oculta la plantilla antes de guardar. Una
  // selección ya guardada solo se habilita tras confirmar su nueva identidad.
  const category = season?.category ?? document.getElementById('te-category')?.value ?? team?.category;
  const show = !!teamId && canHaveTeamRoster(team && { ...team, category, specialEdition });
  panel.style.display = show ? 'flex' : 'none';
  if (!show) { panelState._rosterTeamId = null; _rosterRows = []; return; }
  setupRosterPanel();
  panelState._rosterTeamId = teamId;
  document.getElementById('teamRosterYear').textContent = panelState._editingTeamSeasonYear;
  // Reset del buscador de añadir
  const addSearch = document.getElementById('rosterAddSearch');
  if (addSearch) addSearch.value = '';
  const addResults = document.getElementById('rosterAddResults');
  if (addResults) { addResults.style.display = 'none'; addResults.innerHTML = ''; }
  // Género del buscador: el del equipo si lo tiene; si no, toggle visible.
  const toggle = document.getElementById('rosterAddGenderToggle');
  if (team?.gender) {
    _rosterAddGender = team.gender;
    if (toggle) toggle.style.display = 'none';
  } else {
    _rosterAddGender = 'male';
    if (toggle) toggle.style.display = 'flex';
    _updateRosterGenderToggle();
  }
  loadTeamRoster(teamId);
}

const _updateRosterGenderToggle = () =>
  setGenderToggleActive('rosterAddGenderMale', 'rosterAddGenderFemale', _rosterAddGender);

async function loadTeamRoster(teamId) {
  const matrix = (panelState._teamsCache || []).find(t => t.id === teamId);
  if (!canHaveTeamRoster(matrix && { ...matrix, category: panelState._season27Row?.category ?? matrix.category })) return;
  const list = document.getElementById('teamRosterList');
  if (list) list.innerHTML = '<div class="u-fs-3 u-c-dim">Cargando…</div>';
  try {
    // El contrato administrativo combina afiliaciones editables con observaciones
    // oficiales UCI de 2020–2025. Estas últimas acreditan una plantilla anual, no
    // fechas contractuales, y se devuelven como filas de solo lectura.
    const cols = 'id, firstName, lastName, otherNames, nationality, birthDate, currentTeamId, verified, source';

    // 1) Filas resueltas para este equipo y año.
    const { data: rosterData, error: affErr } = await supabase.rpc('admin_get_team_roster', {
      p_team_id: teamId,
      p_year: panelState._editingTeamSeasonYear,
    });
    if (affErr) throw affErr;
    const affs = Array.isArray(rosterData) ? rosterData : [];

    // 2) Traer las fichas de esos corredores (por género).
    const menIds   = (affs || []).filter(a => a.riderGender === 'male').map(a => a.riderId);
    const womenIds = (affs || []).filter(a => a.riderGender === 'female').map(a => a.riderId);
    const [men, women] = await Promise.all([
      menIds.length   ? supabase.from('riders_men').select(cols).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
      womenIds.length ? supabase.from('riders_women').select(cols).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
    ]);
    const riderByKey = new Map();
    men.forEach(r => riderByKey.set(`male:${r.id}`, r));
    women.forEach(r => riderByKey.set(`female:${r.id}`, r));

    // 3) Construir filas desde las afiliaciones (la ficha puede faltar → fila huérfana).
    const rows = [];
    (affs || []).forEach(a => {
      const gender = a.riderGender === 'female' ? 'female' : 'male';
      const key = `${gender}:${a.riderId}`;
      rows.push({
        id: a.id,
        affiliationType: a.affiliationType,
        sourceUrl: a.sourceUrl,
        dateBasis: a.dateBasis,
        readOnly: a.readOnly === true,
        sourceKind: a.sourceKind || 'affiliation',
        riderId: a.riderId,
        riderGender: gender,
        dateFrom: a.dateFrom || null,
        dateTo:   a.dateTo   || null,
        rider: riderByKey.get(key) || null,
      });
    });

    // La ficha puede faltar (afiliación huérfana: p. ej. justo tras fusionar un
    // duplicado, su afiliación queda apuntando a un id ya borrado) → null-guard
    // en el orden; esas filas se pintan degradadas en renderTeamRoster.
    const sortKey = (row) => row.rider
      ? `${row.rider.lastName || ''} ${row.rider.firstName || ''}`
      : `￿${row.riderId}`;   // huérfanas al final
    rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'es', { sensitivity: 'base' }));
    if (panelState._rosterTeamId !== teamId) return;
    _rosterRows = rows;
    renderTeamRoster();
  } catch (err) {
    console.error('[loadTeamRoster]', err);
    if (list) list.innerHTML = `<div class="u-c-red u-fs-3">Error cargando la plantilla: ${esc(err.message || String(err))}</div>`;
  }
}

function renderTeamRoster() {
  const list = document.getElementById('teamRosterList');
  const countEl = document.getElementById('teamRosterCount');
  if (!list) return;
  if (countEl) countEl.textContent = _rosterRows.length ? `${_rosterRows.length} corredor${_rosterRows.length === 1 ? '' : 'es'}` : '';

  if (_rosterRows.length === 0) {
    list.innerHTML = `<div class="u-c-dim u-fs-3 u-py-035 u-px-0">Sin corredores en la plantilla ${panelState._editingTeamSeasonYear}. Añade uno existente o crea uno nuevo.</div>`;
    return;
  }

  list.innerHTML = _rosterRows.map(row => {
    const r = row.rider;
    if (!r) {
      // Afiliación huérfana (el corredor ya no existe): fila degradada.
      return `<div class="roster-row roster-row--error" data-affiliation-id="${esc(row.id)}" data-rider-id="${esc(row.riderId)}" data-gender="${esc(row.riderGender)}">
        <span class="u-grow u-fs-2 u-c-red">⚠ Corredor no encontrado — ${esc(row.riderId)} (${esc(row.riderGender)})</span>
        ${row.readOnly ? '' : '<button class="btn btn--ghost roster-clean-orphan u-btn-xs u-c-red">Limpiar afiliación</button>'}
      </div>`;
    }
    // La prueba no es un traspaso ni modifica la pertenencia habitual.
    const isTrainee = row.affiliationType === 'trainee';
    return `<div class="roster-row u-wrap" data-affiliation-id="${esc(row.id)}" data-rider-id="${esc(r.id)}" data-gender="${esc(row.riderGender)}">
      <span class="u-shrink-0 u-w-160em u-center">${_slRiderFlagPreview(r.nationality)}</span>
      <span class="u-grow u-minw-800 u-fs-3">
        <strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
        ${isTrainee ? '<span class="badge roster-stagiaire-badge">Stagiaire</span>' : ''}
        ${r.birthDate ? `<span class="u-c-dim u-fs-1 u-ml-030">'${esc(String(r.birthDate).slice(2,4))}</span>` : ''}
        ${r.verified === false ? '<span title="Sin verificar" class="u-c-warn u-ml-030">?</span>' : ''}
      </span>
      ${!isTrainee && !row.readOnly ? `<label class="u-row u-row--gap-xs u-fs-1 u-c-dim">Desde
        <input type="date" class="roster-from u-chip-input" value="${esc(row.dateFrom || '')}">
      </label>
      <label class="u-row u-row--gap-xs u-fs-1 u-c-dim">Hasta
        <input type="date" class="roster-to u-chip-input" value="${esc(row.dateTo || '')}">
      </label>
      <button class="btn btn--ghost roster-save-dates u-btn-xs" title="Guardar fechas de vínculo (vacío = toda la temporada)">💾</button>` : ''}
      <button class="btn btn--ghost roster-edit-rider u-btn-xs" title="Editar datos del corredor">✎</button>
      ${row.readOnly
        ? '<span class="u-fs-1 u-c-dim" title="Observación anual oficial sin fechas contractuales">Solo lectura</span>'
        : isTrainee
        ? '<span class="u-fs-1 u-c-dim" title="Las pruebas requieren la RPC y evidencia de stagiaires">Gestión por contrato de stagiaires</span>'
        : '<button class="btn btn--ghost roster-remove u-btn-xs u-c-red" title="Quitar del equipo (no borra el corredor)">Quitar</button>'}
    </div>`;
  }).join('');

  // Listeners por fila
  list.querySelectorAll('.roster-row').forEach(rowEl => {
    const riderId = rowEl.dataset.riderId;
    const gender  = rowEl.dataset.gender;
    const affiliationId = rowEl.dataset.affiliationId;

    const cleanOrphan = rowEl.querySelector('.roster-clean-orphan');
    if (cleanOrphan) cleanOrphan.addEventListener('click', () => removeRiderFromTeam(riderId, gender, { orphan: true, affiliationId }));

    const saveDates = rowEl.querySelector('.roster-save-dates');
    if (saveDates) saveDates.addEventListener('click', () => {
      const from = rowEl.querySelector('.roster-from').value || null;
      const to   = rowEl.querySelector('.roster-to').value || null;
      saveAffiliationDates(riderId, gender, from, to, saveDates, affiliationId);
    });

    const editBtn = rowEl.querySelector('.roster-edit-rider');
    if (editBtn) editBtn.addEventListener('click', () => openRosterRiderEditor(riderId, gender));

    const removeBtn = rowEl.querySelector('.roster-remove');
    if (removeBtn) removeBtn.addEventListener('click', () => removeRiderFromTeam(riderId, gender, { affiliationId }));
  });
}

// Actualización de fechas del vínculo habitual por su identidad real.
async function saveAffiliationDates(riderId, riderGender, dateFrom, dateTo, btnEl, affiliationId) {
  if (!panelState._rosterTeamId) return;
  const row = _rosterRows.find(r => r.id === affiliationId);
  // Las fechas de prueba se mantienen con la RPC documentada y su evidencia.
  if (!row || row.readOnly || row.affiliationType === 'trainee') return;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    showToast('La fecha "desde" no puede ser posterior a "hasta".', 'error');
    return;
  }
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }
  try {
    const payload = { dateFrom: dateFrom || null, dateTo: dateTo || null };
    const { error } = await supabase.rpc('admin_edit_regular_team_affiliation', {
      p_action: 'update', p_team_id: panelState._rosterTeamId, p_year: panelState._editingTeamSeasonYear,
      p_rider_id: riderId, p_rider_gender: riderGender, p_affiliation_id: affiliationId,
      p_date_from: payload.dateFrom, p_date_to: payload.dateTo,
    });
    if (error) throw error;
    // Reflejar en memoria sin recargar.
    if (row) { row.dateFrom = payload.dateFrom; row.dateTo = payload.dateTo; }
    showToast('Fechas guardadas', 'success', 2000);
  } catch (err) {
    console.error('[saveAffiliationDates]', err);
    showToast('Error: ' + (err.message || err), 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '💾'; }
  }
}

// Quitar de la plantilla. La VERDAD es rider_team_affiliations (mig. 116): quitar =
// borrar la afiliación de este corredor a este equipo del año (sea simple o con
// fechas). El trigger inverso deriva currentTeamId (→ NULL si era su afiliación
// activa y no queda otra). NUNCA se escribe currentTeamId a mano.
async function removeRiderFromTeam(riderId, riderGender, { orphan = false, affiliationId } = {}) {
  if (!panelState._rosterTeamId) return;
  const row = _rosterRows.find(r => r.id === affiliationId);
  if (!row || row.readOnly) return;
  const r = row?.rider;
  const name = r ? `${r.firstName} ${r.lastName}` : riderId;
  const isTitular = row.affiliationType !== 'trainee' && panelState._editingTeamSeasonYear === CURRENT_TEAM_SEASON
    && r && r.currentTeamId === panelState._rosterTeamId;

  const msg = orphan
    ? `¿Eliminar la afiliación huérfana de "${name}"?`
    : isTitular
      ? `¿Quitar a ${name} del equipo? Dejará de tener equipo actual. No borra el corredor.`
      : `¿Quitar el tramo de ${name} en este equipo ${panelState._editingTeamSeasonYear}? (Su equipo actual no cambia.)`;
  if (!await confirmDialog(msg, { danger: true })) return;

  try {
    // Borrar la afiliación a este equipo (simple o con fechas). El trigger inverso
    // recalcula currentTeamId.
    if (row.affiliationType === 'trainee') {
      throw new Error('Las afiliaciones de stagiaire se gestionan con su contrato específico.');
    }
    const { error: delErr } = await supabase.rpc('admin_edit_regular_team_affiliation', {
      p_action: 'remove', p_team_id: panelState._rosterTeamId, p_year: panelState._editingTeamSeasonYear,
      p_rider_id: riderId, p_rider_gender: riderGender, p_affiliation_id: affiliationId,
    });
    if (delErr) throw delErr;
    _rosterRows = _rosterRows.filter(x => x.id !== affiliationId);
    renderTeamRoster();
    showToast('Corredor quitado de la plantilla', 'success', 2000);
  } catch (err) {
    console.error('[removeRiderFromTeam]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}

// Añadir corredor existente. La VERDAD es rider_team_affiliations (mig. 116): se
// upserta la afiliación SIMPLE (sin fechas) del año a este equipo y el trigger
// inverso deriva currentTeamId. La pertenencia es única → se borra la afiliación
// simple del equipo anterior (un fichaje). NUNCA se escribe currentTeamId a mano.
async function addExistingRiderToTeam(riderId, riderGender, rider) {
  if (!panelState._rosterTeamId) return;
  if (_rosterRows.some(r => r.riderId === riderId && r.riderGender === riderGender && r.affiliationType === 'regular')) {
    showToast('Ese corredor ya está en la plantilla.', 'info', 2500);
    return;
  }
  try {
    const { error } = await supabase.rpc('admin_edit_regular_team_affiliation', {
      p_action: 'add', p_team_id: panelState._rosterTeamId, p_year: panelState._editingTeamSeasonYear,
      p_rider_id: riderId, p_rider_gender: riderGender,
      p_verified: rider?.verified ?? false,
    });
    if (error) throw error;
    showToast('Corredor añadido a la plantilla', 'success', 2000);
    const addSearch = document.getElementById('rosterAddSearch');
    if (addSearch) addSearch.value = '';
    const addResults = document.getElementById('rosterAddResults');
    if (addResults) { addResults.style.display = 'none'; addResults.innerHTML = ''; }
    await loadTeamRoster(panelState._rosterTeamId);
  } catch (err) {
    console.error('[addExistingRiderToTeam]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}

// Búsqueda de corredores para añadir a la plantilla del equipo.
async function _rosterSearchRiders(q) {
  const results = document.getElementById('rosterAddResults');
  if (!results) return;
  const term = (q || '').trim();
  if (term.length < 3) { results.style.display = 'none'; results.innerHTML = ''; return; }

  const table = _rosterAddGender === 'male' ? 'riders_men' : 'riders_women';
  const safe = term.replace(/[%,()]/g, '');
  results.style.display = 'flex';
  results.innerHTML = '<div class="u-c-dim u-fs-2 u-py-030 u-px-0">Buscando…</div>';
  try {
    const { data, error } = await supabase
      .from(table)
      .select('id, firstName, lastName, nationality, birthDate, currentTeamId, verified')
      .or(`lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`)
      .order('lastName')
      .limit(20);
    if (error) throw error;
    const rows = data || [];
    const inRoster = new Set(_rosterRows.filter(r => r.riderGender === _rosterAddGender && r.affiliationType === 'regular').map(r => r.riderId));
    if (rows.length === 0) {
      results.innerHTML = '<div class="u-c-dim u-fs-2 u-py-030 u-px-0">Sin resultados.</div>';
      return;
    }
    results.innerHTML = rows.map(r => {
      const already = inRoster.has(r.id);
      const team = r.currentTeamId ? (panelState._teamsCache || []).find(t => t.id === r.currentTeamId) : null;
      return `<div class="roster-add-option" data-rid="${esc(r.id)}">
        <span class="u-w-150em u-center">${_slRiderFlagPreview(r.nationality)}</span>
        <span class="u-grow u-min0 u-fs-2"><strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
          ${r.birthDate ? `<span class="u-c-dim u-fs-1">'${esc(String(r.birthDate).slice(2,4))}</span>` : ''}
          ${team ? `<span class="u-block u-fs-1 u-c-dim">${esc(team.name)}</span>` : ''}
        </span>
        ${already
          ? '<span class="u-fs-1 u-c-dim">ya en plantilla</span>'
          : '<button class="btn btn--ghost roster-add-pick u-btn-xs">Añadir</button>'}
      </div>`;
    }).join('');
    results.querySelectorAll('.roster-add-pick').forEach(btn => {
      btn.addEventListener('click', () => {
        const rid = btn.closest('[data-rid]').dataset.rid;
        const rider = rows.find(x => x.id === rid);
        addExistingRiderToTeam(rid, _rosterAddGender, rider);
      });
    });
  } catch (err) {
    console.error('[_rosterSearchRiders]', err);
    results.innerHTML = `<div class="u-c-red u-fs-2 u-py-030 u-px-0">Error: ${esc(err.message || String(err))}</div>`;
  }
}

// Editor de un corredor desde la plantilla: abre el modal de ficha con el género
// correcto y el corredor cargado (reutiliza saveRider/merge/delete). `_ridersGender`
// fija el catálogo (riders_men/women) sobre el que operan esas funciones.
async function openRosterRiderEditor(riderId, riderGender) {
  panelState._ridersGender = riderGender;
  panelState._onRiderSavedOnce = null;   // apertura normal: sin hook de otro flujo
  try {
    const table = riderGender === 'male' ? 'riders_men' : 'riders_women';
    const { data } = await supabase.from(table).select('*').eq('id', riderId).maybeSingle();
    if (data) {
      panelState._ridersAllCache = [data];
      openRiderEditor(riderId, { level: 2 });
    }
  } catch (err) {
    console.error('[openRosterRiderEditor]', err);
  }
}

// Refresca la plantilla del equipo abierto (si la hay) tras editar/borrar/fusionar
// una ficha desde el modal. Sustituye al antiguo loadRidersTable() (la lista global
// se eliminó al fusionar Corredores en Equipos).
export async function _refreshOpenRoster() {
  if (panelState._rosterTeamId) await loadTeamRoster(panelState._rosterTeamId);
}

// ── Crear corredor nuevo dentro del equipo ────────────────────────
// Inserta en riders_* con currentTeamId = equipo (el trigger crea la afiliación
// simple). Las fechas se guardan directamente en la nueva afiliación habitual.
function _rosterGenderForNewRider() {
  // Para crear: si el equipo tiene género, usarlo; si no, el del toggle.
  const team = (panelState._teamsCache || []).find(t => t.id === panelState._rosterTeamId);
  return panelState._season27Row?.gender || team?.gender || _rosterAddGender;
}

function openNewRiderInTeamForm() {
  if (!panelState._rosterTeamId) return;
  const gender = _rosterGenderForNewRider();
  const genderLabel = gender === 'male' ? 'masculino' : 'femenino';
  const results = document.getElementById('rosterAddResults');
  if (!results) return;
  // Reutilizamos rosterAddResults como contenedor del mini-formulario.
  results.style.display = 'flex';
  results.innerHTML = `
    <div class="roster-new-rider">
      <div class="u-fs-2 u-fw-600 u-c-text">Nuevo corredor (${genderLabel}) en este equipo</div>
      <div class="u-grid u-cols-2 u-gap-040">
        <input class="u-input-bordered" type="text" id="rnr-firstName" placeholder="Nombre">
        <input class="u-input-bordered" type="text" id="rnr-lastName" placeholder="Apellido(s)">
        <input type="text" id="rnr-nationality" placeholder="País (es)" maxlength="5" class="u-input-bordered u-lower">
        <input class="u-input-bordered" type="date" id="rnr-birthDate" title="Fecha de nacimiento">
        <label class="u-row u-row--gap-xs u-fs-1 u-c-dim">Desde
          <input class="u-chip-input" type="date" id="rnr-from">
        </label>
        <label class="u-row u-row--gap-xs u-fs-1 u-c-dim">Hasta
          <input class="u-chip-input" type="date" id="rnr-to">
        </label>
      </div>
      <div class="u-row">
        <button class="btn btn--primary u-py-030 u-px-070 u-fs-2" id="rnr-save">Crear</button>
        <button class="btn btn--ghost u-py-030 u-px-070 u-fs-2" id="rnr-cancel">Cancelar</button>
        <span id="rnr-status" class="u-fs-1 u-c-dim"></span>
      </div>
    </div>`;
  document.getElementById('rnr-firstName').focus();
  document.getElementById('rnr-save').addEventListener('click', () => createRiderInTeam(gender));
  document.getElementById('rnr-cancel').addEventListener('click', () => { results.style.display = 'none'; results.innerHTML = ''; });
}

async function createRiderInTeam(gender) {
  if (!panelState._rosterTeamId) return;
  const status = document.getElementById('rnr-status');
  const firstName = document.getElementById('rnr-firstName').value.trim();
  const lastName  = document.getElementById('rnr-lastName').value.trim();
  if (!firstName || !lastName) { if (status) status.textContent = 'Faltan nombre y/o apellido.'; return; }
  const nationality = document.getElementById('rnr-nationality').value.trim().toLowerCase() || null;
  const birthDate   = document.getElementById('rnr-birthDate').value || null;
  const dateFrom    = document.getElementById('rnr-from').value || null;
  const dateTo      = document.getElementById('rnr-to').value || null;
  if (dateFrom && dateTo && dateFrom > dateTo) {
    if (status) status.textContent = 'La fecha desde no puede ser posterior a hasta.';
    return;
  }
  if (status) status.textContent = 'Creando…';

  const table = gender === 'male' ? 'riders_men' : 'riders_women';
  try {
    // Slug con el plegado canónico (igual que saveRider).
    const slugFromFold = async s => {
      const { data } = await supabase.rpc('fold_name_rpc', { p_text: s });
      return (data || '').replace(/ /g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    };
    const baseSlug = `${await slugFromFold(lastName)}-${await slugFromFold(firstName)}`.replace(/^-|-$/g, '') || 'rider';
    let id = baseSlug;
    const { data: existing } = await supabase.from(table).select('id').eq('id', id);
    if (existing?.length) {
      const year = birthDate ? birthDate.slice(0, 4) : Date.now().toString().slice(-4);
      id = `${id}-${year}`;
    }
    // La VERDAD es rider_team_affiliations (mig. 116): se crea la ficha SIN
    // currentTeamId (lo deriva el trigger inverso) y la pertenencia se declara con
    // una afiliación al equipo. NO se escribe currentTeamId a mano.
    const { error } = await supabase.from(table).insert({
      id, firstName, lastName, nationality, birthDate,
      source: 'manual', verified: true,
      updatedAt: new Date().toISOString(),
    });
    if (error) {
      if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
        if (status) status.textContent = 'Ya existe un corredor con ese nombre. Búscalo arriba y añádelo en vez de crearlo.';
        return;
      }
      throw error;
    }
    // Afiliación al equipo: con fechas si se indicaron, simple si no. El trigger
    // inverso deriva currentTeamId.
    {
      const { error: affErr } = await supabase.rpc('admin_edit_regular_team_affiliation', {
        p_action: 'add', p_team_id: panelState._rosterTeamId, p_year: panelState._editingTeamSeasonYear,
        p_rider_id: id, p_rider_gender: gender, p_date_from: dateFrom,
        p_date_to: dateTo, p_verified: true,
      });
      if (affErr) throw affErr;
    }
    showToast('Corredor creado y añadido a la plantilla', 'success', 2500);
    const results = document.getElementById('rosterAddResults');
    if (results) { results.style.display = 'none'; results.innerHTML = ''; }
    await loadTeamRoster(panelState._rosterTeamId);
  } catch (err) {
    console.error('[createRiderInTeam]', err);
    if (status) status.textContent = 'Error: ' + (err.message || err);
  }
}

// Wiring del panel de plantilla (una sola vez).
export function setupRosterPanel() {
  // Se cablea POR APERTURA del drawer (el DOM del roster se recrea cada vez).
  // Idempotente sobre el DOM actual vía data-flag: el panel se llama desde
  // wireTeamEditor y desde _syncRosterVisibility, pero solo cablea una vez por
  // instancia de DOM (evita doble binding sin la vieja guarda global once).
  const box = document.getElementById('rosterAddBox');
  if (!box || box.dataset.wired === '1') return;
  box.dataset.wired = '1';
  let timer = null;
  const addSearch = document.getElementById('rosterAddSearch');
  if (addSearch) addSearch.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => _rosterSearchRiders(addSearch.value), 280);
  });
  wireGenderToggle('rosterAddGenderMale', 'rosterAddGenderFemale', (g) => {
    _rosterAddGender = g; _updateRosterGenderToggle(); _rosterSearchRiders(addSearch?.value || '');
  });
  const newBtn = document.getElementById('rosterNewRiderBtn');
  if (newBtn) newBtn.addEventListener('click', openNewRiderInTeamForm);
}

// ═════════════════════════════════════════════════════════════════
//  TEMPORADA DEL EQUIPO (team_seasons)
// ═════════════════════════════════════════════════════════════════
// La ficha matriz (`teams`) conserva identidad y compatibilidad. Este bloque
// lee y guarda exclusivamente la temporada seleccionada.

let _teamSeasonLoadToken = 0;

function _ts27SetColor(key, value) {
  const color = document.getElementById(`ts27-${key}-color`);
  const text  = document.getElementById(`ts27-${key}-text`);
  if (!color || !text) return;
  const hex = (value || '').toLowerCase();
  const safe = /^#[0-9a-f]{6}$/.test(hex) ? hex : '#000000';
  color.value = safe;
  text.value = safe.toUpperCase();
}

function _ts27GetColor(key) {
  const text = document.getElementById(`ts27-${key}-text`)?.value.trim() || '';
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return document.getElementById(`ts27-${key}-color`)?.value.toLowerCase() || '#000000';
}

function refreshSeason27Preview() {
  const colors = [_ts27GetColor('torsoSides'), _ts27GetColor('torsoCenter'), _ts27GetColor('shorts')];
  document.querySelectorAll('#ts27ColorsPreview i').forEach((square, index) => {
    square.style.background = colors[index];
  });
  const headerBg = _ts27GetColor('headerBg');
  const header = document.getElementById('ts27HeaderPreview');
  if (header) {
    header.style.background = headerBg;
    header.style.color = automaticTeamHeaderText(headerBg);
    header.textContent = document.getElementById('ts27-name')?.value.trim() || 'Barra de título';
  }
}

export function _syncSeason27Visibility(teamId, specialEdition) {
  const panel = document.getElementById('teamSeason27Panel');
  if (!panel) return;
  const show = !!teamId && !specialEdition;
  panel.hidden = !show;
  panel.style.display = show ? 'flex' : 'none';
  if (show) {
    const label = document.getElementById('teamSeasonYearLabel');
    if (label) label.textContent = String(panelState._editingTeamSeasonYear);
    loadTeamSeason27(teamId);
  }
}

async function loadTeamSeason27(teamId) {
  const year = panelState._editingTeamSeasonYear;
  const token = ++_teamSeasonLoadToken;
  const status = document.getElementById('ts27Status');
  if (status) status.textContent = 'Cargando…';
  panelState._season27Row = null;
  try {
    const { data, error } = await supabase
      .from('team_seasons').select('*')
      .eq('teamId', teamId).eq('year', year)
      .maybeSingle();
    if (error) throw error;
    if (token !== _teamSeasonLoadToken || panelState._editingTeamId !== teamId || panelState._editingTeamSeasonYear !== year) return;
    panelState._season27Row = data || null;
    // Sin fila → precargar desde la matriz solo como borrador; guardar crea
    // exclusivamente team_seasons[year].
    const team = (panelState._teamsCache || []).find(t => t.id === teamId) || {};
    const src = panelState._season27Row || team;
    const nameEl = document.getElementById('ts27-name');
    if (!nameEl) return; // el drawer se cerró mientras cargaba
    nameEl.value = src.name || '';
    document.getElementById('ts27-aliases').value = src.nameAliases || '';
    document.getElementById('ts27-uciCode').value = src.uciCode || '';
    document.getElementById('ts27-innerCircle-text').value = src.badgeInnerCircle || '';
    document.getElementById('ts27-translations').value = JSON.stringify(src.translations || {}, null, 2);
    document.getElementById('ts27-category').value = src.category || '';
    document.getElementById('ts27-gender').value = src.gender || '';
    document.getElementById('ts27-badgeVisible').checked = panelState._season27Row
      ? (panelState._season27Row.badgeVisible !== false)
      : year !== MARKET_SEASON;
    document.getElementById('ts27-continuityDoubt').checked = !!panelState._season27Row?.continuityDoubt;
    _ts27SetColor('headerBg',    src.headerBg         || DEFAULT_TEAM.headerBg);
    _ts27SetColor('torsoCenter', src.badgeTorsoCenter || DEFAULT_TEAM.badgeTorsoCenter);
    _ts27SetColor('torsoSides',  src.badgeTorsoSides  || DEFAULT_TEAM.badgeTorsoSides);
    _ts27SetColor('shorts',      src.badgeShorts      || DEFAULT_TEAM.badgeShorts);
    refreshSeason27Preview();
    document.getElementById('teamRosterYear').textContent = year;
    _syncRosterVisibility(teamId, false, src);
    // "No continúa" solo pertenece al contrato del mercado.
    const discBtn = document.getElementById('ts27DiscontinueBtn');
    if (discBtn) {
      discBtn.style.display = panelState._season27Row && year === MARKET_SEASON ? '' : 'none';
      discBtn.textContent = `No continúa en ${year}`;
    }
    if (status) status.textContent = panelState._season27Row ? '' : `Sin temporada ${year}. Guarda para crearla sin modificar la matriz.`;
  } catch (err) {
    console.error('[loadTeamSeason27]', err);
    if (status) status.textContent = `Error cargando la temporada ${year}: ` + (err.message || err);
  }
}

async function saveTeamSeason27() {
  if (!panelState._editingTeamId) return;
  const status = document.getElementById('ts27Status');
  const name = document.getElementById('ts27-name').value.trim();
  if (!name) { status.textContent = 'Falta el nombre de temporada.'; return; }
  const category = document.getElementById('ts27-category').value || null;
  const CATEGORY_GENDER = { WT:'male',WWT:'female',PT:'male',PRW:'female',CT:'male',CTW:'female',NTM:'male',NTW:'female',CLUBM:'male',CLUBW:'female' };
  const headerBg = _ts27GetColor('headerBg');
  let translations;
  try {
    translations = JSON.parse(document.getElementById('ts27-translations').value || '{}');
    if (!translations || Array.isArray(translations) || typeof translations !== 'object') throw new Error();
  } catch {
    status.textContent = 'Las traducciones deben ser un objeto JSON válido.';
    return;
  }
  const badgeInnerCircle = document.getElementById('ts27-innerCircle-text').value.trim().toLowerCase() || null;
  if (badgeInnerCircle && !/^#[0-9a-f]{6}$/.test(badgeInnerCircle)) {
    status.textContent = 'El círculo interior debe usar #RRGGBB o quedar vacío.';
    return;
  }
  status.textContent = 'Guardando…';
  try {
    const payload = {
      name,
      nameAliases: document.getElementById('ts27-aliases').value.split('\n').map(s => s.trim()).filter(Boolean).join('\n') || null,
      uciCode: document.getElementById('ts27-uciCode').value.trim().toUpperCase() || null,
      category,
      gender: document.getElementById('ts27-gender').value || CATEGORY_GENDER[category] || null,
      headerBg,
      headerText:       automaticTeamHeaderText(headerBg),
      badgeTorsoCenter: _ts27GetColor('torsoCenter'),
      badgeTorsoSides:  _ts27GetColor('torsoSides'),
      badgeInnerCircle,
      badgeShorts:      _ts27GetColor('shorts'),
      translations,
      badgeVisible:     document.getElementById('ts27-badgeVisible').checked,
      continuityDoubt:  document.getElementById('ts27-continuityDoubt').checked,
    };
    const { error } = await supabase.rpc('admin_save_team_season', {
      p_team_id: panelState._editingTeamId, p_year: panelState._editingTeamSeasonYear, p_season: payload,
    });
    if (error) throw error;
    status.textContent = 'Guardado.';
    showToast(`Temporada ${panelState._editingTeamSeasonYear} guardada`, 'success', 2500);
    await fetchTeamSeasonYears({ force: true });
    await fetchTeamSeasonsForYear(panelState._editingTeamSeasonYear, { force: true });
    populateTeamsYearSelect();
    if (panelState._teamsListYear === panelState._editingTeamSeasonYear) renderTeamsList();
    await loadTeamSeason27(panelState._editingTeamId);
    if (panelState._editingTeamSeasonYear === MARKET_SEASON) await _refreshMarketTeamsIfVisible();
  } catch (err) {
    console.error('[saveTeamSeason27]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

/**
 * Refresca la lista de equipos de la vista Fichajes si está montada — un
 * renombre 2027 o un cambio de colores/duda debe verse al cerrar el editor.
 * No-op fuera de esa vista (el editor de equipo también vive en Equipos).
 */
async function _refreshMarketTeamsIfVisible() {
  if (!document.getElementById('marketTeamsList')) return;
  const { data } = await supabase.from('team_seasons')
    .select('teamId, name, category, badgeVisible, continuityDoubt')
    .eq('year', MARKET_SEASON);
  panelState._marketSeasons = data || [];
  panelState._trTeamNameById = new Map(panelState._marketSeasons.map(s => [s.teamId, s.name]));
  renderMarketTeams();
  renderTransfersList();   // los nombres 2027 del feed también cambian
}

// Equipos que CIERRAN: marcar que no continúa = borrar su temporada 2027 →
// deja de listarse en Fichajes (la ausencia de fila ES la señal; no hay flag).
// Reversible: "Guardar temporada 2027" vuelve a crearla.
export async function discontinueTeamSeason27() {
  if (!panelState._editingTeamId) return;
  if (panelState._editingTeamSeasonYear !== MARKET_SEASON) return;
  const teamName = document.getElementById('te-name')?.value.trim() || 'este equipo';
  if (!await confirmDialog(`¿Marcar que ${teamName} NO continúa en ${MARKET_SEASON}? Se elimina solo esa temporada y deja de aparecer en Fichajes.`, { danger: true })) return;
  const status = document.getElementById('teamSaveStatus');
  if (status) status.textContent = `Eliminando temporada ${MARKET_SEASON}…`;
  try {
    const { error } = await supabase.rpc('admin_delete_team_season', {
      p_team_id: panelState._editingTeamId, p_year: MARKET_SEASON,
    });
    if (error) throw error;
    showToast(`Marcado: el equipo no continúa en ${MARKET_SEASON}`, 'success', 3000);
    await fetchTeamSeasonYears({ force: true });
    await fetchTeamSeasonsForYear(MARKET_SEASON, { force: true });
    populateTeamsYearSelect();
    if (panelState._teamsListYear === MARKET_SEASON) renderTeamsList();
    await _refreshMarketTeamsIfVisible();
    closeTeamEditor();
  } catch (err) {
    console.error('[discontinueTeamSeason27]', err);
    if (status) status.textContent = 'Error: ' + (err.message || err);
  }
}

// Wiring del panel de temporada (por apertura del drawer, idempotente por DOM).
export function setupSeason27Panel() {
  const panel = document.getElementById('teamSeason27Panel');
  if (!panel || panel.dataset.wired === '1') return;
  panel.dataset.wired = '1';
  document.getElementById('saveTeamSeason27Btn')?.addEventListener('click', saveTeamSeason27);
  document.getElementById('ts27DiscontinueBtn')?.addEventListener('click', discontinueTeamSeason27);
  document.getElementById('ts27-category')?.addEventListener('change', event => {
    const genders = { WT:'male',WWT:'female',PT:'male',PRW:'female',CT:'male',CTW:'female',NTM:'male',NTW:'female',CLUBM:'male',CLUBW:'female' };
    if (genders[event.target.value]) document.getElementById('ts27-gender').value = genders[event.target.value];
    _syncRosterVisibility(panelState._editingTeamId, false, { category: event.target.value || null });
  });
  ['headerBg', 'torsoSides', 'torsoCenter', 'shorts'].forEach(key => {
    const color = document.getElementById(`ts27-${key}-color`);
    const text  = document.getElementById(`ts27-${key}-text`);
    if (!color || !text) return;
    color.addEventListener('input', () => { text.value = color.value.toUpperCase(); refreshSeason27Preview(); });
    text.addEventListener('input', () => {
      const v = text.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { color.value = v.toLowerCase(); refreshSeason27Preview(); }
    });
  });
  document.getElementById('ts27-name')?.addEventListener('input', refreshSeason27Preview);
}
