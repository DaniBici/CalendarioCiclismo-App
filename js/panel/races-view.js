// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Vista de carreras: listado, editor, guardado y duplicado
// ─────────────────────────────────────────────────────────────────

import {
  panelCatalogHeaderHtml, panelCatalogModel, panelRaceListItemHtml, renderPanelCatalog,
} from './catalog-ui.js';
import { attachCountryAutocomplete } from '../country-select.js';
import { mountClassificationEditor } from './race-presentation.js';
import { supabase, countryFlag, esc } from '../shared.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { confirmDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { showToast, toSlug, validateSlug } from './helpers.js';
import { attachInlineUpload } from './uploads.js';
import { initTabs, switchTab } from './navigation.js';
import { ensureRaceYearLoaded, removeRaceLocal, upsertRaceLocal } from './agenda.js';
import { openNewRaceEditor, validateCatGender, validateChampionshipName } from './race-picker.js';
import { _loadUciLink, openUciLinkPanel } from './uci-link.js';
import { openChallengeModal, renderChallengesView } from './challenges.js';

// ── Subvista de la pestaña Carreras: 'races' | 'challenges' ──────────

export function applyRacesSubview(subview) {
  panelState._racesSubview = subview === 'challenges' ? 'challenges' : 'races';
  const isChallenges = panelState._racesSubview === 'challenges';

  // Estado del toggle
  document.querySelectorAll('#racesSubviewToggle .races-subview-btn').forEach(btn => {
    const active = btn.dataset.subview === panelState._racesSubview;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  // Acciones de cabecera: cada subvista muestra su botón "+ Nuevo …"
  const addRaceBtn      = document.getElementById('addRaceDirectBtn');
  const newChallengeBtn = document.getElementById('newChallengeBtn');
  const filtersRow      = document.getElementById('racesFiltersRow');
  if (addRaceBtn)      addRaceBtn.style.display      = isChallenges ? 'none' : '';
  if (newChallengeBtn) newChallengeBtn.style.display = isChallenges ? '' : 'none';
  // Los filtros (año/categoría/país/búsqueda) son específicos de Carreras
  if (filtersRow)      filtersRow.style.display      = isChallenges ? 'none' : '';

  // Cuerpos de cada subvista
  document.getElementById('racesListView').style.display      = isChallenges ? 'none' : '';
  document.getElementById('challengesListView').style.display = isChallenges ? '' : 'none';

  if (isChallenges) renderChallengesView();
  else              renderRacesView();
}

// ── Render listado de carreras ────────────────────────────────────
// Orden canónico de categorías UCI (cuadrícula de botones + agrupación).
const RACES_CAT_ORDER = ['WC','CC','CN','1.UWT','2.UWT','1.WWT','2.WWT','1.Pro','2.Pro','1.1','2.1','1.2','2.2','1.2U','2.2U'];

// Categoría seleccionada en la cuadrícula (null = mostrar cuadrícula).
let _racesCatSelected = null;

// Construye el HTML de una fila de carrera.
function _raceListItemHtml(race, { showTimestamp = false } = {}) {
  const flag   = race.hideFlag ? '' : countryFlag(race.countryCode);
  const gender = race.gender === 'female' ? 'Femenino' : 'Masculino';
  const format = race.raceFormat === 'one_day' ? 'Clásica' : 'Vuelta por etapas';
  let extra = '';
  if (showTimestamp) {
    const tsStr = race.updatedAt || race.createdAt || null;
    const createdStr = tsStr
      ? new Date(tsStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
      : '';
    if (createdStr) extra = ` · <span class="u-c-muted">${createdStr}</span>`;
  }
  return panelRaceListItemHtml({flagHtml:flag,name:race.name,isCancelled:race.isCancelled,
    metadataHtml:`${gender} · ${format} · ${esc(race.startDate || '—')} → ${esc(race.endDate || '—')} · <strong>${esc(race.uciCategory || '—')}</strong>${extra}`,
    category:race.uciCategory});
}

export function renderRacesView(searchQ) {
  const categorySelect=document.getElementById('racesCatFilter');
  const model=panelCatalogModel(panelState.allRaces.filter(r=>(r.year || new Date().getFullYear())===_racesYear),{
    categoryOf:race=>race.uciCategory,categoryOrder:RACES_CAT_ORDER,
    selectedCategory:_racesCatSelected,search:searchQ ?? document.getElementById('racesSearch')?.value ?? '',
    country:document.getElementById('racesCountryFilter')?.value || '',sort:document.getElementById('racesSortOrder')?.value || 'cat',
  });
  _racesCatSelected=model.selectedCategory;
  if(categorySelect)categorySelect.value=_racesCatSelected || '';
  renderPanelCatalog(document.getElementById('racesListView'),model,{
    onCategory:category=>{_racesCatSelected=category;renderRacesView();},onRace:openEditRaceModal,itemHtml:_raceListItemHtml,
    emptyMessage:`No hay carreras${searchQ || document.getElementById('racesSearch')?.value ? ' que coincidan con la búsqueda' : ` para ${_racesYear}`}.`,
  });
}

// ── Editor de carrera (drawer) ────────────────────────────────────
// HTML del formulario (mismos ids que antes para no tocar populate/save).
function raceEditorBodyHtml() {
  return `
    <div id="editRaceError" class="alert alert--error" style="display:none"></div>
    <input type="hidden" id="er-id">
    <div class="field-row field-row--2">
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="er-name">
      </div>
      <div class="field">
        <label>Abreviatura <span class="u-hint">(máx. 6)</span></label>
        <input type="text" id="er-abbrev" placeholder="VUELTA" maxlength="6">
      </div>
    </div>
    <div class="field">
      <label>Nombre original <span class="u-hint">(para SEO, no visible en la web)</span></label>
      <input type="text" id="er-originalName" placeholder="Tour de France">
    </div>
    <div class="field">
      <label>Nombre en inglés <span class="u-hint">(EN, opcional)</span></label>
      <input type="text" id="er-nameEn" placeholder="Tour of Flanders">
    </div>
    <div class="field">
      <label class="u-row u-row--gap-sm">Slug
        <span class="u-field-hint">— URL amigable (solo a-z, 0-9 y guiones)</span>
      </label>
      <div class="u-row u-gap-050">
        <input type="text" id="er-slug" placeholder="tour-de-france-2025" maxlength="80"
               autocomplete="off" spellcheck="false">
        <button type="button" id="er-slug-suggest" class="btn btn--ghost u-fs-1 u-btn-sm"
               >Auto</button>
      </div>
      <div id="er-slug-error" class="u-c-danger u-fs-1 u-mt-025" style="display:none"></div>
    </div>
    <div class="field">
      <label class="u-row u-row--gap-sm">Slug EN
        <span class="u-field-hint">— URL en inglés (solo a-z, 0-9 y guiones)</span>
      </label>
      <input type="text" id="er-slugEn" placeholder="tour-of-flanders-2025" maxlength="80"
             autocomplete="off" spellcheck="false">
      <div id="er-slugEn-error" class="u-c-danger u-fs-1 u-mt-025" style="display:none"></div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Categoría UCI</label>
        <select id="er-uci">
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
        <select id="er-gender">
          <option value="male">Masculino</option>
          <option value="female">Femenino</option>
        </select>
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Formato</label>
        <select id="er-format">
          <option value="stage_race">Vuelta por etapas</option>
          <option value="one_day">Clásica</option>
        </select>
      </div>
      <div class="field">
        <label>País (código ISO)</label>
        <input type="text" id="er-country" maxlength="5">
      </div>
      <div class="field">
        <label>Año de edición</label>
        <input type="number" id="er-year" placeholder="2026" min="2000" max="2099">
      </div>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-preview">
        <input class="u-color-dot" type="color" id="er-colorPicker" value="#e8c547"
              >
        <input class="u-grow" type="text" id="er-color" placeholder="#e8c547">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Fecha inicio</label>
        <input type="date" id="er-startDate">
      </div>
      <div class="field">
        <label>Fecha fin</label>
        <input type="date" id="er-endDate">
      </div>
    </div>
    <div class="field">
      <label>Logo (URL, opcional)</label>
      <div class="field-upload-wrap" id="er-logo-wrap"><input type="url" id="er-logo" placeholder="https://…/logo.png"></div>
    </div>
    <div class="field">
      <label>Web oficial (URL, opcional)</label>
      <input type="url" id="er-website" placeholder="https://…">
    </div>
    <div class="field">
      <label>DataRide (competitionId)</label>
      <div class="u-row u-gap-040">
        <input class="u-grow" type="number" id="er-uciCompetitionId" placeholder="—" min="1">
        <button type="button" class="btn btn--ghost u-fs-1 u-py-0 u-px-060 u-nowrap" id="er-uciLinkBtn">Enlazar con UCI</button>
      </div>
      <div id="er-uciPanel" class="u-mt-050 u-fs-2" style="display:none"></div>
    </div>
    <div class="u-row nr-check-row nr-check-row--first">
      <input class="u-checkbox" type="checkbox" id="er-hideFlag">
      <span class="u-collapse-header" onclick="document.getElementById('er-hideFlag').click()">Ocultar bandera</span>
    </div>
    <div class="u-row nr-check-row">
      <input class="u-checkbox" type="checkbox" id="er-isGrandTour">
      <span class="u-collapse-header" onclick="document.getElementById('er-isGrandTour').click()">Gran Vuelta</span>
    </div>
    <div class="u-row nr-check-row">
      <input type="checkbox" id="er-isCancelled" class="u-checkbox nr-danger-check">
      <span onclick="document.getElementById('er-isCancelled').click()" class="u-collapse-header nr-danger-label">Cancelada</span>
    </div>
    <div class="u-row nr-check-row">
      <input type="checkbox" id="er-isNoClickable" class="u-checkbox nr-flag-check">
      <span onclick="document.getElementById('er-isNoClickable').click()" class="u-collapse-header nr-flag-label">No clicable</span>
    </div>
    <div class="panel-form-actions u-justify-between u-items-center u-wrap">
      <div class="u-row u-gap-050">
        <button class="btn btn--danger" id="er-deleteBtn">Borrar carrera</button>
        <button class="btn btn--ghost u-fs-1" id="er-editStartlistBtn">Editar dorsales</button>
      </div>
      <div class="u-row u-gap-050">
        <button class="btn btn--ghost" id="er-duplicateBtn">Crear edición</button>
        <button class="btn btn--primary" id="editRaceSaveBtn">Guardar cambios</button>
      </div>
    </div>
  `;
}

// Engancha todos los listeners del editor de carrera (se crean por apertura).
function wireRaceEditor() {
  document.getElementById('editRaceSaveBtn').addEventListener('click', saveEditRace);
  document.getElementById('er-deleteBtn').addEventListener('click', deleteRaceFromList);
  document.getElementById('er-duplicateBtn').addEventListener('click', duplicateRace);
  document.getElementById('er-editStartlistBtn').addEventListener('click', () => {
    const raceId = document.getElementById('er-id').value;
    if (!raceId) return;
    closeEditRaceModal();
    switchTab('startlists');
    openStartlistEditor(raceId);
  });
  // Slug — Auto + validación en vivo
  document.getElementById('er-slug-suggest').addEventListener('click', () => {
    const name = document.getElementById('er-name').value.trim();
    const year = document.getElementById('er-year').value.trim();
    const base = toSlug(name);
    const suggestion = year ? `${base}-${year}` : base;
    document.getElementById('er-slug').value = suggestion.slice(0, 80);
    document.getElementById('er-slug-error').style.display = 'none';
  });
  document.getElementById('er-slug').addEventListener('input', e => {
    const err = validateSlug(e.target.value.trim());
    const el  = document.getElementById('er-slug-error');
    if (err) { el.textContent = err; el.style.display = 'block'; }
    else     { el.style.display = 'none'; }
  });
  // Color picker — sincronización bidireccional
  const erPicker = document.getElementById('er-colorPicker');
  const erText   = document.getElementById('er-color');
  erPicker.addEventListener('input', e => { erText.value = e.target.value; });
  erText.addEventListener('input', e => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) erPicker.value = e.target.value;
  });
  // Auto-formato al cambiar categoría UCI
  _wireRaceUciAutoFormat();
  // Enlace con la competición de resultados UCI (lee el match-report + escribe race_uci_links)
  document.getElementById('er-uciLinkBtn').addEventListener('click', openUciLinkPanel);
  // Upload inline de logo + autocompletado de país
  attachInlineUpload(document.getElementById('er-logo'), 'logo');
  attachCountryAutocomplete(document.getElementById('er-country'));
}

// ── Editor de carrera — abrir en drawer ───────────────────────────
function openEditRaceModal(race) {
  openDrawer({
    title: 'Editar carrera',
    level: 1,
    render: (body) => {
      body.innerHTML = raceEditorBodyHtml();
      wireRaceEditor();
      populateRaceEditor(race);
    },
  });
}

function populateRaceEditor(race) {
  document.getElementById('er-id').value      = race.id;
  document.getElementById('er-name').value    = race.name || '';
  document.getElementById('er-originalName').value = race.originalName || '';
  document.getElementById('er-nameEn').value = race.nameEn || '';
  document.getElementById('er-slugEn').value = race.slugEn || '';
  document.getElementById('er-slugEn-error').style.display = 'none';
  document.getElementById('er-abbrev').value  = race.abbrev || '';
  document.getElementById('er-slug').value    = race.slug  || '';
  document.getElementById('er-slug-error').style.display = 'none';
  document.getElementById('er-uci').value     = race.uciCategory || '1.UWT';
  document.getElementById('er-uci').value     = race.uciCategory || '1.UWT';
  document.getElementById('er-gender').value  = race.gender || 'male';
  document.getElementById('er-format').value  = race.raceFormat || 'stage_race';
  document.getElementById('er-country').value = race.countryCode || '';
  mountClassificationEditor(supabase, document.getElementById('editRaceSaveBtn').parentElement.parentElement, race);
  document.getElementById('er-color').value     = race.colorHex || '';
  document.getElementById('er-colorPicker').value = race.colorHex || '#888888';
  document.getElementById('er-logo').value    = race.logoUrl || '';
  document.getElementById('er-website').value = race.websiteUrl || '';
  // El enlace UCI vive en race_uci_links (no en races) → cargar async.
  document.getElementById('er-uciCompetitionId').value = '';
  document.getElementById('er-uciPanel').style.display = 'none';
  document.getElementById('er-uciPanel').innerHTML = '';
  _loadUciLink(race.id);
  document.getElementById('er-hideFlag').checked    = race.hideFlag    || false;
  document.getElementById('er-isGrandTour').checked  = race.isGrandTour || false;
  document.getElementById('er-isCancelled').checked  = race.isCancelled || false;
  document.getElementById('er-isNoClickable').checked = race.isNoClickable || false;
  document.getElementById('er-year').value      = race.year || new Date().getFullYear();
  document.getElementById('er-startDate').value = race.startDate || '';
  document.getElementById('er-endDate').value   = race.endDate   || '';
  document.getElementById('editRaceError').style.display = 'none';
}

function closeEditRaceModal() {
  closeDrawer(1);
}

// Marca que hay páginas estáticas pendientes de crear solo cuando la URL
// canónica de la jornada todavía responde 404. Una página ya creada se hidrata
// con los datos vivos de Supabase y no necesita reconstruir el artifact.
//
// DEBOUNCE EN EL SERVIDOR (migración 121): antes esto programaba un setTimeout(8s)
// en el navegador que, al vencer, disparaba los workflows. Era frágil — si tras
// guardar se cambiaba de jornada, se cerraba el editor, se recargaba o la pestaña
// pasaba a segundo plano (el navegador congela sus timers), el dispatch NUNCA salía
// y la página quedaba en 404 hasta el cron diario (bug cazado con la Clásica
// Castilla y León 2026). Y no colapsaba ráfagas entre guardados espaciados: una
// sesión de edición llegaba a disparar ~15 runs de og-pages en 30 min.
//
// La comprobación es conservadora: solo un 404 confirmado marca la cola. Un
// error de red o una respuesta distinta no dispara nada, porque una edición de
// una jornada existente nunca debe provocar una regeneración por defecto.
//
// Fire-and-forget y NON-BLOCKING: el guardado ya terminó cuando se llama.
export async function _markWebPagesDirtyIfMissing(slug) {
  try {
    const pageUrl = `${CONFIG.basePath}/jornada/${encodeURIComponent(slug)}/`;
    const response = await fetch(pageUrl, { method: 'HEAD', cache: 'no-store' });
    if (response.ok) return;
    if (response.status !== 404) {
      console.warn(`No se comprobó la página de jornada (${response.status}); no se regenera.`);
      return;
    }
    const { error } = await supabase.rpc('admin_mark_web_pages_dirty');
    if (error) console.warn('No se pudo marcar la creación de páginas:', error.message || error);
  } catch (err) {
    console.warn('No se pudo comprobar la página de jornada; no se regenera:', err?.message || err);
  }
}

// Auto-formato al cambiar categoría en editar carrera (cableado por apertura
// del drawer en wireRaceEditor; antes era un listener a nivel de módulo que
// petaba al cargar cuando #er-uci ya no vive en el HTML estático).
function _wireRaceUciAutoFormat() {
  document.getElementById('er-uci').addEventListener('change', e => {
    const val = e.target.value;
    const CLASICA = new Set(['1.UWT','1.WWT','1.Pro','1.1','1.2','1.2U','WC','CC']);
    const WWT     = new Set(['1.WWT','2.WWT']);
    const HIDE    = new Set(['WC','CC']);
    if (!val) return;
    document.getElementById('er-format').value = CLASICA.has(val) ? 'one_day' : 'stage_race';
    if (WWT.has(val))  document.getElementById('er-gender').value = 'female';
    if (HIDE.has(val)) document.getElementById('er-hideFlag').checked = true;
  });
}

async function saveEditRace() {
  const id   = document.getElementById('er-id').value;
  const name = document.getElementById('er-name').value.trim();
  const errDiv = document.getElementById('editRaceError');

  if (!name) {
    errDiv.textContent = 'El nombre es obligatorio.';
    errDiv.style.display = 'block';
    return;
  }

  // Validar slug
  const slugVal = document.getElementById('er-slug').value.trim();
  const slugErr = validateSlug(slugVal);
  const slugErrEl = document.getElementById('er-slug-error');
  if (slugErr) {
    slugErrEl.textContent = slugErr;
    slugErrEl.style.display = 'block';
    return;
  }
  slugErrEl.style.display = 'none';

  // Validar slugEn (opcional, pero si tiene valor debe ser válido)
  const slugEnVal = document.getElementById('er-slugEn').value.trim();
  const slugEnErr = slugEnVal ? validateSlug(slugEnVal) : null;
  const slugEnErrEl = document.getElementById('er-slugEn-error');
  if (slugEnErr) {
    slugEnErrEl.textContent = slugEnErr;
    slugEnErrEl.style.display = 'block';
    return;
  }
  slugEnErrEl.style.display = 'none';

  const uci    = document.getElementById('er-uci').value;
  const gender = document.getElementById('er-gender').value;
  if (!validateCatGender(uci, gender, errDiv)) return;
  // Convención de nombres CN (ES + EN) para la deducción en Modo Campeonatos.
  if (!validateChampionshipName(uci, name, document.getElementById('er-nameEn').value, errDiv)) return;

  try {
    const updatedData = {
      name,
      originalName: document.getElementById('er-originalName').value.trim() || null,
      nameEn:      document.getElementById('er-nameEn').value.trim() || null,
      slugEn:      slugEnVal || null,
      slug:        slugVal || null,
      abbrev:      document.getElementById('er-abbrev').value.trim().toUpperCase() || null,
      uciCategory: document.getElementById('er-uci').value,
      gender:      document.getElementById('er-gender').value,
      raceFormat:  document.getElementById('er-format').value,
      countryCode: document.getElementById('er-country').value.trim() || null,
      colorHex:    document.getElementById('er-color').value || '#888888',
      logoUrl:     document.getElementById('er-logo').value.trim() || null,
      websiteUrl:  document.getElementById('er-website').value.trim() || null,
      hideFlag:    document.getElementById('er-hideFlag').checked || false,
      isGrandTour: document.getElementById('er-isGrandTour').checked || false,
      isCancelled: document.getElementById('er-isCancelled').checked || false,
      isNoClickable: document.getElementById('er-isNoClickable').checked || false,
      year:        parseInt(document.getElementById('er-year').value) || new Date().getFullYear(),
      startDate:   document.getElementById('er-startDate').value || null,
      endDate:     document.getElementById('er-endDate').value   || null,
    };
    const { error: upErr } = await supabase.from('races').update(updatedData).eq('id', id);
    if (upErr) throw upErr;
    upsertRaceLocal({ id, ...updatedData });
    closeEditRaceModal();
    renderRacesView();
  } catch (err) {
    // 23514: validación de la base (p. ej. logo fuera de assets.calendariociclismo.app).
    errDiv.textContent = err?.code === '23514' ? err.message : 'Error al guardar.';
    errDiv.style.display = 'block';
  }
}

async function deleteRaceFromList() {
  const id   = document.getElementById('er-id').value;
  const name = document.getElementById('er-name').value;
  if (!await confirmDialog(`¿Borrar la carrera "${name}"? Esta acción no borra sus jornadas asociadas.`, { danger: true })) return;
  try {
    const { error: delErr } = await supabase.from('races').delete().eq('id', id);
    if (delErr) throw delErr;
    removeRaceLocal(id);
    closeEditRaceModal();
    renderRacesView();
  } catch (err) {
    document.getElementById('editRaceError').textContent = 'Error al borrar.';
    document.getElementById('editRaceError').style.display = 'block';
  }
}

async function duplicateRace() {
  const id = document.getElementById('er-id').value;
  try {
    const { data: raceData } = await supabase.from('races').select('*').eq('id', id).single();
    if (!raceData) return;
    const sourceYear = Number(raceData.year) || new Date().getFullYear();
    const rawYear = window.prompt('Año de la nueva edición', String(sourceYear + 1));
    if (rawYear == null) return;
    const targetYear = Number.parseInt(rawYear, 10);
    if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2099) {
      throw new Error('Año de edición inválido.');
    }

    let seriesId = raceData.raceSeriesId;
    if (!seriesId) {
      // Compatibilidad con carreras que aún no se hayan asociado durante el
      // backfill de la migración: nunca creamos una edición huérfana.
      seriesId = crypto.randomUUID();
      const { error: seriesErr } = await supabase.from('race_series').insert({
        id: seriesId,
        canonicalName: raceData.name,
        gender: raceData.gender || null,
      });
      if (seriesErr) throw seriesErr;
      const { error: sourceErr } = await supabase.from('races')
        .update({ raceSeriesId: seriesId }).eq('id', id);
      if (sourceErr) throw sourceErr;
      upsertRaceLocal({ ...raceData, raceSeriesId: seriesId });
    }

    const { data: existing, error: existingErr } = await supabase.from('races')
      .select('id')
      .eq('raceSeriesId', seriesId)
      .eq('year', targetYear)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) throw new Error(`La serie ya tiene una edición en ${targetYear}.`);

    const baseSlug = raceData.slug?.replace(new RegExp(`-${sourceYear}$`), '') || toSlug(raceData.name);
    const baseSlugEn = raceData.slugEn?.replace(new RegExp(`-${sourceYear}$`), '') || null;
    const newRaceId = crypto.randomUUID();
    // Solo se heredan los datos estables de la prueba. Fechas, jornadas,
    // documentación, inscritos y resultados pertenecen a cada edición.
    const data = {
      id: newRaceId,
      raceSeriesId: seriesId,
      name: raceData.name,
      originalName: raceData.originalName || null,
      nameEn: raceData.nameEn || null,
      abbrev: raceData.abbrev || null,
      uciCategory: raceData.uciCategory || null,
      gender: raceData.gender || null,
      raceFormat: raceData.raceFormat || null,
      countryCode: raceData.countryCode || null,
      colorHex: raceData.colorHex || null,
      logoUrl: raceData.logoUrl || null,
      websiteUrl: raceData.websiteUrl || null,
      hideFlag: raceData.hideFlag || false,
      isGrandTour: raceData.isGrandTour || false,
      isNoClickable: raceData.isNoClickable || false,
      isCancelled: false,
      year: targetYear,
      startDate: null,
      endDate: null,
      slug: `${baseSlug}-${targetYear}`.slice(0, 80),
      slugEn: baseSlugEn ? `${baseSlugEn}-${targetYear}`.slice(0, 80) : null,
      translations: raceData.translations || {},
      createdAt: new Date().toISOString(),
    };
    const { error: dupErr } = await supabase.from('races').insert(data);
    if (dupErr) throw dupErr;
    const newRace = { ...data };
    upsertRaceLocal(newRace);
    closeEditRaceModal();
    renderRacesView();
    openEditRaceModal(newRace);
  } catch (err) {
    document.getElementById('editRaceError').textContent = err.message || 'Error al crear la edición.';
    document.getElementById('editRaceError').style.display = 'block';
  }
}

// ── Setup modales de carreras ─────────────────────────────────────
export function setupRacesView() {
  document.querySelector('#racesView .races-header').innerHTML=panelCatalogHeaderHtml({
    tabsId:'racesSubviewToggle',tabs:[{key:'races',label:'Carreras'},{key:'challenges',label:'Challenges'}],filterRowId:'racesFiltersRow',searchId:'racesSearch',
    controls:[
      {key:'period',id:'racesYearSelect',label:'Temporada',options:Array.from({length:11},(_,i)=>[2020+i,2020+i]),value:_racesYear},
      {key:'class',id:'racesCatFilter',label:'Categoría',options:[['','Todas'],...RACES_CAT_ORDER.map(cat=>[cat,cat])]},
      {key:'country',id:'racesCountryFilter',label:'País',options:[['','Todos los países']]},
      {key:'sort',id:'racesSortOrder',label:'Orden',options:[['cat','Por categoría'],['recent','Última actualización']],value:'cat'},
    ],actions:[{key:'new',id:'addRaceDirectBtn',primary:true,label:'+ Nueva carrera'},{key:'challenge',id:'newChallengeBtn',primary:true,label:'+ Nuevo challenge',hidden:true}],
  });
  // Selector de año
  const yearSel = document.getElementById('racesYearSelect');
  yearSel.value = _racesYear;
  yearSel.addEventListener('change', async () => {
    _racesYear = parseInt(yearSel.value);
    yearSel.disabled = true;
    try {
      await ensureRaceYearLoaded(_racesYear);
      renderRacesView();
    } catch (error) {
      showToast('No se pudieron cargar las carreras de la temporada: ' + error.message);
    } finally {
      yearSel.disabled = false;
    }
  });

  // El desplegable de categoría sincroniza con la cuadrícula: elegir una
  // categoría salta a su listado; "Todas" vuelve a la cuadrícula.
  document.getElementById('racesCatFilter').addEventListener('change', e => {
    _racesCatSelected = e.target.value || null;
    renderRacesView();
  });
  document.getElementById('racesSortOrder').addEventListener('change', () => renderRacesView());

  // Poblar selector de países con los del año activo
  const countryFilter = document.getElementById('racesCountryFilter');
  const racesForYear  = panelState.allRaces.filter(r => (r.year || new Date().getFullYear()) === _racesYear);
  const countryCodes  = [...new Set(racesForYear.map(r => r.countryCode).filter(Boolean))].sort();
  countryFilter.innerHTML = '<option value="">Todos los países</option>';
  countryCodes.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code.toUpperCase();
    opt.textContent = code.toUpperCase();
    countryFilter.appendChild(opt);
  });
  countryFilter.addEventListener('change', () => renderRacesView());

  // Buscador en vista de carreras
  document.getElementById('racesSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderRacesView(q);
  });

  // Botón nueva carrera desde vista de carreras
  document.getElementById('addRaceDirectBtn').addEventListener('click', () => {
    panelState._newRaceFromRacesView = true;
    openNewRaceEditor({ presetYear: _racesYear });
  });

  // Editor de carrera: ahora se renderiza en el drawer; sus listeners se
  // cablean por apertura en wireRaceEditor() (ver openEditRaceModal).

  // Editor de challenge: se renderiza en el drawer; abrir desde newChallengeBtn.
  // El resto de listeners (guardar, etc.) se cablean por apertura.
  document.getElementById('newChallengeBtn').addEventListener('click', () => openChallengeModal());

  // Toggle de subvista Carreras / Challenges (sustituye al antiguo tab del rail)
  document.querySelectorAll('#racesSubviewToggle .races-subview-btn').forEach(btn => {
    btn.addEventListener('click', () => applyRacesSubview(btn.dataset.subview));
  });

  initTabs();
}

let _racesYear = new Date().getFullYear();
