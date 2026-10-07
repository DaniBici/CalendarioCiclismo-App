// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Challenges (challenge_groups)
// ─────────────────────────────────────────────────────────────────

import { attachCountryAutocomplete } from '../country-select.js';
import { supabase } from '../shared.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { confirmDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { attachInlineUpload } from './uploads.js';
import { ensureAllRacesLoaded } from './agenda.js';

// ─────────────────────────────────────────────────────────────────
//  CHALLENGE GROUPS
// ─────────────────────────────────────────────────────────────────

let _challengeEditingId = null; // null = crear nuevo, string = editar existente

// ── Render listado de challenges ─────────────────────────────────
export async function renderChallengesView() {
  const container = document.getElementById('challengesListView');
  container.innerHTML = '<div class="u-fs-3 u-c-dim">Cargando…</div>';

  try {
    const { data: groupsData } = await supabase.from('challenge_groups').select('*');
    const groups = groupsData || [];

    groups.sort((a, b) => {
      if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
      return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
    });

    if (!groups.length) {
      container.innerHTML = `<div class="u-c-dim u-fs-3 u-py-100 u-px-0">
        No hay challenge groups todavía. Crea uno con el botón de arriba.
      </div>`;
      return;
    }

    container.innerHTML = '<div class="panel-list">' + groups.map(cg => {
      const raceCount = Array.isArray(cg.raceIds) ? cg.raceIds.length : 0;
      const genderLabel = cg.gender === 'female' ? 'Femenino' : 'Masculino';
      const colorDot = cg.colorHex
        ? `<span class="challenge-dot" style="--dot-color:${cg.colorHex}"></span>`
        : '';

      return `<div class="challenge-item" data-id="${cg.id}">
        ${colorDot}
        <div class="u-grow u-min0">
          <div class="u-fw-600 u-fs-4">${cg.name || '—'}</div>
          <div class="u-fs-2 u-c-dim u-mt-015">
            ${cg.year || '—'} · ${genderLabel} · ${cg.uciCategory || '1.1'} · ${raceCount} carrera${raceCount !== 1 ? 's' : ''}
            ${cg.slug ? `· <span class="u-mono u-fs-1">${cg.slug}</span>` : ''}
          </div>
        </div>
        <button class="cg-edit-btn" data-id="${cg.id}">Editar</button>
        <button class="cg-delete-btn" data-id="${cg.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>`;
    }).join('') + '</div>';

    // Listeners de editar / borrar
    container.querySelectorAll('.cg-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openChallengeModal(btn.dataset.id));
    });
    container.querySelectorAll('.cg-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await confirmDialog('¿Eliminar este challenge group? Las carreras individuales no se borran.', { danger: true })) return;
        await supabase.from('challenge_groups').delete().eq('id', btn.dataset.id);
        renderChallengesView();
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="u-c-red u-fs-2">Error: ${err.message}</div>`;
  }
}

// ── Abrir modal (nuevo o editar) ─────────────────────────────────
// HTML del formulario de challenge (mismos ids cg-* que el markup anterior).
function challengeBodyHtml() {
  return `
    <div id="challengeError" class="alert alert--error" style="display:none"></div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="cg-name" placeholder="Challenge Mallorca">
      </div>
      <div class="field">
        <label>Slug</label>
        <input type="text" id="cg-slug" placeholder="challenge-mallorca-2026">
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Categoría UCI</label>
        <select id="cg-category">
          <option value="WC">WC</option><option value="CC">CC</option><option value="CN">CN</option>
          <option value="1.UWT">1.UWT</option><option value="2.UWT">2.UWT</option>
          <option value="1.WWT">1.WWT</option><option value="2.WWT">2.WWT</option>
          <option value="1.Pro">1.Pro</option><option value="2.Pro">2.Pro</option>
          <option value="1.1" selected>1.1</option><option value="2.1">2.1</option>
          <option value="1.2">1.2</option><option value="2.2">2.2</option>
          <option value="1.2U">1.2U</option><option value="2.2U">2.2U</option>
        </select>
      </div>
      <div class="field">
        <label>Género</label>
        <select id="cg-gender">
          <option value="male">Masculino</option>
          <option value="female">Femenino</option>
        </select>
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>País (código ISO)</label>
        <input type="text" id="cg-country" placeholder="ES" maxlength="5">
      </div>
      <div class="field">
        <label>Año de edición</label>
        <input type="number" id="cg-year" placeholder="2026" min="2000" max="2099">
      </div>
    </div>
    <div class="field">
      <label>Color</label>
      <div class="color-preview u-maxw-full u-clip">
        <input class="u-color-dot" type="color" id="cg-colorPicker" value="#217cc4"
              >
        <input type="text" id="cg-color" placeholder="#217cc4" class="u-grow u-min0 u-maxw-120px">
      </div>
    </div>
    <div class="field">
      <label>Logo (URL, opcional)</label>
      <div class="field-upload-wrap" id="cg-logo-wrap"><input type="url" id="cg-logo" placeholder="https://…/logo.png"></div>
    </div>
    <div class="field">
      <label>Carreras incluidas</label>
      <div class="cg-race-picker">
        <div class="u-stack u-gap-030">
          <div class="u-micro">Disponibles</div>
          <input type="text" id="cg-search-available" placeholder="Buscar…">
          <select id="cg-available" multiple size="8"></select>
        </div>
        <div class="u-stack u-gap-040 u-pt-180">
          <button type="button" id="cg-add-race" class="btn btn--ghost u-py-035 u-px-060" title="Añadir">›</button>
          <button type="button" id="cg-remove-race" class="btn btn--ghost u-py-035 u-px-060" title="Quitar">‹</button>
        </div>
        <div class="u-stack u-gap-030">
          <div class="u-micro">Incluidas</div>
          <div class="u-h-175"></div>
          <select id="cg-selected" multiple size="8"></select>
        </div>
      </div>
    </div>
    <div class="panel-form-actions">
      <button class="btn btn--primary" id="challengeSaveBtn">Guardar challenge</button>
    </div>
  `;
}

export async function openChallengeModal(editId = null) {
  _challengeEditingId = editId;
  openDrawer({
    title: editId ? 'Editar challenge' : 'Nuevo challenge',
    level: 1,
    render: (body) => {
      body.innerHTML = challengeBodyHtml();
      document.getElementById('challengeSaveBtn').addEventListener('click', saveChallengeGroup);
      _populateChallengeEditor(editId);
    },
  });
}

// Pobla y cablea el editor de challenge (todo per-apertura, ya lo era).
async function _populateChallengeEditor(editId) {
  await ensureAllRacesLoaded();
  const errorDiv = document.getElementById('challengeError');
  errorDiv.style.display = 'none';

  // Usar allRaces ya cargado en memoria — no hay necesidad de otra query a Firestore
  const allR = [...panelState.allRaces].sort((a, b) => {
    if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
    return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
  });

  let existingRaceIds = [];
  let existing = null;

  if (editId) {
    const { data: cgData } = await supabase.from('challenge_groups').select('*').eq('id', editId).single();
    existing   = cgData || {};
    existingRaceIds = Array.isArray(existing.raceIds) ? existing.raceIds : [];

    document.getElementById('cg-name').value     = existing.name     || '';
    document.getElementById('cg-slug').value     = existing.slug     || '';
    document.getElementById('cg-gender').value   = existing.gender   || 'male';
    document.getElementById('cg-year').value     = existing.year     || new Date().getFullYear();
    document.getElementById('cg-category').value = existing.uciCategory || '1.1';
    document.getElementById('cg-country').value  = existing.countryCode  || '';
    document.getElementById('cg-color').value    = existing.colorHex    || '';
    document.getElementById('cg-logo').value     = existing.logoUrl     || '';
  } else {
    document.getElementById('cg-name').value     = '';
    document.getElementById('cg-slug').value     = '';
    document.getElementById('cg-gender').value   = 'male';
    document.getElementById('cg-year').value     = new Date().getFullYear();
    document.getElementById('cg-category').value = '1.1';
    document.getElementById('cg-country').value  = '';
    document.getElementById('cg-color').value    = '';
    document.getElementById('cg-logo').value     = '';
  }

  // Auto-slug desde el nombre
  const nameInput = document.getElementById('cg-name');
  const slugInput = document.getElementById('cg-slug');
  nameInput.addEventListener('input', () => {
    if (!editId) {
      const year = document.getElementById('cg-year').value || new Date().getFullYear();
      const gender = document.getElementById('cg-gender').value;
      const base = nameInput.value
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const suffix = gender === 'female' ? '-fem' : '';
      slugInput.value = `${base}${suffix}-${year}`;
    }
  });
  document.getElementById('cg-gender').addEventListener('change', () => {
    if (!editId) nameInput.dispatchEvent(new Event('input'));
  });
  document.getElementById('cg-year').addEventListener('input', () => {
    if (!editId) nameInput.dispatchEvent(new Event('input'));
  });

  // Sistema de dos listas: disponibles / incluidas
  const selAvailable = document.getElementById('cg-available');
  const selSelected  = document.getElementById('cg-selected');
  const searchAvail  = document.getElementById('cg-search-available');

  // Poblar lista de disponibles (las no seleccionadas) y seleccionadas
  function norm(s) { return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }

  function fillLists(filter = '') {
    const q = norm(filter);
    const selectedIds = [...selSelected.options].map(o => o.value);
    selAvailable.innerHTML = '';
    allR.forEach(r => {
      if (selectedIds.includes(r.id)) return;
      if (q && !norm(r.name || r.id).includes(q)) return;
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `${r.name || r.id}  ${r.year || ''} ${r.uciCategory || ''}`;
      selAvailable.appendChild(opt);
    });
  }

  // Añadir seleccionadas iniciales
  selSelected.innerHTML = '';
  existingRaceIds.forEach(id => {
    const r = allR.find(x => x.id === id);
    if (!r) return;
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.name || r.id}  ${r.year || ''} ${r.uciCategory || ''}`;
    selSelected.appendChild(opt);
  });

  fillLists();

  searchAvail.addEventListener('input', () => fillLists(searchAvail.value));

  document.getElementById('cg-add-race').addEventListener('click', () => {
    [...selAvailable.selectedOptions].forEach(opt => {
      selAvailable.removeChild(opt);
      selSelected.appendChild(opt);
    });
  });

  document.getElementById('cg-remove-race').addEventListener('click', () => {
    [...selSelected.selectedOptions].forEach(opt => {
      selSelected.removeChild(opt);
      fillLists(searchAvail.value); // re-añade a disponibles respetando el filtro
    });
    fillLists(searchAvail.value);
  });

  // Color picker sincronizado (igual que nueva carrera)
  const cgColorPicker = document.getElementById('cg-colorPicker');
  const cgColorText   = document.getElementById('cg-color');
  cgColorPicker.value = (editId && existing?.colorHex) ? existing.colorHex : '#217cc4';
  cgColorText.value   = (editId && existing?.colorHex) ? existing.colorHex : '';
  cgColorPicker.addEventListener('input', () => { cgColorText.value = cgColorPicker.value; });
  cgColorText.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(cgColorText.value)) cgColorPicker.value = cgColorText.value;
  });

  // Upload de logo hacia R2
  attachInlineUpload(document.getElementById('cg-logo'), 'logo');
  attachCountryAutocomplete(document.getElementById('cg-country'));
}

// ── Cerrar editor de challenge ───────────────────────────────────
function closeChallengeModal() {
  closeDrawer(1);
  _challengeEditingId = null;
}

// ── Guardar challenge ────────────────────────────────────────────
async function saveChallengeGroup() {
  const errorDiv = document.getElementById('challengeError');
  errorDiv.style.display = 'none';

  const name     = document.getElementById('cg-name').value.trim();
  const slug     = document.getElementById('cg-slug').value.trim();
  const gender   = document.getElementById('cg-gender').value;
  const year     = parseInt(document.getElementById('cg-year').value) || new Date().getFullYear();
  const category = document.getElementById('cg-category').value.trim() || '1.1';
  const country  = document.getElementById('cg-country').value.trim();
  const color    = document.getElementById('cg-color').value.trim()
                || document.getElementById('cg-colorPicker').value;
  const logoUrl  = document.getElementById('cg-logo').value.trim();

  if (!name) {
    errorDiv.textContent = 'El nombre es obligatorio.';
    errorDiv.style.display = 'block';
    return;
  }
  if (!slug) {
    errorDiv.textContent = 'El slug es obligatorio.';
    errorDiv.style.display = 'block';
    return;
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    errorDiv.textContent = 'El slug solo puede contener letras minúsculas, números y guiones.';
    errorDiv.style.display = 'block';
    return;
  }

  // Recoger raceIds seleccionados
  const raceIds = [...document.getElementById('cg-selected').options].map(o => o.value);

  const data = {
    name,
    slug,
    gender,
    year,
    uciCategory: category,
    countryCode: country,
    colorHex:    color,
    logoUrl:     logoUrl || null,
    raceIds,
    updatedAt:   new Date().toISOString(),
  };

  try {
    if (_challengeEditingId) {
      const { error: cgErr } = await supabase.from('challenge_groups').update(data).eq('id', _challengeEditingId);
      if (cgErr) throw cgErr;
    } else {
      const { error: cgErr } = await supabase.from('challenge_groups').insert({ ...data, id: crypto.randomUUID() });
      if (cgErr) throw cgErr;
    }
    closeChallengeModal();
    renderChallengesView();
  } catch (err) {
    errorDiv.textContent = 'Error al guardar: ' + err.message;
    errorDiv.style.display = 'block';
  }
}
