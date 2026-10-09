// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Selección de carrera para una jornada y alta de carrera nueva
// ─────────────────────────────────────────────────────────────────

import { attachCountryAutocomplete } from '../country-select.js';
import { supabase, countryFlag } from '../shared.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { attachInlineUpload } from './uploads.js';
import {
  ensureRaceYearLoaded, loadSidebar, raceYearFromDateKey, upsertRaceLocal,
} from './agenda.js';
import { openEditor } from './jornada-editor.js';
import { moveBroadcastRow, updateBroadcastLabels } from './jornada-fields.js';
import { renderRacesView } from './races-view.js';

// ── Modal: seleccionar carrera ────────────────────────────────────
// Cuerpo del selector de carrera (mismos ids que el markup estático que
// sustituye; se monta en el body del drawer).
function raceModalBodyHtml() {
  return `
    <div class="modal__search">
      <input type="text" id="raceSearch" placeholder="Buscar carrera…" class="race-search-input">
    </div>
    <div class="modal__list" id="raceList">
      <div id="raceSuggestionsSection" style="display:none">
        <div class="race-modal-section-label" id="raceSuggestionsLabel"></div>
        <div id="raceSuggestions"></div>
        <div class="race-modal-divider" id="raceModalDivider" style="display:none">
          <span>Otras carreras</span>
        </div>
      </div>
      <div id="raceListGeneral"></div>
    </div>
    <div class="race-modal-footer">
      <button class="btn btn--ghost btn--full" id="newRaceBtn">+ Crear carrera nueva</button>
    </div>`;
}

function wireRaceModal() {
  document.getElementById('raceSearch').addEventListener('input', e => {
    renderRaceModal(e.target.value);
  });
  document.getElementById('newRaceBtn').addEventListener('click', () => {
    closeRaceModal();
    openNewRaceEditor();
  });
}

let _racePickerLevel = 1;  // nivel en el que se abrió el selector de carrera

export async function openRaceModal() {
  await ensureRaceYearLoaded(raceYearFromDateKey(panelState.currentDateKey));
  // Si el editor de jornada (nivel 1) está abierto, apilar en nivel 2;
  // si se abre desde la agenda (+ Añadir jornada), va en nivel 1.
  const level = document.getElementById('editorArea') ? 2 : 1;
  _racePickerLevel = level;
  openDrawer({
    title: 'Seleccionar carrera',
    level,
    render: (body) => {
      body.innerHTML = raceModalBodyHtml();
      wireRaceModal();
      renderRaceModal('');
    },
  });
  // Refrescar IDs con jornada en este día y re-render
  try {
    const { data: dayData } = await supabase
      .from('race_days').select('raceId').eq('dateKey', panelState.currentDateKey);
    panelState.currentDayRaceIds = new Set((dayData || []).map(d => d.raceId).filter(Boolean));
  } catch (e) {
    // Si falla, usamos el Set que ya teníamos
  }
  renderRaceModal('');
}

export function getRaceSuggestionsForDate(dateKey,assignedRaceIds=panelState.currentDayRaceIds) {
  if (!dateKey) return [];
  return panelState.allRaces.filter(r => {
    const start = r.startDate || '';
    const end   = r.endDate   || '';
    if (!start || !end) return false;
    return start <= dateKey && dateKey <= end && !assignedRaceIds.has(r.id) && !r.isCancelled;
  });
}

function buildRaceOption(race, suggested = false) {
  const opt = document.createElement('div');
  opt.className = 'race-option' + (suggested ? ' race-option--suggested' : '');
  opt.innerHTML = `
    ${race.hideFlag ? '<span class="race-option__flag"></span>' : `<span class="race-option__flag">${countryFlag(race.countryCode)}</span>`}
    <div>
      <div class="race-option__name">${race.name}</div>
      <div class="race-option__cat">${race.uciCategory || ''} · ${race.gender === 'female' ? 'Femenino' : 'Masculino'}</div>
    </div>`;
  opt.addEventListener('click', () => selectRace(race));
  return opt;
}

function renderRaceModal(query) {
  const suggestionsSection = document.getElementById('raceSuggestionsSection');
  const suggestionsLabel   = document.getElementById('raceSuggestionsLabel');
  const suggestionsEl      = document.getElementById('raceSuggestions');
  const divider            = document.getElementById('raceModalDivider');
  const generalEl          = document.getElementById('raceListGeneral');

  const sorted = (arr) => [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));

  if (query.trim() === '') {
    // — Sin búsqueda: sugeridas arriba + resto abajo —
    const suggested = getRaceSuggestionsForDate(panelState.currentDateKey);
    const suggestedIds = new Set(suggested.map(r => r.id));
    const rest = panelState.allRaces.filter(r => !suggestedIds.has(r.id));

    if (suggested.length > 0) {
      suggestionsLabel.textContent = `Carreras pendientes del ${formatDateLabel(panelState.currentDateKey)}`;
      suggestionsEl.innerHTML = '';
      sorted(suggested).forEach(r => suggestionsEl.appendChild(buildRaceOption(r, true)));
      divider.style.display = rest.length > 0 ? 'flex' : 'none';
      suggestionsSection.style.display = 'block';
    } else {
      suggestionsSection.style.display = 'none';
      divider.style.display = 'none';
    }

    generalEl.innerHTML = '';
    if (rest.length === 0 && suggested.length === 0) {
      generalEl.innerHTML = `<div class="panel-empty">Sin carreras</div>`;
    } else {
      sorted(rest).forEach(r => generalEl.appendChild(buildRaceOption(r, false)));
    }

  } else {
    // — Con búsqueda: una lista unificada, sugeridas marcadas —
    suggestionsSection.style.display = 'none';
    const q = query.toLowerCase();
    const filtered = panelState.allRaces.filter(r => r.name?.toLowerCase().includes(q));
    const suggestedIds = new Set(getRaceSuggestionsForDate(panelState.currentDateKey).map(r => r.id));

    generalEl.innerHTML = '';
    if (filtered.length === 0) {
      generalEl.innerHTML = `<div class="panel-empty">Sin resultados</div>`;
    } else {
      sorted(filtered).forEach(r => generalEl.appendChild(buildRaceOption(r, suggestedIds.has(r.id))));
    }
  }
}

function formatDateLabel(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

function selectRace(race) {
  // Crear nueva jornada con esta carrera para el día actual
  createNewRaceDay(race.id);
  closeRaceModal();
}

function closeRaceModal() {
  closeDrawer(_racePickerLevel);
}

export async function createNewRaceDay(raceId) {
  const newId = crypto.randomUUID();
  const { error } = await supabase.from('race_days').insert({
    id:              newId,
    raceId,
    dateKey:         panelState.currentDateKey,
    date:            panelState.currentDateKey,
    editorialStatus: 'draft',
    updatedAt:       new Date().toISOString(),
  });
  if (error) { showToast('Error al crear jornada: ' + error.message); return; }
  await loadSidebar();
  openEditor(newId);
}

// ── Modal: nueva carrera ──────────────────────────────────────────
export function setupModals() {
  // Race modal
  // El selector de carrera y el editor "nueva carrera" viven ahora en el
  // drawer; sus listeners se cablean por apertura (wireRaceModal en
  // openRaceModal, wireNewRaceEditor en openNewRaceEditor). El cierre y el
  // click-fuera los gestiona el propio drawer (✕ + scrim).

  // Broadcast buttons (delegated — funciona para filas cargadas y añadidas dinámicamente)
  document.addEventListener('click', e => {
    const panel = e.target.closest('.tv-entry-panel');
    if (!panel) return;
    if (e.target.classList.contains('remove-broadcast-btn')) {
      panel.remove();
      updateBroadcastLabels();
    } else if (e.target.classList.contains('move-broadcast-up-btn')) {
      moveBroadcastRow(panel, 'up');
    } else if (e.target.classList.contains('move-broadcast-down-btn')) {
      moveBroadcastRow(panel, 'down');
    }
  });
}

// ── Editor "nueva carrera" (drawer) ───────────────────────────────
// Mismos ids nr-* que el markup anterior para no tocar reset/save.
function newRaceBodyHtml() {
  return `
    <div id="newRaceError" class="alert alert--error" style="display:none"></div>
    <div class="field">
      <label>Nombre</label>
      <input type="text" id="nr-name" placeholder="Vuelta a España">
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Categoría UCI</label>
        <select id="nr-uci">
          <option value="WC">WC</option><option value="CC">CC</option><option value="CN">CN</option>
          <option value="1.UWT">1.UWT</option><option value="2.UWT">2.UWT</option>
          <option value="1.WWT">1.WWT</option><option value="2.WWT">2.WWT</option>
          <option value="1.Pro">1.Pro</option><option value="2.Pro">2.Pro</option>
          <option value="1.1">1.1</option><option value="2.1">2.1</option>
          <option value="1.2">1.2</option><option value="2.2">2.2</option>
          <option value="1.2U">1.2U</option><option value="2.2U">2.2U</option>
        </select>
      </div>
      <div class="field">
        <label>Género</label>
        <select id="nr-gender">
          <option value="male">Masculino</option>
          <option value="female">Femenino</option>
        </select>
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Formato</label>
        <select id="nr-format">
          <option value="stage_race">Vuelta por etapas</option>
          <option value="one_day">Clásica</option>
        </select>
      </div>
      <div class="field">
        <label>País (código ISO)</label>
        <input type="text" id="nr-country" placeholder="ES" maxlength="5">
      </div>
      <div class="field">
        <label>Año de edición</label>
        <input type="number" id="nr-year" placeholder="2026" min="2000" max="2099">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Fecha inicio</label>
        <input type="date" id="nr-startDate">
      </div>
      <div class="field">
        <label>Fecha fin</label>
        <input type="date" id="nr-endDate">
      </div>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-preview">
        <input class="u-color-dot" type="color" id="nr-colorPicker" value="#e8c547"
              >
        <input class="u-grow" type="text" id="nr-color" placeholder="#e8c547">
      </div>
    </div>
    <div class="field">
      <label>Logo (URL, opcional)</label>
      <div class="field-upload-wrap" id="nr-logo-wrap"><input type="url" id="nr-logo" placeholder="https://…/logo.png"></div>
    </div>
    <div class="u-row nr-check-row nr-check-row--first">
      <input class="u-checkbox" type="checkbox" id="nr-hideFlag">
      <span class="u-collapse-header" onclick="document.getElementById('nr-hideFlag').click()">Ocultar bandera</span>
    </div>
    <div class="u-row nr-check-row">
      <input class="u-checkbox" type="checkbox" id="nr-isGrandTour">
      <span class="u-collapse-header" onclick="document.getElementById('nr-isGrandTour').click()">Gran Vuelta</span>
    </div>
    <div class="u-row nr-check-row">
      <input type="checkbox" id="nr-isNoClickable" class="u-checkbox nr-flag-check">
      <span onclick="document.getElementById('nr-isNoClickable').click()" class="u-collapse-header nr-flag-label">No clicable</span>
    </div>
    <div class="panel-form-actions">
      <button class="btn btn--primary" id="newRaceSaveBtn">Crear carrera</button>
    </div>
  `;
}

// Listeners del editor "nueva carrera" (por apertura del drawer).
function wireNewRaceEditor() {
  document.getElementById('newRaceSaveBtn').addEventListener('click', saveNewRace);
  // Autoseleccionar formato según categoría UCI
  const CLASICA_CATS   = new Set(['1.UWT','1.WWT','1.Pro','1.1','1.2','1.2U','WC','CC']);
  const WWT_CATS       = new Set(['1.WWT','2.WWT']);
  const HIDEFLAG_CATS  = new Set(['WC','CC']);
  document.getElementById('nr-uci').addEventListener('change', e => {
    const val       = e.target.value;
    const formatSel = document.getElementById('nr-format');
    const genderSel = document.getElementById('nr-gender');
    if (val === '') return;
    formatSel.value = CLASICA_CATS.has(val) ? 'one_day' : 'stage_race';
    if (WWT_CATS.has(val))      genderSel.value = 'female';
    if (HIDEFLAG_CATS.has(val)) document.getElementById('nr-hideFlag').checked = true;
  });
  // Color picker — sincronización bidireccional
  const nrPicker = document.getElementById('nr-colorPicker');
  const nrText   = document.getElementById('nr-color');
  nrPicker.addEventListener('input', e => { nrText.value = e.target.value; });
  nrText.addEventListener('input', e => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) nrPicker.value = e.target.value;
  });
  // Upload inline de logo + autocompletado de país
  attachInlineUpload(document.getElementById('nr-logo'), 'logo');
  attachCountryAutocomplete(document.getElementById('nr-country'));
}

// Abre el editor de nueva carrera en el drawer.
// presetYear: año a preseleccionar (cuando se abre desde la vista Carreras).
export function openNewRaceEditor({ presetYear = null } = {}) {
  openDrawer({
    title: 'Nueva carrera',
    level: 1,
    render: (body) => {
      body.innerHTML = newRaceBodyHtml();
      wireNewRaceEditor();
      resetNewRaceModal();
      if (presetYear != null) {
        const yr = document.getElementById('nr-year');
        if (yr) yr.value = presetYear;
      }
    },
  });
}

function resetNewRaceModal() {
  const nrErr = document.getElementById('newRaceError');
  if (nrErr) nrErr.style.display = 'none';
  ['nr-name','nr-country','nr-logo','nr-color','nr-startDate','nr-endDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const yr = document.getElementById('nr-year');
  if (yr) yr.value = new Date().getFullYear();
  const uci = document.getElementById('nr-uci');
  if (uci) uci.selectedIndex = 0;
  const gender = document.getElementById('nr-gender');
  if (gender) gender.selectedIndex = 0;
  const format = document.getElementById('nr-format');
  if (format) format.selectedIndex = 0;
  const colorPicker = document.getElementById('nr-colorPicker');
  if (colorPicker) colorPicker.value = '#e8c547';
  const hideFlag = document.getElementById('nr-hideFlag');
  if (hideFlag) hideFlag.checked = false;
  const isGT = document.getElementById('nr-isGrandTour');
  if (isGT) isGT.checked = false;
  const isNC = document.getElementById('nr-isNoClickable');
  if (isNC) isNC.checked = false;
}

function closeNewRaceModal() {
  closeDrawer(1);
}

// ── Validación categoría ↔ género ────────────────────────────────
export function validateCatGender(uci, gender, errDiv) {
  const MALE_ONLY = new Set(['1.UWT','2.UWT']);
  const FEM_ONLY  = new Set(['1.WWT','2.WWT']);
  if (MALE_ONLY.has(uci) && gender === 'female') {
    errDiv.textContent = `La categoría ${uci} es exclusivamente masculina.`;
    errDiv.style.display = 'block';
    return false;
  }
  if (FEM_ONLY.has(uci) && gender !== 'female') {
    errDiv.textContent = `La categoría ${uci} es exclusivamente femenina.`;
    errDiv.style.display = 'block';
    return false;
  }
  return true;
}

// Las carreras CN (Campeonatos Nacionales) alimentan la página de Modo Campeonatos,
// que deduce la prueba (línea/CRI, sub23, género) parseando el nombre. Por eso el
// nombre ES y, si existe, el EN deben seguir la convención. Bloquea el guardado y
// da un tip cuando no la cumplen. Misma firma/uso que validateCatGender.
export function validateChampionshipName(uci, name, nameEn, errDiv) {
  if (uci !== 'CN') return true; // solo aplica a CN
  // ES: "Campeonato de <País> <línea|CRI> [sub23] <masculino|femenino>"
  const reEs = /^Campeonato de .+\s+(línea|cri)\b.*\b(masculino|femenino)\s*$/i;
  if (!reEs.test((name || '').trim())) {
    errDiv.textContent = 'Nombre CN inválido. Formato: "Campeonato de (País) (línea|CRI) (sub23 si aplica) (masculino|femenino)". Ej: "Campeonato de España CRI sub23 masculino".';
    errDiv.style.display = 'block';
    return false;
  }
  // EN (solo si hay nameEn): "<Gentilicio> Championships - <Men's|Women's> [U23] <RR|ITT>"
  if ((nameEn || '').trim()) {
    const reEn = /Championships\s*-\s*(men's|women's)\b.*\b(rr|itt)\s*$/i;
    if (!reEn.test(nameEn.trim())) {
      errDiv.textContent = "Invalid EN name. Format: \"(Nationality) Championships - (Men's|Women's) (U23 if applies) (RR|ITT)\". E.g. \"Spanish Championships - Men's U23 ITT\".";
      errDiv.style.display = 'block';
      return false;
    }
  }
  return true;
}

async function saveNewRace() {
  const name    = document.getElementById('nr-name').value.trim();
  const errDiv  = document.getElementById('newRaceError');

  if (!name) {
    errDiv.textContent = 'El nombre es obligatorio.';
    errDiv.style.display = 'block';
    return;
  }

  const uci    = document.getElementById('nr-uci').value;
  const gender = document.getElementById('nr-gender').value;
  if (!validateCatGender(uci, gender, errDiv)) return;
  // El modal de nueva carrera no tiene nameEn → se valida solo el ES (el EN se
  // valida al editar). La convención CN alimenta la página de Modo Campeonatos.
  if (!validateChampionshipName(uci, name, null, errDiv)) return;

  const newRaceId = crypto.randomUUID();
  const newSeriesId = crypto.randomUUID();
  const data = {
    id:          newRaceId,
    raceSeriesId: newSeriesId,
    name,
    uciCategory: document.getElementById('nr-uci').value,
    gender:      document.getElementById('nr-gender').value,
    raceFormat:  document.getElementById('nr-format').value,
    countryCode: document.getElementById('nr-country').value.trim() || null,
    colorHex:    document.getElementById('nr-color').value || document.getElementById('nr-colorPicker').value || '#888888',
    logoUrl:     document.getElementById('nr-logo').value.trim() || null,
    hideFlag:    document.getElementById('nr-hideFlag').checked || false,
    isGrandTour: document.getElementById('nr-isGrandTour').checked || false,
    isNoClickable: document.getElementById('nr-isNoClickable').checked || false,
    startDate:   document.getElementById('nr-startDate').value || null,
    endDate:     document.getElementById('nr-endDate').value   || null,
    year:        parseInt(document.getElementById('nr-year').value) || new Date().getFullYear(),
    createdAt:   new Date().toISOString(),
  };

  try {
    const { error: seriesErr } = await supabase.from('race_series').insert({
      id: newSeriesId,
      canonicalName: name,
      gender,
    });
    if (seriesErr) throw seriesErr;
    const { error: insertErr } = await supabase.from('races').insert(data);
    if (insertErr) {
      await supabase.from('race_series').delete().eq('id', newSeriesId);
      throw insertErr;
    }
    const newRace = { ...data };
    upsertRaceLocal(newRace);
    closeNewRaceModal();
    if (panelState._newRaceFromRacesView) {
      panelState._newRaceFromRacesView = false;
      renderRacesView();
    } else {
      selectRace(newRace);
    }
  } catch (err) {
    errDiv.textContent = err?.code === '23514' ? err.message : 'Error al guardar la carrera.';
    errDiv.style.display = 'block';
  }
}
