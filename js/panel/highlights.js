// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Cintillo «Hoy» (today_highlights)
// ─────────────────────────────────────────────────────────────────

import {
  panelArea, loadCxCommonRaces, fillCxRaceSelect, cxCommonRaceName,
  loadCxCommonTournaments, fillCxTournamentSelect, cxCommonTournamentName,
} from './cx.js?v=20260927foldname';
import { supabase, countryFlag, esc } from '../shared.js';
import { openDrawer } from '../components/drawer.js?v=20260912cxsavecontext';
import { confirmDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { attachInlineUpload } from './uploads.js';
import { ensureAllRacesLoaded } from './agenda.js';

// ═════════════════════════════════════════════════════════════════
//  CINTILLO «HOY» — today_highlights (manual editorial)
// ═════════════════════════════════════════════════════════════════

let _highlightsViewReady = false;
let _highlightsCache = null;
let _highlightsScope = null;               // scope ('road'|'cx') de `_highlightsCache`
let _highlightRaceDaysCache = {};         // raceId → race_days[] (lazy, para el editor)
let _highlightRaceDaysByIdCache = {};     // raceDayId → race_day (bulk, para la lista)
let _highlightEditor = null;
let _hlSelectedRace = null;
let _hlRaceSearchDebounce = null;

// ── Helpers de fecha+hora para visibleFrom/visibleUntil (TIMESTAMPTZ) ─

/**
 * Convierte un timestamptz ISO (devuelto por Supabase) al formato que espera
 * `<input type="datetime-local">`: "YYYY-MM-DDTHH:MM" en hora local del editor.
 */
function _toDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convierte el valor de `<input type="datetime-local">` (sin TZ, hora local del
 * editor) a un ISO con TZ explícita para que Supabase lo guarde como TIMESTAMPTZ.
 * El navegador ya interpreta "2026-05-29T14:00" en la TZ local del editor.
 */
function _fromDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Formatea un timestamptz ISO a algo legible en la lista de destacados.
 * Ej: "29 may 14:00". Usa la TZ local del editor.
 */
function _fmtVisibilityInstant(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

async function fetchHighlights({ force = false } = {}) {
  const scope = panelArea();
  if (_highlightsCache && !force && _highlightsScope === scope) return _highlightsCache;
  const { data, error } = await supabase
    .from('today_highlights')
    .select('*')
    .eq('scope', scope)
    .order('position', { ascending: true });
  if (error) { console.error('[highlights] fetch', error); return []; }
  _highlightsCache = data || [];
  _highlightsScope = scope;
  return _highlightsCache;
}

async function _fetchRaceDaysForHighlight(raceId) {
  if (_highlightRaceDaysCache[raceId]) return _highlightRaceDaysCache[raceId];
  const { data, error } = await supabase
    .from('race_days')
    .select('id, slug, date, stageNumber, startLocation, finishLocation, primaryType, startOrderImportedAt')
    .eq('raceId', raceId)
    .order('date', { ascending: true });
  if (error) { console.error('[highlights] race_days', error); return []; }
  _highlightRaceDaysCache[raceId] = data || [];
  return _highlightRaceDaysCache[raceId];
}

export function setupHighlightsView() {
  ensureAllRacesLoaded().catch(error => {
    showToast('No se pudo cargar el catálogo histórico: ' + error.message);
  });
  if (!_highlightsViewReady) {
    _highlightsViewReady = true;
    document.getElementById('addHighlightBtn').addEventListener('click', () => openHighlightEditor(null));
    // El editor de cintillo se renderiza en el drawer; sus listeners se cablean
    // por apertura en wireHighlightEditor() (ver openHighlightEditor).
  }
  fetchHighlights({ force: true })
    .then(_prefetchHighlightsRaceDays)
    .then(() => loadCxCommonRaces(supabase).catch(error => showToast(error.message, 'error')))
    .then(() => loadCxCommonTournaments(supabase).catch(error => showToast(error.message, 'error')))
    .then(renderHighlightsList);
}

/**
 * Resuelve en bulk los `race_days` referenciados por destacados activos para
 * que la lista no muestre "(carrera desconocida)" en filas con `raceDayId` y
 * para poder pintar "Etapa N" en el subtítulo.
 */
async function _prefetchHighlightsRaceDays() {
  const ids = (_highlightsCache || [])
    .map(h => h.raceDayId)
    .filter(Boolean)
    .filter(id => !_highlightRaceDaysByIdCache[id]);
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from('race_days')
    .select('id, raceId, date, stageNumber, startLocation, finishLocation, primaryType')
    .in('id', ids);
  if (error) { console.error('[highlights] prefetch race_days', error); return; }
  (data || []).forEach(rd => { _highlightRaceDaysByIdCache[rd.id] = rd; });
}

function _onHighlightRaceSearch() {
  const editor = _highlightEditor;
  if (!editor?.drawer.isCurrent()) return;
  const q = document.getElementById('hl-race-search').value.trim().toLowerCase();
  const resultsDiv = document.getElementById('hl-race-results');
  clearTimeout(_hlRaceSearchDebounce);
  if (!q || q.length < 2) {
    resultsDiv.style.display = 'none';
    return;
  }
  _hlRaceSearchDebounce = setTimeout(() => {
    if (!editor.drawer.isCurrent()) return;
    const matches = panelState.allRaces
      .filter(r => (r.name || '').toLowerCase().includes(q) || (r.nameEn || '').toLowerCase().includes(q))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
      .slice(0, 20);
    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div style="padding:0.5rem 0.7rem;color:var(--text-dim);font-size:0.82rem">Sin resultados</div>';
    } else {
      resultsDiv.innerHTML = matches.map(r => {
        const flag = r.hideFlag ? '' : countryFlag(r.countryCode);
        return `
          <div class="hl-race-option" data-race-id="${esc(r.id)}" style="padding:0.5rem 0.7rem;cursor:pointer;display:flex;align-items:center;gap:0.5rem;border-bottom:1px solid var(--border)">
            ${flag ? `<span>${flag}</span>` : ''}
            <span style="flex:1;font-size:0.85rem">${esc(r.name)}</span>
            <span class="u-fs-xs u-c-dim">${esc(r.startDate || '')} · ${esc(r.uciCategory || '')}</span>
          </div>`;
      }).join('');
      resultsDiv.querySelectorAll('.hl-race-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const id = opt.dataset.raceId;
          const race = panelState.allRaces.find(r => r.id === id);
          if (race) _selectHighlightRace(race);
        });
      });
    }
    resultsDiv.style.display = 'block';
  }, 150);
}

async function _selectHighlightRace(race) {
  const editor = _highlightEditor;
  if (!editor?.drawer.isCurrent()) return;
  const request = ++editor.raceRequest;
  _hlSelectedRace = race;
  document.getElementById('hl-race-search').style.display = 'none';
  document.getElementById('hl-race-results').style.display = 'none';
  const sel = document.getElementById('hl-race-selected');
  sel.style.display = 'flex';
  // countryFlag() devuelve HTML (<img>), por eso innerHTML — no textContent.
  document.getElementById('hl-race-selected-flag').innerHTML = race.hideFlag ? '' : countryFlag(race.countryCode);
  document.getElementById('hl-race-selected-name').textContent = race.name;
  document.getElementById('hl-stage-row').style.display = 'none';
  document.getElementById('hl-raceDayId').innerHTML = '';

  // Cargar jornadas si la carrera es de varias etapas
  let rds;
  try {
    rds = await _fetchRaceDaysForHighlight(race.id);
  } catch (error) {
    if (editor.drawer.isCurrent() && request === editor.raceRequest) document.getElementById('highlightSaveStatus').textContent = error.message;
    return;
  }
  if (!editor.drawer.isCurrent() || request !== editor.raceRequest) return;
  const stageRow = document.getElementById('hl-stage-row');
  const stageSel = document.getElementById('hl-raceDayId');
  if (rds.length === 0) {
    stageRow.style.display = 'none';
    stageSel.innerHTML = '';
  } else if (rds.length === 1) {
    // Una sola jornada: la asignamos pero no mostramos selector
    stageRow.style.display = 'none';
    stageSel.innerHTML = `<option value="${esc(rds[0].id)}" selected>${_describeRaceDay(rds[0])}</option>`;
  } else {
    stageRow.style.display = '';
    stageSel.innerHTML = '<option value="">— Selecciona jornada —</option>' +
      rds.map(rd => `<option value="${esc(rd.id)}">${esc(_describeRaceDay(rd))}</option>`).join('');
  }
  _refreshHighlightTargetWarning();
}

function _describeRaceDay(rd) {
  const stage = rd.stageNumber === 0 ? 'Prólogo' : (rd.stageNumber != null ? `Etapa ${rd.stageNumber}` : '');
  const route = [rd.startLocation, rd.finishLocation].filter(Boolean).join(' › ');
  return [rd.date, stage, route].filter(Boolean).join(' · ');
}

function _clearHighlightRaceSelection() {
  if (_highlightEditor) ++_highlightEditor.raceRequest;
  _hlSelectedRace = null;
  document.getElementById('hl-race-search').value = '';
  document.getElementById('hl-race-search').style.display = '';
  document.getElementById('hl-race-selected').style.display = 'none';
  document.getElementById('hl-stage-row').style.display = 'none';
  document.getElementById('hl-raceDayId').innerHTML = '';
  _refreshHighlightTargetWarning();
}

function _refreshHighlightTargetWarning() {
  const warn = document.getElementById('hl-target-warning');
  warn.style.display = 'none';
  warn.textContent = '';

  const targetType = document.querySelector('input[name="hl-targetType"]:checked')?.value || 'raceDay';

  // Entrada custom: ocultar selección de carrera/jornada, mostrar campos custom.
  // Modo Campeonatos y Fichajes: tampoco usan carrera (destino fijo), sin campos custom de URL.
  const isCustom = targetType === 'custom';
  const isChampionships = targetType === 'championships';
  const isTransfers = targetType === 'transfers';
  const isCx = targetType === 'cxRace';
  const isCxTournament = targetType === 'cxTournament';
  document.getElementById('hl-cx-race-row').style.display = isCx ? '' : 'none';
  document.getElementById('hl-cx-tournament-row').style.display = isCxTournament ? '' : 'none';
  const noRace = isCustom || isChampionships || isTransfers || isCx || isCxTournament;
  document.getElementById('hl-race-row').style.display   = noRace ? 'none' : '';
  document.getElementById('hl-custom-row').style.display = isCustom ? 'flex' : 'none';
  if (noRace) {
    document.getElementById('hl-stage-row').style.display = 'none';
    return; // sin carrera → sin avisos de startlist/jornada
  }

  if (!_hlSelectedRace) return;

  if (targetType === 'race') {
    // Competición: vista general de la carrera. No exige startlist ni jornada.
    return;
  }
  if (targetType === 'startlist') {
    if (!_hlSelectedRace.startlistImportedAt) {
      warn.textContent = 'Esta carrera no tiene startlist importada — el enlace fallará. Importa la startlist o cambia el destino.';
      warn.style.display = 'block';
    }
    return;
  }
  if (targetType === 'startOrder') {
    const rdId = document.getElementById('hl-raceDayId').value;
    const rds = _highlightRaceDaysCache[_hlSelectedRace.id] || [];
    const rd = rds.find(r => r.id === rdId);
    if (!rd) {
      warn.textContent = 'Selecciona una jornada.';
      warn.style.display = 'block';
      return;
    }
    if (!rd.startOrderImportedAt) {
      warn.textContent = 'Esta jornada no tiene orden de salida importado — el enlace fallará. Importa el orden de salida o cambia el destino.';
      warn.style.display = 'block';
    }
  }
}

// Destinos del cintillo. Carretera y Ciclocross son independientes: solo se
// muestran los del área activa. Los del área opuesta quedan en el DOM ocultos
// para conservar los flujos del editor pero no son seleccionables.
const HIGHLIGHT_TARGETS = [
  ['raceDay', 'Jornada (detalle de la etapa)', 'road'],
  ['race', 'Competición (vista general de la carrera)', 'road'],
  ['startlist', 'Dorsales (startlist)', 'road'],
  ['startOrder', 'Orden de salida', 'road'],
  ['championships', 'Modo Campeonatos — web abre la página; apps, la pantalla nativa', 'road'],
  ['transfers', 'Mercado de Fichajes — web abre /fichajes/; apps, la pantalla nativa', 'road'],
  ['custom', 'Personalizado (solo web) — URL, título y logo libres', 'road'],
  ['cxRace', 'Prueba de ciclocross (página de la jornada)', 'cx'],
  ['cxTournament', 'Torneo de ciclocross (página de la serie)', 'cx'],
];
const HIGHLIGHT_TARGET_DEFAULT = { road: 'raceDay', cx: 'cxRace' };

function _highlightTargetOptionsHtml(scope) {
  const area = scope === 'cx' ? 'cx' : 'road';
  const defaultType = HIGHLIGHT_TARGET_DEFAULT[area];
  return HIGHLIGHT_TARGETS.map(([value, label, valueScope]) =>
    `<label class="hl-target-option"${valueScope !== area ? ' style="display:none"' : ''}><input type="radio" name="hl-targetType" value="${value}"${value === defaultType ? ' checked' : ''}><span>${esc(label)}</span></label>`
  ).join('');
}

// Cuerpo del editor de cintillo dentro del drawer (mismos ids hl-*).
function highlightEditorBodyHtml(scope) {
  const isCx = scope === 'cx';
  return `
    <div>
      <label style="display:block;font-size:0.78rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:0.4rem">Destino del cintillo de ${isCx ? 'Ciclocross' : 'carretera'}</label>
      <div class="hl-target-options" style="display:flex;flex-direction:column;gap:0.5rem">
        ${_highlightTargetOptionsHtml(scope)}
      </div>
      <div id="hl-target-warning" style="display:none;color:var(--red);font-size:0.78rem;margin-top:0.4rem"></div>
    </div>
    <div class="field" id="hl-cx-race-row" style="display:none">
      <label>Carrera de ciclocross</label>
      <select id="hl-cx-race-id"></select>
      <button type="button" class="btn btn--ghost" id="hl-cx-retry" hidden>Reintentar</button>
    </div>
    <div class="field" id="hl-cx-tournament-row" style="display:none">
      <label>Torneo de ciclocross</label>
      <select id="hl-cx-tournament-id"></select>
      <button type="button" class="btn btn--ghost" id="hl-cx-tournament-retry" hidden>Reintentar</button>
    </div>
    <div class="field" id="hl-race-row">
      <label>Carrera</label>
      <input type="text" id="hl-race-search" placeholder="Busca por nombre de carrera…" autocomplete="off">
      <div id="hl-race-results" style="display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;margin-top:0.25rem;background:var(--bg)"></div>
      <div id="hl-race-selected" style="display:none;padding:0.5rem 0.7rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;margin-top:0.25rem;align-items:center;gap:0.6rem">
        <span id="hl-race-selected-flag" style="font-size:1.1rem;line-height:1"></span>
        <span id="hl-race-selected-name" style="flex:1;font-size:0.9rem;font-weight:600"></span>
        <button class="btn btn--ghost" id="hl-race-clear" style="padding:0.25rem 0.55rem;font-size:0.72rem">Cambiar</button>
      </div>
    </div>
    <div class="field" id="hl-stage-row" style="display:none">
      <label>Jornada</label>
      <select id="hl-raceDayId"></select>
    </div>
    <div id="hl-custom-row" style="display:none;flex-direction:column;gap:1rem">
      <div class="field-row field-row--2">
        <div class="field">
          <label>URL de destino (ES) <span style="color:var(--red)">*</span></label>
          <input type="text" id="hl-customUrl" placeholder="Ej.: /campeonatos-nacionales-2026.html" class="u-w-full">
        </div>
        <div class="field">
          <label>URL de destino (EN) <span class="u-dim">— opcional</span></label>
          <input type="text" id="hl-customUrlEn" placeholder="Ej.: /en/2026-national-championships/" class="u-w-full">
        </div>
      </div>
      <div class="field" id="hl-customLogo-wrap">
        <label>Logo <span class="u-dim">— opcional (URL o subir)</span></label>
        <input type="text" id="hl-customLogo" placeholder="https://assets.calendariociclismo.app/…" class="u-w-full">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Título personalizado (ES) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customTitle" placeholder="Sobrescribe el nombre de la carrera" class="u-w-full">
      </div>
      <div class="field">
        <label>Título personalizado (EN) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customTitleEn" placeholder="Custom title in English" class="u-w-full">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Detalle (ES) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customDetail" placeholder="Ej.: Etapa reina · 4500m de desnivel" class="u-w-full">
      </div>
      <div class="field">
        <label>Detalle (EN) <span class="u-dim">— opcional</span></label>
        <input type="text" id="hl-customDetailEn" placeholder="Ej.: Queen stage · 4500m climbing" class="u-w-full">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Visible desde <span class="u-dim">— opcional, hora local</span></label>
        <input type="datetime-local" id="hl-visibleFrom">
      </div>
      <div class="field">
        <label>Visible hasta <span class="u-dim">— opcional, hora local</span></label>
        <input type="datetime-local" id="hl-visibleUntil">
      </div>
    </div>
    <div class="u-row" style="gap:0.75rem;flex-wrap:wrap;margin-top:1rem">
      <button class="btn btn--primary" id="saveHighlightBtn">Guardar</button>
      <button class="btn btn--ghost" id="deleteHighlightBtn" style="color:var(--red);display:none">Eliminar</button>
      <span class="u-fs-md u-c-dim" id="highlightSaveStatus"></span>
    </div>
  `;
}

// Listeners del editor de cintillo (por apertura del drawer).
function wireHighlightEditor() {
  document.getElementById('saveHighlightBtn').addEventListener('click', saveHighlight);
  document.getElementById('deleteHighlightBtn').addEventListener('click', deleteHighlight);
  document.getElementById('hl-race-search').addEventListener('input', _onHighlightRaceSearch);
  document.getElementById('hl-race-clear').addEventListener('click', _clearHighlightRaceSelection);
  document.querySelectorAll('input[name="hl-targetType"]').forEach(r =>
    r.addEventListener('change', _refreshHighlightTargetWarning)
  );
  document.getElementById('hl-raceDayId').addEventListener('change', _refreshHighlightTargetWarning);
  document.getElementById('hl-cx-retry').addEventListener('click', () => {
    const editor = _highlightEditor;
    if (editor?.drawer.isCurrent() && !editor.busy) void _loadHighlightCxRaces(editor);
  });
  document.getElementById('hl-cx-tournament-retry').addEventListener('click', () => {
    const editor = _highlightEditor;
    if (editor?.drawer.isCurrent() && !editor.busy) void _loadHighlightCxTournaments(editor);
  });
}

async function _loadHighlightCxRaces(editor, selected) {
  if (!editor.drawer.isCurrent() || editor.cxLoading) return;
  const body = editor.drawer.body;
  const select = body.querySelector('#hl-cx-race-id');
  const retry = body.querySelector('#hl-cx-retry');
  const status = body.querySelector('#highlightSaveStatus');
  editor.cxLoading = true;
  select.disabled = true;
  retry.hidden = true;
  const selectedId = selected ?? (select.value || editor.cxRaceId || '');
  editor.cxRaceId = selectedId;
  try {
    await fillCxRaceSelect(supabase, select, selectedId, { isCurrent: () => editor.drawer.isCurrent() });
    if (editor.drawer.isCurrent()) {
      editor.cxRaceId = select.value;
      status.textContent = '';
    }
  } catch (error) {
    if (editor.drawer.isCurrent()) {
      status.textContent = error.message;
      retry.hidden = false;
    }
  } finally {
    editor.cxLoading = false;
    if (editor.drawer.isCurrent()) select.disabled = editor.busy;
  }
}

async function _loadHighlightCxTournaments(editor, selected) {
  if (!editor.drawer.isCurrent() || editor.cxTournamentLoading) return;
  const body = editor.drawer.body;
  const select = body.querySelector('#hl-cx-tournament-id');
  const retry = body.querySelector('#hl-cx-tournament-retry');
  const status = body.querySelector('#highlightSaveStatus');
  editor.cxTournamentLoading = true;
  select.disabled = true;
  retry.hidden = true;
  const selectedId = selected ?? (select.value || editor.cxTournamentId || '');
  editor.cxTournamentId = selectedId;
  try {
    await fillCxTournamentSelect(supabase, select, selectedId, { isCurrent: () => editor.drawer.isCurrent() });
    if (editor.drawer.isCurrent()) {
      editor.cxTournamentId = select.value;
      status.textContent = '';
    }
  } catch (error) {
    if (editor.drawer.isCurrent()) {
      status.textContent = error.message;
      retry.hidden = false;
    }
  } finally {
    editor.cxTournamentLoading = false;
    if (editor.drawer.isCurrent()) select.disabled = editor.busy;
  }
}

function _setHighlightBusy(editor, busy) {
  editor.busy = busy;
  if (!editor.drawer.isCurrent()) return;
  const body = editor.drawer.body;
  body.setAttribute('aria-busy', String(busy));
  if (busy) {
    editor.controls = [...body.querySelectorAll('input,select,textarea,button')].map(node => [node, node.disabled]);
    for (const [node] of editor.controls) node.disabled = true;
  } else {
    for (const [node, disabled] of editor.controls || []) node.disabled = disabled;
    body.querySelector('#hl-cx-race-id').disabled = editor.cxLoading;
    body.querySelector('#hl-cx-tournament-id').disabled = editor.cxTournamentLoading;
  }
}

async function openHighlightEditor(highlight) {
  // Reset
  const editor = { id: highlight?.id || crypto.randomUUID(), isNew: !highlight,
    position: highlight?.position ?? (_highlightsCache || []).reduce((mx, h) => Math.max(mx, h.position || 0), -1) + 1,
    scope: panelArea(), cxTournamentId: '', busy: false, cxLoading: false, cxTournamentLoading: false,
    loading: true, raceRequest: 0 };
  _highlightEditor = editor;
  _hlSelectedRace = null;

  // El editor vive en el drawer: se monta su cuerpo + listeners por apertura.
  editor.drawer = openDrawer({
    title: highlight ? 'Editar destacado' : 'Nuevo destacado',
    level: 1,
    render: (body) => {
      body.innerHTML = highlightEditorBodyHtml(editor.scope);
      wireHighlightEditor();
    },
    onClose: () => {
      if (_highlightEditor !== editor) return;
      _highlightEditor = null;
      _hlSelectedRace = null;
      clearTimeout(_hlRaceSearchDebounce);
    },
  });

  document.getElementById('highlightSaveStatus').textContent = '';
  document.getElementById('deleteHighlightBtn').style.display = highlight ? 'inline-block' : 'none';
  document.getElementById('hl-customTitle').value     = highlight?.customTitle     || '';
  document.getElementById('hl-customTitleEn').value   = highlight?.customTitleEn   || '';
  document.getElementById('hl-customDetail').value    = highlight?.customDetail    || '';
  document.getElementById('hl-customDetailEn').value  = highlight?.customDetailEn  || '';
  document.getElementById('hl-customUrl').value       = highlight?.customUrl       || '';
  document.getElementById('hl-customUrlEn').value     = highlight?.customUrlEn     || '';
  document.getElementById('hl-customLogo').value      = highlight?.customLogo      || '';
  document.getElementById('hl-visibleFrom').value     = _toDatetimeLocal(highlight?.visibleFrom);
  document.getElementById('hl-visibleUntil').value    = _toDatetimeLocal(highlight?.visibleUntil);
  const targetType = highlight?.targetType || (editor.scope === 'cx' ? 'cxRace' : 'raceDay');
  const targetRadio = document.querySelector(`input[name="hl-targetType"][value="${targetType}"]`);
  if (targetRadio) targetRadio.checked = true;
  _clearHighlightRaceSelection();
  // Enganchar la subida R2 del logo custom (el DOM es nuevo en cada apertura).
  attachInlineUpload(document.getElementById('hl-customLogo'), 'logo');
  _refreshHighlightTargetWarning(); // ajustar visibilidad de secciones según el tipo
  _setHighlightBusy(editor, true);
  try {
    await _loadHighlightCxRaces(editor, highlight?.cxRaceId || '');
    if (!editor.drawer.isCurrent()) return;
    await _loadHighlightCxTournaments(editor, highlight?.cxTournamentId || '');
    if (!editor.drawer.isCurrent()) return;

    if (highlight) {
      // Resolver raceId: si vino directo (startlist) usar; si vino raceDayId, traer race_days y de ahí raceId
      let resolvedRaceId = highlight.raceId;
      if (!resolvedRaceId && highlight.raceDayId) {
        const { data: rd, error } = await supabase.from('race_days').select('raceId').eq('id', highlight.raceDayId).single();
        if (!editor.drawer.isCurrent()) return;
        if (error) throw error;
        resolvedRaceId = rd?.raceId;
      }
      const race = resolvedRaceId ? panelState.allRaces.find(r => r.id === resolvedRaceId) : null;
      if (race) {
        await _selectHighlightRace(race);
        if (!editor.drawer.isCurrent()) return;
        if (highlight.raceDayId) {
          document.getElementById('hl-raceDayId').value = highlight.raceDayId;
        }
      }
      _refreshHighlightTargetWarning();
    }
  } catch (error) {
    if (editor.drawer.isCurrent()) document.getElementById('highlightSaveStatus').textContent = error.message;
  } finally {
    editor.loading = false;
    _setHighlightBusy(editor, false);
  }
}

function closeHighlightEditor() {
  _highlightEditor?.drawer.close();
}

async function saveHighlight() {
  const editor = _highlightEditor;
  if (!editor?.drawer.isCurrent() || editor.busy || editor.loading) return;
  const status = document.getElementById('highlightSaveStatus');
  const targetType = document.querySelector('input[name="hl-targetType"]:checked')?.value || 'raceDay';
  const isCustom = targetType === 'custom';
  const isChampionships = targetType === 'championships';
  const isTransfers = targetType === 'transfers';
  const isCx = targetType === 'cxRace';
  const isCxTournament = targetType === 'cxTournament';
  if ((isCx && editor.cxLoading) || (isCxTournament && editor.cxTournamentLoading)) return;
  status.style.color = 'var(--text-dim)';
  status.textContent = 'Guardando…';
  const cxRaceId = isCx ? document.getElementById('hl-cx-race-id').value || null : null;
  const cxTournamentId = isCxTournament ? document.getElementById('hl-cx-tournament-id').value || null : null;
  const noRace = isCustom || isChampionships || isTransfers || isCx || isCxTournament;
  if (isCx && !cxRaceId) {
    status.style.color = 'var(--red)';
    status.textContent = 'Selecciona una carrera de ciclocross.';
    return;
  }
  if (isCxTournament && !cxTournamentId) {
    status.style.color = 'var(--red)';
    status.textContent = 'Selecciona un torneo de ciclocross.';
    return;
  }

  // Carrera obligatoria salvo para entradas custom, Campeonatos o Fichajes (sin carrera).
  if (!noRace && !_hlSelectedRace) {
    status.style.color = 'var(--red)';
    status.textContent = 'Selecciona una carrera.';
    return;
  }

  // Campos custom (solo web).
  const customUrl    = document.getElementById('hl-customUrl').value.trim()    || null;
  const customUrlEn  = document.getElementById('hl-customUrlEn').value.trim()  || null;
  const customLogo   = document.getElementById('hl-customLogo').value.trim()   || null;
  const customTitle  = document.getElementById('hl-customTitle').value.trim()  || null;

  if (isCustom) {
    if (!customUrl) {
      status.style.color = 'var(--red)';
      status.textContent = 'La URL de destino (ES) es obligatoria para una entrada personalizada.';
      return;
    }
    if (!customTitle) {
      status.style.color = 'var(--red)';
      status.textContent = 'El título (ES) es obligatorio para una entrada personalizada.';
      return;
    }
  }

  // Validar payload según targetType:
  //   - custom → customUrl (sin carrera)
  //   - startlist / race → solo `raceId`
  //   - raceDay / startOrder → `raceDayId` (con su `raceId` derivado a nivel DB)
  let raceId = null;
  let raceDayId = null;
  if (!noRace) {
    const raceDayIdSel = document.getElementById('hl-raceDayId').value || null;
    const rds = _highlightRaceDaysCache[_hlSelectedRace.id] || [];
    if (targetType === 'startlist' || targetType === 'race') {
      raceId = _hlSelectedRace.id;
    } else {
      raceDayId = raceDayIdSel || (rds.length === 1 ? rds[0].id : null);
      if (!raceDayId) {
        status.style.color = 'var(--red)';
        status.textContent = 'Selecciona una jornada.';
        return;
      }
    }
  }

  const payload = {
    scope: editor.scope,
    targetType,
    cxRaceId,
    cxTournamentId,
    raceId,
    raceDayId,
    customTitle,
    customTitleEn:   document.getElementById('hl-customTitleEn').value.trim()  || null,
    customDetail:    document.getElementById('hl-customDetail').value.trim()   || null,
    customDetailEn:  document.getElementById('hl-customDetailEn').value.trim() || null,
    customUrl:       isCustom ? customUrl   : null,
    customUrlEn:     isCustom ? customUrlEn : null,
    customLogo:      isCustom ? customLogo  : null,
    visibleFrom:     _fromDatetimeLocal(document.getElementById('hl-visibleFrom').value),
    visibleUntil:    _fromDatetimeLocal(document.getElementById('hl-visibleUntil').value),
  };

  _setHighlightBusy(editor, true);
  try {
    if (!editor.isNew) {
      const { error } = await supabase.from('today_highlights').update(payload).eq('id', editor.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('today_highlights').upsert({ ...payload, id: editor.id, position: editor.position }, { onConflict: 'id' });
      if (error) throw error;
    }
    if (editor.drawer.isCurrent()) {
      showToast(editor.isNew ? 'Destacado creado' : 'Destacado actualizado', 'success', 2500);
      editor.drawer.close();
    }
    await fetchHighlights({ force: true });
    await _prefetchHighlightsRaceDays();
    renderHighlightsList();
  } catch (err) {
    if (!editor.drawer.isCurrent()) return;
    status.style.color = 'var(--red)';
    status.textContent = 'Error: ' + err.message;
  } finally {
    _setHighlightBusy(editor, false);
  }
}

async function deleteHighlight() {
  const editor = _highlightEditor;
  if (!editor?.drawer.isCurrent() || editor.isNew || editor.busy || editor.loading) return;
  if (!await confirmDialog('¿Eliminar este destacado del cintillo?', { danger: true })) return;
  if (!editor.drawer.isCurrent() || editor.busy) return;
  _setHighlightBusy(editor, true);
  try {
    const { error } = await supabase.from('today_highlights').delete().eq('id', editor.id);
    if (error) throw error;
    if (editor.drawer.isCurrent()) {
      showToast('Destacado eliminado', 'success', 2500);
      editor.drawer.close();
    }
    await fetchHighlights({ force: true });
    renderHighlightsList();
  } catch (error) {
    if (editor.drawer.isCurrent()) showToast('Error al eliminar: ' + error.message);
  } finally {
    _setHighlightBusy(editor, false);
  }
}

function _resolveHighlightDisplay(h) {
  // Devuelve { race, raceDay } para una fila del listado de destacados.
  // Para entradas con `raceDayId`, usa el bulk cache `_highlightRaceDaysByIdCache`
  // (poblado por _prefetchHighlightsRaceDays al cargar el tab).
  const raceDay = h.raceDayId ? _highlightRaceDaysByIdCache[h.raceDayId] || null : null;
  let race = null;
  if (h.raceId) {
    race = panelState.allRaces.find(r => r.id === h.raceId) || null;
  } else if (raceDay?.raceId) {
    race = panelState.allRaces.find(r => r.id === raceDay.raceId) || null;
  }
  return { race, raceDay };
}

function _stageLabelShort(rd) {
  if (!rd) return '';
  if (rd.stageNumber === 0) return 'Prólogo';
  if (rd.stageNumber != null) return `Etapa ${rd.stageNumber}`;
  return '';
}

function renderHighlightsList() {
  const container = document.getElementById('highlightsList');
  const list = _highlightsCache || [];
  if (list.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;padding:1rem;text-align:center">
      No hay destacados todavía. Pulsa <strong>+ Añadir destacado</strong> para empezar.
    </div>`;
    return;
  }

  const TARGET_LABELS = {
    raceDay:       'Jornada',
    race:          'Competición',
    startlist:     'Dorsales',
    startOrder:    'Orden de salida',
    custom:        'Personalizado',
    championships: 'Campeonatos',
    transfers:     'Fichajes',
    cxRace:        'Prueba CX',
    cxTournament:  'Torneo CX',
  };

  container.innerHTML = list.map((h, idx) => {
    const { race, raceDay } = _resolveHighlightDisplay(h);
    let lhs;
    if (h.targetType === 'custom') {
      // Custom: identificar por su título (o la URL si no hay título).
      lhs = h.customTitle || h.customUrl || '(personalizado)';
    } else if (h.targetType === 'championships') {
      lhs = h.customTitle || 'Campeonatos Nacionales';
    } else if (h.targetType === 'transfers') {
      lhs = h.customTitle || 'Mercado de Fichajes';
    } else if (h.targetType === 'cxRace') {
      lhs = cxCommonRaceName(h.cxRaceId) || h.customTitle || '(carrera CX desconocida)';
    } else if (h.targetType === 'cxTournament') {
      lhs = cxCommonTournamentName(h.cxTournamentId) || h.customTitle || '(torneo CX desconocido)';
    } else {
      // Fila identifica el destacado por la carrera real, no por el customTitle
      // (que es lo que se ve en el cintillo en sí, no en el panel).
      const raceName = race?.name || '(carrera desconocida)';
      const stageBit = raceDay ? _stageLabelShort(raceDay) : '';
      // Para destinos con jornada concreta (raceDay / startOrder), añadir "Etapa N"
      // al nombre de la carrera. Competición e Inscritos van solos.
      const showStage = stageBit && (h.targetType === 'raceDay' || h.targetType === 'startOrder');
      lhs = showStage ? `${raceName} · ${stageBit}` : raceName;
    }
    const targetLabel = TARGET_LABELS[h.targetType] || h.targetType;
    const dateRange = [h.visibleFrom, h.visibleUntil].map(_fmtVisibilityInstant).filter(Boolean).join(' → ');
    const detailBits = [];
    if (h.customDetail) detailBits.push(esc(h.customDetail));
    if (dateRange)      detailBits.push('Visible: ' + esc(dateRange));
    const subtitle = detailBits.join(' · ');
    return `
      <div class="hl-row" data-id="${esc(h.id)}" data-idx="${idx}" style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.7rem;background:var(--bg-card);border:1px solid var(--border);border-radius:8px">
        <span class="hl-handle" style="color:var(--text-dim);font-size:1.2rem;cursor:grab;touch-action:none;user-select:none;padding:0.35rem 0.2rem;margin:-0.35rem -0.1rem;line-height:1" title="Arrastrar para reordenar">⋮⋮</span>
        <div class="u-grow u-min0">
          <div style="font-size:0.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <span style="font-weight:600">${esc(lhs)}</span>
            <span style="color:var(--text-dim);margin:0 0.3rem">→</span>
            <span style="font-weight:500">${esc(targetLabel)}</span>
          </div>
          ${subtitle ? `<div style="font-size:0.74rem;color:var(--text-dim);margin-top:0.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subtitle}</div>` : ''}
        </div>
        <button class="btn btn--ghost hl-edit-btn" data-id="${esc(h.id)}" style="padding:0.25rem 0.55rem;font-size:0.72rem">Editar</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.hl-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const h = (_highlightsCache || []).find(x => x.id === btn.dataset.id);
      if (h) openHighlightEditor(h);
    });
  });

  // Reordenado por arrastre del tirador ⋮⋮ con Pointer Events (funciona con
  // ratón Y con el dedo en móvil; la HTML5 Drag&Drop API no dispara en táctil).
  _wireHighlightReorder(container);
}

// Arrastre para reordenar el cintillo, vía Pointer Events. El arrastre se
// inicia SOLO desde el tirador `.hl-handle` (con `touch-action:none`), de modo
// que el resto de la fila sigue permitiendo el scroll vertical de la lista con
// el dedo. Durante el arrastre se reordena el DOM en vivo según el punto medio
// de cada fila; al soltar se renumera y se persiste.
function _wireHighlightReorder(container) {
  let dragRow = null;
  let pointerId = null;

  const rowsExceptDragged = () =>
    [...container.querySelectorAll('.hl-row')].filter(r => r !== dragRow);

  const onMove = (e) => {
    if (!dragRow || e.pointerId !== pointerId) return;
    e.preventDefault();
    const y = e.clientY;
    // Primera fila (no la arrastrada) cuyo punto medio queda por debajo del
    // cursor → insertamos la arrastrada antes de ella; si ninguna, al final.
    let before = null;
    for (const r of rowsExceptDragged()) {
      const rect = r.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { before = r; break; }
    }
    if (before) {
      if (before.previousElementSibling !== dragRow) container.insertBefore(dragRow, before);
    } else if (container.lastElementChild !== dragRow) {
      container.appendChild(dragRow);
    }
  };

  const onUp = async (e) => {
    if (!dragRow || e.pointerId !== pointerId) return;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    dragRow.style.opacity = '';
    dragRow.style.boxShadow = '';
    document.body.style.userSelect = '';
    dragRow = null;
    pointerId = null;

    // Nuevo orden según el DOM resultante.
    const orderedIds = [...container.querySelectorAll('.hl-row')].map(r => r.dataset.id);
    const byId = new Map((_highlightsCache || []).map(h => [h.id, h]));
    const items = orderedIds.map(id => byId.get(id)).filter(Boolean);
    const changed = items.some((it, i) => it.position !== i);
    items.forEach((it, i) => { it.position = i; });
    _highlightsCache = items;
    if (!changed) return;
    // Persistir y re-renderizar para refrescar índices/listeners.
    const updates = items.map(it => supabase.from('today_highlights').update({ position: it.position }).eq('id', it.id));
    await Promise.all(updates);
    renderHighlightsList();
    showToast('Orden actualizado', 'success', 1800);
  };

  container.querySelectorAll('.hl-handle').forEach(handle => {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;  // solo botón principal
      const row = handle.closest('.hl-row');
      if (!row) return;
      e.preventDefault();
      dragRow = row;
      pointerId = e.pointerId;
      try { handle.setPointerCapture(pointerId); } catch (_) { /* noop */ }
      row.style.opacity = '0.6';
      row.style.boxShadow = '0 4px 16px rgba(0,0,0,0.35)';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  });
}

// ═════════════════════════════════════════════════════════════════
//  VISTA DE VERSIONES (PRs mergeados desde GitHub)
// ═════════════════════════════════════════════════════════════════
