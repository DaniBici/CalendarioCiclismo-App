// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Detección de colores de maillot
// ─────────────────────────────────────────────────────────────────

import { supabase, esc, findMatchingTeam } from '../shared.js';
import { loadCompleteStartlistCatalog } from '../startlist/import.js?v=20260912120000';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { refreshTeamEditorColors } from './teams.js';

// ═════════════════════════════════════════════════════════════════
//  DETECCIÓN DE COLORES DE MAILLOT (desde el editor de equipo)
// ═════════════════════════════════════════════════════════════════

let _jerseyDetectorState = null;

// ── Overlay de detección ──────────────────────────────────────────

function _jerseyColorFieldHtml(key, label) {
  return `<div style="display:flex;flex-direction:column;gap:0.2rem">
    <label style="font-size:0.76rem;color:var(--text-dim)">${esc(label)}</label>
    <div style="display:flex;gap:0.35rem;align-items:center">
      <input type="color" id="jd-${key}-color" style="width:34px;height:30px;padding:2px;border:1px solid var(--border);background:var(--bg);border-radius:4px;cursor:pointer">
      <input type="text" id="jd-${key}-text" value="#000000" maxlength="7" style="flex:1;font-family:monospace;font-size:0.82rem;text-transform:uppercase;padding:0.28rem 0.4rem;border:1px solid var(--border);background:var(--bg);border-radius:4px;color:var(--text)">
    </div>
  </div>`;
}

function _getOrCreateJerseyOverlay() {
  let ov = document.getElementById('jerseyDetectorOverlay');
  if (ov) return ov;

  ov = document.createElement('div');
  ov.id = 'jerseyDetectorOverlay';
  ov.className = 'modal-overlay';
  ov.style.cssText = 'display:none;z-index:300';
  ov.innerHTML = `
    <div class="modal" style="max-width:640px;max-height:92vh;overflow:hidden">
      <div class="modal__header">
        <div class="modal__title" id="jerseyDetectorTitle">Detectar colores de maillot</div>
        <button class="btn btn--ghost" id="jerseyDetectorCloseBtn" style="padding:0.25rem 0.5rem;font-size:0.75rem">✕</button>
      </div>

      <div style="overflow-y:auto;flex:1;padding:1.25rem;display:flex;flex-direction:column;gap:1.25rem">

        <!-- 1 · Seleccionar imagen -->
        <div id="jerseyStep1" style="display:flex;flex-direction:column;gap:0.65rem">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-dim);font-weight:700">Seleccionar imagen del maillot</div>

          <div style="display:flex;align-items:center;gap:0.6rem">
            <button class="btn btn--ghost" id="jerseyUploadBtn" style="font-size:0.8rem">📁 Subir imagen</button>
            <span id="jerseyFileLabel" style="font-size:0.78rem;color:var(--text-dim)">PNG, JPG o WEBP — máx 10 MB</span>
            <input type="file" id="jerseyFileInput" accept="image/png,image/jpeg,image/webp" style="display:none">
          </div>
        </div>

        <!-- Status -->
        <div id="jerseyDetectorStatus" style="font-size:0.82rem;color:var(--text-dim);display:none;padding:0.5rem 0.75rem;border-radius:6px;background:var(--bg-card);border:1px solid var(--border)"></div>

        <!-- 2 · Preview de colores -->
        <div id="jerseyColorsPreview" style="display:none;flex-direction:column;gap:0.75rem">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-dim);font-weight:700">Colores detectados — revisa y ajusta</div>
          <div style="display:grid;grid-template-columns:120px 1fr;gap:1rem;align-items:start">
            <div style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;position:sticky;top:0">
              <div id="jerseyColorsSwatches" style="display:flex;gap:0.35rem"><i style="width:24px;height:24px"></i><i style="width:24px;height:24px"></i><i style="width:24px;height:24px"></i></div>
              <div id="jerseyHeaderPreview" style="width:100%;text-align:center;padding:0.35rem 0.4rem;border-radius:5px;font-family:var(--font-display);font-weight:700;font-size:0.75rem;letter-spacing:0.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Cabecera</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.45rem">
              ${_jerseyColorFieldHtml('headerBg',   'Fondo cabecera')}
              ${_jerseyColorFieldHtml('headerText',  'Texto cabecera')}
              ${_jerseyColorFieldHtml('torsoCenter', 'Central torso')}
              ${_jerseyColorFieldHtml('torsoSides',  'Laterales')}
              ${_jerseyColorFieldHtml('shorts', 'Culotte')}
            </div>
          </div>
        </div>

        <!-- Asociar en listas de inscritos (aparece tras guardar colores) -->
        <div id="jerseyStartlistStep" style="display:none;flex-direction:column;gap:0.65rem">
          <div id="jerseyStartlistStepTitle" style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-dim);font-weight:700">Asociar en listas de inscritos</div>
          <div id="jerseyStartlistStepBody" style="display:flex;flex-direction:column;gap:0.5rem"></div>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:0.9rem 1.25rem;border-top:1px solid var(--border);display:flex;align-items:center;gap:0.75rem">
        <button class="btn btn--primary" id="jerseyDetectorSaveBtn" style="display:none">Guardar colores</button>
        <button class="btn btn--primary" id="jerseyAssocBtn" style="display:none">Asociar seleccionadas</button>
        <button class="btn btn--ghost" id="jerseyDetectorCancelBtn">Cancelar</button>
        <span class="u-fs-md u-c-dim" id="jerseyDetectorSaveStatus"></span>
      </div>
    </div>`;

  document.body.appendChild(ov);

  ov.addEventListener('click', e => { if (e.target === ov) closeJerseyDetector(); });
  ov.querySelector('#jerseyDetectorCloseBtn').addEventListener('click', closeJerseyDetector);
  ov.querySelector('#jerseyDetectorCancelBtn').addEventListener('click', closeJerseyDetector);
  ov.querySelector('#jerseyDetectorSaveBtn').addEventListener('click', saveJerseyColors);
  ov.querySelector('#jerseyAssocBtn').addEventListener('click', confirmJerseyStartlistLinks);
  ov.querySelector('#jerseyUploadBtn').addEventListener('click', () => ov.querySelector('#jerseyFileInput').click());
  ov.querySelector('#jerseyFileInput').addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) jerseyHandleFile(file);
  });

  const allKeys = ['headerBg', 'headerText', 'torsoCenter', 'torsoSides', 'shorts'];
  allKeys.forEach(key => {
    const colorEl = ov.querySelector(`#jd-${key}-color`);
    const textEl  = ov.querySelector(`#jd-${key}-text`);
    if (!colorEl || !textEl) return;
    colorEl.addEventListener('input', () => { textEl.value = colorEl.value.toUpperCase(); refreshJerseyPreview(); });
    textEl.addEventListener('input', () => {
      const v = textEl.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { colorEl.value = v.toLowerCase(); refreshJerseyPreview(); }
    });
  });

  return ov;
}

function openJerseyDetector(teamId, teamName, { applyCallback } = {}) {
  _jerseyDetectorState = { teamId, teamName, applyCallback };
  const ov = _getOrCreateJerseyOverlay();

  ov.querySelector('#jerseyDetectorTitle').textContent = `Detectar colores — ${teamName}`;
  ov.querySelector('#jerseyStep1').style.display = 'flex';
  ov.querySelector('#jerseyStep1').style.flexDirection = 'column';
  ov.querySelector('#jerseyColorsPreview').style.display = 'none';
  ov.querySelector('#jerseyDetectorSaveBtn').style.display = 'none';
  ov.querySelector('#jerseyDetectorSaveBtn').disabled = false;
  ov.querySelector('#jerseyAssocBtn').style.display = 'none';
  ov.querySelector('#jerseyStartlistStep').style.display = 'none';
  ov.querySelector('#jerseyStartlistStepTitle').style.display = '';
  ov.querySelector('#jerseyStartlistStepBody').innerHTML = '';
  ov.querySelector('#jerseyDetectorStatus').style.display = 'none';
  ov.querySelector('#jerseyDetectorStatus').textContent = '';
  ov.querySelector('#jerseyDetectorSaveStatus').textContent = '';
  ov.querySelector('#jerseyDetectorCancelBtn').textContent = 'Cancelar';
  ov.querySelector('#jerseyFileLabel').textContent = 'PNG, JPG o WEBP — máx 10 MB';
  ov.style.display = 'flex';
}

function closeJerseyDetector() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (ov) ov.style.display = 'none';
  _jerseyDetectorState = null;
}

async function jerseyHandleFile(file) {
  // La edición de colores se realiza directamente en el formulario del equipo.
  // Este manejador queda como salvaguarda para overlays antiguos aún cacheados.
  console.warn('[team colors] La detección automática ya no está disponible.', file.name);
}

function _jerseyApplyColors(raw) {
  let colors = { ...raw };

  // Anti-blanco: si headerBg es blanco puro, sustituir por el color de torso más representativo
  if (colors.headerBg === '#ffffff') {
    const alt = [colors.badgeTorsoCenter, colors.badgeTorsoSides].find(c => c && c !== '#ffffff');
    colors.headerBg  = alt || '#f0f0f0';
    colors.headerText = '#000000';
  }

  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return;

  const setVal = (key, val) => {
    if (!val) return;
    const c = ov.querySelector(`#jd-${key}-color`);
    const t = ov.querySelector(`#jd-${key}-text`);
    if (c) c.value = val.toLowerCase();
    if (t) t.value = val.toUpperCase();
  };

  setVal('headerBg',   colors.headerBg);
  setVal('headerText', colors.headerText);
  setVal('torsoCenter', colors.badgeTorsoCenter);
  setVal('torsoSides',  colors.badgeTorsoSides);
  setVal('shorts',      colors.badgeShorts);

  ov.querySelector('#jerseyColorsPreview').style.display = 'flex';
  ov.querySelector('#jerseyColorsPreview').style.flexDirection = 'column';
  ov.querySelector('#jerseyDetectorSaveBtn').style.display = '';
  ov.querySelector('#jerseyDetectorSaveBtn').disabled = false;
  refreshJerseyPreview();
}

function refreshJerseyPreview() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return;
  const get = key => (ov.querySelector(`#jd-${key}-text`)?.value || '').trim().toLowerCase();

  const team = {
    name:             _jerseyDetectorState?.teamName || '',
    headerBg:         get('headerBg'),
    headerText:       get('headerText'),
    badgeTorsoCenter: get('torsoCenter'),
    badgeTorsoSides:  get('torsoSides'),
    badgeShorts:      get('shorts'),
    badgeInnerCircle: null,
  };

  const colors = [team.badgeTorsoSides, team.badgeTorsoCenter, team.badgeShorts];
  ov.querySelectorAll('#jerseyColorsSwatches i').forEach((square, index) => {
    square.style.background = colors[index];
  });

  const hdrEl = ov.querySelector('#jerseyHeaderPreview');
  if (hdrEl) {
    hdrEl.style.background = team.headerBg || '#1f2937';
    hdrEl.style.color      = team.headerText || '#ffffff';
    hdrEl.textContent      = team.name;
  }
}

function _jerseyReadColors() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return null;
  const get = key => (ov.querySelector(`#jd-${key}-text`)?.value || '').trim().toLowerCase();
  return {
    headerBg:         get('headerBg'),
    headerText:       get('headerText'),
    badgeTorsoCenter: get('torsoCenter'),
    badgeTorsoSides:  get('torsoSides'),
    badgeShorts:      get('shorts'),
    badgeInnerCircle: null,
  };
}

async function saveJerseyColors() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov || !_jerseyDetectorState) return;
  const saveBtn    = ov.querySelector('#jerseyDetectorSaveBtn');
  const saveStatus = ov.querySelector('#jerseyDetectorSaveStatus');
  const colors = _jerseyReadColors();
  if (!colors) return;

  const HEX = /^#[0-9a-f]{6}$/;
  const bad = ['headerBg', 'headerText', 'badgeTorsoCenter', 'badgeTorsoSides', 'badgeShorts']
    .find(k => !HEX.test(colors[k] || ''));
  if (bad) { saveStatus.textContent = `Color inválido en "${bad}"`; return; }

  // Modo "equipo nuevo": aplica colores al formulario del editor sin guardar en BD
  if (_jerseyDetectorState.applyCallback) {
    _jerseyDetectorState.applyCallback(colors);
    closeJerseyDetector();
    return;
  }

  if (!_jerseyDetectorState.teamId) return;
  saveBtn.disabled = true;
  saveStatus.textContent = 'Guardando…';

  try {
    const { error } = await supabase.from('teams').update(colors).eq('id', _jerseyDetectorState.teamId);
    if (error) throw error;

    const savedId   = _jerseyDetectorState.teamId;
    const savedName = _jerseyDetectorState.teamName;

    if (panelState._teamsCache) {
      const idx = panelState._teamsCache.findIndex(t => t.id === savedId);
      if (idx >= 0) Object.assign(panelState._teamsCache[idx], colors);
    }
    // Refresca el editor abierto detrás del overlay para ver los colores sin F5.
    refreshTeamEditorColors(savedId, colors);

    saveBtn.style.display = 'none';
    saveStatus.textContent = '✓ Colores guardados. Buscando apariciones en listas…';
    ov.querySelector('#jerseyDetectorCancelBtn').textContent = 'Cerrar';

    const team = panelState._teamsCache?.find(t => t.id === savedId);
    const matches = await _jerseyCheckStartlistMatches(team);

    if (matches.length > 0) {
      _jerseyRenderStartlistStep(matches);
      saveStatus.textContent = '';
    } else {
      showToast(`Colores guardados: ${savedName}`, 'success', 3000);
      closeJerseyDetector();
    }
  } catch (err) {
    saveStatus.textContent = `Error: ${err.message}`;
    saveBtn.disabled = false;
  }
}

// ── Paso 3: buscar apariciones en listas de inscritos ────────────

async function _jerseyCheckStartlistMatches(team) {
  if (!team) return [];

  // Buscar primero las filas pendientes; no descargar el calendario completo.
  const unmatched = await loadCompleteStartlistCatalog((from, to, count) => supabase
    .from('startlist_teams')
    .select('id, teamName, raceId', count ? { count: 'exact' } : {})
    .is('teamId', null).order('id').range(from, to));
  if (!unmatched.length) return [];
  const raceIds = [...new Set(unmatched.map(st => st.raceId))];
  const races = [];
  for (let i = 0; i < raceIds.length; i += 100) {
    const { data, error } = await supabase.from('races')
      .select('id, name, year, gender').in('id', raceIds.slice(i, i + 100));
    if (error) throw error;
    races.push(...(data || []));
  }
  const raceById = Object.fromEntries(races.map(r => [r.id, r]));

  const teamGender = team.gender || null;

  return unmatched
    .filter(st => {
      const race = raceById[st.raceId];
      if (!race) return false;
      // Reject explicit cross-gender mismatches (both sides set and different)
      if (teamGender && race.gender && teamGender !== race.gender) return false;
      return !!findMatchingTeam(st.teamName, [team]);
    })
    .map(st => {
      const race = raceById[st.raceId];
      return {
        id:         st.id,
        teamName:   st.teamName,
        raceId:     st.raceId,
        raceName:   race?.name  || st.raceId,
        raceYear:   race?.year  || null,
        raceGender: race?.gender || null,
      };
    })
    .sort((a, b) =>
      (b.raceYear ?? 0) - (a.raceYear ?? 0) || a.raceName.localeCompare(b.raceName)
    );
}

function _openJerseyStartlistOnly(teamId, teamName, matches) {
  _jerseyDetectorState = { teamId, teamName };
  const ov = _getOrCreateJerseyOverlay();
  ov.querySelector('#jerseyDetectorTitle').textContent  = `Asociar en listas — ${teamName}`;
  ov.querySelector('#jerseyStep1').style.display        = 'none';
  ov.querySelector('#jerseyDetectorStatus').style.display = 'none';
  ov.querySelector('#jerseyColorsPreview').style.display  = 'none';
  ov.querySelector('#jerseyDetectorSaveBtn').style.display = 'none';
  ov.querySelector('#jerseyAssocBtn').style.display       = 'none';
  ov.querySelector('#jerseyStartlistStep').style.display  = 'none';
  ov.querySelector('#jerseyStartlistStepTitle').style.display = 'none';
  ov.querySelector('#jerseyStartlistStepBody').innerHTML  = '';
  ov.querySelector('#jerseyDetectorSaveStatus').textContent = '';
  ov.querySelector('#jerseyDetectorCancelBtn').textContent = 'Cerrar';
  ov.style.display = 'flex';
  _jerseyRenderStartlistStep(matches);
}

function _jerseyRenderStartlistStep(matches) {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov || !_jerseyDetectorState) return;

  const step     = ov.querySelector('#jerseyStartlistStep');
  const body     = ov.querySelector('#jerseyStartlistStepBody');
  const assocBtn = ov.querySelector('#jerseyAssocBtn');
  if (!step || !body) return;

  const teamName = _jerseyDetectorState.teamName;

  const rowsHtml = matches.map(m => {
    const genderWarning = !m.raceGender
      ? `<span title="El género de esta carrera no está especificado" style="font-size:0.7rem;color:#f59e0b;flex-shrink:0">⚠ sin género</span>`
      : '';
    return `<label style="display:flex;align-items:center;gap:0.6rem;padding:0.3rem 0.5rem;border-radius:5px;cursor:pointer">
      <input type="checkbox" class="sl-assoc-check" data-id="${esc(m.id)}" checked style="flex-shrink:0;cursor:pointer">
      <span class="u-grow u-min0 u-truncate">
        <span style="font-size:0.83rem;font-weight:600">${esc(m.raceName)}${m.raceYear ? ` ${m.raceYear}` : ''}</span>
        <span style="font-size:0.75rem;color:var(--text-dim);margin-left:0.35rem">"${esc(m.teamName)}"</span>
      </span>
      ${genderWarning}
    </label>`;
  }).join('');

  body.innerHTML = `
    <div class="u-fs-082">
      ${matches.length === 1 ? 'Se encontró' : 'Se encontraron'} <strong>${matches.length}</strong> aparición${matches.length > 1 ? 'es' : ''}
      de <strong>${esc(teamName)}</strong> en listas enriquecidas sin asociar.
    </div>
    <div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
      <div style="max-height:190px;overflow-y:auto;padding:0.25rem 0.25rem">
        ${rowsHtml}
      </div>
      <div style="border-top:1px solid var(--border);padding:0.3rem 0.5rem;display:flex;align-items:center;gap:0.5rem">
        <button class="btn btn--ghost" id="jerseyAssocCheckAll" style="font-size:0.7rem;padding:0.15rem 0.4rem">Todas</button>
        <button class="btn btn--ghost" id="jerseyAssocUncheckAll" style="font-size:0.7rem;padding:0.15rem 0.4rem">Ninguna</button>
      </div>
    </div>`;

  step.style.display = 'flex';

  assocBtn.textContent = `Asociar seleccionadas (${matches.length})`;
  assocBtn.style.display = '';
  assocBtn.disabled = false;

  // Select-all / unselect-all helpers
  body.querySelector('#jerseyAssocCheckAll')?.addEventListener('click', () => {
    body.querySelectorAll('.sl-assoc-check').forEach(cb => { cb.checked = true; });
    _jerseyUpdateAssocCount();
  });
  body.querySelector('#jerseyAssocUncheckAll')?.addEventListener('click', () => {
    body.querySelectorAll('.sl-assoc-check').forEach(cb => { cb.checked = false; });
    _jerseyUpdateAssocCount();
  });
  body.querySelectorAll('.sl-assoc-check').forEach(cb =>
    cb.addEventListener('change', _jerseyUpdateAssocCount)
  );

  // Scroll step into view
  step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _jerseyUpdateAssocCount() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov) return;
  const n = ov.querySelectorAll('.sl-assoc-check:checked').length;
  const btn = ov.querySelector('#jerseyAssocBtn');
  if (btn) btn.textContent = `Asociar seleccionadas (${n})`;
}

async function confirmJerseyStartlistLinks() {
  const ov = document.getElementById('jerseyDetectorOverlay');
  if (!ov || !_jerseyDetectorState?.teamId) return;

  const checked = Array.from(ov.querySelectorAll('.sl-assoc-check:checked')).map(cb => cb.dataset.id);
  if (checked.length === 0) {
    closeJerseyDetector();
    return;
  }

  const assocBtn   = ov.querySelector('#jerseyAssocBtn');
  const saveStatus = ov.querySelector('#jerseyDetectorSaveStatus');
  const teamId     = _jerseyDetectorState.teamId;
  const teamName   = _jerseyDetectorState.teamName;

  assocBtn.disabled = true;
  saveStatus.textContent = 'Asociando…';

  try {
    // Supabase update in batches of 100 to respect URL length limits
    for (let i = 0; i < checked.length; i += 100) {
      const batch = checked.slice(i, i + 100);
      const { error } = await supabase
        .from('startlist_teams')
        .update({ teamId })
        .in('id', batch);
      if (error) throw error;
    }

    showToast(
      `${checked.length} aparición${checked.length > 1 ? 'es' : ''} asociada${checked.length > 1 ? 's' : ''}: ${teamName}`,
      'success', 4000
    );
    closeJerseyDetector();
  } catch (err) {
    saveStatus.textContent = `Error al asociar: ${err.message}`;
    assocBtn.disabled = false;
  }
}
