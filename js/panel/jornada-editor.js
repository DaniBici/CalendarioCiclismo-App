// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Editor de jornada: apertura, assets y formulario
// ─────────────────────────────────────────────────────────────────

import { panelEditorTopbarHtml, panelEditorTabsHtml } from './editor-ui.js?v=20260912cxcohesion';
import { attachCountryAutocomplete } from '../country-select.js?v=20260917cxflags';
import { mountDayTimingEditor } from './race-presentation.js';
import { supabase, countryFlag, stageLabel, esc } from '../shared.js';
import { exportElevationProfilePNG } from '../stage/elevation-profile.js';
import { buildProfileAssetDownloadRequest, mountProfileDigitizer } from '../stage/profile-digitizer.js';
import { openDrawer } from '../components/drawer.js?v=20260912cxsavecontext';
import { confirmDialog, alertDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { formatDateTime, formatTimeHHMM, showToast, toSlug, validateSlug } from './helpers.js';
import { attachInlineUpload, getAuthHeaders, R2_PUBLIC_BASE, R2_UPLOAD_FN } from './uploads.js';
import { switchTab } from './navigation.js';
import { setupStartOrderSection } from './start-order.js';
import {
  _autoDetectSummitClimb, _gpxHandleUpload, _interpolateElevation, _mapHandleUpload,
  _refreshSummitStats, _wireMapDelete,
} from './jornada-profile.js';
import {
  addBroadcastRow, broadcastHTML, initMdToolbar, mdToolbarHtml, summitRowHTML,
  waypointRowHTML,
} from './jornada-fields.js';
import { deleteRaceDay, duplicateRaceDay, saveRaceDay } from './jornada-save.js';
import { openRaceModal } from './race-picker.js';
import { setupUciResultsSection } from './results.js';

// ── Editor de jornada ─────────────────────────────────────────────
// El editor vive en el drawer. `#editorArea` es el contenedor que el drawer
// monta en su body; `renderEditor()` (y saveRaceDay/deleteRaceDay/…) lo
// localizan por id como siempre, así que su lógica interna no cambia.
function _ensureEditorArea() {
  // Si el drawer ya tiene el editor montado, reusarlo (re-render in situ).
  let area = document.getElementById('editorArea');
  if (area && area.closest('#ccDrawer1Body')) return area;

  openDrawer({
    title: 'Jornada',
    level: 1,
    wide: true,
    render: (body) => {
      body.innerHTML = '<section class="editor-area" id="editorArea"></section>';
    },
    onClose: () => { panelState.currentRaceDayId = null; },
  });
  return document.getElementById('editorArea');
}

export async function openEditor(raceDayId, cachedData = null) {
  // Al cambiar de jornada, invalidar caché anterior
  if (raceDayId !== panelState.currentRaceDayId) panelState._editorCache = null;
  panelState.currentRaceDayId = raceDayId;

  // Marcar activo en sidebar
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));

  const area = _ensureEditorArea();

  // Usar datos en memoria si vienen de un guardado reciente (0 lecturas Firestore)
  const source = cachedData || panelState._editorCache;
  if (source && source.rdId === raceDayId) {
    const race = panelState.allRaces.find(r => r.id === source.rd.raceId) || {};
    renderEditor(source.rd, race, source.broadcasts, source.assets);
    return;
  }

  area.innerHTML = '<div class="loading" style="margin:3rem auto">Cargando jornada</div>';

  try {
    const { data: rdData, error: rdError } = await supabase.from('race_days').select('*').eq('id', raceDayId).single();
    if (rdError || !rdData) throw new Error('No existe');
    const rd = rdData;

    const [bcastRes, assetsRes] = await Promise.all([
      supabase.from('broadcasts').select('*').eq('raceDayId', raceDayId).order('sortOrder', { ascending: true }),
      supabase.from('assets').select('*').eq('raceDayId', raceDayId),
    ]);
    const broadcasts = bcastRes.data || [];
    const assets     = assetsRes.data || [];

    // Guardar en caché para posibles guardados sucesivos
    panelState._editorCache = { rdId: raceDayId, rd, broadcasts, assets };

    const race = panelState.allRaces.find(r => r.id === rd.raceId) || {};
    renderEditor(rd, race, broadcasts, assets);

  } catch (err) {
    console.error(err);
    area.innerHTML = `<div class="editor-placeholder">
      <div class="editor-placeholder__icon">⚠️</div>
      <div class="editor-placeholder__title">Error al cargar la jornada</div>
    </div>`;
  }
}

// Tipos de documento soportados en la sección Documentación.
// El icono se inyecta como SVG inline para no depender de assets externos.
const ASSET_TYPE_LABELS = {
  technicalGuide: 'Libro de Ruta',
  roadbook: 'Rutómetro',
  profile: 'Perfil',
  ports: 'Puertos',
  map: 'Mapa',
  startOrder: 'Orden Salida',
  live_text: 'Live texto',
};
const ASSET_TYPE_ICONS = {
  technicalGuide: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M4 3h11l5 5v13H4z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/></svg>',
  roadbook: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  profile: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
  ports: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M8 3 4 7l4 4"/><path d="m16 3 4 4-4 4"/><line x1="4" y1="7" x2="20" y2="7"/><path d="M8 17 4 21l4 4"/><path d="m16 17 4 4-4 4"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
  map: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.645v12.21a1 1 0 0 1-.553.894l-4 2a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.355V7.145a1 1 0 0 1 .553-.894l4-2a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/></svg>',
  startOrder: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M12 5V3"/><path d="M10 2h4"/></svg>',
  live_text: '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m14 14-4-4-4 4 4 4"/><path d="M5 7H3v14h14v-2"/></svg>',
};
const ASSET_DOC_TYPES_ALL = ['technicalGuide', 'roadbook', 'profile', 'ports', 'map', 'startOrder', 'live_text'];

export function buildAssetRowHtml(type, asset = null) {
  const isLive = type === 'live_text';
  return `<div class="asset-row" data-asset-type="${type}">
    <span class="asset-row__type">${ASSET_TYPE_ICONS[type]} ${ASSET_TYPE_LABELS[type]}</span>
    <input type="url" class="asset-url-input${isLive ? ' asset-url-input--live' : ''}" data-type="${type}"
           ${asset?.id ? `data-assetid="${asset.id}"` : ''}
           value="${asset?.url || ''}" placeholder="https://…">
    <button type="button" class="asset-row__remove" title="Quitar" aria-label="Quitar">✕</button>
  </div>`;
}

export function refreshAssetTypeSelector() {
  const sel = document.getElementById('assetTypeSelector');
  if (!sel) return;
  const used = new Set(
    [...document.querySelectorAll('#assetsList .asset-row')].map(r => r.dataset.assetType)
  );
  const remaining = ASSET_DOC_TYPES_ALL.filter(t => !used.has(t));
  sel.innerHTML = '<option value="">+ Añadir documento…</option>'
    + remaining.map(t => `<option value="${t}">${ASSET_TYPE_LABELS[t]}</option>`).join('');
  sel.disabled = remaining.length === 0;
}

function setupAssetsSection() {
  const sel = document.getElementById('assetTypeSelector');
  const list = document.getElementById('assetsList');
  if (!sel || !list) return;
  refreshAssetTypeSelector();

  sel.addEventListener('change', () => {
    const type = sel.value;
    if (!type) return;
    // Si la lista está en estado vacío, limpiarla
    const empty = list.querySelector('.assets-empty');
    if (empty) empty.remove();
    list.insertAdjacentHTML('beforeend', buildAssetRowHtml(type));
    const newRow = list.lastElementChild;
    const input = newRow.querySelector('.asset-url-input');
    // Reconectar el upload inline para tipos != live_text
    if (type !== 'live_text' && input) attachInlineUpload(input, type);
    refreshAssetTypeSelector();
    sel.value = '';
    if (input) input.focus();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.asset-row__remove');
    if (!btn) return;
    const row = btn.closest('.asset-row');
    if (!row) return;
    // Marcar el tipo como borrado A PROPÓSITO. saveRaceDay reconstruye los
    // assets desde el DOM y preserva el `startOrder` ausente (lo crea el
    // importador, no el editor); sin esta marca, quitar la fila a mano y
    // "que el editor nunca la renderizara" serían indistinguibles y el
    // guardado resucitaría el asset que se acaba de borrar.
    list.dataset.removedTypes = [
      ...new Set([...(list.dataset.removedTypes || '').split(',').filter(Boolean), row.dataset.assetType]),
    ].join(',');
    row.remove();
    if (!list.querySelector('.asset-row')) {
      list.innerHTML = '<div class="assets-empty">Aún no hay documentos. Usa el selector de arriba para añadir.</div>';
    }
    refreshAssetTypeSelector();
  });
}

export function attachDeleteHandler(btn, rd) {
  btn.addEventListener('click', async () => {
    if (!await confirmDialog('¿Eliminar el orden de salida de esta jornada?', { danger: true })) return;
    btn.disabled = true;
    try {
      await supabase.from('start_order_entries').delete().eq('raceDayId', rd.id);
      await supabase.from('race_days').update({ startOrderImportedAt: null, startOrderTtDorsals: null, startOrderGcDorsals: null }).eq('id', rd.id);
      // Borrar asset startOrder
      const { data: oldAssets } = await supabase
        .from('assets').select('id').eq('raceDayId', rd.id).eq('type', 'startOrder');
      if (oldAssets?.length) {
        await supabase.from('assets').delete().in('id', oldAssets.map(a => a.id));
      }
      // Limpiar input en panel
      const soInput = document.querySelector('.asset-url-input[data-type="startOrder"]');
      if (soInput) soInput.closest('.asset-row')?.remove();
      refreshAssetTypeSelector?.();

      const statusEl = document.getElementById('soStatus');
      if (statusEl) { statusEl.className = 'so-editor-status'; statusEl.textContent = 'Sin datos importados.'; }
      btn.remove();
      document.getElementById('soResyncBtn')?.remove();
      const preview = document.getElementById('soPreview');
      if (preview) preview.innerHTML = '';
      const msg = document.getElementById('soMsg');
      if (msg) msg.textContent = '';
      const ttEl = document.getElementById('soTtDorsals');
      const gcEl = document.getElementById('soGcDorsals');
      if (ttEl) ttEl.value = '';
      if (gcEl) gcEl.value = '';
    } catch (err) {
      alertDialog(`Error al eliminar: ${err.message}`, { title: 'Error' });
      btn.disabled = false;
    }
  });
}

function renderEditor(rd, race, broadcasts, assets) {
  const area   = document.getElementById('editorArea');
  panelState._profileDigitizerCleanup?.();
  panelState._profileDigitizerCleanup = null;
  const isDraft = rd.editorialStatus !== 'published';
  const flag    = countryFlag(race.countryCode);

  const startTime  = rd.neutralStartTimeUtc   ? formatTimeHHMM(rd.neutralStartTimeUtc)   : '';
  const realStartTime = rd.realStartTimeUtc ? formatTimeHHMM(rd.realStartTimeUtc) : '';
  const finishTime = rd.estimatedFinishTimeUtc ? formatTimeHHMM(rd.estimatedFinishTimeUtc) : '';

  const editorStage = stageLabel(rd.stageNumber, rd._stageSuffix);
  const publicUrl = rd.slug
    ? `${CONFIG.basePath}/jornada/${rd.slug}/`
    : `${CONFIG.basePath}/jornada.html?id=${rd.id}`;

  area.innerHTML = `
    ${panelEditorTopbarHtml({name:race.name||'Jornada',flagHtml:flag,detail:editorStage,date:rd.dateKey,published:!isDraft,updated:rd.updatedAt?formatDateTime(rd.updatedAt):'',actionsHtml:`
        <a class="btn btn--ghost" href="${publicUrl}" target="_blank" rel="noopener">Ver ↗</a>
        <button class="btn btn--ghost" id="ed-startlist" data-race-id="${rd.raceId}">Dorsales</button>
        <button class="btn btn--danger" id="ed-delete">Borrar</button>
        <button class="btn btn--ghost" id="ed-duplicate">Duplicar</button>
        <button class="btn btn--ghost" id="ed-draft">Borrador</button>
        <button class="btn btn--primary" id="ed-publish">${isDraft?'Publicar':'Actualizar'}</button>`})}
    <div class="editor-content">
      ${panelEditorTabsHtml([['general','General'],['tv','TV'],['perfil','GPX'],['mas','Docs'],['resultados','Resultados']].map(([key,label])=>({key,label})),{id:'editorTabs'})}

      <!-- Identidad -->
      <div class="editor-section" data-tab="general">
        <div class="editor-section__header">
          <span class="editor-section__title">Identidad</span>
        </div>
        <div class="editor-section__body">
          <div class="field-row field-row--2">
            <div class="field">
              <label>Fecha</label>
              <input type="date" id="ed-date" value="${rd.dateKey || ''}">
            </div>
            <div class="field">
              <label>Nº etapa (opcional)</label>
              <input type="number" id="ed-stage" value="${rd.stageNumber != null ? rd.stageNumber : ''}" placeholder="—" min="0" ${rd.isRestDay ? 'disabled' : ''}>
            </div>
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer">
              <input type="checkbox" id="ed-isRestDay" ${rd.isRestDay ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
              <span>Jornada de descanso</span>
              <span class="u-field-hint">— no se mostrará como etapa ni será clicable</span>
            </label>
          </div>
          <div class="field">
            <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer">
              <input type="checkbox" id="ed-isCancelledDay" ${rd.isCancelledDay ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:#e55">
              <span style="color:#e55;font-weight:600">Jornada cancelada</span>
              <span class="u-field-hint">— se mostrará con indicador visual en la jornada y en las cards</span>
            </label>
          </div>
          <div class="field">
            <label>Carrera</label>
            <div style="display:flex;align-items:center;gap:0.75rem">
              <span style="font-family:var(--font-display);font-weight:700;
                           font-size:0.95rem;text-transform:uppercase;flex:1">
                ${flag} ${race.name || '—'}
              </span>
              <button class="btn btn--ghost" id="ed-changeRace" style="font-size:0.75rem;padding:0.35rem 0.7rem">
                Cambiar
              </button>
            </div>
          </div>
          <div class="lang-pair" data-lang="es">
            <div class="lang-pair__header">
              <label style="display:flex;align-items:center;gap:0.5rem;margin:0">
                <span class="lang-field--es">Slug</span>
                <span class="lang-field--en">Slug (EN)</span>
                <span class="u-field-hint">— URL amigable (opcional, solo a-z, 0-9 y guiones)</span>
              </label>
              <button type="button" class="lang-toggle" data-lang-target="es">EN</button>
            </div>
            <div class="field lang-field--es">
              <div class="u-row">
                <input type="text" id="ed-slug" value="${esc(rd.slug || '')}" placeholder="tour-de-france-2025-etapa-3" maxlength="80"
                       style="flex:1;font-family:var(--font-display);font-size:0.85rem;letter-spacing:0.01em"
                       autocomplete="off" spellcheck="false" ${!rd.slug ? 'data-auto="1"' : ''}>
                <button type="button" id="ed-slug-suggest" class="btn btn--ghost u-fs-xs u-btn-sm"
                       >Auto</button>
              </div>
              <div id="ed-slug-error" style="color:#e55;font-size:0.75rem;margin-top:0.25rem;display:none"></div>
            </div>
            <div class="field lang-field--en">
              <div class="u-row">
                <input type="text" id="ed-slug-en" value="${esc(rd.slugEn || '')}" placeholder="tour-de-france-2025-stage-3" maxlength="80"
                       style="flex:1;font-family:var(--font-display);font-size:0.85rem;letter-spacing:0.01em"
                       autocomplete="off" spellcheck="false" ${!rd.slugEn ? 'data-auto="1"' : ''}>
                <button type="button" id="ed-slug-en-suggest" class="btn btn--ghost u-fs-xs u-btn-sm"
                       >Auto</button>
              </div>
              <div id="ed-slug-en-error" style="color:#e55;font-size:0.75rem;margin-top:0.25rem;display:none"></div>
            </div>
          </div>
          <div class="field">
            <label class="u-row">
              País (solo bandera, opcional)
              <span class="u-field-hint">— sobrescribe la bandera de la carrera; déjalo vacío para usar la del país de la carrera (${esc((race.countryCode || '').toUpperCase()) || '—'})</span>
            </label>
            <input type="text" id="ed-country" value="${esc(rd.countryCode || '')}" placeholder="ES, FR, IT…" maxlength="6" autocomplete="off" spellcheck="false">
          </div>
        </div>
      </div>

      <!-- Recorrido -->
      <div class="editor-section" data-tab="general">
        <div class="editor-section__header u-between u-gap-sm">
          <span class="editor-section__title">Recorrido</span>
        </div>
        <div class="editor-section__body">
          <div class="lang-pair" data-lang="es">
            <div class="lang-pair__header">
              <span class="lang-pair__label">
                <span class="lang-field--es">Salida y Llegada</span>
                <span class="lang-field--en">Start &amp; Finish (EN)</span>
              </span>
              <button type="button" class="lang-toggle" data-lang-target="es">EN</button>
            </div>
            <div class="field-row field-row--2 lang-field--es">
              <div class="field">
                <label>Salida</label>
                <input type="text" id="ed-start" value="${esc(rd.startLocation || '')}" placeholder="Ciudad salida">
              </div>
              <div class="field">
                <label>Llegada</label>
                <input type="text" id="ed-finish" value="${esc(rd.finishLocation || '')}" placeholder="Ciudad llegada">
              </div>
            </div>
            <div class="field-row field-row--2 lang-field--en">
              <div class="field">
                <label>Start (EN)</label>
                <input type="text" id="ed-start-en" value="${esc(rd.startLocationEn || '')}" placeholder="Start city (English)" ${!rd.startLocationEn ? 'data-auto="1"' : ''}>
              </div>
              <div class="field">
                <label>Finish (EN)</label>
                <input type="text" id="ed-finish-en" value="${esc(rd.finishLocationEn || '')}" placeholder="Finish city (English)" ${!rd.finishLocationEn ? 'data-auto="1"' : ''}>
              </div>
            </div>
          </div>
          <div class="field-row field-row--4">
            <div class="field">
              <label>Distancia (km)</label>
              <input type="number" id="ed-km" value="${rd.distanceKm || ''}" placeholder="0">
            </div>
            <div class="field">
              <label>Desnivel (m)</label>
              <input type="number" id="ed-elev" value="${rd.elevationProfile?.elevationGain ?? ''}" placeholder="0" min="0" step="10" title="Desnivel positivo. Si la jornada tiene GPX, sobrescribe el calculado; si no, se guarda solo el número (sin silueta).">
            </div>
            <div class="field">
              <label>Tipo principal</label>
              <select id="ed-type">
                <option value="">—</option>
                <option value="flat"             ${rd.primaryType==='flat'?'selected':''}>Llana</option>
                <option value="rolling"          ${rd.primaryType==='rolling'?'selected':''}>Sinuosa</option>
                <option value="cotas"            ${rd.primaryType==='cotas'?'selected':''}>Cotas</option>
                <option value="medium_mountain"  ${rd.primaryType==='medium_mountain'?'selected':''}>Media montaña</option>
                <option value="high_mountain"    ${rd.primaryType==='high_mountain'?'selected':''}>Alta montaña</option>
                <option value="cobbles"          ${rd.primaryType==='cobbles'?'selected':''}>Adoquines</option>
                <option value="sterrato"         ${rd.primaryType==='sterrato'?'selected':''}>Sterrato</option>
                <option value="itt"              ${rd.primaryType==='itt'?'selected':''}>CRI</option>
                <option value="ttt"              ${rd.primaryType==='ttt'?'selected':''}>CRE</option>
              </select>
            </div>
            <div class="field">
              <label>Tipo secundario</label>
              <select id="ed-type2">
                <option value=""                 ${!rd.secondaryType?'selected':''}>—</option>
                <option value="summit_finish"    ${rd.secondaryType==='summit_finish'?'selected':''}>Final en alto</option>
                <option value="uphill_finish"    ${rd.secondaryType==='uphill_finish'?'selected':''}>Final en repecho</option>
                <option value="chrono_climb"     ${rd.secondaryType==='chrono_climb'?'selected':''}>Cronoescalada</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Horarios -->
      <div class="editor-section" data-tab="general">
        <div class="editor-section__header">
          <span class="editor-section__title">Horarios (hora española)</span>
        </div>
        <div class="editor-section__body">
          <div class="field-row field-row--3">
            <div class="field">
              <label>Salida neutralizada</label>
              <input type="time" id="ed-startTime" value="${startTime}">
            </div>
            <div class="field">
              <label>Salida real</label>
              <input type="time" id="ed-realStartTime" value="${realStartTime}">
            </div>
            <div class="field">
              <label>Llegada estimada</label>
              <input type="time" id="ed-finishTime" value="${finishTime}">
            </div>
          </div>
        </div>
      </div>

      <!-- TV -->
      <div class="editor-section" data-tab="tv">
        <div class="editor-section__header">
          <span class="editor-section__title">Televisión</span>
        </div>
        <div class="editor-section__body">
          <div class="field">
            <label>Estado</label>
            <select id="ed-tvStatus">
              <option value=""                 ${!rd.tvStatus?'selected':''}>—</option>
              <option value="confirmed_time"   ${rd.tvStatus==='confirmed_time'?'selected':''}>Confirmado con hora</option>
              <option value="confirmed_notime" ${rd.tvStatus==='confirmed_notime'?'selected':''}>Confirmado sin hora</option>
              <option value="pending"          ${rd.tvStatus==='pending'?'selected':''}>Por confirmar</option>
              <option value="none"             ${rd.tvStatus==='none'?'selected':''}>Sin retransmisión</option>
              <option value="unavailable_es"  ${rd.tvStatus==='unavailable_es'?'selected':''}>No TV España</option>
            </select>
          </div>
          <div id="broadcastsList">
            ${(broadcasts || []).map((b, i) => broadcastHTML(b, i)).join('')}
          </div>
          <button class="btn btn--ghost" id="addBroadcastBtn" style="margin-top:0.25rem">
            + Añadir emisión
          </button>
        </div>
      </div>

      <!-- Editorial -->
      <div class="editor-section" data-tab="general">
        <div class="lang-pair" data-lang="es">
          <div class="editor-section__header u-between u-gap-sm">
            <span class="editor-section__title">
              <span class="lang-field--es">Editorial</span>
              <span class="lang-field--en">Editorial (EN)</span>
            </span>
            <button type="button" class="lang-toggle" data-lang-target="es">EN</button>
          </div>
          <div class="editor-section__body">
            ${(() => {
              const tr = rd.translations?.en || {};
              const statusBadge = (field) => {
                const s = tr[field]?.status;
                const labels = { auto: 'auto', manual: 'manual', stale: 'stale', pending: 'pending' };
                const cls = `en-badge en-badge--${s || 'pending'}`;
                return `<span class="${cls}">${labels[s] || 'pending'}</span>`;
              };
              return `
            <!-- Descripción -->
            <div class="field lang-field--es">
              <label>Descripción</label>
              <div class="md-editor">
                ${mdToolbarHtml('md-toolbar')}
                <div id="ed-description-wysiwyg" class="md-wysiwyg" contenteditable="true" data-placeholder="Describe la jornada…"></div>
                <textarea id="ed-description" style="display:none">${rd.description || ''}</textarea>
              </div>
            </div>
            <div class="field lang-field--en">
              <label class="u-row">Description (EN) ${statusBadge('description')}
                ${tr.description?.status !== 'manual' ? `<button type="button" class="btn btn--ghost" onclick="markTranslationAsManual('description')" style="font-size:0.7rem;padding:0.15rem 0.5rem">✓ Manual</button>` : ''}
              </label>
              <div class="md-editor">
                ${mdToolbarHtml('md-toolbar-en', { bold: 'Bold (Cmd+B)', italic: 'Italic (Cmd+I)', h2: 'Heading H2', h3: 'Heading H3', ul: 'List', blockquote: 'Blockquote', hr: 'Horizontal rule' })}
                <div id="ed-description-en-wysiwyg" class="md-wysiwyg" contenteditable="true" data-placeholder="Stage description in English…"></div>
                <textarea id="ed-description-en" style="display:none">${esc(tr.description?.value || '')}</textarea>
              </div>
            </div>

            <!-- Bonificaciones y Notas -->
            <div class="field-row field-row--2 lang-field--es">
              <div class="field">
                <label>Bonificaciones (opcional)</label>
                <input type="text" id="ed-bonuses" value="${esc(rd.bonuses || '')}" placeholder="—">
              </div>
              <div class="field">
                <label>Notas (opcional)</label>
                <input type="text" id="ed-notes" value="${esc(rd.notes || '')}" placeholder="—">
              </div>
            </div>
            <div class="field-row field-row--2 lang-field--en">
              <div class="field">
                <label class="u-row">Bonuses (EN) ${statusBadge('bonuses')}</label>
                <input type="text" id="ed-bonuses-en" value="${esc(tr.bonuses?.value || '')}" placeholder="—">
              </div>
              <div class="field">
                <label class="u-row">Notes (EN) ${statusBadge('notes')}</label>
                <input type="text" id="ed-notes-en" value="${esc(tr.notes?.value || '')}" placeholder="—">
              </div>
            </div>`;
            })()}
          </div>
        </div>
      </div>

      <!-- Orden de Salida (solo CRI/CRE) -->
      ${(rd.primaryType === 'itt' || rd.primaryType === 'ttt') ? `<div class="editor-section" data-tab="mas" id="soEditorSection">
        <div class="editor-section__header">
          <span class="editor-section__title">Orden de Salida</span>
        </div>
        <div class="editor-section__body">
          ${rd.startOrderImportedAt
            ? `<div class="so-editor-status so-editor-status--ok" id="soStatus">✓ Importado el ${new Date(rd.startOrderImportedAt).toLocaleDateString('es-ES')} — <a href="${rd.slug ? `${CONFIG.basePath}/orden-salida/${encodeURIComponent(rd.slug)}/` : `/orden-salida.html?id=${rd.id}`}" target="_blank" rel="noopener">ver página ↗</a></div>`
            : `<div class="so-editor-status" id="soStatus">Sin datos importados.</div>`
          }
          <p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 0.5rem">
            ${rd.primaryType === 'ttt'
              ? `Pega el orden de salida en formato <code>HH:MM nombre del equipo</code>, un equipo por línea. El sistema cruzará automáticamente con los equipos de la carrera.`
              : `Pega el orden de salida en formato <code>HH:MM:SS dorsal</code>, una entrada por línea. El sistema cruzará automáticamente con los inscritos por dorsal.`}
          </p>
          <textarea id="soRawInput" class="so-editor-textarea" placeholder="${rd.primaryType === 'ttt' ? '14:00:00 UAE Team Emirates&#10;14:05:00 Visma | Lease a Bike&#10;14:10:00 Soudal Quick-Step&#10;…' : '14:00:00 1&#10;14:00:30 2&#10;14:01:00 3&#10;…'}"></textarea>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap;align-items:center">
            <button class="btn btn--ghost" id="soParseBtn" type="button">Procesar</button>
            <button class="btn btn--primary" id="soSaveBtn" type="button" disabled>Guardar</button>
            ${(rd.startOrderImportedAt && rd.primaryType !== 'ttt')
              ? `<button class="btn btn--ghost" id="soResyncBtn" type="button" title="Re-aplica nombres canónicos desde riders_men/women a las entradas ya importadas">Re-sincronizar nombres</button>`
              : ''}
            ${rd.startOrderImportedAt
              ? `<button class="btn btn--ghost" id="soDeleteBtn" type="button" style="color:var(--red,#e55)">Eliminar</button>`
              : ''}
            <span class="u-fs-md u-c-muted" id="soMsg"></span>
          </div>
          <div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.5rem">
            <div>
              <label class="u-sublabel" for="soTimezone">Zona horaria de la jornada (IANA)</label>
              <input type="text" id="soTimezone" class="input u-input-block" value="${esc(rd.timezone || '')}" placeholder="Ej: Europe/Madrid, Asia/Tokyo, America/New_York" autocomplete="off" spellcheck="false">
              <p style="font-size:0.72rem;color:var(--text-muted);margin:0.25rem 0 0">Si se indica, la página pública convierte las horas a la zona del visitante.</p>
            </div>
            ${rd.primaryType === 'ttt' ? '' : `
            <div>
              <label class="u-sublabel" for="soTtDorsals">Dorsales Contrarrelojistas (separados por coma)</label>
              <input type="text" id="soTtDorsals" class="input u-input-block" value="${(rd.startOrderTtDorsals || []).join(', ')}" placeholder="Ej: 1, 12, 45">
            </div>
            <div>
              <label class="u-sublabel" for="soGcDorsals">Dorsales General / GC (separados por coma)</label>
              <input type="text" id="soGcDorsals" class="input u-input-block" value="${(rd.startOrderGcDorsals || []).join(', ')}" placeholder="Ej: 1, 12, 45">
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);margin:0">Los grupos con al menos un dorsal muestran filtros en la página pública.</p>`}
            <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem">
              <button class="btn btn--ghost u-fs-082" id="soGroupSaveBtn" type="button">${rd.primaryType === 'ttt' ? 'Guardar zona horaria' : 'Guardar zona y grupos'}</button>
              <span id="soGroupMsg" style="font-size:0.78rem;color:var(--text-muted)"></span>
            </div>
          </div>
          <div id="soPreview" class="so-editor-preview"></div>
        </div>
      </div>` : ''}

      <!-- Assets -->
      <div class="editor-section" data-tab="mas">
        <div class="editor-section__header u-between u-gap-sm">
          <span class="editor-section__title">Documentación</span>
          <div class="assets-add">
            <select id="assetTypeSelector" class="assets-add__select">
              <option value="">+ Añadir documento…</option>
            </select>
          </div>
        </div>
        <div class="editor-section__body">
          <div id="assetsList" class="assets-list">
            ${(() => {
              // Si hay startOrderImportedAt y no hay asset startOrder, auto-añadirlo
              const existing = (assets || []).filter(a => ASSET_DOC_TYPES_ALL.includes(a.type));
              if (rd.startOrderImportedAt && !existing.find(a => a.type === 'startOrder')) {
                const soUrl = rd.slug
                  ? `${CONFIG.webOrigin}/orden-salida/${encodeURIComponent(rd.slug)}/`
                  : `${CONFIG.webOrigin}/orden-salida.html?id=${rd.id}`;
                existing.unshift({ type: 'startOrder', url: soUrl, sourceType: 'external', id: '' });
              }
              if (existing.length === 0) {
                return '<div class="assets-empty">Aún no hay documentos. Usa el selector de arriba para añadir.</div>';
              }
              return existing.map(a => buildAssetRowHtml(a.type, a)).join('');
            })()}
          </div>
        </div>
      </div>

      <!-- Perfil de elevacion GPX -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg> Perfil de elevación GPX</span>
        </div>
        <div class="editor-section__body">
          <div id="ed-gpx-summary" style="${rd.elevationProfile ? '' : 'display:none'}; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem"${rd.elevationProfile ? ` data-distance="${rd.elevationProfile.distance}"` : ''}>
            ${rd.elevationProfile ? `${rd.elevationProfile.distance} km &middot; +${rd.elevationProfile.elevationGain} m / -${rd.elevationProfile.elevationLoss} m &middot; ${rd.elevationProfile.points?.length ?? '?'} puntos` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem">
            <button class="btn btn--ghost" id="ed-gpx-btn">${rd.elevationProfile ? 'Reemplazar GPX' : 'Subir GPX'}</button>
            <button class="btn btn--ghost" id="ed-gpx-del" style="font-size:0.8rem;color:var(--red);${rd.elevationProfile ? '' : 'display:none'}">Borrar</button>
            <a class="btn btn--ghost u-fs-082" id="ed-gpx-view" href="/panel/perfil.html?id=${rd.id}" target="_blank" rel="noopener" style="${rd.elevationProfile ? '' : 'display:none'}">Ver perfil ↗</a>
            <button class="btn btn--ghost u-fs-082" id="ed-gpx-png" style="${rd.elevationProfile ? '' : 'display:none'}" title="Exportar el miniperfil (solo iconos) a PNG con fondo transparente"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-0.15em;margin-right:0.3em"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Exportar PNG</button>
            <span class="u-fs-md u-c-muted" id="ed-gpx-status"></span>
          </div>
          <label id="ed-profile-not-viewable-label" style="display:${rd.elevationProfile ? 'flex' : 'none'};align-items:center;gap:0.45rem;margin-top:0.5rem;cursor:pointer;font-size:0.82rem;color:var(--text-muted)">
            <input type="checkbox" id="ed-profile-not-viewable" ${rd.profileNotViewable ? 'checked' : ''} style="width:14px;height:14px;cursor:pointer;accent-color:var(--red)">
            No visualizable en público
          </label>
        </div>
      </div>

      <!-- Digitalizador manual de perfiles desde una imagen -->
      <details class="editor-section editor-section--advanced" data-tab="perfil">
        <summary class="editor-section__header editor-advanced__summary">
          <span class="editor-section__title">Digitalizar perfil desde imagen</span>
          <span class="editor-advanced__hint">Clics + dos referencias de altitud</span>
        </summary>
        <div class="editor-section__body">
          <div id="ed-profile-digitizer" class="profile-digitizer"></div>
        </div>
      </details>

      <!-- Mapa interactivo del recorrido (Leaflet, opt-in) -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg> Mapa interactivo del recorrido</span>
        </div>
        <div class="editor-section__body">
          <div id="ed-map-summary" style="${rd.routeGpxUrl ? '' : 'display:none'};font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem">
            ${rd.routeGpxUrl ? 'Mapa activo · GPX en Storage' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
            <button class="btn btn--ghost" id="ed-map-btn">${rd.routeGpxUrl ? 'Reemplazar GPX del mapa' : 'Subir GPX del mapa'}</button>
            ${rd.routeGpxUrl ? `<button class="btn btn--ghost" id="ed-map-del" style="font-size:0.8rem;color:var(--red)">Quitar mapa</button>` : ''}
            ${rd.routeGpxUrl ? `<a class="btn btn--ghost u-fs-082" href="/mapa.html?id=${rd.id}" target="_blank" rel="noopener">Ver mapa ↗</a>` : ''}
            <span class="u-fs-md u-c-muted" id="ed-map-status"></span>
          </div>
        </div>
      </div>

      <!-- Puertos del perfil -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="m2 20 4-9 4 5 4-7 4 11H2z"/></svg> Puertos del perfil</span>
        </div>
        <div class="editor-section__body">
          <div class="ann-row ann-row--header" aria-hidden="true">
            <span class="ann-km">km cima</span>
            <span class="ann-alt">alt (m)</span>
            <span class="ann-name--wide">Nombre</span>
            <span class="ann-cat">Cat.</span>
            <span class="ann-side">Etiq.</span>
            <span class="ann-start">km inicio</span>
            <span class="ann-foot-time">hora pie</span>
            <span class="ann-time">hora cima</span>
            <span class="ann-detect-placeholder"></span>
            <span class="ann-stats">long. · %</span>
            <span class="ann-del-placeholder"></span>
          </div>
          <div id="summitsList">${(rd.profileSummits || []).map(summitRowHTML).join('')}</div>
          <button class="btn btn--ghost" id="addSummitBtn" style="margin-top:0.5rem;font-size:0.82rem">+ Añadir puerto</button>
        </div>
      </div>

      <!-- Localidades del perfil -->
      <div class="editor-section" data-tab="perfil">
        <div class="editor-section__header">
          <span class="editor-section__title"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="u-inline-icon"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> Localidades del perfil</span>
        </div>
        <div class="editor-section__body">
          <div class="ann-row ann-row--header" aria-hidden="true">
            <span class="u-w-time u-fs-xs u-c-muted">km</span>
            <span style="flex:1;font-size:0.72rem;color:var(--text-muted)">Nombre</span>
            <span style="width:12rem;font-size:0.72rem;color:var(--text-muted)">Tipo</span>
            <span style="width:5.5em;font-size:0.72rem;color:var(--text-muted)">hora</span>
            <span style="width:2rem"></span>
          </div>
          <div id="waypointsList">${(rd.profileWaypoints || []).filter(w => w.type !== 'kom').map(waypointRowHTML).join('')}</div>
          <button class="btn btn--ghost" id="addWaypointBtn" style="margin-top:0.5rem;font-size:0.82rem">+ Añadir localidad</button>
        </div>
      </div>

      <!-- Resultados internos (pestaña Resultados) -->
      <div class="editor-section" data-tab="resultados">
        <div class="editor-section__header">
          <span class="editor-section__title">Clasificaciones</span>
        </div>
        <div class="editor-section__body" id="ruSectionBody">
          <div style="color:var(--text-muted);font-size:0.8rem">Cargando clasificaciones…</div>
        </div>
      </div>

      <div id="editorFeedback" style="margin-top:1rem"></div>
      <div style="height:3rem"></div>

    </div><!-- /editor-content -->
  `;

  // Guardar referencia al raceId actual
  area.dataset.raceId = rd.raceId || '';
  area.dataset.rdId   = rd.id;
  area.dataset.raceSlug = race.slug || '';
  area.dataset.raceYear = race.year || '';
  area.dataset.stageNumber = rd.stageNumber ?? '';
  area.dataset.raceDaySlug = rd.slug || '';

  // Título del drawer (cabecera fija): nombre de la carrera + etapa
  const _drawerTitle = document.getElementById('ccDrawer1Title');
  if (_drawerTitle) _drawerTitle.textContent = `${race.name || 'Jornada'}${editorStage ? ` · ${editorStage}` : ''}`;

  // Upload inline en campos de documentación (excluye live_text, siempre URL)
  area.querySelectorAll('.asset-url-input:not(.asset-url-input--live)').forEach(input => {
    attachInlineUpload(input, input.dataset.type);
  });

  // Boton de subida de GPX
  const _gpxBtn    = document.getElementById('ed-gpx-btn');
  const _gpxStatus = document.getElementById('ed-gpx-status');
  const _gpxSummary = document.getElementById('ed-gpx-summary');
  const _syncElevationProfileUi = profile => {
    if (panelState._editorCache?.rdId === area.dataset.rdId) {
      panelState._editorCache.rd = { ...panelState._editorCache.rd, elevationProfile: profile };
    }
    if (profile) {
      _gpxSummary.textContent = `${profile.distance} km · +${profile.elevationGain} m / -${profile.elevationLoss} m · ${profile.points?.length ?? '?'} puntos`;
      _gpxSummary.dataset.distance = profile.distance;
      _gpxSummary.style.display = '';
      _gpxBtn.textContent = 'Reemplazar GPX';
      document.getElementById('ed-gpx-del').style.display = '';
      document.getElementById('ed-gpx-view').style.display = '';
      document.getElementById('ed-gpx-png').style.display = '';
      document.getElementById('ed-profile-not-viewable-label').style.display = 'flex';
      const elevInput = document.getElementById('ed-elev');
      if (elevInput) elevInput.value = profile.elevationGain ?? '';
    } else {
      _gpxSummary.style.display = 'none';
      _gpxSummary.textContent = '';
      delete _gpxSummary.dataset.distance;
      _gpxBtn.textContent = 'Subir GPX';
      document.getElementById('ed-gpx-del').style.display = 'none';
      document.getElementById('ed-gpx-view').style.display = 'none';
      document.getElementById('ed-gpx-png').style.display = 'none';
      document.getElementById('ed-profile-not-viewable-label').style.display = 'none';
      const elevInput = document.getElementById('ed-elev');
      if (elevInput) elevInput.value = '';
    }
  };
  if (_gpxBtn) {
    const _gpxFileIn = document.createElement('input');
    _gpxFileIn.type = 'file';
    _gpxFileIn.accept = '.gpx,application/gpx+xml,text/xml,application/xml';
    _gpxFileIn.addEventListener('change', () => {
      if (_gpxFileIn.files[0]) _gpxHandleUpload(_gpxFileIn.files[0], area.dataset.rdId, _gpxStatus, _gpxSummary, _gpxBtn, _syncElevationProfileUi);
      _gpxFileIn.value = '';
    });
    _gpxBtn.addEventListener('click', () => _gpxFileIn.click());
  }
  document.getElementById('ed-gpx-del')?.addEventListener('click', async () => {
    if (!await confirmDialog('Borrar el perfil de elevación de esta jornada?', { danger: true })) return;
    const { error } = await supabase.from('race_days').update({ elevationProfile: null }).eq('id', area.dataset.rdId);
    if (error) { showToast('Error al borrar: ' + error.message); return; }
    _syncElevationProfileUi(null);
    showToast('Perfil de elevacion borrado', 'success', 3000);
  });

  panelState._profileDigitizerCleanup = mountProfileDigitizer({
    root: document.getElementById('ed-profile-digitizer'),
    distanceInput: document.getElementById('ed-km'),
    initialAssetUrl: (() => {
      const profileAsset = assets.find(asset => asset.type === 'profile' && (asset.url || asset.filePath));
      return profileAsset?.url || profileAsset?.filePath || null;
    })(),
    loadAssetData: async url => {
      if (!url.startsWith(R2_PUBLIC_BASE)) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      }
      const request = buildProfileAssetDownloadRequest(R2_UPLOAD_FN, url);
      const response = await fetch(request.url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          ...await getAuthHeaders(),
          'x-action': 'download-profile',
          'x-filename': encodeURIComponent(request.filename),
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    },
    onSave: async profile => {
      const current = (panelState._editorCache?.rdId === area.dataset.rdId) ? panelState._editorCache.rd?.elevationProfile : rd.elevationProfile;
      if (current && !await confirmDialog('¿Reemplazar el perfil de elevación actual por el digitalizado?')) {
        throw new Error('Guardado cancelado.');
      }
      const { error } = await supabase.from('race_days').update({ elevationProfile: profile }).eq('id', area.dataset.rdId);
      if (error) throw error;
      _syncElevationProfileUi(profile);
      showToast('Perfil digitalizado guardado', 'success', 3000);
    },
  });

  // Boton de subida del GPX del MAPA interactivo (independiente del perfil).
  const _mapBtn     = document.getElementById('ed-map-btn');
  const _mapStatus  = document.getElementById('ed-map-status');
  const _mapSummary = document.getElementById('ed-map-summary');
  if (_mapBtn) {
    const _mapFileIn = document.createElement('input');
    _mapFileIn.type = 'file';
    _mapFileIn.accept = '.gpx,application/gpx+xml,text/xml,application/xml';
    _mapFileIn.addEventListener('change', () => {
      if (_mapFileIn.files[0]) _mapHandleUpload(_mapFileIn.files[0], area.dataset.rdId, _mapStatus, _mapSummary, _mapBtn);
      _mapFileIn.value = '';
    });
    _mapBtn.addEventListener('click', () => _mapFileIn.click());
  }
  const _mapDelExisting = document.getElementById('ed-map-del');
  if (_mapDelExisting) _wireMapDelete(_mapDelExisting, area.dataset.rdId, _mapSummary, _mapBtn);

  // Exportar el miniperfil "solo iconos" a PNG (cliente, canvas). Usa los datos
  // ya cargados en memoria; no relee Supabase. El render normal de la web no se
  // toca (el generador recibe iconsOnly:true sólo para este export).
  document.getElementById('ed-gpx-png')?.addEventListener('click', async () => {
    const cached = (panelState._editorCache?.rdId === area.dataset.rdId) ? panelState._editorCache.rd : rd;
    const profile = cached?.elevationProfile;
    if (!profile?.points?.length) { showToast('Esta jornada no tiene perfil', 'error', 3000); return; }

    const btn = document.getElementById('ed-gpx-png');
    const prevDisabled = btn.disabled;
    btn.disabled = true;
    try {
      const slug = s => String(s || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const stagePart = (!cached.isRestDay && cached.stageNumber != null)
        ? `etapa-${cached.stageNumber}`
        : (cached.dateKey || '');
      const base = [slug(race.name), slug(stagePart)].filter(Boolean).join('-');
      const filename = (base ? `${base}-perfil` : 'perfil') + '.png';

      await exportElevationProfilePNG({
        profile,
        summits:        cached.profileSummits   || [],
        waypoints:      cached.profileWaypoints  || [],
        startLocation:  cached.startLocation     || '',
        finishLocation: cached.finishLocation    || '',
        color:          race.colorHex || null,
      }, { filename });
    } catch (err) {
      console.error(err);
      showToast('Error al exportar el PNG: ' + (err?.message || err), 'error', 4000);
    } finally {
      btn.disabled = prevDisabled;
    }
  });

  mountDayTimingEditor(
    document.getElementById('ruSectionBody').closest('.editor-section'),
    rd,
  );

  // Eventos del editor
  document.getElementById('ed-delete').addEventListener('click', deleteRaceDay);
  document.getElementById('ed-draft').addEventListener('click',   () => saveRaceDay('draft'));
  document.getElementById('ed-publish').addEventListener('click', () => saveRaceDay('published'));
  document.getElementById('ed-duplicate').addEventListener('click', duplicateRaceDay);
  document.getElementById('ed-changeRace').addEventListener('click', openRaceModal);
  document.getElementById('ed-startlist').addEventListener('click', () => {
    const raceId = document.getElementById('ed-startlist').dataset.raceId;
    if (!raceId) return;
    switchTab('startlists');
    openStartlistEditor(raceId);
  });
  document.getElementById('addBroadcastBtn').addEventListener('click', addBroadcastRow);

  document.getElementById('addSummitBtn').addEventListener('click', () => {
    document.getElementById('summitsList').insertAdjacentHTML('beforeend', summitRowHTML());
  });
  // Refresca el span "long. · %" de cada puerto ya cargado.
  document.querySelectorAll('#summitsList .ann-row').forEach(_refreshSummitStats);
  document.getElementById('addWaypointBtn').addEventListener('click', () => {
    document.getElementById('waypointsList').insertAdjacentHTML('beforeend', waypointRowHTML());
  });
  document.getElementById('summitsList').addEventListener('click', e => {
    const delBtn    = e.target.closest('.ann-del-btn');
    const detectBtn = e.target.closest('.ann-detect-btn');
    if (delBtn) {
      delBtn.closest('.ann-row').remove();
      return;
    }
    if (detectBtn) {
      const row = detectBtn.closest('.ann-row');
      _autoDetectSummitClimb(row);
    }
  });
  document.getElementById('summitsList').addEventListener('change', e => {
    const row = e.target.closest('.ann-row');
    if (!row) return;
    const pts = panelState._editorCache?.rd?.elevationProfile?.points;
    const kmInput = e.target.closest('.ann-km');
    if (kmInput && pts?.length) {
      const altInput = row.querySelector('.ann-alt');
      const km = parseFloat(kmInput.value);
      if (altInput && altInput.value.trim() === '' && !isNaN(km)) {
        altInput.value = _interpolateElevation(km, pts);
      }
      // Si aún no se ha rellenado el inicio del puerto, lanzar detección automática.
      const startInput = row.querySelector('.ann-start');
      if (startInput && startInput.value.trim() === '' && !isNaN(km)) {
        _autoDetectSummitClimb(row, /*silent*/ true);
      }
    }
    _refreshSummitStats(row);
  });
  document.getElementById('waypointsList').addEventListener('click', e => {
    if (e.target.closest('.ann-del-btn')) e.target.closest('.ann-row').remove();
  });
  document.getElementById('waypointsList').addEventListener('change', e => {
    const typeSelect = e.target.closest('.ann-type');
    if (!typeSelect) return;
    const row = typeSelect.closest('.ann-row');
    const lenInput = row?.querySelector('.ann-len');
    if (!lenInput) return;
    const show = typeSelect.value === 'cobblestone' || typeSelect.value === 'sterrato';
    lenInput.style.display = show ? '' : 'none';
    if (!show) lenInput.value = '';
  });

  // Autocompletado de país para el override de jornada
  attachCountryAutocomplete(document.getElementById('ed-country'));

  // Enter en campos de texto/hora/url → Publicar / Actualizar
  ['ed-stage', 'ed-start', 'ed-finish', 'ed-km', 'ed-elev',
   'ed-slug', 'ed-startTime', 'ed-finishTime',
   'ed-bonuses', 'ed-notes',
   'ed-bonuses-en', 'ed-notes-en'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveRaceDay('published');
      }
    });
  });

  // Enter en campos dinámicos (broadcasts, assets, puertos y localidades) → Publicar / Actualizar
  document.getElementById('broadcastsList')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });
  document.getElementById('editorArea')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.asset-url-input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });
  document.getElementById('summitsList')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });
  document.getElementById('waypointsList')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      saveRaceDay('published');
    }
  });

  // Jornada de descanso / cancelada — adaptar campos y pestañas
  const restDayCb     = document.getElementById('ed-isRestDay');
  const cancelledDayCb = document.getElementById('ed-isCancelledDay');
  const restDayIds = ['ed-stage', 'ed-finish', 'ed-km', 'ed-elev', 'ed-type', 'ed-type2',
                      'ed-startTime', 'ed-finishTime', 'ed-tvStatus'];

  function applyDayModeState() {
    const isRest      = restDayCb.checked;
    const isCancelled = cancelledDayCb?.checked || false;

    // Campos incompatibles con rest day
    restDayIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = isRest;
      el.closest('.field')?.style.setProperty('opacity', isRest ? '0.4' : '1');
    });
    if (isRest) document.getElementById('ed-stage').value = '';

    // Pestañas a ocultar según modo
    const hiddenTabs = new Set();
    if (isRest) { hiddenTabs.add('tv'); hiddenTabs.add('perfil'); hiddenTabs.add('resultados'); }
    if (isCancelled) hiddenTabs.add('tv');

    document.querySelectorAll('#editorTabs .editor-tab').forEach(tab => {
      tab.hidden = hiddenTabs.has(tab.dataset.target);
    });

    // Si la pestaña activa se acaba de ocultar, saltar a General
    const activeTab = document.querySelector('#editorTabs .editor-tab--active');
    if (activeTab && activeTab.hidden) {
      document.querySelector('#editorTabs .editor-tab[data-target="general"]')?.click();
    }
  }

  applyDayModeState();
  restDayCb.addEventListener('change', applyDayModeState);
  cancelledDayCb?.addEventListener('change', applyDayModeState);

  // Slug jornada — generación automática y botón Auto
  function buildSlugSuggestion() {
    const raceName = (race.name || '').trim();
    const stageVal = document.getElementById('ed-stage').value.trim();
    const dateVal  = document.getElementById('ed-date').value.trim();
    const year     = dateVal ? dateVal.slice(0, 4) : (race.year ? String(race.year) : '');
    const baseRace = toSlug(raceName);
    if (stageVal !== '') {
      const n = parseInt(stageVal, 10);
      const stageStr = n === 0 ? 'prologo' : `etapa-${n}`;
      return (year ? `${baseRace}-${year}-${stageStr}` : `${baseRace}-${stageStr}`).slice(0, 80);
    }
    return (year ? `${baseRace}-${year}` : baseRace).slice(0, 80);
  }

  function applyAutoSlug() {
    const slugInput = document.getElementById('ed-slug');
    if (!slugInput.dataset.auto) return;
    slugInput.value = buildSlugSuggestion();
    document.getElementById('ed-slug-error').style.display = 'none';
  }

  // Generar slug base al abrir si la jornada es nueva
  const slugInputInit = document.getElementById('ed-slug');
  if (slugInputInit.dataset.auto && !slugInputInit.value) applyAutoSlug();

  document.getElementById('ed-slug-suggest').addEventListener('click', () => {
    const slugInput = document.getElementById('ed-slug');
    slugInput.value = buildSlugSuggestion();
    slugInput.dataset.auto = '1';
    document.getElementById('ed-slug-error').style.display = 'none';
  });
  document.getElementById('ed-slug').addEventListener('input', e => {
    delete e.target.dataset.auto;
    const err = validateSlug(e.target.value.trim());
    const el  = document.getElementById('ed-slug-error');
    if (err) { el.textContent = err; el.style.display = 'block'; }
    else     { el.style.display = 'none'; }
  });
  document.getElementById('ed-stage').addEventListener('input', applyAutoSlug);
  document.getElementById('ed-date').addEventListener('change', applyAutoSlug);

  // Slug EN — generación automática y botón Auto
  function buildSlugEnSuggestion() {
    const raceName = (race.nameEn || race.name || '').trim();
    const stageVal = document.getElementById('ed-stage').value.trim();
    const dateVal  = document.getElementById('ed-date').value.trim();
    const year     = dateVal ? dateVal.slice(0, 4) : (race.year ? String(race.year) : '');
    const baseRace = toSlug(raceName);
    if (stageVal !== '') {
      const n = parseInt(stageVal, 10);
      const stageStr = n === 0 ? 'prologue' : `stage-${n}`;
      return (year ? `${baseRace}-${year}-${stageStr}` : `${baseRace}-${stageStr}`).slice(0, 80);
    }
    return (year ? `${baseRace}-${year}` : baseRace).slice(0, 80);
  }

  function applyAutoSlugEn() {
    const slugEnInput = document.getElementById('ed-slug-en');
    if (!slugEnInput.dataset.auto) return;
    slugEnInput.value = buildSlugEnSuggestion();
    document.getElementById('ed-slug-en-error').style.display = 'none';
  }

  const slugEnInputInit = document.getElementById('ed-slug-en');
  if (slugEnInputInit.dataset.auto && !slugEnInputInit.value) applyAutoSlugEn();

  document.getElementById('ed-slug-en-suggest').addEventListener('click', () => {
    const slugEnInput = document.getElementById('ed-slug-en');
    slugEnInput.value = buildSlugEnSuggestion();
    slugEnInput.dataset.auto = '1';
    document.getElementById('ed-slug-en-error').style.display = 'none';
  });
  document.getElementById('ed-slug-en').addEventListener('input', e => {
    delete e.target.dataset.auto;
    const err = validateSlug(e.target.value.trim());
    const el  = document.getElementById('ed-slug-en-error');
    if (err) { el.textContent = err; el.style.display = 'block'; }
    else     { el.style.display = 'none'; }
  });
  document.getElementById('ed-stage').addEventListener('input', applyAutoSlugEn);
  document.getElementById('ed-date').addEventListener('change', applyAutoSlugEn);

  // Ciudades EN — auto-copia desde castellano mientras el campo EN no se haya editado manualmente
  document.getElementById('ed-start').addEventListener('input', () => {
    const enInput = document.getElementById('ed-start-en');
    if (enInput.dataset.auto) enInput.value = document.getElementById('ed-start').value;
  });
  document.getElementById('ed-finish').addEventListener('input', () => {
    const enInput = document.getElementById('ed-finish-en');
    if (enInput.dataset.auto) enInput.value = document.getElementById('ed-finish').value;
  });
  document.getElementById('ed-start-en').addEventListener('input', e => { delete e.target.dataset.auto; });
  document.getElementById('ed-finish-en').addEventListener('input', e => { delete e.target.dataset.auto; });

  // Barra de herramientas Markdown + atajos de teclado
  initMdToolbar('md-toolbar', 'ed-description');
  initMdToolbar('md-toolbar-en', 'ed-description-en', 'ed-description-en-wysiwyg');

  // Pestañas del editor
  setupEditorTabs();

  // Sección Documentación: selector dinámico para añadir/quitar tipos
  setupAssetsSection();

  // Sección Orden de Salida (solo CRI/CRE)
  if (rd.primaryType === 'itt' || rd.primaryType === 'ttt') setupStartOrderSection(rd);

  // Pestaña Resultados: clasificaciones UCI in-house (carga async)
  if (!rd.isRestDay) setupUciResultsSection(rd, race);

  // Toggles ES/EN por sección
  setupLangToggles();
}

// Cada `.lang-pair` tiene un botón `.lang-toggle` que alterna entre los
// idiomas mostrando/ocultando los `.lang-field--es` y `.lang-field--en`
// dentro del mismo contenedor. El botón muestra el idioma al que se va a
// cambiar (en modo ES, dice "EN", y viceversa).
function setupLangToggles() {
  document.querySelectorAll('.lang-pair').forEach(pair => {
    const btn = pair.querySelector(':scope > .lang-pair__header .lang-toggle')
             || pair.querySelector(':scope > .editor-section__header .lang-toggle')
             || pair.querySelector('.lang-toggle');
    if (!btn) return;
    const update = () => {
      const current = pair.dataset.lang || 'es';
      btn.textContent = current === 'es' ? 'EN' : 'ES';
      btn.dataset.langTarget = current;
    };
    btn.addEventListener('click', () => {
      pair.dataset.lang = (pair.dataset.lang === 'en') ? 'es' : 'en';
      update();
    });
    update();
  });
}

// Activación de pestañas del editor.
// La pestaña activa se persiste en localStorage para que al volver al editor
// el usuario caiga donde estaba.
function setupEditorTabs() {
  const tabs = document.querySelectorAll('#editorTabs .editor-tab');
  if (tabs.length === 0) return;
  const saved = localStorage.getItem('panel_editorTab');
  const savedTab = saved ? document.querySelector(`#editorTabs .editor-tab[data-target="${saved}"]`) : null;
  const initial = savedTab && !savedTab.hidden ? saved : 'general';
  const activate = (target, { persist = true } = {}) => {
    const targetTab = document.querySelector(`#editorTabs .editor-tab[data-target="${target}"]`);
    let effective = target;
    let fallbackApplied = false;
    if (targetTab?.hidden) { effective = 'general'; fallbackApplied = true; }
    tabs.forEach(t => t.classList.toggle('editor-tab--active', t.dataset.target === effective));
    document.querySelectorAll('.editor-section[data-tab]').forEach(sec => {
      sec.style.display = sec.dataset.tab === effective ? '' : 'none';
    });
    if (persist && !fallbackApplied) localStorage.setItem('panel_editorTab', effective);
  };
  tabs.forEach(tab => {
    tab.addEventListener('click', () => activate(tab.dataset.target));
  });
  activate(initial, { persist: false });
}

// ═════════════════════════════════════════════════════════════════
//  TRADUCCIONES EN — solo edición manual
// ═════════════════════════════════════════════════════════════════

window.markTranslationAsManual = async function(field) {
  const area = document.getElementById('editorArea');
  const rdId = area?.dataset.rdId;
  if (!rdId) return;
  try {
    const { data: rdForTr, error: fetchErr } = await supabase.from('race_days').select('translations').eq('id', rdId).single();
    if (fetchErr) throw fetchErr;
    const existingTr = rdForTr?.translations || {};
    const existingEn = existingTr.en || {};
    const fieldEntry = existingEn[field];
    if (!fieldEntry?.value) { showToast('No hay traducción para marcar'); return; }
    const newEn = { ...existingEn, [field]: { ...fieldEntry, status: 'manual', updatedAt: new Date().toISOString() } };
    const newTranslations = { ...existingTr, en: newEn };
    const { error } = await supabase.from('race_days').update({ translations: newTranslations }).eq('id', rdId);
    if (error) throw error;
    panelState._editorCache = null;
    await openEditor(rdId);
    showToast(`Traducción "${field}" marcada como manual`, 'success', 2500);
  } catch (e) {
    showToast('Error: ' + e.message);
  }
};
