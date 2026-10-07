// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Vista de equipos
// ─────────────────────────────────────────────────────────────────

import { panelTeamRowHtml, panelTeamCatalogHtml } from './editor-ui.js';
import { supabase, countryFlag, esc } from '../shared.js';
import {
  activeCatalogTeams, teamGenderLabel, teamListYearOptions, teamsForSeasonList,
} from '../services/team-catalog.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { confirmDialog } from '../components/dialog.js';
import { genderToggleHtml } from '../components/gender-toggle.js';
import { automaticTeamHeaderText } from '../team-appearance.js';
import { loadCompleteStartlistCatalog } from '../startlist/import.js';
import { panelState } from './state.js';
import { CURRENT_TEAM_SEASON, MARKET_SEASON } from './constants.js';
import { showToast } from './helpers.js';
import { _slRiderFlagPreview } from './startlist-picker.js';
import {
  _syncRosterVisibility, _syncSeason27Visibility, discontinueTeamSeason27,
  setupRosterPanel, setupSeason27Panel,
} from './team-roster.js';
import { openDuplicateScanner } from './rider-merge.js';

// ═════════════════════════════════════════════════════════════════
//  VISTA DE EQUIPOS (teams)
// ═════════════════════════════════════════════════════════════════

let _teamsViewReady = false;
let _teamColorsExplicitlySet = false; // false = colores no tocados → guardar null

export const DEFAULT_TEAM = {
  headerBg:          '#1f2937',
  headerText:        '#ffffff',
  badgeTorsoCenter:  '#ffffff',
  badgeTorsoSides:   '#111111',
  badgeInnerCircle:  null,
  badgeShorts:       '#111111',
};

let _teamsLoading = null;
let _teamSeasonYears = new Map();
let _teamSeasonYearsLoading = null;
const _teamSeasonsByYear = new Map();
const _teamSeasonsByYearLoading = new Map();
export async function fetchTeams({ force = false } = {}) {
  if (panelState._teamsCache && !force) return panelState._teamsCache;
  if (_teamsLoading) return _teamsLoading;
  _teamsLoading = loadCompleteStartlistCatalog((from, to, count) => supabase.from('teams')
    .select('*', count ? { count: 'exact' } : {}).order('id').range(from, to))
    .then(data => {
      panelState._teamsCache = data.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
      return panelState._teamsCache;
    })
    .catch(error => { console.error('[teams] fetch', error); return []; })
    .finally(() => { _teamsLoading = null; });
  return _teamsLoading;
}

export async function fetchTeamSeasonYears({ force = false } = {}) {
  if (_teamSeasonYears.size && !force) return _teamSeasonYears;
  if (_teamSeasonYearsLoading) return _teamSeasonYearsLoading;
  _teamSeasonYearsLoading = loadCompleteStartlistCatalog((from, to, count) => supabase.from('team_seasons')
    .select('teamId,year', count ? { count: 'exact' } : {}).order('year').range(from, to))
    .then(rows => {
      const years = new Map();
      rows.forEach(row => {
        const list = years.get(row.teamId) || [];
        list.push(row.year);
        years.set(row.teamId, list);
      });
      _teamSeasonYears = years;
      return years;
    })
    .catch(error => { console.error('[team_seasons] fetch', error); return _teamSeasonYears; })
    .finally(() => { _teamSeasonYearsLoading = null; });
  return _teamSeasonYearsLoading;
}

export async function fetchTeamSeasonsForYear(year, { force = false } = {}) {
  const normalizedYear = Number(year);
  if (!Number.isInteger(normalizedYear)) return [];
  if (_teamSeasonsByYear.has(normalizedYear) && !force) return _teamSeasonsByYear.get(normalizedYear);
  if (_teamSeasonsByYearLoading.has(normalizedYear)) return _teamSeasonsByYearLoading.get(normalizedYear);
  const request = loadCompleteStartlistCatalog((from, to, count) => supabase.from('team_seasons')
    .select('*', count ? { count: 'exact' } : {})
    .eq('year', normalizedYear)
    .order('name')
    .range(from, to))
    .then(rows => {
      _teamSeasonsByYear.set(normalizedYear, rows);
      return rows;
    })
    .catch(error => {
      console.error(`[team_seasons ${normalizedYear}] fetch`, error);
      return _teamSeasonsByYear.get(normalizedYear) || [];
    })
    .finally(() => { _teamSeasonsByYearLoading.delete(normalizedYear); });
  _teamSeasonsByYearLoading.set(normalizedYear, request);
  return request;
}

export function populateTeamsYearSelect() {
  const select = document.getElementById('teamsYearSelect');
  if (!select) return;
  const existingYears = [..._teamSeasonYears.values()].flat();
  const options = teamListYearOptions(existingYears, {
    currentYear: CURRENT_TEAM_SEASON,
    marketYear: MARKET_SEASON,
    minYear: 2020,
  });
  if (!options.includes(panelState._teamsListYear)) panelState._teamsListYear = options.includes(CURRENT_TEAM_SEASON)
    ? CURRENT_TEAM_SEASON
    : options[0];
  select.innerHTML = options.map(year => `<option value="${year}">${year}</option>`).join('');
  select.value = String(panelState._teamsListYear);
  const label = document.getElementById('teamsListYearLabel');
  if (label) label.textContent = String(panelState._teamsListYear);
}

function _populateParentTeamSelect(selectedId) {
  const sel = document.getElementById('te-parentTeamId');
  const baseTeams = activeCatalogTeams(panelState._teamsCache)
    .filter(t => !t.specialEdition)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = '<option value="">— Sin vincular —</option>' +
    baseTeams.map(t =>
      `<option value="${esc(t.id)}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)}${t.category ? ` (${esc(t.category)})` : ''}</option>`
    ).join('');
}

// Pobla el selector de carrera del bloque de vigencia del maillot especial.
// `query` filtra por nombre; `selectedId` preselecciona (se conserva aunque no
// coincida con el filtro, para no perder el valor guardado al teclear).
function _populateSpecialRaceSelect(selectedId, query = '') {
  const sel = document.getElementById('te-seRaceId');
  if (!sel) return;
  const q = (query || '').trim().toLowerCase();
  const sorted = [...panelState.allRaces].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const matches = sorted.filter(r =>
    !q || (r.name || '').toLowerCase().includes(q) || r.id === selectedId
  );
  sel.innerHTML = '<option value="">— Ninguna —</option>' +
    matches.map(r =>
      `<option value="${esc(r.id)}"${r.id === selectedId ? ' selected' : ''}>${r.hideFlag ? '' : countryFlag(r.countryCode)} ${esc(r.name)}${r.year ? ` (${r.year})` : ''}</option>`
    ).join('');
  sel.value = selectedId || '';
}

function renderTeamSpecialEditionsPanel(teamId) {
  const panel = document.getElementById('teamSpecialEditionsPanel');
  const list = document.getElementById('teamSpecialEditionsList');
  const team = (panelState._teamsCache || []).find(candidate => candidate.id === teamId);
  if (!panel || !list || !team || team.specialEdition) {
    if (panel) panel.style.display = 'none';
    return;
  }
  panel.style.display = 'flex';
  const editions = (panelState._teamsCache || [])
    .filter(candidate => candidate.specialEdition && candidate.parentTeamId === teamId)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
  if (!editions.length) {
    list.innerHTML = '<div class="u-fs-3 u-c-dim">Sin ediciones especiales.</div>';
    return;
  }
  list.innerHTML = editions.map(edition => {
    const validity = edition.specialEditionRaceId
      ? 'Carrera concreta'
      : [edition.specialEditionValidFrom, edition.specialEditionValidTo].filter(Boolean).join(' → ') || 'Sin vigencia limitada';
    return `<button type="button" class="btn btn--ghost team-edition-row" data-special-edition-id="${esc(edition.id)}">
      <strong class="u-grow u-fs-2">${esc(edition.name)}</strong>
      <span class="u-fs-1 u-c-dim">${esc(validity)}</span>
      <span aria-hidden="true">›</span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-special-edition-id]').forEach(button => {
    button.addEventListener('click', () => openTeamEditor(button.dataset.specialEditionId, {
      seasonYear: panelState._editingTeamSeasonYear,
    }));
  });
}

export async function setupTeamsView() {
  if (!_teamsViewReady) {
    _teamsViewReady = true;
    // Enlazar listeners de forma resiliente: si un nodo falta (p. ej. HTML
    // de app.html cacheado por el navegador y desfasado respecto a js/panel/),
    // un único elemento ausente NO debe abortar todo setupTeamsView y dejar la
    // lista de equipos sin cargar. Avisamos por consola y seguimos.
    const bind = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
      else console.warn(`[setupTeamsView] #${id} no existe en el DOM — listener omitido (¿app.html cacheado?)`);
    };
    bind('addTeamPanelBtn', 'click', () => openTeamEditor(null, { seasonYear: panelState._teamsListYear }));
    bind('teamsSearch', 'input', () => renderTeamsList());
    bind('teamsYearSelect', 'change', async event => {
      panelState._teamsListYear = Number(event.target.value) || CURRENT_TEAM_SEASON;
      _teamsCatSelected = null;
      const label = document.getElementById('teamsListYearLabel');
      if (label) label.textContent = String(panelState._teamsListYear);
      const list = document.getElementById('teamsList');
      if (list) list.innerHTML = '<div class="u-fs-3 u-c-dim">Cargando…</div>';
      await fetchTeamSeasonsForYear(panelState._teamsListYear);
      renderTeamsList();
    });
    // Los listeners del editor de equipo (form, colores, specialEdition,
    // categoría→género, editTeamColorsBtn, roster) se cablean por apertura en
    // wireTeamEditor() — el editor se renderiza en el drawer.

    // Detector de duplicados del catálogo de corredores. Antes vivía en la zona
    // Corredores (eliminada); ahora se dispara desde Equipos y se renderiza en
    // el drawer (cierre por ✕; toggle masc/fem cableado por apertura en
    // wireDupScan()).
    bind('dupScanBtn', 'click', openDuplicateScanner);
  }
  await Promise.all([fetchTeams({ force: true }), fetchTeamSeasonYears({ force: true })]);
  populateTeamsYearSelect();
  await fetchTeamSeasonsForYear(panelState._teamsListYear, { force: true });
  renderTeamsList();
}

const TEAM_CATEGORIES = [
  { key: 'WT',    label: 'WorldTour masculino',      gender: 'male'   },
  { key: 'WWT',   label: 'WorldTour femenino',       gender: 'female' },
  { key: 'PT',    label: 'ProTeam masculino',         gender: 'male'   },
  { key: 'PRW',   label: 'ProTeam femenino',          gender: 'female' },
  { key: 'CT',    label: 'Continental masculino',     gender: 'male'   },
  { key: 'CTW',   label: 'Continental femenino',      gender: 'female' },
  { key: 'NTM',   label: 'Selecciones masculinas',     gender: 'male'   },
  { key: 'NTW',   label: 'Selecciones femeninas',      gender: 'female' },
  { key: 'CLUBM', label: 'Club masculino',            gender: 'male'   },
  { key: 'CLUBW', label: 'Club femenino',             gender: 'female' },
];

// Categoría de equipos seleccionada en la cuadrícula (null = mostrar cuadrícula).
// Claves: las de TEAM_CATEGORIES, más '__none__' (sin categoría).
let _teamsCatSelected = null;

export function renderTeamsList() {
  const container = document.getElementById('teamsList');
  const q = (document.getElementById('teamsSearch').value || '').toLowerCase().trim();
  const completeCatalog = panelState._teamsCache || [];
  const seasonRows = _teamSeasonsByYear.get(panelState._teamsListYear) || [];
  const allTeams = teamsForSeasonList(completeCatalog, seasonRows);
  const filtered = allTeams.filter(t =>
    !q || (t.name || '').toLowerCase().includes(q) || ((t.nameAliases || '').toLowerCase().includes(q)) ||
      ((t.matrixName || '').toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="u-fs-3 u-c-dim">
      ${allTeams.length === 0 ? `No hay equipos en la temporada ${panelState._teamsListYear}.` : 'Sin resultados.'}
    </div>`;
    return;
  }

  const total = allTeams.length;

  const renderTeamRow=t=>panelTeamRowHtml(t,{meta:[teamGenderLabel(t.gender),t.category,String(panelState._teamsListYear)]});

  // Agrupar equipos base por categoría
  const byCategory = {};
  const uncategorized = [];
  for (const t of filtered) {
    if (t.category) {
      if (!byCategory[t.category]) byCategory[t.category] = [];
      byCategory[t.category].push(t);
    } else {
      uncategorized.push(t);
    }
  }

  // Definición ordenada de las categorías que existen (con su listado).
  const sections = [];
  for (const { key, label } of TEAM_CATEGORIES) {
    if (byCategory[key]?.length) sections.push({ key, label, items: byCategory[key] });
  }
  if (uncategorized.length) sections.push({ key: '__none__', label: 'Sin categoría', items: uncategorized });

  const wireRows = () => {
    container.querySelectorAll('[data-team-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openTeamEditor(el.dataset.teamId, { seasonYear: panelState._teamsListYear });
      });
    });
    container.querySelectorAll('[data-edit-team-id]').forEach(btn => {
      btn.addEventListener('click', () => openTeamEditor(btn.dataset.editTeamId, { seasonYear: panelState._teamsListYear }));
    });
  };

  const catalog=panelTeamCatalogHtml({sections,selectedCategory:_teamsCatSelected,search:q,total,filteredRows:filtered,rowHtml:renderTeamRow});
  _teamsCatSelected=catalog.selectedCategory;container.innerHTML=catalog.html;
  container.querySelectorAll('[data-team-category]').forEach(button=>button.onclick=()=>{_teamsCatSelected=button.dataset.teamCategory;renderTeamsList();});
  container.querySelector('.cat-back__btn')?.addEventListener('click',()=>{_teamsCatSelected=null;renderTeamsList();});
  wireRows();
}

function setColorPair(key, value) {
  const color = document.getElementById(`te-${key}-color`);
  const text  = document.getElementById(`te-${key}-text`);
  const hex = (value || '').toLowerCase();
  const safe = /^#[0-9a-f]{6}$/.test(hex) ? hex : '#000000';
  color.value = safe;
  text.value = safe.toUpperCase();
}

function getColorPair(key) {
  const text = document.getElementById(`te-${key}-text`).value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return document.getElementById(`te-${key}-color`).value.toLowerCase();
}

function readTeamFromForm() {
  const headerBg = _teamColorsExplicitlySet ? getColorPair('headerBg') : DEFAULT_TEAM.headerBg;
  const category = document.getElementById('te-category').value || null;
  const isSelection = category === 'NTM' || category === 'NTW';
  const selectionScope = isSelection
    ? (document.getElementById('te-selectionScope').value || 'national')
    : null;
  const selectionCode = isSelection
    ? ((document.getElementById('te-selectionCode').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || null)
    : null;
  return {
    name:             document.getElementById('te-name').value.trim(),
    nameAliases:      document.getElementById('te-aliases').value.split('\n').map(s => s.trim()).filter(Boolean).join('\n') || null,
    headerBg,
    headerText:       automaticTeamHeaderText(headerBg),
    badgeTorsoCenter: _teamColorsExplicitlySet ? getColorPair('torsoCenter')       : DEFAULT_TEAM.badgeTorsoCenter,
    badgeTorsoSides:  _teamColorsExplicitlySet ? getColorPair('torsoSides')        : DEFAULT_TEAM.badgeTorsoSides,
    badgeInnerCircle: null,
    badgeShorts:      _teamColorsExplicitlySet ? getColorPair('shorts')            : DEFAULT_TEAM.badgeShorts,
    specialEdition:   document.getElementById('te-specialEdition').checked,
    parentTeamId:     document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-parentTeamId').value || null)
                        : null,
    // Vigencia del maillot especial (solo si specialEdition). Rango O carrera.
    specialEditionValidFrom: document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-seValidFrom').value || null) : null,
    specialEditionValidTo:   document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-seValidTo').value || null) : null,
    specialEditionRaceId:    document.getElementById('te-specialEdition').checked
                        ? (document.getElementById('te-seRaceId').value || null) : null,
    category,
    gender:           document.getElementById('te-gender').value || null,
    countryCode:      (document.getElementById('te-countryCode').value || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || null,
    teamKind:         isSelection ? 'selection' : 'club',
    selectionScope,
    selectionCode,
  };
}

function readTeamSeasonFromForm(team) {
  const uciCode = (document.getElementById('te-uciCode')?.value || '').trim().toUpperCase() || null;
  return {
    name: team.name,
    nameAliases: team.nameAliases,
    uciCode,
    category: team.category,
    gender: team.gender,
    headerBg: team.headerBg,
    headerText: team.headerText,
    badgeTorsoCenter: team.badgeTorsoCenter,
    badgeTorsoSides: team.badgeTorsoSides,
    badgeInnerCircle: panelState._season27Row?.badgeInnerCircle || null,
    badgeShorts: team.badgeShorts,
    translations: panelState._season27Row?.translations || {},
    badgeVisible: panelState._season27Row ? panelState._season27Row.badgeVisible !== false : true,
    continuityDoubt: !!panelState._season27Row?.continuityDoubt,
  };
}

// Bandera SVG (flag-icons), igual que el resto de la web (countryFlag → <img>).
// Reutiliza _slRiderFlagPreview para que tenga el mismo tamaño y placeholder que
// la bandera de nacionalidad del corredor.
function refreshTeamCountryFlag() {
  const cc = (document.getElementById('te-countryCode').value || '').trim().toLowerCase();
  document.getElementById('te-countryFlag').innerHTML = _slRiderFlagPreview(cc);
}

function refreshTeamPreview() {
  const t = readTeamFromForm();
  const colors = [t.badgeTorsoSides, t.badgeTorsoCenter, t.badgeShorts];
  document.querySelectorAll('#teamEditorColorsPreview i').forEach((square, index) => {
    square.style.background = colors[index];
  });
  const hdr = document.getElementById('teamEditorHeaderPreview');
  hdr.style.background = t.headerBg;
  hdr.style.color = t.headerText;
  hdr.textContent = t.name || 'Cabecera';
}

function duplicateTeam() {
  panelState._editingTeamId = null;
  panelState._editingTeamIsSeason = false;
  const drawerTitle = document.getElementById('ccDrawer1Title');
  if (drawerTitle) drawerTitle.textContent = 'Nuevo equipo';
  document.getElementById('deleteTeamBtn').style.display = 'none';
  document.getElementById('duplicateTeamBtn').style.display = 'none';
  document.getElementById('te-name').value = '';
  document.getElementById('te-aliases').value = '';
  document.getElementById('teamSaveStatus').textContent = 'Copia lista. Pon nombre y guarda.';
  // Los colores ya están en el formulario; solo se refresca la vista previa.
  refreshTeamPreview();
}

// HTML del editor de equipo dentro del drawer (mismos ids; sin botón Cerrar
// propio — el drawer trae su ✕; sin span de título — va al header del drawer).
function teamEditorBodyHtml() {
  return `
    <button type="button" class="btn btn--ghost team-editor-back" id="specialEditorBackBtn" style="display:none">← Volver al equipo</button>
    <div id="teamEditorKindTitle" class="panel-subheading u-mb-075">Equipo</div>
    <div id="teamEditorKindDescription" class="u-fs-1 u-c-dim u-mb-075">Identidad de la temporada seleccionada.</div>
    <div class="team-editor-layout">
      <div class="u-stack">
        <div class="field">
          <label>Nombre</label>
          <input type="text" id="te-name" placeholder="Nombre oficial del equipo" class="u-w-full">
        </div>
        <div class="field">
          <label>Alias (uno por línea) <span class="u-dim">— para matching</span></label>
          <textarea id="te-aliases" rows="3" placeholder="Alias 1&#10;Alias 2" class="u-w-full team-aliases-input"></textarea>
        </div>
        <input type="checkbox" id="te-specialEdition" hidden>
        <div id="te-parentTeam-row" class="field u-mt-010" style="display:none">
          <label>Equipo base <span class="u-dim">— al que pertenece esta edición especial</span></label>
          <select id="te-parentTeamId" class="u-w-full">
            <option value="">— Sin vincular —</option>
          </select>
        </div>
        <div id="te-specialValidity-row" class="panel-dashed-box u-gap-060 u-mt-010" style="display:none">
          <div class="u-fs-2 u-c-dim">
            Vigencia del maillot especial — usa <strong>un rango de fechas</strong> (denominación de tramo, p. ej. hasta abril)
            <strong>o</strong> una <strong>carrera concreta</strong> (maillot de una sola prueba). No ambos.
          </div>
          <div class="field-row field-row--2">
            <div class="field">
              <label>Vigente desde <span class="u-dim">— vacío = inicio de temporada</span></label>
              <input type="date" id="te-seValidFrom" class="u-w-full">
            </div>
            <div class="field">
              <label>Vigente hasta</label>
              <input type="date" id="te-seValidTo" class="u-w-full">
            </div>
          </div>
          <div class="field">
            <label>O carrera concreta</label>
            <input type="text" id="te-seRaceSearch" placeholder="Filtrar carreras…" autocomplete="off" class="u-w-full u-mb-035">
            <select id="te-seRaceId" class="u-w-full">
              <option value="">— Ninguna —</option>
            </select>
          </div>
        </div>
        <div class="field-row field-row--4">
          <div class="field">
            <label>Código UCI <span class="u-dim">— 3 caracteres</span></label>
            <input type="text" id="te-uciCode" maxlength="3" class="u-w-full" autocapitalize="characters" autocomplete="off" spellcheck="false">
          </div>
          <div class="field">
            <label>Categoría UCI</label>
            <select id="te-category" class="u-w-full">
              <option value="">— Sin categoría —</option>
              <optgroup label="Masculino">
                <option value="WT">WT — WorldTour</option>
                <option value="PT">PT — ProTeam</option>
                <option value="CT">CT — Continental</option>
                <option value="NTM">NTM — Selección</option>
                <option value="CLUBM">CLUBM — Club</option>
              </optgroup>
              <optgroup label="Femenino">
                <option value="WWT">WWT — WorldTour</option>
                <option value="PRW">PRW — ProTeam</option>
                <option value="CTW">CTW — Continental</option>
                <option value="NTW">NTW — Selección</option>
                <option value="CLUBW">CLUBW — Club</option>
              </optgroup>
            </select>
          </div>
          <div class="field">
            <label>Género</label>
            <select id="te-gender" class="u-w-full">
              <option value="">— Sin especificar —</option>
              <option value="male">Masculino</option>
              <option value="female">Femenino</option>
            </select>
          </div>
          <div class="field">
            <label>País <span class="u-dim">— ISO 2</span></label>
            <div class="u-row u-row--gap-sm">
              <span class="u-icon-box" id="te-countryFlag" title="Bandera"></span>
              <input type="text" id="te-countryCode" placeholder="es" maxlength="2" autocapitalize="off" autocomplete="off" spellcheck="false" class="u-grow u-lower">
            </div>
          </div>
        </div>
        <div id="te-selectionMeta-row" class="field-row field-row--2" style="display:none">
          <div class="field">
            <label>Ámbito de selección</label>
            <select id="te-selectionScope" class="u-w-full">
              <option value="national">Nacional</option>
              <option value="regional">Regional</option>
            </select>
          </div>
          <div class="field">
            <label>Código de selección <span class="u-dim">— p. ej. es-ct</span></label>
            <input type="text" id="te-selectionCode" placeholder="es o es-ct" maxlength="16" autocapitalize="off" autocomplete="off" spellcheck="false" class="u-w-full">
          </div>
        </div>
        <div id="te-colors">
          <div class="field">
            <label>Fondo de pestaña / barra de título</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-headerBg-color">
              <input class="u-grow" type="text" id="te-headerBg-text" value="#1f2937">
            </div>
          </div>
        <div class="field-row field-row--3">
          <div class="field">
            <label>Cuadrado cromático 1</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-torsoSides-color">
              <input class="u-grow" type="text" id="te-torsoSides-text" value="#111111">
            </div>
          </div>
          <div class="field">
            <label>Cuadrado cromático 2</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-torsoCenter-color">
              <input class="u-grow" type="text" id="te-torsoCenter-text" value="#ffffff">
            </div>
          </div>
          <div class="field">
            <label>Cuadrado cromático 3</label>
            <div class="color-preview">
              <input class="u-color-dot" type="color" id="te-shorts-color">
              <input class="u-grow" type="text" id="te-shorts-text" value="#111111">
            </div>
          </div>
        </div>
        </div><!-- /te-colors -->
      </div>
      <div class="team-editor-preview">
        <div class="team-editor-preview__label">Vista previa</div>
        <div id="teamEditorColorsPreview" class="team-color-squares" aria-label="Tres colores cromáticos">
          <i></i><i></i><i></i>
        </div>
        <div id="teamEditorHeaderPreview" class="team-editor-preview__header">Cabecera</div>
      </div>
    </div>
    <div class="u-row u-gap-075 u-wrap u-mt-100">
      <button class="btn btn--primary" id="saveTeamBtn">Guardar</button>
      <button class="btn btn--ghost" id="duplicateTeamBtn" style="display:none">Duplicar</button>
      <button class="btn btn--ghost u-c-red" id="deleteTeamBtn" style="display:none">Eliminar</button>
      <button class="btn btn--ghost u-c-red" id="seasonDiscontinueBtn" style="display:none">No continúa</button>
      <span class="u-fs-2 u-c-dim" id="teamSaveStatus"></span>
    </div>
    <div id="teamSpecialEditionsPanel" class="team-editor-panel u-gap-060" style="display:none">
      <div class="u-row u-gap-075 u-wrap">
        <div class="panel-subheading u-c-text">Ediciones especiales</div>
        <div class="u-grow"></div>
        <button type="button" class="btn btn--ghost u-py-030 u-px-070 u-fs-1" id="addSpecialEditionBtn">+ Nueva edición</button>
      </div>
      <div id="teamSpecialEditionsList" class="u-stack u-stack--xs"></div>
    </div>
    <div id="teamRosterPanel" class="team-editor-panel" style="display:none">
      <div class="u-row u-gap-075 u-wrap">
        <div class="panel-subheading u-c-text">
          Plantilla <span id="teamRosterYear"></span>
        </div>
        <span class="u-fs-1 u-c-dim" id="teamRosterCount"></span>
        <div class="u-grow"></div>
        <button class="btn btn--primary u-py-030 u-px-070 u-fs-1 u-nowrap" id="rosterNewRiderBtn">+ Nuevo corredor</button>
      </div>
      <div id="rosterAddBox" class="panel-dashed-box u-gap-040">
        <div class="u-row u-gap-050 u-wrap">
          <label class="u-fs-1 u-c-dim u-nowrap">Añadir corredor existente:</label>
          <input type="search" id="rosterAddSearch" placeholder="Buscar por nombre o apellido…" autocomplete="off" class="roster-add-search">
          ${genderToggleHtml({ idMale: 'rosterAddGenderMale', idFemale: 'rosterAddGenderFemale', wrapId: 'rosterAddGenderToggle', wrapStyle: 'display:none' })}
        </div>
        <div id="rosterAddResults" class="roster-add-results panel-list" style="display:none"></div>
      </div>
      <div id="teamRosterList" class="panel-list">
        <div class="u-fs-3 u-c-dim">Cargando…</div>
      </div>
    </div>
    <div id="teamSeason27Panel" hidden class="team-editor-panel" style="display:none">
      <div class="u-row u-gap-075 u-wrap">
        <div class="panel-subheading u-c-text">
          Temporada <span id="teamSeasonYearLabel"></span>
        </div>
        <span class="u-fs-1 u-c-dim">identidad anual independiente de la ficha matriz</span>
      </div>
      <div class="field-row field-row--2">
        <div class="field">
          <label>Nombre de temporada</label>
          <input type="text" id="ts27-name" class="u-w-full">
        </div>
        <div class="field">
          <label>Categoría de temporada</label>
          <select id="ts27-category" class="u-w-full">
            <option value="">— Sin categoría —</option>
            <optgroup label="Masculino">
              <option value="WT">WT — WorldTour</option>
              <option value="PT">PT — ProTeam</option>
              <option value="CT">CT — Continental</option>
              <option value="NTM">NTM — Selección nac.</option>
              <option value="CLUBM">CLUBM — Club</option>
            </optgroup>
            <optgroup label="Femenino">
              <option value="WWT">WWT — WorldTour</option>
              <option value="PRW">PRW — ProTeam</option>
              <option value="CTW">CTW — Continental</option>
              <option value="NTW">NTW — Selección nac.</option>
              <option value="CLUBW">CLUBW — Club</option>
            </optgroup>
          </select>
        </div>
      </div>
      <div class="field-row field-row--3">
        <div class="field">
          <label>Código UCI <span class="u-dim">— 3 caracteres</span></label>
          <input type="text" id="ts27-uciCode" maxlength="3" class="u-w-full">
        </div>
        <div class="field">
          <label>Género</label>
          <select id="ts27-gender" class="u-w-full">
            <option value="">— Sin especificar —</option>
            <option value="male">Masculino</option>
            <option value="female">Femenino</option>
          </select>
        </div>
        <div class="field">
          <label>Alias de temporada <span class="u-dim">— uno por línea</span></label>
          <textarea id="ts27-aliases" rows="3" class="u-w-full"></textarea>
        </div>
      </div>
      <label class="panel-check-label u-gap-050 u-fs-3">
        <input type="checkbox" id="ts27-badgeVisible">
        <span>Colores publicados para esta temporada</span>
      </label>
      <label class="panel-check-label u-gap-050 u-fs-3">
        <input type="checkbox" id="ts27-continuityDoubt">
        <span>Continuidad en duda <span class="u-dim">— usado por el mercado de fichajes cuando corresponde</span></span>
      </label>
      <details id="ts27-colors-details">
        <summary class="u-pointer u-fs-2 u-c-muted">🎨 Colores de temporada</summary>
        <div class="team-colors-body">
          <div class="field-row">
            <div class="field">
              <label>Fondo de pestaña / barra de título</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-headerBg-color">
                <input class="u-grow" type="text" id="ts27-headerBg-text" value="#1f2937">
              </div>
            </div>
          </div>
          <div class="field-row field-row--3">
            <div class="field">
              <label>Cuadrado cromático 1</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-torsoSides-color">
                <input class="u-grow" type="text" id="ts27-torsoSides-text" value="#111111">
              </div>
            </div>
            <div class="field">
              <label>Cuadrado cromático 2</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-torsoCenter-color">
                <input class="u-grow" type="text" id="ts27-torsoCenter-text" value="#ffffff">
              </div>
            </div>
            <div class="field">
              <label>Cuadrado cromático 3</label>
              <div class="color-preview">
                <input class="u-color-dot" type="color" id="ts27-shorts-color">
                <input class="u-grow" type="text" id="ts27-shorts-text" value="#111111">
              </div>
            </div>
          </div>
          <div class="field-row field-row--2">
            <div class="field">
              <label>Círculo interior <span class="u-dim">— opcional, #RRGGBB</span></label>
              <input type="text" id="ts27-innerCircle-text" placeholder="Sin círculo" class="u-w-full">
            </div>
            <div class="field">
              <label>Traducciones <span class="u-dim">— JSON</span></label>
              <textarea id="ts27-translations" rows="3" class="u-w-full" spellcheck="false">{}</textarea>
            </div>
          </div>
          <div class="team-season-colors-preview">
            <div id="ts27ColorsPreview" class="team-color-squares team-color-squares--small" aria-label="Tres colores cromáticos de la temporada"><i></i><i></i><i></i></div>
            <div id="ts27HeaderPreview" class="team-season-header-preview">Barra de título</div>
          </div>
        </div>
      </details>
      <div class="u-row u-gap-075 u-wrap">
        <button class="btn btn--primary u-py-035 u-px-080 u-fs-2" id="saveTeamSeason27Btn">Guardar temporada</button>
        <button class="btn btn--ghost u-py-035 u-px-080 u-fs-2 u-c-red" id="ts27DiscontinueBtn" title="Elimina únicamente la temporada del mercado y deja de listar el equipo allí" style="display:none">No continúa</button>
        <span class="u-fs-2 u-c-dim" id="ts27Status"></span>
      </div>
    </div>
  `;
}

// Listeners del editor de equipo (por apertura del drawer). Incluye los pares
// de color, specialEdition, categoría→género, colores-modal y el panel de
// plantilla (que tenía guarda once _rosterReady → ahora se cablea por apertura).
function wireTeamEditor() {
  const bind = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  };
  bind('saveTeamBtn', 'click', saveTeam);
  bind('duplicateTeamBtn', 'click', duplicateTeam);
  bind('deleteTeamBtn', 'click', deleteTeam);
  bind('seasonDiscontinueBtn', 'click', discontinueTeamSeason27);
  bind('specialEditorBackBtn', 'click', event => {
    const parentTeamId = event.currentTarget.dataset.parentTeamId;
    if (parentTeamId) openTeamEditor(parentTeamId, { seasonYear: panelState._editingTeamSeasonYear });
  });
  bind('addSpecialEditionBtn', 'click', () => {
    if (panelState._editingTeamId) openTeamEditor(null, {
      seasonYear: panelState._editingTeamSeasonYear,
      specialParentId: panelState._editingTeamId,
    });
  });
  ['headerBg', 'torsoSides', 'torsoCenter', 'shorts'].forEach(key => {
    const color = document.getElementById(`te-${key}-color`);
    const text  = document.getElementById(`te-${key}-text`);
    if (!color || !text) return;
    color.addEventListener('input', () => { _teamColorsExplicitlySet = true; text.value = color.value.toUpperCase(); refreshTeamPreview(); });
    text.addEventListener('input', () => {
      const v = text.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { _teamColorsExplicitlySet = true; color.value = v.toLowerCase(); refreshTeamPreview(); }
    });
  });
  bind('te-name', 'input', refreshTeamPreview);
  bind('te-countryCode', 'input', refreshTeamCountryFlag);
  bind('te-seRaceSearch', 'input', (e) => {
    const current = document.getElementById('te-seRaceId').value || null;
    _populateSpecialRaceSelect(current, e.target.value);
  });
  const CATEGORY_GENDER = { WT:'male',WWT:'female',PT:'male',PRW:'female',CT:'male',CTW:'female',NTM:'male',NTW:'female',CLUBM:'male',CLUBW:'female' };
  bind('te-category', 'change', (e) => {
    const g = CATEGORY_GENDER[e.target.value];
    if (g) document.getElementById('te-gender').value = g;
    const isSelection = e.target.value === 'NTM' || e.target.value === 'NTW';
    const meta = document.getElementById('te-selectionMeta-row');
    if (meta) meta.style.display = isSelection ? '' : 'none';
    if (isSelection) {
      const scope = document.getElementById('te-selectionScope');
      if (!scope.value) scope.value = 'national';
      const code = document.getElementById('te-selectionCode');
      if (!code.value) code.value = document.getElementById('te-countryCode').value.trim().toLowerCase();
    }
    _syncRosterVisibility(panelState._editingTeamId, document.getElementById('te-specialEdition').checked);
  });
  // Panel de plantilla (antes setupRosterPanel con guarda once)
  setupRosterPanel();
  // Editor de temporada: el DOM se recrea cada vez que se abre el drawer.
  setupSeason27Panel();
}

export function openTeamEditor(teamId, { seasonYear = CURRENT_TEAM_SEASON, specialParentId = null } = {}) {
  panelState._editingTeamId = teamId;
  panelState._editingTeamSeasonYear = Number(seasonYear) || CURRENT_TEAM_SEASON;
  // Por defecto, un alta normal NO nace en el mercado (solo lo hace el alta por
  // «+ Equipo <MARKET_SEASON>», que fija el flag después de esta llamada).
  panelState._newTeamMarketBorn = false;
  const team = teamId ? (panelState._teamsCache || []).find(t => t.id === teamId) : null;
  const requestedParent = specialParentId
    ? (panelState._teamsCache || []).find(candidate => candidate.id === specialParentId && !candidate.specialEdition)
    : null;
  const matrix = team || requestedParent;
  const isSpecialEdition = team?.specialEdition === true || !!requestedParent;
  const parentTeamId = team?.parentTeamId || requestedParent?.id || null;
  const season = teamId && !isSpecialEdition
    ? (_teamSeasonsByYear.get(panelState._editingTeamSeasonYear) || []).find(row => row.teamId === teamId) || null
    : null;
  const source = isSpecialEdition ? matrix : (season || matrix);
  panelState._editingTeamIsSeason = !!teamId && !isSpecialEdition;
  panelState._season27Row = season;
  _teamColorsExplicitlySet = !!(source?.headerBg);

  // El editor vive en el drawer: se monta su cuerpo + listeners por apertura.
  openDrawer({
    title: isSpecialEdition ? (team ? 'Editar edición especial' : 'Nueva edición especial') : (team ? 'Editar equipo' : 'Nuevo equipo'),
    level: 1,
    render: (body) => {
      body.innerHTML = teamEditorBodyHtml();
      wireTeamEditor();
    },
  });

  document.getElementById('deleteTeamBtn').style.display = team && isSpecialEdition ? '' : 'none';
  document.getElementById('duplicateTeamBtn').style.display = team && isSpecialEdition ? '' : 'none';
  document.getElementById('seasonDiscontinueBtn').style.display = panelState._editingTeamIsSeason
    && panelState._editingTeamSeasonYear === MARKET_SEASON && !!season ? '' : 'none';
  document.getElementById('teamSaveStatus').textContent = '';

  document.getElementById('te-name').value    = source?.name || '';
  document.getElementById('te-aliases').value = source?.nameAliases || '';
  document.getElementById('te-uciCode').value = season?.uciCode || '';
  setColorPair('headerBg',    source?.headerBg         || DEFAULT_TEAM.headerBg);
  setColorPair('torsoCenter', source?.badgeTorsoCenter || DEFAULT_TEAM.badgeTorsoCenter);
  setColorPair('torsoSides',  source?.badgeTorsoSides  || DEFAULT_TEAM.badgeTorsoSides);
  setColorPair('shorts',      source?.badgeShorts      || DEFAULT_TEAM.badgeShorts);
  document.getElementById('te-specialEdition').checked = isSpecialEdition;
  const kindTitle = document.getElementById('teamEditorKindTitle');
  const kindDescription = document.getElementById('teamEditorKindDescription');
  if (isSpecialEdition) {
    if (kindTitle) kindTitle.textContent = 'Edición especial';
    if (kindDescription) kindDescription.textContent = 'Identidad y vigencia del maillot especial vinculado al equipo matriz.';
  } else {
    if (kindTitle) kindTitle.textContent = `Temporada ${panelState._editingTeamSeasonYear}`;
    if (kindDescription) kindDescription.textContent = season
      ? `Identidad anual del equipo en ${panelState._editingTeamSeasonYear}. Los cambios solo afectan a esta temporada.`
      : `Nueva identidad anual para ${panelState._editingTeamSeasonYear}.`;
  }
  const backButton = document.getElementById('specialEditorBackBtn');
  if (backButton && parentTeamId) {
    backButton.style.display = '';
    backButton.dataset.parentTeamId = parentTeamId;
  }
  const parentRow = document.getElementById('te-parentTeam-row');
  parentRow.style.display = isSpecialEdition ? '' : 'none';
  if (isSpecialEdition) _populateParentTeamSelect(parentTeamId);
  // Vigencia del maillot especial
  document.getElementById('te-specialValidity-row').style.display = isSpecialEdition ? 'flex' : 'none';
  document.getElementById('te-seValidFrom').value = team?.specialEditionValidFrom || '';
  document.getElementById('te-seValidTo').value   = team?.specialEditionValidTo   || '';
  document.getElementById('te-seRaceSearch').value = '';
  _populateSpecialRaceSelect(team?.specialEditionRaceId || null);
  document.getElementById('te-category').value = source?.category || '';
  document.getElementById('te-gender').value   = source?.gender   || '';
  document.getElementById('te-countryCode').value = matrix?.countryCode || '';
  document.getElementById('te-countryCode').disabled = panelState._editingTeamIsSeason;
  const isSelection = source?.category === 'NTM' || source?.category === 'NTW' || source?.teamKind === 'selection';
  document.getElementById('te-selectionScope').value = source?.selectionScope || 'national';
  document.getElementById('te-selectionCode').value = source?.selectionCode || (isSelection ? (source?.countryCode || '') : '');
  document.getElementById('te-selectionMeta-row').style.display = isSelection ? '' : 'none';
  refreshTeamCountryFlag();

  refreshTeamPreview();
  // Temporada y plantilla comparten el año seleccionado. Las ediciones
  // especiales conservan su editor propio y no montan ninguno de estos bloques.
  renderTeamSpecialEditionsPanel(teamId);
  _syncRosterVisibility(teamId, isSpecialEdition, source);
  _syncSeason27Visibility(teamId, isSpecialEdition);
}

export function closeTeamEditor() {
  panelState._editingTeamId = null;
  panelState._editingTeamIsSeason = false;
  panelState._rosterTeamId = null;
  closeDrawer(1);
}

async function saveTeam() {
  const status = document.getElementById('teamSaveStatus');
  const t = readTeamFromForm();
  if (!t.name) { status.textContent = 'Falta el nombre.'; return; }
  if (!t.category) { status.textContent = 'Selecciona una categoría UCI.'; return; }
  if (t.specialEdition && !t.parentTeamId) { status.textContent = 'Selecciona el equipo base de la edición especial.'; return; }
  const seasonPayload = readTeamSeasonFromForm(t);
  if (seasonPayload.uciCode && !/^\S{3}$/.test(seasonPayload.uciCode)) {
    status.textContent = 'El código UCI debe tener exactamente 3 caracteres.';
    return;
  }
  status.textContent = 'Guardando…';
  try {
    if (panelState._editingTeamIsSeason) {
      const { data, error } = await supabase.rpc('admin_save_team_season', {
        p_team_id: panelState._editingTeamId,
        p_year: panelState._editingTeamSeasonYear,
        p_season: seasonPayload,
      });
      if (error) throw error;
      panelState._season27Row = data || seasonPayload;
    } else if (panelState._editingTeamId) {
      const payload = { ...t, updatedAt: new Date().toISOString() };
      const { error } = await supabase.from('teams').update(payload).eq('id', panelState._editingTeamId);
      if (error) throw error;
    } else {
      const id = `team_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Alta desde «+ Equipo <MARKET_SEASON>» → firstSeason = temporada del
      // mercado: el trigger sync_team_to_season NO le estampa una temporada del
      // año en curso (mig. 129) → nace SIN identidad anterior → el mercado lo
      // deja vacío hasta publicar los colores, en vez de mostrar los anteriores
      // que no existen.
      const insert = { id, ...t };
      if (panelState._newTeamMarketBorn) insert.firstSeason = MARKET_SEASON;
      const { error } = await supabase.from('teams').insert(insert);
      if (error) throw error;
      if (!t.specialEdition) {
        const { data: seasonData, error: seasonError } = await supabase.rpc('admin_save_team_season', {
          p_team_id: id,
          p_year: panelState._editingTeamSeasonYear,
          p_season: seasonPayload,
        });
        if (seasonError) throw seasonError;
        panelState._season27Row = seasonData || seasonPayload;
        panelState._editingTeamIsSeason = true;
      }
      panelState._newTeamMarketBorn = false;
      panelState._editingTeamId = id;
      document.getElementById('deleteTeamBtn').style.display = '';
      const drawerTitle = document.getElementById('ccDrawer1Title');
      if (drawerTitle) drawerTitle.textContent = t.specialEdition ? 'Editar edición especial' : 'Editar equipo';
    }
    const refreshes = [
      fetchTeams({ force: true }),
      fetchTeamSeasonsForYear(panelState._editingTeamSeasonYear, { force: true }),
    ];
    if (panelState._teamsListYear !== panelState._editingTeamSeasonYear) {
      refreshes.push(fetchTeamSeasonsForYear(panelState._teamsListYear, { force: true }));
    }
    await Promise.all(refreshes);
    if (document.getElementById('teamsList')) renderTeamsList();
    status.textContent = 'Guardado.';
    showToast(panelState._editingTeamIsSeason ? `Temporada ${panelState._editingTeamSeasonYear} guardada` : 'Equipo guardado', 'success');

    // Revelar/refrescar la plantilla del equipo recién guardado (no para ediciones especiales).
    _syncRosterVisibility(panelState._editingTeamId, t.specialEdition);
    renderTeamSpecialEditionsPanel(panelState._editingTeamId);
    if (panelState._editingTeamIsSeason) {
      document.getElementById('te-countryCode').disabled = true;
      document.getElementById('duplicateTeamBtn').style.display = 'none';
      document.getElementById('deleteTeamBtn').style.display = 'none';
    }
    const backButton = document.getElementById('specialEditorBackBtn');
    if (backButton && t.specialEdition) {
      backButton.style.display = '';
      backButton.dataset.parentTeamId = t.parentTeamId;
    }

  } catch (err) {
    console.error('[saveTeam]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

async function deleteTeam() {
  if (!panelState._editingTeamId) return;
  if (!await confirmDialog('¿Eliminar este equipo? Las listas de inscritos enlazadas perderán su enriquecimiento visual.', { danger: true })) return;
  const status = document.getElementById('teamSaveStatus');
  const deletedTeam = (panelState._teamsCache || []).find(team => team.id === panelState._editingTeamId);
  const returnToParentId = deletedTeam?.specialEdition ? deletedTeam.parentTeamId : null;
  status.textContent = 'Eliminando…';
  try {
    const { error } = await supabase.from('teams').delete().eq('id', panelState._editingTeamId);
    if (error) throw error;
    await Promise.all([
      fetchTeams({ force: true }),
      fetchTeamSeasonsForYear(panelState._teamsListYear, { force: true }),
    ]);
    renderTeamsList();
    if (returnToParentId && (panelState._teamsCache || []).some(team => team.id === returnToParentId)) {
      openTeamEditor(returnToParentId, { seasonYear: panelState._editingTeamSeasonYear });
    } else {
      closeTeamEditor();
    }
    showToast('Equipo eliminado', 'success');
  } catch (err) {
    console.error('[deleteTeam]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}
