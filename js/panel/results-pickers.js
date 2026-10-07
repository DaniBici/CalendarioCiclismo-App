// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Resultados: pickers de corredor y equipo
// ─────────────────────────────────────────────────────────────────

import { supabase, esc, normalizeTeamName } from '../shared.js';
import { activeCatalogTeams } from '../services/team-catalog.js';
import { alertDialog } from '../components/dialog.js';
import {
  filterStartlistRiderCandidates, resultRiderDorsalText, resultRiderPickerInitialQuery,
  riderMatchesSearch, riderSearchLookupToken,
} from '../results/panel-logic.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import {
  _teamsFilteredByGender, _validateGenderMismatch, _validateSpecialEditionForRace,
} from './startlists.js';
import { _slRiderFlagPreview } from './startlist-picker.js';

// ── Picker de corredor para una fila de la clasificación (override manual) ──
// Con startlist publicada solo permite elegir entre sus inscritos y fija dorsal,
// nombre y, cuando existe, globalRiderId. Sin startlist conserva la búsqueda en
// riders_men/women. El dorsal sigue siendo la autoridad en el primer caso.
let _ruMatchPickerEl = null;
function _ruCloseMatchPicker() { _ruMatchPickerEl?.remove(); _ruMatchPickerEl = null; }
export function _ruOpenRiderMatchPicker(tr, gender, onChange, startlistRiders = null) {
  _ruCloseMatchPicker();
  const restrictToStartlist = Array.isArray(startlistRiders);
  const ridersTable = gender === 'female' ? 'riders_women' : gender === 'male' ? 'riders_men' : null;
  if (!restrictToStartlist && !ridersTable) { showToast('La carrera no tiene género definido', 'error'); return; }
  const currentId = tr.dataset.gid || null;
  const currentBib = String(tr.querySelector('.ru-bib')?.value || '').trim();

  const pop = document.createElement('div');
  pop.className = 'panel-popover ru-pick-popover';
  pop.innerHTML = `
    ${currentId ? `<div class="u-fs-1 u-c-dim u-mb-035">Match actual: <code class="u-c-text">${esc(currentId)}</code></div>` : ''}
    ${restrictToStartlist ? '<div class="u-fs-1 u-c-dim u-mb-035">Solo inscritas e inscritos de esta carrera.</div>' : ''}
    <input type="search" class="ru-pick-input" placeholder="${restrictToStartlist ? 'Dorsal o nombre…' : 'Apellido, nombre u otherNames…'}">
    <div class="ru-pick-results"></div>
    <div class="panel-popover-footer">
      ${currentId ? '<button data-action="unlink" type="button" class="btn btn--ghost u-btn-sm u-fs-1 u-c-dim">Desligar</button>' : '<span></span>'}
      <button data-action="close" type="button" class="btn btn--ghost u-btn-sm u-fs-1">Cerrar</button>
    </div>`;
  document.body.appendChild(pop);
  _ruMatchPickerEl = pop;

  const input = pop.querySelector('.ru-pick-input');
  const results = pop.querySelector('.ru-pick-results');
  let reqId = 0;
  const search = async () => {
    const q = input.value.trim();
    const myId = ++reqId;
    if (restrictToStartlist) {
      try {
        const data = filterStartlistRiderCandidates(startlistRiders, q);
        if (!data.length) {
          results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Sin inscritos coincidentes.</div>';
          return;
        }
        results.innerHTML = data.map((rider, index) => {
          const isCurrent = (rider.globalRiderId && rider.globalRiderId === currentId)
            || (currentBib && String(rider.dorsal ?? '') === currentBib);
          return `
            <div data-startlist-index="${index}" role="button" tabindex="0" class="ru-pick-row${isCurrent ? ' ru-pick-row--current' : ''}">
              <strong class="u-minw-220 u-right">#${esc(resultRiderDorsalText(rider.dorsal))}</strong>
              ${_slRiderFlagPreview(rider.countryCode)}
              <span class="u-grow u-min0 u-clip u-ellipsis"><strong>${esc(rider.lastName)}</strong>, ${esc(rider.firstName)}${rider.teamDisplay ? ` <span class="u-c-dim u-fs-1">· ${esc(rider.teamDisplay)}</span>` : ''}</span>
            </div>`;
        }).join('');
        results.querySelectorAll('[data-startlist-index]').forEach((el) => {
          el.addEventListener('click', () => {
            const rider = data[Number(el.dataset.startlistIndex)];
            if (!rider) return;
            tr.dataset.gid = rider.globalRiderId || '';
            const bibInput = tr.querySelector('.ru-bib');
            if (bibInput) bibInput.value = rider.dorsal ?? '';
            const nameInput = tr.querySelector('.ru-name');
            if (nameInput) nameInput.value = rider.name || `${rider.firstName || ''} ${rider.lastName || ''}`.trim();
            onChange?.(tr);
            _ruCloseMatchPicker();
            showToast(`Corredor casado por startlist: ${rider.name || `${rider.firstName} ${rider.lastName}`}`, 'success');
          });
        });
      } catch (error) {
        console.error('[resultados] Error mostrando candidatos de la startlist', error);
        results.innerHTML = '<div class="u-c-red u-fs-1 u-p-030">No se han podido mostrar los inscritos.</div>';
      }
      return;
    }
    if (q.length < 2) { results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Escribe al menos 2 letras.</div>'; return; }
    results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Buscando…</div>';
    const safe = riderSearchLookupToken(q).replace(/[%,()]/g, '');
    const { data, error } = await supabase.from(ridersTable)
      .select('id,firstName,lastName,otherNames,nationality,verified,identityKey')
      .or(`identityKey.ilike.%${safe}%,lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`)
      .order('lastName').limit(25);
    if (myId !== reqId) return;
    if (error) { results.innerHTML = `<div class="u-c-red u-fs-1 u-p-030">Error: ${esc(error.message)}</div>`; return; }
    const matchingData = (data || []).filter((rider) => riderMatchesSearch(rider, q));
    if (!matchingData.length) { results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Sin resultados.</div>'; return; }
    results.innerHTML = matchingData.map(rd2 => `
      <div data-pick="${esc(rd2.id)}" role="button" tabindex="0" class="ru-pick-row${rd2.id === currentId ? ' ru-pick-row--current' : ''}">
        ${_slRiderFlagPreview(rd2.nationality)}
        <span class="u-grow u-min0 u-clip u-ellipsis"><strong>${esc(rd2.lastName)}</strong>, ${esc(rd2.firstName)}${rd2.otherNames ? ` <span class="u-c-dim u-fs-1">(${esc(rd2.otherNames)})</span>` : ''}</span>
        ${rd2.verified === false ? '<span title="Sin verificar" class="sl-verify-mark u-c-warn">?</span>' : ''}
      </div>`).join('');
    results.querySelectorAll('[data-pick]').forEach(el => {
      el.addEventListener('click', () => {
        const rider = matchingData.find(x => x.id === el.dataset.pick);
        if (!rider) return;
        tr.dataset.gid = rider.id;
        const nameInput = tr.querySelector('.ru-name');
        if (nameInput) nameInput.value = `${rider.firstName || ''} ${rider.lastName || ''}`.trim();
        onChange?.(tr);   // refresca la celda de equipo auto-resuelto
        _ruCloseMatchPicker();
        showToast(`Corredor casado: ${rider.firstName} ${rider.lastName}`, 'success');
      });
    });
  };
  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') _ruCloseMatchPicker(); });
  pop.querySelector('[data-action="unlink"]')?.addEventListener('click', () => {
    tr.dataset.gid = '';
    onChange?.(tr);   // refresca la celda de equipo auto-resuelto
    _ruCloseMatchPicker();
    showToast('Match eliminado', 'success');
  });
  pop.querySelector('[data-action="close"]').addEventListener('click', _ruCloseMatchPicker);
  // Precarga: buscar ya por el nombre que hay en la fila. En la startlist se
  // conserva el texto completo para que partículas como «van den» y nombres con
  // caracteres especiales filtren al inscrito correcto. En la búsqueda global
  // se mantiene el último token, optimizado para la consulta por apellido.
  const seedName = (tr.querySelector('.ru-name')?.value || '').trim();
  const seed = resultRiderPickerInitialQuery(seedName, restrictToStartlist);
  if (restrictToStartlist) {
    input.value = seed;
    search();
  } else if (seed.length >= 2) {
    input.value = seed;
    search();
  }
  setTimeout(() => input.focus(), 0);
}

// ── Combobox de equipos reutilizable ────────────────────────────
// Muestra el nombre y la etiqueta «Ed. especial» de cada equipo,
// con búsqueda por texto y navegación por teclado (↑/↓/Enter/Esc). Recibe la lista
// YA filtrada (por sexo, etc.) y devuelve el equipo elegido por callback.
//
// opts = {
//   title,                // encabezado del modal
//   teams,                // array de equipos candidatos (ya filtrado)
//   currentId,            // id preseleccionado (o '')
//   suggestionId,         // id a resaltar como sugerencia (opcional)
//   allowNone,            // muestra opción «— Ninguno —» (default true)
//   validate,             // (team) => {ok, reason}; bloquea al confirmar (opcional)
//   onPick,               // (teamIdOrEmpty) => void
// }
export function _openTeamCombo(opts) {
  const { title = 'Asignar equipo', teams = [], currentId = '',
          suggestionId = '', allowNone = true, validate, onPick } = opts;
  const sorted = [...teams].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const overlay = document.createElement('div');
  overlay.className = 'tc-overlay';
  overlay.innerHTML = `
    <div class="tc-dialog">
      <div class="tc-title">${esc(title)}</div>
      <input type="text" class="tc-search" placeholder="Buscar equipo…" autocomplete="off">
      <div class="tc-list" role="listbox" tabindex="-1"></div>
      <div class="u-flex u-gap-050 u-justify-end">
        <button class="btn btn--ghost tc-cancel">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector('.tc-list');
  const searchEl = overlay.querySelector('.tc-search');
  const close = () => { document.removeEventListener('keydown', onDocKey, true); overlay.remove(); };

  // Filas candidatas (incluye «Ninguno» como pseudo-fila con id '').
  const rows = [];
  if (allowNone) rows.push({ id: '', name: '— Ninguno —', _none: true });
  sorted.forEach(t => rows.push(t));

  let filtered = rows.slice();
  let active = -1; // índice sobre `filtered`

  const rowHtml = (t, idx, isActive) => {
    const selected = t.id === currentId;
    const isSug = t.id && t.id === suggestionId;
    const special = t.specialEdition
      ? '<span class="tc-special">Ed. especial</span>' : '';
    const sug = isSug ? '<span class="tc-sug">sugerido</span>' : '';
    const state = isActive ? ' tc-item--active' : (selected ? ' tc-item--selected' : '');
    return `<div class="tc-item${state}${t._none ? ' tc-item--none' : ''}" data-idx="${idx}" data-id="${esc(t.id)}" role="option" aria-selected="${selected}">
        <span${t._none ? '' : ' class="u-fw-600"'}>${esc(t.name)}</span>${sug}${special}
      </div>`;
  };

  const render = () => {
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Sin equipos que coincidan.</div>';
      return;
    }
    listEl.innerHTML = filtered.map((t, i) => rowHtml(t, i, i === active)).join('');
    const act = listEl.querySelector(`.tc-item[data-idx="${active}"]`);
    if (act) act.scrollIntoView({ block: 'nearest' });
  };

  const pick = (t) => {
    if (t && !t._none && validate) {
      const v = validate(t);
      if (!v.ok) { alertDialog(v.reason, { title: '⚠️ No permitido' }); return; }
    }
    onPick?.(t ? t.id : '');
    close();
  };

  const applyFilter = () => {
    const q = normalizeTeamName(searchEl.value.trim());
    filtered = !q ? rows.slice() : rows.filter(t => t._none || normalizeTeamName(t.name || '').includes(q));
    // Activo por defecto: la selección/sugerencia actual si sigue visible; si no,
    // el PRIMER equipo real (nunca «Ninguno», para que Enter tras buscar no borre
    // la asignación); y solo si no hay equipos reales, se cae a «Ninguno».
    active = filtered.findIndex(t => t.id && (t.id === currentId || t.id === suggestionId));
    if (active < 0) active = filtered.findIndex(t => !t._none);
    if (active < 0) active = filtered.length ? 0 : -1;
    render();
  };

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.tc-item');
    if (!item) return;
    pick(filtered[Number(item.dataset.idx)]);
  });
  searchEl.addEventListener('input', applyFilter);
  overlay.querySelector('.tc-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const onDocKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length) { active = (active + 1) % filtered.length; render(); } return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (filtered.length) { active = (active - 1 + filtered.length) % filtered.length; render(); } return; }
    if (e.key === 'Enter')     { e.preventDefault(); if (active >= 0 && filtered[active]) pick(filtered[active]); return; }
  };
  document.addEventListener('keydown', onDocKey, true);

  applyFilter();
  setTimeout(() => searchEl.focus(), 0);
}

// ── Picker de equipo para una fila de la clasificación (override manual) ──
// Combobox sobre los equipos globales. Valida specialEdition y sexo
// contra la carrera de la jornada (mismo guard que inscritos). Guarda en tr.dataset.teamId.
export function _ruOpenTeamPicker(tr, race, onPicked) {
  if (!panelState._teamsCache || panelState._teamsCache.length === 0) {
    alertDialog('No hay equipos globales. Crea equipos en la pestaña Equipos primero.');
    return;
  }
  const current = tr.dataset.teamId || '';
  // Candidatos filtrados por sexo de la carrera (excluye el sexo opuesto); se
  // incluye igualmente el equipo ya asignado aunque sea del sexo opuesto (dato
  // heredado) para poder verlo y corregirlo.
  const genderTeams = _teamsFilteredByGender(activeCatalogTeams(panelState._teamsCache), race && race.gender);
  if (current && !genderTeams.some(t => t.id === current)) {
    const cur = panelState._teamsCache.find(t => t.id === current);
    if (cur) genderTeams.push(cur);
  }
  _openTeamCombo({
    title: 'Equipo (override)',
    teams: genderTeams,
    currentId: current,
    validate: (team) => {
      const v = _validateSpecialEditionForRace(team, race);
      if (!v.ok) return v;
      return _validateGenderMismatch(team, race && race.gender);
    },
    onPick: (val) => { tr.dataset.teamId = val || ''; onPicked?.(tr); },
  });
}
