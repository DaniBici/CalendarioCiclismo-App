// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Vista de corredores
// ─────────────────────────────────────────────────────────────────

import { panelRiderRowHtml } from './editor-ui.js';
import { supabase, esc } from '../shared.js';
import { isSelectionTeam } from '../services/team-roster.js';
import { activeCatalogTeams } from '../services/team-catalog.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { confirmDialog } from '../components/dialog.js';
import {
  genderToggleHtml, setGenderToggleActive, wireGenderToggle,
} from '../components/gender-toggle.js';
import {
  isValidRiderSlug, homonymIdentityKey, planRenameIdentityKeyClash,
} from '../rider-rename-logic.js';
import { riderTeamOptionLabel } from '../services/transfer-rider.js';
import { riderMatchesSearch, riderSearchLookupToken } from '../results/panel-logic.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { _slRiderFlagPreview } from './startlist-picker.js';
import { fetchTeams } from './teams.js';
import { _refreshOpenRoster } from './team-roster.js';
import { _mergeRidersSilent, openMergeRiderPicker } from './rider-merge.js';

// ═════════════════════════════════════════════════════════════════
//  VISTA DE CORREDORES
// ═════════════════════════════════════════════════════════════════

let _ridersViewReady = false;
let _ridersSearchDebounce = null;
let _ridersSearchRequest = 0;

export async function setupRidersView() {
  if (_ridersViewReady) return;
  _ridersViewReady = true;

  const input = document.getElementById('ridersSearch');
  if (!input) return;
  document.getElementById('addRiderPanelBtn')?.addEventListener('click', openNewRiderFromRiders);
  input.addEventListener('input', () => {
    clearTimeout(_ridersSearchDebounce);
    _ridersSearchDebounce = setTimeout(() => searchRidersForEditing(input.value), 280);
  });

  // El editor reutilizado muestra el equipo actual en su selector y los
  // resultados lo incluyen como contexto para distinguir homónimos.
  await fetchTeams();
}

async function searchRidersForEditing(query) {
  const results = document.getElementById('ridersSearchResults');
  if (!results) return;
  const term = (query || '').trim();
  const requestId = ++_ridersSearchRequest;
  if (term.length < 3) {
    results.innerHTML = '';
    return;
  }

  const safe = riderSearchLookupToken(term).replace(/[%,()]/g, '');
  if (safe.length < 2) {
    results.innerHTML = '';
    return;
  }

  results.innerHTML = '<div class="u-fs-085 u-c-dim">Buscando…</div>';
  const cols = 'id, firstName, lastName, otherNames, nationality, birthDate, currentTeamId, contractUntil, verified, source, identityKey';
  const filter = `identityKey.ilike.%${safe}%,lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`;

  try {
    const [menRes, womenRes] = await Promise.all([
      supabase.from('riders_men').select(cols).or(filter).order('lastName').limit(12),
      supabase.from('riders_women').select(cols).or(filter).order('lastName').limit(12),
    ]);
    if (requestId !== _ridersSearchRequest) return;
    if (menRes.error) throw menRes.error;
    if (womenRes.error) throw womenRes.error;

    const rows = [
      ...(menRes.data || []).map(r => ({ ...r, gender: 'male' })),
      ...(womenRes.data || []).map(r => ({ ...r, gender: 'female' })),
    ]
      .filter(rider => riderMatchesSearch(rider, term))
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));

    if (!rows.length) {
      results.innerHTML = '<div class="u-fs-085 u-c-dim">Sin resultados.</div>';
      return;
    }

    results.innerHTML = rows.map((rider, index) => {
      const team = rider.currentTeamId ? (panelState._teamsCache || []).find(t => t.id === rider.currentTeamId) : null;
      return panelRiderRowHtml(rider,{index,flagHtml:_slRiderFlagPreview(rider.nationality),teamName:team?.name});
    }).join('');

    results.querySelectorAll('[data-rider-index]').forEach(button => {
      button.addEventListener('click', () => {
        const rider = rows[Number(button.dataset.riderIndex)];
        if (!rider) return;
        panelState._ridersGender = rider.gender;
        panelState._onRiderSavedOnce = null;
        panelState._ridersAllCache = [rider];
        openRiderEditor(rider.id, { level: 1, loading: true });
      });
    });
  } catch (err) {
    if (requestId !== _ridersSearchRequest) return;
    console.error('[searchRidersForEditing]', err);
    results.innerHTML = `<div class="u-c-red u-fs-085">Error: ${esc(err.message || String(err))}</div>`;
  }
}

let _riderEditorLevel = 2;           // 1 = alta directa; 2 = sobre equipo/movimiento

// Cablea (una sola vez) los listeners del modal-editor de corredor. Se invoca
// perezosamente desde openRosterRiderEditor; el modal vive fuera de cualquier
// vista, así que no depende de switchTab.
// Cuerpo de la ficha de corredor dentro del drawer (mismos ids re-*; sin botón
// Cerrar propio ni título — los aporta el drawer; el cierre del backdrop también).
function riderEditorBodyHtml() {
  return `
    <div class="field u-mb-075" id="re-gender-row" style="display:none">
      <label>Sexo</label>
      ${genderToggleHtml({ idMale: 're-gender-male', idFemale: 're-gender-female', labels: { male: 'Masculino', female: 'Femenino' } })}
      <span class="u-fs-075 u-c-dim u-block u-mt-025">Decide en qué catálogo (riders_men / riders_women) se crea la ficha.</span>
    </div>
    <div class="field u-mb-075" id="re-slug-row" style="display:none">
      <label>Identificador/slug</label>
      <div class="u-row u-gap-040">
        <input type="text" id="re-slug" readonly spellcheck="false" autocomplete="off" class="u-grow">
        <button type="button" class="btn btn--ghost" id="re-slug-edit">Editar slug</button>
      </div>
      <span id="re-slug-hint" class="u-fs-075 u-c-dim u-block u-mt-025">Cambiar el slug re-vincula startlists, resultados, afiliaciones, transferencias, alias y orden de salida mediante una RPC transaccional. Solo minúsculas, dígitos y guiones.</span>
    </div>
    <div class="u-grid u-cols-2 u-gap-075">
      <div class="field">
        <label>Nombre</label>
        <input type="text" id="re-firstName" placeholder="Tadej" class="u-w-full">
      </div>
      <div class="field">
        <label>Apellido(s)</label>
        <input type="text" id="re-lastName" placeholder="Pogačar" class="u-w-full">
      </div>
      <div class="field u-span-all">
        <label>Otros nombres <span class="u-dim">— separados por coma, para matching alternativo</span></label>
        <input type="text" id="re-otherNames" placeholder="Cano, Zapater, OConnor" class="u-w-full">
        <div class="u-fs-072 u-c-dim u-mt-025">
          Usa este campo para segundos apellidos (ej: "Cano" si el corredor se llama Rodríguez Cano), variantes ortográficas o abreviaturas que puedan aparecer en startlists importadas.
        </div>
      </div>
      <div class="field">
        <label>Nacionalidad</label>
        <div class="u-row u-gap-040">
          <input type="text" id="re-nationality" placeholder="es" maxlength="5" autocomplete="off">
          <span id="re-nationality-flag" class="u-fs-140 u-minw-180 u-center"></span>
        </div>
      </div>
      <div class="field">
        <label>Fecha de nacimiento</label>
        <input type="date" id="re-birthDate" class="u-w-full">
      </div>
      <div class="field">
        <label>Equipo actual</label>
        <select id="re-teamId" class="u-w-full">
          <option value="">— Sin equipo —</option>
        </select>
      </div>
      <div class="field">
        <label>Contrato hasta <span class="u-dim">— año, vacío = desconocido</span></label>
        <input type="number" id="re-contractUntil" min="2020" max="2040" placeholder="2027" class="u-w-full">
      </div>
      <div class="field u-row u-span-all">
        <input type="checkbox" id="re-verified" class="u-w-auto u-m0">
        <label for="re-verified" class="re-verified-label">Verificado <span class="u-dim">— marca cuando los datos del corredor estén revisados y completos</span></label>
        <span id="re-source-info" class="u-ml-auto u-fs-072 u-c-dim"></span>
      </div>
    </div>
    <div class="u-row u-gap-075 u-wrap u-mt-100">
      <button class="btn btn--primary" id="saveRiderBtn">Guardar</button>
      <button class="btn btn--ghost u-c-warn" id="mergeRiderBtn" title="Fusionar este corredor con otro: las startlists del actual pasan al elegido y este se elimina." style="display:none">Fusionar con otro…</button>
      <button class="btn btn--ghost u-c-red" id="deleteRiderBtn" style="display:none">Eliminar</button>
      <span class="u-fs-080 u-c-dim" id="riderSaveStatus"></span>
    </div>
  `;
}

// Listeners de la ficha de corredor (por apertura del drawer nivel 2).
function wireRiderEditor() {
  document.getElementById('saveRiderBtn').addEventListener('click', saveRider);
  document.getElementById('deleteRiderBtn').addEventListener('click', deleteRider);
  document.getElementById('mergeRiderBtn').addEventListener('click', openMergeRiderPicker);
  document.getElementById('re-nationality').addEventListener('input', (e) => {
    const code = e.target.value.trim().toLowerCase();
    document.getElementById('re-nationality-flag').innerHTML = _slRiderFlagPreview(code);
  });
  // Selector de sexo (solo visible al CREAR): decide la tabla riders_men/women.
  wireGenderToggle('re-gender-male', 're-gender-female', (g) => {
    panelState._ridersGender = g;
    setGenderToggleActive('re-gender-male', 're-gender-female', g);
  });
  // Slug: readonly por defecto; el botón lo habilita y la validación es inline.
  const slugInput = document.getElementById('re-slug');
  const slugHint  = document.getElementById('re-slug-hint');
  const slugHintOk = slugHint.textContent;
  document.getElementById('re-slug-edit').addEventListener('click', () => {
    slugInput.readOnly = false;
    document.getElementById('re-slug-edit').style.display = 'none';
    slugInput.focus();
  });
  slugInput.addEventListener('input', () => {
    const value = slugInput.value.trim();
    if (!value || isValidRiderSlug(value)) {
      slugHint.textContent = slugHintOk;
      slugHint.style.color = '';
    } else {
      slugHint.textContent = 'Slug inválido: solo minúsculas, dígitos y guiones (^[a-z0-9-]+$).';
      slugHint.style.color = 'var(--red)';
    }
  });
}

// El equipo actual admite equipos regulares; las selecciones solo convocan
// corredores en startlists. Se conserva la búsqueda entre géneros.
function _populateRiderEditorTeams() {
  const sel = document.getElementById('re-teamId');
  if (!sel) return;
  const prev = sel.value;
  const allTeamsSorted = activeCatalogTeams(panelState._teamsCache)
    .filter(t => !t.specialEdition && !isSelectionTeam(t))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  sel.innerHTML = '<option value="">— Sin equipo —</option>' + allTeamsSorted.map(t =>
    `<option value="${esc(t.id)}" ${prev === t.id ? 'selected' : ''}>${esc(riderTeamOptionLabel(t))}</option>`
  ).join('');
}

export function openRiderEditor(riderId, { level = _riderEditorLevel, loading = false } = {}) {
  _riderEditorLevel = level;
  panelState._editingRiderId = riderId;
  const rider = riderId ? panelState._ridersAllCache.find(r => r.id === riderId) : null;

  const renderEditor = (body) => {
    body.innerHTML = riderEditorBodyHtml();
    wireRiderEditor();

    document.getElementById('deleteRiderBtn').style.display = rider ? '' : 'none';
    document.getElementById('mergeRiderBtn').style.display  = rider ? '' : 'none';
    document.getElementById('riderSaveStatus').textContent  = '';

    // Selector de sexo: solo al CREAR una ficha (al editar, el género lo fija la
    // tabla de la que vino y NO se cambia aquí). Refleja _ridersGender, que el
    // llamador ya prefijó (p. ej. por el equipo de origen del movimiento).
    const genderRow = document.getElementById('re-gender-row');
    if (genderRow) genderRow.style.display = rider ? 'none' : '';
    if (!rider) setGenderToggleActive('re-gender-male', 're-gender-female', panelState._ridersGender);

    // Slug: solo al EDITAR; vuelve a readonly y al id actual en cada apertura
    // (el cuerpo se re-renderiza, así que el aviso inline también se restablece).
    const slugRow = document.getElementById('re-slug-row');
    if (slugRow) slugRow.style.display = rider ? '' : 'none';
    document.getElementById('re-slug').value = rider?.id || '';
    document.getElementById('re-slug').readOnly = true;
    document.getElementById('re-slug-edit').style.display = '';

    // Rellenar el desplegable de equipos ANTES de fijar re-teamId.value (necesita
    // que exista la <option> correspondiente).
    _populateRiderEditorTeams();

    document.getElementById('re-firstName').value   = rider?.firstName   || '';
    document.getElementById('re-lastName').value    = rider?.lastName    || '';
    document.getElementById('re-otherNames').value  = rider?.otherNames  || '';
    document.getElementById('re-nationality').value = rider?.nationality || '';
    document.getElementById('re-nationality-flag').innerHTML = _slRiderFlagPreview(rider?.nationality || '');
    document.getElementById('re-birthDate').value   = rider?.birthDate   || '';
    document.getElementById('re-teamId').value      = rider?.currentTeamId || '';
    document.getElementById('re-contractUntil').value = rider?.contractUntil || '';
    // Verificación: nuevos riders parten como verified=true (los crea el admin).
    // Editando un existente: muestra su estado real.
    document.getElementById('re-verified').checked  = rider ? (rider.verified !== false) : true;
    const srcInfo = document.getElementById('re-source-info');
    if (rider && rider.source) srcInfo.textContent = `origen: ${rider.source}`;
    else srcInfo.textContent = '';
  };

  // El alta directa usa el nivel 1; desde un equipo o movimiento se apila en el 2.
  openDrawer({
    title: rider ? 'Editar corredor' : 'Nuevo corredor',
    level,
    render: (body) => {
      if (!loading) {
        renderEditor(body);
        return;
      }
      body.innerHTML = '<div class="u-fs-085 u-c-dim">Cargando corredor…</div>';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (body.isConnected) renderEditor(body);
      }));
    },
  });
}

export function closeRiderEditor() {
  panelState._editingRiderId = null;
  closeDrawer(_riderEditorLevel);
}

// Alta independiente desde la cabecera de Corredores. El editor estándar ya
// incluye sexo y equipo actual, por lo que no necesita una plantilla abierta.
function openNewRiderFromRiders() {
  panelState._ridersGender = 'male';
  panelState._onRiderSavedOnce = null;
  panelState._ridersAllCache = [];
  openRiderEditor(null, { level: 1 });
}

async function saveRider() {
  const status    = document.getElementById('riderSaveStatus');
  const firstName = document.getElementById('re-firstName').value.trim();
  const lastName  = document.getElementById('re-lastName').value.trim();
  if (!firstName || !lastName) { status.textContent = 'Faltan nombre y/o apellido.'; return; }

  // Invariante del renombrado: el update NUNCA incluye el id; el slug original se
  // captura aquí y el id solo cambia vía admin_rename_rider (RPC transaccional).
  const originalId = panelState._editingRiderId;
  let newSlug = originalId;
  if (originalId) {
    newSlug = document.getElementById('re-slug').value.trim() || originalId;
    if (newSlug !== originalId && !isValidRiderSlug(newSlug)) {
      status.textContent = 'Slug inválido: solo minúsculas, dígitos y guiones.';
      return;
    }
  }

  status.textContent = 'Guardando…';
  const table = panelState._ridersGender === 'male' ? 'riders_men' : 'riders_women';

  const payload = {
    firstName,
    lastName,
    otherNames:    document.getElementById('re-otherNames').value.trim()  || null,
    nationality:   document.getElementById('re-nationality').value.trim().toLowerCase() || null,
    birthDate:     document.getElementById('re-birthDate').value || null,
    currentTeamId: document.getElementById('re-teamId').value   || null,
    contractUntil: parseInt(document.getElementById('re-contractUntil').value, 10) || null,
    verified:      document.getElementById('re-verified').checked,
    updatedAt:     new Date().toISOString(),
  };

  try {
    if (panelState._editingRiderId) {
      const { error } = await supabase.from(table).update(payload).eq('id', panelState._editingRiderId);
      if (error) {
        // Renombrar una ficha existente puede chocar con OTRA que ya tiene ese
        // mismo "DNI" (identityKey) — típicamente un duplicado huérfano creado por
        // un volcado con el nombre largo. En vez de dejar al admin en un callejón
        // sin salida con el error crudo, ofrecemos fusionar la otra ficha en ESTA
        // (la que se edita, que es la buena) y reintentar el rename.
        if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
          const merged = await _handleRenameIdentityKeyClash(table, firstName, lastName, payload, status);
          if (!merged) return; // el admin canceló o no se pudo: status ya informado
          // _mergeRidersSilent acumuló los otherNames del perdedor en la ficha
          // (matching futuro). Releer ese valor consolidado para no pisarlo con el
          // del input al reintentar el update.
          const { data: tgtNow } = await supabase.from(table)
            .select('otherNames').eq('id', panelState._editingRiderId).maybeSingle();
          if (tgtNow && tgtNow.otherNames) payload.otherNames = tgtNow.otherNames;
          // Reintentar el update tras consolidar el duplicado (o declarar homónimo).
          const { error: retryErr } = await supabase.from(table).update(payload).eq('id', panelState._editingRiderId);
          if (retryErr) throw retryErr;
        } else {
          throw error;
        }
      }

      // Renombrado de slug: el update anterior conservó el id; el cambio de slug
      // va por la RPC, que re-vincula startlists, resultados, afiliaciones,
      // transferencias, alias y orden de salida en una transacción.
      let currentId = panelState._editingRiderId;
      let renameError = null;
      if (newSlug !== currentId) {
        try {
          const { data: renameCounts, error: rpcErr } = await supabase.rpc('admin_rename_rider', {
            p_gender: panelState._ridersGender, p_old_id: currentId, p_new_id: newSlug,
          });
          if (rpcErr) throw rpcErr;
          currentId = newSlug;
          panelState._editingRiderId = newSlug;
          panelState._ridersAllCache = panelState._ridersAllCache.map(r => r.id === originalId ? { ...r, id: newSlug } : r);
          const c = renameCounts || {};
          showToast(`Slug renombrado: ${c.startlist_riders ?? 0} startlists, ${c.race_uci_results ?? 0} resultados, ${c.rider_team_affiliations ?? 0} afiliaciones, ${c.rider_transfers ?? 0} transferencias, ${c.rider_identity_aliases ?? 0} alias, ${c.start_order_entries ?? 0} órdenes de salida`, 'success', 6000);
        } catch (e) {
          console.error('[saveRider] rename falló', e);
          renameError = e.message || String(e);
        }
      }

      // P4: propagar a snapshots de startlist_riders para que las apps que
      // todavía leen la tabla original (no la vista resuelta) vean el nombre
      // canónico actualizado. countryCode NO se propaga porque suele ser un
      // override de selección nacional en la startlist (Mundial, JJOO).
      // Se hace con el id vigente: la RPC ya re-puntó globalRiderId al nuevo.
      try {
        const { error: propErr } = await supabase
          .from('startlist_riders')
          .update({ firstName, lastName })
          .eq('globalRiderId', currentId);
        if (propErr) console.warn('[saveRider] snapshot propagation failed', propErr);
      } catch (e) {
        console.warn('[saveRider] snapshot propagation error', e);
      }

      await _refreshOpenRoster();
      if (renameError) {
        // El resto de campos ya está guardado: no se rompe el flujo, pero el
        // slug queda como estaba y el error se muestra en el status.
        status.textContent = 'Error: ' + renameError;
      } else {
        status.textContent = 'Guardado.';
        showToast('Corredor guardado', 'success');
      }
    } else {
      // Generar ID slug con el plegado CANÓNICO (fold_name SQL, igual que el
      // catálogo y resolve_riders) en vez del NFD+strip de JS que corrompe ø/ł/ß.
      const slugFromFold = async s => {
        const { data } = await supabase.rpc('fold_name_rpc', { p_text: s });
        return (data || '').replace(/ /g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      };
      const baseSlug = `${await slugFromFold(lastName)}-${await slugFromFold(firstName)}`.replace(/^-|-$/g, '') || 'rider';
      let id = baseSlug;
      // Resolver colisión del id: sufijo de año de nacimiento o numérico. El id es único
      // entre riders_men y riders_women (guarda a01_rider_id_unique_across_genders).
      const existing = await Promise.all(['riders_men', 'riders_women']
        .map(t => supabase.from(t).select('id').eq('id', id)));
      if (existing.some(r => r.data?.length)) {
        const year = payload.birthDate ? payload.birthDate.slice(0,4) : Date.now().toString().slice(-4);
        id = `${id}-${year}`;
      }
      panelState._editingRiderId = id;
      const { error } = await supabase.from(table).insert({ id, ...payload, source: 'manual', verified: true });
      if (error) {
        // El índice UNIQUE de identityKey rechaza una ficha cuyo "DNI" ya existe.
        // En vez de dejar al admin en un callejón sin salida, buscamos la(s)
        // ficha(s) que chocan y le ofrecemos editarla o crear un homónimo.
        if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
          panelState._editingRiderId = null;
          await _handleIdentityKeyClash(table, firstName, lastName, payload, status);
          return;
        }
        throw error;
      }
      document.getElementById('deleteRiderBtn').style.display = '';
      document.getElementById('mergeRiderBtn').style.display = '';
      const drawer2Title = document.getElementById('ccDrawer2Title');
      if (drawer2Title) drawer2Title.textContent = 'Editar corredor';
      await _refreshOpenRoster();
      status.textContent = 'Guardado.';
      showToast('Corredor guardado', 'success');
    }

    // Ficha creada desde el editor de un movimiento del mercado: seleccionarla
    // ahí y cerrar este drawer, para no obligar a volver a buscarla.
    if (panelState._onRiderSavedOnce) {
      const cb = panelState._onRiderSavedOnce;
      panelState._onRiderSavedOnce = null;
      cb({ id: panelState._editingRiderId, gender: panelState._ridersGender, ...payload });
    }
  } catch (err) {
    console.error('[saveRider]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}

// Reconstruye el identityKey igual que compute_identity_key (migración 075):
// fold_name(first+' '+last) -> split por espacio -> dedup -> orden alfabético ->
// join('-'). Usa fold_name_rpc para que el plegado sea idéntico al de la BD.
async function _computeIdentityKeyClient(firstName, lastName) {
  const { data } = await supabase.rpc('fold_name_rpc', { p_text: `${firstName || ''} ${lastName || ''}` });
  const folded = (data || '').trim();
  if (!folded) return null;
  const tokens = [...new Set(folded.split(/\s+/).filter(Boolean))].sort();
  return tokens.join('-') || null;
}

// Un INSERT de corredor chocó con el índice UNIQUE de identityKey. Buscamos la(s)
// ficha(s) existentes con ese DNI y damos salida al admin: editar la que ya existe
// (el caso normal: "ya está, no lo dupliques") o, si de verdad es otra persona,
// crear un homónimo con sufijo de año (requiere fecha de nacimiento, como hace el
// desambiguador del catálogo).
async function _handleIdentityKeyClash(table, firstName, lastName, payload, status) {
  status.textContent = 'Ese nombre ya existe (mismo DNI). Buscando la ficha…';
  const ikey = await _computeIdentityKeyClient(firstName, lastName);
  let matches = [];
  if (ikey) {
    const { data } = await supabase.from(table).select('*').eq('identityKey', ikey);
    matches = data || [];
  }
  // Fallback: si por lo que sea el identityKey reconstruido no casa, buscar por
  // nombre+apellido exactos (defensivo; no debería hacer falta).
  if (!matches.length) {
    const { data } = await supabase.from(table)
      .select('*').ilike('firstName', firstName).ilike('lastName', lastName);
    matches = data || [];
  }

  if (!matches.length) {
    status.textContent = 'Ya existe un corredor con ese DNI pero no se pudo localizar. Búscalo en la lista y edítalo.';
    return;
  }

  const m = matches[0];
  const dob = m.birthDate ? ` · ${m.birthDate}` : ' · sin fecha';
  const team = (panelState._teamsCache || []).find(t => t.id === m.currentTeamId);
  const teamStr = team ? ` · ${team.name}` : '';
  const hasBirth = !!payload.birthDate;

  // Diálogo de decisión. Ofrecer crear homónimo SOLO si la ficha nueva trae fecha
  // (sin fecha no se puede desambiguar de forma estable → se bloquea).
  const ok = await confirmDialog(
    `Ya existe "${m.firstName} ${m.lastName}"${dob}${teamStr} (id: ${m.id}).\n\n` +
    `Lo más probable es que sea la MISMA persona.\n\n` +
    `• Aceptar → abrir esa ficha para editarla (recomendado).\n` +
    `• Cancelar → no hacer nada (si de verdad es otra persona distinta` +
    (hasBirth ? `, usa el botón de abajo para crear un homónimo con año).` : ` necesitas ponerle fecha de nacimiento para poder distinguirla).`),
    { title: 'Posible duplicado', confirmText: 'Abrir ficha existente' }
  );

  if (ok) {
    // Cargar la ficha existente en la caché del editor para que openRiderEditor
    // la encuentre (el modal lee de _ridersAllCache).
    panelState._ridersAllCache = [m];
    openRiderEditor(m.id);
    status.textContent = `Editando la ficha existente de ${m.firstName} ${m.lastName}.`;
    showToast('Abierta la ficha existente', 'success');
    return;
  }

  // El admin dice que es otra persona. Crear homónimo con sufijo de año, replicando
  // el desempate del catálogo (id y identityKey con '-<año>'). Solo con fecha.
  if (hasBirth) {
    const wantHomonym = await confirmDialog(
      `¿Crear "${firstName} ${lastName}" como persona DISTINTA (homónimo)?\n\n` +
      `Se le añadirá el año de nacimiento (${payload.birthDate.slice(0,4)}) para distinguirla.`,
      { confirmText: 'Crear homónimo' }
    );
    if (wantHomonym) {
      const year = payload.birthDate.slice(0, 4);
      const baseSlug = (await _computeIdentityKeyClient(firstName, lastName)) || 'rider';
      // id e identityKey sufijados con el año (el trigger respeta una clave ya
      // sufijada por el año propio = homónimo declarado, ver migración 075).
      const homId  = `${baseSlug}-${year}`;
      const homKey = `${baseSlug}-${year}`;
      const { error: insErr } = await supabase.from(table).insert({
        id: homId, identityKey: homKey, ...payload,
        source: 'manual', verified: true,
      });
      if (insErr) {
        status.textContent = 'No se pudo crear el homónimo: ' + insErr.message;
        return;
      }
      panelState._editingRiderId = homId;
      // Sembrar la caché del editor con la ficha recién creada para reabrirla.
      panelState._ridersAllCache = [{ id: homId, identityKey: homKey, ...payload, source: 'manual', verified: true }];
      await _refreshOpenRoster();
      openRiderEditor(homId);
      status.textContent = `Creado como homónimo (${homId}).`;
      showToast('Homónimo creado', 'success');
      return;
    }
  }
  status.textContent = 'Cancelado. No se creó ninguna ficha.';
}

// Renombrar la ficha que se está editando (_editingRiderId) chocó con el índice
// UNIQUE de identityKey: ya existe OTRA ficha con ese mismo DNI. La ficha que se
// edita es la buena (verificada por el admin); la otra suele ser un duplicado
// huérfano. Salidas: si es la MISMA persona, fusionar la OTRA ficha en ESTA
// (traspasa sus startlists/afiliaciones aquí, deja un alias del DNI viejo para
// que no se re-cree, y la borra); si son personas DISTINTAS, declarar homónimo
// (identityKey = base-añoPropio, que el trigger 075 respeta) y reintentar.
// Devuelve true para que saveRider() reintente el rename; false si el admin
// cancela o no se pudo (status ya informado).
async function _handleRenameIdentityKeyClash(table, firstName, lastName, payload, status) {
  status.textContent = 'Ese nombre ya existe (mismo DNI). Buscando la ficha que choca…';
  const ikey = await _computeIdentityKeyClient(firstName, lastName);
  let matches = [];
  if (ikey) {
    const { data } = await supabase.from(table).select('*')
      .eq('identityKey', ikey).neq('id', panelState._editingRiderId);
    matches = data || [];
  }
  if (!matches.length) {
    status.textContent =
      'Otra ficha tiene ese DNI pero no se pudo localizar. Búscala en el catálogo y fusiónala a mano.';
    return false;
  }

  const other = matches[0];
  const dob = other.birthDate ? ` · ${other.birthDate}` : ' · sin fecha';
  const team = (panelState._teamsCache || []).find(t => t.id === other.currentTeamId);
  const teamStr = team ? ` · ${team.name}` : '';

  const ok = await confirmDialog(
    `Al renombrar a "${firstName} ${lastName}" choca con una ficha que ya existe ` +
    `con ese mismo DNI:\n\n` +
    `   "${other.firstName} ${other.lastName}"${dob}${teamStr} (id: ${other.id})\n\n` +
    `Si es la MISMA persona:\n` +
    `• Aceptar → fusionar esa ficha EN ESTA (sus startlists y afiliaciones pasan ` +
    `a la que estás editando; la duplicada se elimina) y aplicar el cambio de nombre.\n` +
    `• Cancelar → pasar a la opción de homónimo o no hacer nada.`,
    { title: 'Duplicado al renombrar', confirmText: 'Fusionar y renombrar' }
  );

  if (ok) {
    status.textContent = 'Fusionando el duplicado…';
    // La ficha editada es el superviviente; la otra (other) es el perdedor.
    const target = { id: panelState._editingRiderId, firstName, lastName, otherNames: payload.otherNames };
    const { ok: mergedOk, error: mergeErr } = await _mergeRidersSilent(other, target, table);
    if (!mergedOk) {
      status.textContent = 'No se pudo fusionar el duplicado: ' + (mergeErr || 'error');
      return false;
    }

    // Alias del DNI del perdedor → superviviente, para que un volcado futuro por el
    // nombre largo no vuelva a crear el duplicado (red de seguridad, como en el saneo).
    try {
      const gender = table === 'riders_men' ? 'male' : 'female';
      await supabase.from('rider_identity_aliases').insert({
        aliasKey: other.identityKey,
        gender,
        riderId: panelState._editingRiderId,
        note: `dup fusionado al renombrar a ${firstName} ${lastName}`,
      });
    } catch (e) {
      console.warn('[rename clash] no se pudo crear alias:', e);
    }

    return true;
  }

  // Son personas distintas: declarar homónimo. La clave candidata es base + año
  // PROPIO (el trigger 075 respeta una identityKey ya sufijada por el año de la
  // propia ficha). Se comprueba con un SELECT que esté libre antes de fijarla.
  const wantHomonym = await confirmDialog(
    `¿"${firstName} ${lastName}" y la ficha que choca son personas DISTINTAS?\n\n` +
    `Se declarará homónimo: la clave de identidad incluirá el año de nacimiento propio` +
    (payload.birthDate ? ` (${payload.birthDate.slice(0,4)})` : '') +
    `, igual que hace el desambiguador del catálogo.`,
    { title: 'Son personas distintas', confirmText: 'Declarar homónimo' }
  );
  if (!wantHomonym) {
    status.textContent = 'Cancelado. No se aplicó el cambio de nombre.';
    return false;
  }

  status.textContent = 'Comprobando la clave de homónimo…';
  const homKey = homonymIdentityKey(ikey, payload.birthDate);
  let homonymTaken = false;
  if (homKey) {
    const { data: takenRows } = await supabase.from(table).select('id')
      .eq('identityKey', homKey).neq('id', panelState._editingRiderId);
    homonymTaken = !!(takenRows && takenRows.length);
  }
  const plan = planRenameIdentityKeyClash({
    samePerson: false,
    baseIdentityKey: ikey,
    birthDate: payload.birthDate,
    homonymTaken,
  });
  if (plan.action !== 'homonym') {
    status.textContent = 'No se pudo declarar el homónimo: ' + plan.reason;
    return false;
  }
  payload.identityKey = plan.identityKey;
  status.textContent = `Reintentando el guardado como homónimo (${plan.identityKey})…`;
  return true;
}

async function deleteRider() {
  if (!panelState._editingRiderId) return;
  const rider = panelState._ridersAllCache.find(r => r.id === panelState._editingRiderId);
  const name  = rider ? `${rider.firstName} ${rider.lastName}` : panelState._editingRiderId;

  // Avisar si tiene startlists enlazadas: al borrarlo quedarían apuntando a un
  // globalRiderId huérfano (página /rider/<id> no existiría). Limpiamos esos
  // links antes de borrar para que las apps vuelvan al snapshot.
  const { count: linkedCount } = await supabase
    .from('startlist_riders')
    .select('id', { count: 'exact', head: true })
    .eq('globalRiderId', panelState._editingRiderId);
  const linkedMsg = linkedCount ? ` Aparece en ${linkedCount} startlist(s); sus filas perderán el link a BD (el snapshot del nombre se conserva).` : '';
  if (!await confirmDialog(`¿Eliminar a ${name}?${linkedMsg}`, { danger: true })) return;

  const status = document.getElementById('riderSaveStatus');
  status.textContent = 'Eliminando…';
  const table = panelState._ridersGender === 'male' ? 'riders_men' : 'riders_women';
  try {
    if (linkedCount) {
      const { error: unlinkErr } = await supabase
        .from('startlist_riders').update({ globalRiderId: null }).eq('globalRiderId', panelState._editingRiderId);
      if (unlinkErr) throw new Error('Limpiando links: ' + unlinkErr.message);
    }
    const { error } = await supabase.from(table).delete().eq('id', panelState._editingRiderId);
    if (error) throw error;
    closeRiderEditor();
    await _refreshOpenRoster();
    showToast('Corredor eliminado', 'success');
  } catch (err) {
    console.error('[deleteRider]', err);
    status.textContent = 'Error: ' + (err.message || err);
  }
}
