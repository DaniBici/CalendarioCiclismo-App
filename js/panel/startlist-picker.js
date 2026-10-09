// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Inscritos: picker manual de corredores y fila de equipo
// ─────────────────────────────────────────────────────────────────

import {
  supabase, countryFlag, esc, normalizeTeamName, isNoTeamPlaceholderTeam,
} from '../shared.js';
import { confirmDialog } from '../components/dialog.js';
import { riderMatchesSearch, riderSearchTokens, withRiderSearch } from '../results/panel-logic.js';
import { teamStripes } from '../team-appearance.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { _slRefreshRiderMatchBtn } from './startlists.js';
import { _mergeRidersSilent } from './rider-merge.js';

// ── Picker manual de match contra la BD ─────────────────────────────
let _slMatchPickerEl = null;

function _slCloseMatchPicker() {
  if (_slMatchPickerEl) { _slMatchPickerEl.remove(); _slMatchPickerEl = null; }
  document.removeEventListener('mousedown', _slOutsideMatchPickerClick, true);
}

function _slOutsideMatchPickerClick(e) {
  if (!_slMatchPickerEl) return;
  if (_slMatchPickerEl.contains(e.target)) return;
  if (e.target.closest('.sl-rider-match-btn')) return;
  _slCloseMatchPicker();
}

export async function _slOpenRiderMatchPicker(riderEl) {
  _slCloseMatchPicker();

  const race = panelState.allRaces.find(r => r.id === panelState._editingRaceId);
  const raceGender = race?.gender;
  const ridersTable = raceGender === 'female' ? 'riders_women' : raceGender === 'male' ? 'riders_men' : null;
  if (!ridersTable) { showToast('La carrera no tiene género definido', 'error'); return; }

  const currentLast = (riderEl.querySelector('.sl-lastname').value || '').trim();
  const currentId   = riderEl.dataset.globalRiderId || null;

  const popover = document.createElement('div');
  popover.className = 'panel-popover sl-picker-popover';
  popover.innerHTML = `
    ${currentId ? `
      <div class="u-fs-1 u-c-dim u-mb-030">Match actual: <code class="u-c-text">${esc(currentId)}</code></div>
      <div class="sl-picker-edit-current sl-picker-box">
        <div class="sl-picker-heading">Editar este rider en BD</div>
        <div class="sl-picker-fields">
          <input type="text" class="sl-edit-last sl-picker-field sl-picker-field--last" placeholder="Apellidos">
          <input type="text" class="sl-edit-first sl-picker-field sl-picker-field--first" placeholder="Nombre">
          <input type="text" class="sl-edit-nat sl-picker-field sl-picker-field--nat" placeholder="es" maxlength="5">
          <span class="sl-edit-flag sl-picker-flag"></span>
        </div>
        <input type="text" class="sl-edit-other sl-picker-field sl-picker-field--wide u-mt-030" placeholder="otherNames (aliases separados por coma)">
        <input type="date" class="sl-edit-birth sl-picker-field sl-picker-field--wide u-mt-030" title="Fecha de nacimiento">
        <div class="u-between u-mt-040 u-gap-030">
          <button data-action="delete-current" type="button" class="btn btn--ghost btn--xs u-c-red" title="Eliminar este rider de la BD (desliga primero las startlists afectadas)">Eliminar de BD</button>
          <button data-action="save-current" type="button" class="btn btn--primary u-py-025 u-px-055 u-fs-1" disabled style="opacity:0.45">Guardar</button>
        </div>
        <div class="sl-picker-dups u-mt-050" style="display:none">
          <div class="sl-picker-heading u-fs-1 u-mb-025">Posibles duplicados en BD</div>
          <div class="sl-picker-dups-list u-stack u-stack--xs"></div>
        </div>
      </div>
    ` : `
      <div class="u-fs-1 u-c-dim u-mb-040">Sin match en BD.</div>
      <div class="sl-picker-create-new sl-picker-box">
        <div class="sl-picker-heading">Crear nuevo rider en BD</div>
        <div class="sl-picker-fields u-mb-030">
          <input type="text" class="sl-new-last sl-picker-field sl-picker-field--last" placeholder="Apellidos">
          <input type="text" class="sl-new-first sl-picker-field sl-picker-field--first" placeholder="Nombre">
          <input type="text" class="sl-new-nat sl-picker-field sl-picker-field--nat" placeholder="es" maxlength="5">
          <span class="sl-new-flag sl-picker-flag"></span>
        </div>
        <input type="text" class="sl-new-other sl-picker-field sl-picker-field--wide u-mb-030" placeholder="otherNames (opcional): aliases separados por coma">
        <input type="date" class="sl-new-birth sl-picker-field sl-picker-field--wide u-mb-040" title="Fecha de nacimiento verificada (obligatoria)">
        <div class="u-flex u-justify-end">
          <button data-action="create-new" type="button" class="btn btn--primary u-py-025 u-px-060 u-fs-1">Preparar alta</button>
        </div>
      </div>
    `}
    <div class="sl-picker-heading u-mb-025">${currentId ? 'O buscar otro' : 'O buscar match existente'}</div>
    <input type="search" class="sl-picker-input" placeholder="Apellido, nombre u otherNames…">
    <div class="sl-picker-results"></div>
    <div class="panel-popover-footer">
      ${currentId
        ? '<button data-action="unlink" type="button" class="btn btn--ghost u-btn-sm u-fs-1 u-c-dim">Desligar (sin borrar)</button>'
        : '<span></span>'}
      <button data-action="close" type="button" class="btn btn--ghost u-btn-sm u-fs-1">Cerrar</button>
    </div>`;

  document.body.appendChild(popover);
  _slMatchPickerEl = popover;

  const input = popover.querySelector('.sl-picker-input');
  const results = popover.querySelector('.sl-picker-results');
  let reqId = 0;

  const search = async () => {
    const q = input.value.trim();
    const myId = ++reqId;
    if (q.length < 2) {
      results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Escribe al menos 2 letras.</div>';
      return;
    }
    results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Buscando…</div>';
    const tokens = riderSearchTokens(q);
    if (!tokens.length) { results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Sin resultados.</div>'; return; }
    const { data, error } = await withRiderSearch(supabase.from(ridersTable).select('id,firstName,lastName,otherNames,nationality,currentTeamId,verified,source,identityKey'), tokens)
      .order('lastName').limit(25);
    if (myId !== reqId) return;
    if (error) { results.innerHTML = `<div class="u-c-red u-fs-1 u-p-030">Error: ${esc(error.message)}</div>`; return; }
    const matchingData = (data || []).filter((rider) => riderMatchesSearch(rider, q));
    if (!matchingData.length) {
      results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Sin resultados.</div>';
      return;
    }
    results.innerHTML = matchingData.map(rd => `
      <div data-rid="${esc(rd.id)}" class="sl-match-row${rd.id === currentId ? ' sl-match-row--current' : ''}">
        <div data-pick="${esc(rd.id)}" role="button" tabindex="0" class="sl-match-pick">
          ${_slRiderFlagPreview(rd.nationality)}
          <span class="u-grow u-min0 u-clip u-ellipsis"><strong>${esc(rd.lastName)}</strong>, ${esc(rd.firstName)}${rd.otherNames ? ` <span class="u-c-dim u-fs-1">(${esc(rd.otherNames)})</span>` : ''}</span>
          ${rd.verified === false ? '<span title="Sin verificar" class="sl-verify-mark u-c-warn">?</span>' : ''}
        </div>
        ${currentId ? `<button type="button" data-action="merge-into" data-rid="${esc(rd.id)}" title="Fusionar este corredor en el match actual (mueve sus startlists y lo elimina)" class="sl-mini-action sl-mini-action--merge u-py-015 u-px-035 u-fs-1">🔀</button>` : ''}
        <button type="button" data-action="delete-result" data-rid="${esc(rd.id)}" title="Eliminar este corredor de la BD" class="sl-mini-action sl-mini-action--delete u-py-010 u-px-035 u-fs-1">🗑</button>
      </div>`).join('');
    // Click sobre la zona de info → selección como match.
    results.querySelectorAll('[data-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rider = matchingData.find(x => x.id === btn.dataset.pick);
        if (!rider) return;
        riderEl.dataset.globalRiderId = rider.id;
        riderEl.querySelector('.sl-firstname').value = rider.firstName;
        riderEl.querySelector('.sl-lastname').value  = rider.lastName;
        const country = riderEl.querySelector('.sl-country');
        const flagEl  = riderEl.querySelector('.sl-flag-preview');
        if (rider.nationality && country.value.trim().toLowerCase() !== rider.nationality.toLowerCase()) {
          country.value = rider.nationality;
          if (flagEl) flagEl.innerHTML = _slRiderFlagPreview(rider.nationality);
        }
        _slRefreshRiderMatchBtn(riderEl, rider);
        const sugg = riderEl.querySelector('.sl-rider-suggestion');
        if (sugg) { sugg.style.display = 'none'; sugg.dataset.dismissed = '1'; }
        _slCloseMatchPicker();
        showToast(`Match: ${rider.firstName} ${rider.lastName}`, 'success');
      });
    });
    // 🔀 Fusionar este resultado en el currentId (solo si hay currentId).
    results.querySelectorAll('[data-action="merge-into"]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const src = data.find(x => x.id === btn.dataset.rid);
        if (!src || !currentId) return;
        const { count: linkedCount } = await supabase.from('startlist_riders')
          .select('id', { count: 'exact', head: true }).eq('globalRiderId', src.id);
        if (!await confirmDialog(`Mover ${linkedCount || 0} startlist(s) de "${src.lastName}, ${src.firstName}" → match actual y eliminar el duplicado.\n\n¿Continuar?`, { danger: true })) return;
        btn.disabled = true; btn.textContent = '…';
        // Reconstruimos target con datos mínimos para acumular otherNames.
        const target = { id: currentId, firstName: '', lastName: '', otherNames: '' };
        const { ok, error } = await _mergeRidersSilent(src, target, ridersTable);
        if (!ok) { btn.disabled = false; btn.textContent = '🔀'; showToast('Error: ' + error, 'error'); return; }
        btn.closest('[data-rid]').remove();
        showToast(`Fusionado: ${linkedCount || 0} startlist(s) movidas`, 'success');
      });
    });
    // 🗑 Borrar este resultado de la BD (desliga sus startlists primero).
    results.querySelectorAll('[data-action="delete-result"]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const rd = data.find(x => x.id === btn.dataset.rid);
        if (!rd) return;
        const { count: linkedCount } = await supabase.from('startlist_riders')
          .select('id', { count: 'exact', head: true }).eq('globalRiderId', rd.id);
        if (!await confirmDialog(`Eliminar "${rd.lastName}, ${rd.firstName}" de la BD.\n\n${linkedCount || 0} startlist(s) perderán el match (snapshot se conserva).\n\n¿Continuar?`, { danger: true })) return;
        btn.disabled = true; btn.textContent = '…';
        if (linkedCount) {
          await supabase.from('startlist_riders').update({ globalRiderId: null }).eq('globalRiderId', rd.id);
        }
        const { error: delErr } = await supabase.from(ridersTable).delete().eq('id', rd.id);
        if (delErr) { btn.disabled = false; btn.textContent = '🗑'; showToast('Error: ' + delErr.message, 'error'); return; }
        btn.closest('[data-rid]').remove();
        showToast(`Eliminado. ${linkedCount || 0} startlist(s) desligadas.`, 'success');
      });
    });
  };

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') _slCloseMatchPicker(); });

  popover.querySelector('[data-action="unlink"]')?.addEventListener('click', () => {
    delete riderEl.dataset.globalRiderId;
    _slRefreshRiderMatchBtn(riderEl);
    _slCloseMatchPicker();
    showToast('Match eliminado', 'success');
  });
  popover.querySelector('[data-action="close"]').addEventListener('click', _slCloseMatchPicker);

  // ── Crear nuevo rider en BD (solo si NO hay match) ────────────────
  if (!currentId) {
    const newLast  = popover.querySelector('.sl-new-last');
    const newFirst = popover.querySelector('.sl-new-first');
    const newNat   = popover.querySelector('.sl-new-nat');
    const newFlag  = popover.querySelector('.sl-new-flag');
    const newOther = popover.querySelector('.sl-new-other');
    const newBirth = popover.querySelector('.sl-new-birth');
    const createBtn = popover.querySelector('[data-action="create-new"]');

    // Precargar desde la fila del editor de inscritos.
    newLast.value  = (riderEl.querySelector('.sl-lastname').value  || '').trim();
    newFirst.value = (riderEl.querySelector('.sl-firstname').value || '').trim();
    const slCountry = (riderEl.querySelector('.sl-country')?.value || '').trim().toLowerCase();
    newNat.value   = slCountry;
    newFlag.innerHTML = _slRiderFlagPreview(slCountry);
    newNat.addEventListener('input', () => {
      newFlag.innerHTML = _slRiderFlagPreview(newNat.value.trim().toLowerCase());
    });

    newBirth.value = riderEl.dataset.birthDate || '';
    newOther.value = riderEl.dataset.otherNames || '';
    createBtn.addEventListener('click', () => {
      const last = newLast.value.trim();
      const first = newFirst.value.trim();
      const nat = newNat.value.trim().toLowerCase();
      const birth = newBirth.value;
      if (!last || !first || !/^[a-z]{2}$/.test(nat) || !birth) {
        showToast('Completa nombre, apellidos, nacionalidad y fecha de nacimiento verificada.', 'error');
        return;
      }
      riderEl.dataset.birthDate = birth;
      riderEl.dataset.otherNames = newOther.value.trim();
      riderEl.querySelector('.sl-firstname').value = first;
      riderEl.querySelector('.sl-lastname').value = last;
      riderEl.querySelector('.sl-country').value = nat;
      riderEl.querySelector('.sl-flag-preview').innerHTML = _slRiderFlagPreview(nat);
      _slRefreshRiderMatchBtn(riderEl);
      _slCloseMatchPicker();
      showToast('Alta preparada. Se creará al guardar la lista.', 'success');
    });
  }

  // ── Editor inline del rider matcheado (solo si hay match) ─────────
  if (currentId) {
    const editLast  = popover.querySelector('.sl-edit-last');
    const editFirst = popover.querySelector('.sl-edit-first');
    const editNat   = popover.querySelector('.sl-edit-nat');
    const editFlag  = popover.querySelector('.sl-edit-flag');
    const editOther = popover.querySelector('.sl-edit-other');
    const editBirth = popover.querySelector('.sl-edit-birth');
    const saveBtn   = popover.querySelector('[data-action="save-current"]');
    const delBtn    = popover.querySelector('[data-action="delete-current"]');

    // Carga datos actuales del rider matcheado para precargar los inputs.
    const { data: currentRider } = await supabase.from(ridersTable)
      .select('firstName,lastName,nationality,otherNames,birthDate').eq('id', currentId).single();
    if (currentRider) {
      editLast.value  = currentRider.lastName  || '';
      editFirst.value = currentRider.firstName || '';
      editNat.value   = currentRider.nationality || '';
      editOther.value = currentRider.otherNames || '';
      editBirth.value = currentRider.birthDate || '';
      editFlag.innerHTML = _slRiderFlagPreview(currentRider.nationality);
    }
    const baseline = {
      last: editLast.value, first: editFirst.value, nat: editNat.value,
      other: editOther.value, birth: editBirth.value,
    };
    const refreshSaveBtn = () => {
      const dirty = (
        editLast.value.trim()  !== baseline.last  ||
        editFirst.value.trim() !== baseline.first ||
        editNat.value.trim().toLowerCase() !== baseline.nat ||
        editOther.value.trim() !== baseline.other.trim() ||
        editBirth.value !== baseline.birth
      ) && editLast.value.trim() && editFirst.value.trim();
      saveBtn.disabled = !dirty;
      saveBtn.style.opacity = dirty ? '1' : '0.45';
    };
    [editLast, editFirst, editNat, editOther, editBirth].forEach(inp => inp.addEventListener('input', () => {
      if (inp === editNat) editFlag.innerHTML = _slRiderFlagPreview(inp.value.trim().toLowerCase());
      refreshSaveBtn();
    }));

    saveBtn.addEventListener('click', async () => {
      const last  = editLast.value.trim();
      const first = editFirst.value.trim();
      const nat   = editNat.value.trim().toLowerCase() || null;
      const other = editOther.value.trim() || null;
      const birth = editBirth.value || null;
      if (!last || !first) { showToast('Necesita nombre y apellido', 'error'); return; }
      saveBtn.disabled = true; saveBtn.textContent = '…';
      const { error } = await supabase.from(ridersTable).update({
        firstName: first, lastName: last, nationality: nat,
        otherNames: other, birthDate: birth,
        verified: true, updatedAt: new Date().toISOString(),
      }).eq('id', currentId);
      if (error) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; showToast('Error: ' + error.message, 'error'); return; }
      // Reflejar el cambio en la fila del editor de inscritos también.
      riderEl.querySelector('.sl-firstname').value = first;
      riderEl.querySelector('.sl-lastname').value  = last;
      _slRefreshRiderMatchBtn(riderEl, { firstName: first, lastName: last });
      baseline.last = last; baseline.first = first; baseline.nat = nat || '';
      baseline.other = other || ''; baseline.birth = birth || '';
      saveBtn.textContent = 'Guardar'; saveBtn.style.opacity = '0.45';
      showToast('Rider de BD actualizado', 'success');
    });

    // ── Posibles duplicados en BD del rider actual ──────────────────
    // Heurística: mismo apellido normalizado + mismo primer carácter del
    // firstName normalizado. Resultado limitado a 25, excluyendo el propio
    // currentId. Por candidato, dos botones: "Fusionar aquí" (mueve sus
    // startlists al rider actual y lo borra) o "Eliminar" (sin reapuntar).
    const renderDups = async () => {
      const wrap = popover.querySelector('.sl-picker-dups');
      const list = popover.querySelector('.sl-picker-dups-list');
      const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
      const curLast = norm(editLast.value);
      const curFirstInitial = norm(editFirst.value).charAt(0);
      const lastTokens = riderSearchTokens(editLast.value);
      if (!curLast || !lastTokens.length) { wrap.style.display = 'none'; return; }
      // searchName empieza por el nombre plegado: la inicial se filtra en el
      // servidor para que los homónimos de apellido no agoten el límite.
      let dupsQuery = withRiderSearch(supabase.from(ridersTable)
        .select('id,firstName,lastName,nationality,verified,source,otherNames')
        .neq('id', currentId), lastTokens);
      if (curFirstInitial) dupsQuery = dupsQuery.ilike('searchName', `${curFirstInitial}%`);
      const { data, error } = await dupsQuery.limit(25);
      if (error) { wrap.style.display = 'none'; return; }
      const dups = (data || []).filter(c =>
        norm(c.lastName) === curLast &&
        (!curFirstInitial || norm(c.firstName).charAt(0) === curFirstInitial)
      );
      if (!dups.length) { wrap.style.display = 'none'; return; }
      wrap.style.display = '';
      list.innerHTML = dups.map(d => `
        <div data-dup-id="${esc(d.id)}" class="sl-dup-row">
          ${_slRiderFlagPreview(d.nationality)}
          <span class="u-grow u-min0 u-truncate"><strong>${esc(d.lastName)}</strong>, ${esc(d.firstName)}${d.otherNames ? ` <span class="u-c-dim u-fs-1">(${esc(d.otherNames)})</span>` : ''}</span>
          <span class="sl-verify-mark ${d.verified ? 'u-c-ok' : 'u-c-warn'}">${d.verified ? '✓' : '?'}</span>
          <span class="u-c-dim u-fs-1 u-shrink-0">${esc(d.source || '')}</span>
          <button data-dup-action="merge-into-current" title="Mover sus startlists al rider actual y eliminarlo" type="button" class="sl-mini-action sl-mini-action--merge u-py-015 u-px-040 u-fs-1">Fusionar</button>
          <button data-dup-action="delete-dup" title="Eliminar este rider de BD (desliga sus startlists, no las reapunta)" type="button" class="sl-mini-action sl-mini-action--delete u-py-015 u-px-040 u-fs-1">Borrar</button>
        </div>`).join('');

      list.querySelectorAll('[data-dup-action="merge-into-current"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('[data-dup-id]');
          const dupId = row.dataset.dupId;
          const dup = dups.find(d => d.id === dupId);
          if (!dup) return;
          const { count: linkedCount } = await supabase.from('startlist_riders')
            .select('id', { count: 'exact', head: true }).eq('globalRiderId', dupId);
          if (!await confirmDialog(`Mover ${linkedCount || 0} startlist(s) de "${dup.lastName}, ${dup.firstName}" → "${editLast.value}, ${editFirst.value}" y eliminar el duplicado.\n\n¿Continuar?`, { danger: true })) return;
          btn.disabled = true; btn.textContent = '…';
          const target = { id: currentId, firstName: editFirst.value.trim(), lastName: editLast.value.trim(), otherNames: '' };
          const { ok, error } = await _mergeRidersSilent(dup, target, ridersTable);
          if (!ok) { btn.disabled = false; btn.textContent = 'Fusionar'; showToast('Error: ' + error, 'error'); return; }
          row.remove();
          if (!list.children.length) popover.querySelector('.sl-picker-dups').style.display = 'none';
          showToast(`Fusionado: ${linkedCount || 0} startlist(s) reapuntadas`, 'success');
        });
      });
      list.querySelectorAll('[data-dup-action="delete-dup"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('[data-dup-id]');
          const dupId = row.dataset.dupId;
          const dup = dups.find(d => d.id === dupId);
          if (!dup) return;
          const { count: linkedCount } = await supabase.from('startlist_riders')
            .select('id', { count: 'exact', head: true }).eq('globalRiderId', dupId);
          if (!await confirmDialog(`Eliminar "${dup.lastName}, ${dup.firstName}" de BD.\n\n${linkedCount || 0} startlist(s) perderán el match (snapshot del nombre se conserva).\n\n¿Continuar?`, { danger: true })) return;
          btn.disabled = true; btn.textContent = '…';
          if (linkedCount) {
            await supabase.from('startlist_riders').update({ globalRiderId: null }).eq('globalRiderId', dupId);
          }
          const { error: delErr } = await supabase.from(ridersTable).delete().eq('id', dupId);
          if (delErr) { btn.disabled = false; btn.textContent = 'Borrar'; showToast('Error: ' + delErr.message, 'error'); return; }
          row.remove();
          if (!list.children.length) popover.querySelector('.sl-picker-dups').style.display = 'none';
          showToast(`Eliminado. ${linkedCount || 0} startlist(s) desligadas.`, 'success');
        });
      });
    };
    renderDups();
    // Re-evaluar duplicados si el admin edita apellido o nombre (puede aflorar
    // otros candidatos al normalizar la búsqueda).
    let dupTimer = null;
    [editLast, editFirst].forEach(inp => inp.addEventListener('input', () => {
      clearTimeout(dupTimer);
      dupTimer = setTimeout(renderDups, 350);
    }));

    delBtn.addEventListener('click', async () => {
      // Conteo de startlists afectadas para informar al admin.
      const { count: linkedCount } = await supabase.from('startlist_riders')
        .select('id', { count: 'exact', head: true }).eq('globalRiderId', currentId);
      const msg = `Eliminar "${editLast.value}, ${editFirst.value}" (id ${currentId}) de la BD.\n\nAparece en ${linkedCount || 0} startlist(s). Sus filas perderán el match (snapshot del nombre se conserva).\n\n¿Continuar?`;
      if (!await confirmDialog(msg, { danger: true })) return;
      delBtn.disabled = true; delBtn.textContent = '…';
      // 1. Desligar todas las startlists.
      if (linkedCount) {
        const { error: upErr } = await supabase.from('startlist_riders')
          .update({ globalRiderId: null }).eq('globalRiderId', currentId);
        if (upErr) { delBtn.disabled = false; delBtn.textContent = 'Eliminar de BD'; showToast('Error desligando: ' + upErr.message, 'error'); return; }
      }
      // 2. DELETE.
      const { error: delErr } = await supabase.from(ridersTable).delete().eq('id', currentId);
      if (delErr) { delBtn.disabled = false; delBtn.textContent = 'Eliminar de BD'; showToast('Error: ' + delErr.message, 'error'); return; }
      // Reflejar: la fila del editor pierde el match.
      delete riderEl.dataset.globalRiderId;
      _slRefreshRiderMatchBtn(riderEl);
      _slCloseMatchPicker();
      showToast(`Rider eliminado de BD. ${linkedCount || 0} startlist(s) desligadas.`, 'success');
    });
  }

  if (currentLast) input.value = currentLast;
  search();
  setTimeout(() => { input.focus(); input.select(); }, 0);
  setTimeout(() => document.addEventListener('mousedown', _slOutsideMatchPickerClick, true), 0);
}

export function _slRiderFlagPreview(code) {
  return code ? countryFlag(code) : '<span class="flag-placeholder"></span>';
}

export function _slTeamRowHtml({ teamName = '', teamId = null, isConfirmed = false, riders = [] } = {}) {
  const ridersHtml = riders.map(r => {
    const rowKey = r.rowKey || r.id || crypto.randomUUID();
    return `
      <div class="sl-edit-rider" data-row-key="${esc(rowKey)}" data-startlist-rider-id="${esc(r.id || '')}" data-global-rider-id="${esc(r.globalRiderId || '')}" data-birth-date="${esc(r.birthDate || '')}" data-other-names="${esc(r.otherNames || '')}" data-uci-profile-id="${esc(r.uciProfileId || '')}" data-source-url="${esc(r.sourceUrl || '')}" data-rejected-candidate-ids="${esc(JSON.stringify(r.rejectedCandidateIds || []))}">
        <div class="sl-edit-rider__main">
          <input type="number" class="sl-dorsal" value="${Number(r.dorsal) > 0 ? r.dorsal : ''}" placeholder="—" min="1">
          <span class="sl-flag-preview u-icon-box">${_slRiderFlagPreview(r.countryCode)}</span>
          <input type="text" class="sl-country" value="${esc(r.countryCode || '')}" placeholder="es" maxlength="5" title="ISO 3166-1 alpha-2 (2 letras)">
          <input type="text" class="sl-firstname u-input-sm" value="${esc(r.firstName || '')}" placeholder="Nombre">
          <input type="text" class="sl-lastname u-input-sm" value="${esc(r.lastName || '')}" placeholder="Apellido">
          <button type="button" class="sl-rider-match-btn${r.globalRiderId ? ' is-matched' : ''}" data-action="picker"
                  title="${r.globalRiderId ? 'Match en BD: ' + esc((r.firstName||'') + ' ' + (r.lastName||'')) + '. Click para cambiar/desligar.' : 'Buscar o forzar un match en la BD de corredores'}">${r.globalRiderId ? '✓ BD' : '🔗'}</button>
          <button type="button" class="btn btn--ghost sl-remove-rider-btn">✕</button>
        </div>
        <div class="sl-rider-suggestion" style="display:none"></div>
      </div>`;
  }).join('');
  return `<div class="sl-edit-team" data-team-id="${teamId ? esc(teamId) : ''}">
      <div class="sl-edit-team-header">
        <input type="text" class="sl-team-name" value="${esc(teamName)}" placeholder="Nombre del equipo">
        <span class="sl-team-enrich-slot"></span>
        <label class="sl-confirmed-cell" style="display:${panelState._editingRaceProvisional ? 'inline-flex' : 'none'}">
          <input type="checkbox" class="sl-is-confirmed" ${isConfirmed ? 'checked' : ''}>
          Confirmado
        </label>
        <span class="sl-team-order-controls" style="display:none">
          <button type="button" class="btn btn--ghost sl-team-up-btn btn--icon-xs" title="Subir selección" aria-label="Subir selección">↑</button>
          <button type="button" class="btn btn--ghost sl-team-down-btn btn--icon-xs" title="Bajar selección" aria-label="Bajar selección">↓</button>
        </span>
        <button type="button" class="btn btn--ghost sl-remove-team-btn btn--mini u-c-red">Eliminar equipo</button>
      </div>
      <div class="sl-edit-riders">${ridersHtml}</div>
      <div class="sl-edit-team__footer">
        <button class="btn btn--ghost btn--mini" onclick="addRiderRow(this)">+ Corredor</button>
      </div>
    </div>`;
}

export function _slUpdateRowEnrichUI(rowEl) {
  const slot = rowEl.querySelector('.sl-team-enrich-slot');
  const rawName = rowEl.querySelector('.sl-team-name')?.value || '';
  // Las listas se guardan siempre con las identidades completas.
  if (isNoTeamPlaceholderTeam({ teamId: rowEl.dataset.teamId || null, teamName: rawName })) {
    slot.innerHTML = `<span class="u-fs-1 u-c-dim">${esc(rawName)} · sin identidad de equipo</span>`;
    return;
  }
  const teamId = rowEl.dataset.teamId || '';
  const team = teamId ? (panelState._teamsCache || []).find(t => t.id === teamId) : null;
  if (team) {
    slot.innerHTML = `
      <span class="sl-team-badge">${teamStripes(team)}${esc(team.name)}</span>
      <button class="btn btn--ghost sl-change-team btn--tiny" type="button">Cambiar</button>`;
  } else {
    if (!rawName.trim()) { slot.replaceChildren(); return; }
    const matches = panelState._slTeamMatchIndex.get(normalizeTeamName(rawName)) || [];
    const warning = rowEl.dataset.teamResolutionError || (matches.length > 1
      ? 'Varios equipos coinciden. Selecciona el correcto.'
      : 'Equipo no encontrado. Hay que crearlo.');
    slot.innerHTML = `
      <span role="status" class="u-fs-1 u-c-orange">${esc(warning)}</span>
      ${matches.length > 1 ? '' : '<button class="btn btn--ghost sl-create-team btn--tiny" type="button">Crear equipo</button>'}
      <button class="btn btn--ghost sl-assign-team btn--tiny" type="button">Seleccionar existente</button>`;
  }
}
