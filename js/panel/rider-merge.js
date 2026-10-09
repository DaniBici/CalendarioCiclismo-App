// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Corredores: fusión
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { confirmDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { _slRiderFlagPreview } from './startlist-picker.js';
import { _refreshOpenRoster } from './team-roster.js';
import { closeRiderEditor } from './riders.js';
import { riderSearchTokens, withRiderSearch } from '../results/panel-logic.js';

// ── Fusionar dos riders en BD ───────────────────────────────────────
let _mergePickerEl = null;
function _closeMergePicker() {
  if (_mergePickerEl) { _mergePickerEl.remove(); _mergePickerEl = null; }
  document.removeEventListener('mousedown', _outsideMergePickerClick, true);
}
function _outsideMergePickerClick(e) {
  if (!_mergePickerEl) return;
  if (_mergePickerEl.contains(e.target)) return;
  if (e.target.closest('#mergeRiderBtn')) return;
  _closeMergePicker();
}

export async function openMergeRiderPicker() {
  if (!panelState._editingRiderId) return;
  _closeMergePicker();

  const source = panelState._ridersAllCache.find(r => r.id === panelState._editingRiderId);
  if (!source) { showToast('Carga el corredor antes de fusionarlo', 'error'); return; }
  const table = panelState._ridersGender === 'male' ? 'riders_men' : 'riders_women';

  // Contar startlists del source para mostrar impacto al admin.
  const { count: linkedCount } = await supabase
    .from('startlist_riders')
    .select('id', { count: 'exact', head: true })
    .eq('globalRiderId', panelState._editingRiderId);

  const popover = document.createElement('div');
  popover.className = 'merge-popover';
  popover.innerHTML = `
    <div class="u-fs-2 u-c-text u-mb-060">
      <div class="u-fw-700 u-mb-020">Fusionar corredor</div>
      <div class="u-fs-1 u-c-dim">
        Origen: <strong class="u-c-text">${esc(source.lastName)}, ${esc(source.firstName)}</strong> (${linkedCount || 0} startlist${linkedCount === 1 ? '' : 's'} linkada${linkedCount === 1 ? '' : 's'})
      </div>
      <div class="u-fs-1 u-c-dim u-mt-015">Elige el corredor destino al que moverlas. El origen se eliminará.</div>
    </div>
    <input type="search" class="merge-picker-input" placeholder="Buscar destino por apellido, nombre u otherNames…">
    <div class="merge-picker-results"></div>
    <div class="merge-picker-footer">
      <button data-action="close" type="button" class="btn btn--ghost u-btn-sm u-fs-1">Cancelar</button>
    </div>`;

  const anchor = document.getElementById('mergeRiderBtn');
  document.body.appendChild(popover);
  const rect = anchor.getBoundingClientRect();
  popover.style.left = (rect.left + window.scrollX) + 'px';
  popover.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  const popRect = popover.getBoundingClientRect();
  if (popRect.right > window.innerWidth - 16) {
    popover.style.left = (window.innerWidth - popRect.width - 16) + 'px';
  }
  _mergePickerEl = popover;

  const input = popover.querySelector('.merge-picker-input');
  const results = popover.querySelector('.merge-picker-results');
  let reqId = 0;

  const search = async () => {
    const q = input.value.trim();
    const myId = ++reqId;
    const tokens = riderSearchTokens(q);
    if (q.length < 2 || !tokens.length) {
      results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Escribe al menos 2 letras.</div>';
      return;
    }
    results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Buscando…</div>';
    const { data, error } = await withRiderSearch(supabase.from(table)
      .select('id,firstName,lastName,otherNames,nationality,currentTeamId,verified,source'), tokens)
      .neq('id', panelState._editingRiderId)   // no permitir auto-merge
      .order('lastName').limit(25);
    if (myId !== reqId) return;
    if (error) { results.innerHTML = `<div class="u-c-red u-fs-1 u-p-030">Error: ${esc(error.message)}</div>`; return; }
    if (!data?.length) {
      results.innerHTML = '<div class="u-c-dim u-fs-1 u-p-030">Sin resultados.</div>';
      return;
    }
    results.innerHTML = data.map(rd => `
      <button type="button" data-tid="${esc(rd.id)}" class="merge-picker-option">
        ${_slRiderFlagPreview(rd.nationality)}
        <span class="u-grow u-min0"><strong>${esc(rd.lastName)}</strong>, ${esc(rd.firstName)}${rd.otherNames ? ` <span class="u-c-dim u-fs-1">(${esc(rd.otherNames)})</span>` : ''}</span>
        ${rd.verified === false ? '<span title="Sin verificar" class="u-c-warn u-fs-1 u-fw-700">?</span>' : '<span title="Verificado" class="u-c-ok u-fs-1 u-fw-700">✓</span>'}
      </button>`).join('');
    results.querySelectorAll('[data-tid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = data.find(x => x.id === btn.dataset.tid);
        if (target) executeMerge(source, target, linkedCount || 0);
      });
    });
  };

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') _closeMergePicker(); });
  popover.querySelector('[data-action="close"]').addEventListener('click', _closeMergePicker);

  if (source.lastName) input.value = source.lastName;
  search();
  setTimeout(() => { input.focus(); input.select(); }, 0);
  setTimeout(() => document.addEventListener('mousedown', _outsideMergePickerClick, true), 0);
}

async function executeMerge(source, target, linkedCount) {
  const status = document.getElementById('riderSaveStatus');
  const msg = `Vas a:
  • Mover ${linkedCount} startlist(s) de "${source.lastName}, ${source.firstName}" → "${target.lastName}, ${target.firstName}"
  • Eliminar "${source.lastName}, ${source.firstName}" (id ${source.id}) de la BD

Esta acción no se puede deshacer. ¿Continuar?`;
  if (!await confirmDialog(msg, { danger: true })) return;

  _closeMergePicker();
  status.textContent = 'Fusionando…';
  const table = panelState._ridersGender === 'male' ? 'riders_men' : 'riders_women';

  try {
    // 1. Reapuntar las startlist_riders del source al target.
    if (linkedCount > 0) {
      const { error: upErr } = await supabase
        .from('startlist_riders')
        .update({ globalRiderId: target.id })
        .eq('globalRiderId', source.id);
      if (upErr) throw new Error('Re-link startlists: ' + upErr.message);
    }

    // 2. Si el source tiene otherNames únicos, los acumulamos en el target
    //    para preservar variantes de matching.
    const srcAliases = (source.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const tgtAliases = (target.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const merged = [...new Set([...tgtAliases, ...srcAliases, source.lastName !== target.lastName ? source.lastName : null].filter(Boolean))];
    const newOther = merged.join(', ');
    if (newOther !== (target.otherNames || '')) {
      const { error: upTErr } = await supabase
        .from(table).update({ otherNames: newOther, updatedAt: new Date().toISOString() }).eq('id', target.id);
      if (upTErr) console.warn('[merge] no se pudo actualizar otherNames del target:', upTErr);
    }

    // 3. Eliminar el source.
    const { error: delErr } = await supabase.from(table).delete().eq('id', source.id);
    if (delErr) throw new Error('DELETE source: ' + delErr.message);

    showToast(`Fusión OK: ${linkedCount} startlist(s) movidas y ${source.id} eliminado.`, 'success');
    closeRiderEditor();
    await _refreshOpenRoster();
  } catch (err) {
    console.error('[executeMerge]', err);
    status.textContent = 'Error: ' + (err.message || err);
    showToast('Error en la fusión — revisa la consola', 'error');
  }
}

export async function _mergeRidersSilent(source, target, table) {
  try {
    // 1. Re-link startlists
    const { error: upErr } = await supabase
      .from('startlist_riders').update({ globalRiderId: target.id }).eq('globalRiderId', source.id);
    if (upErr) return { ok: false, error: upErr.message };

    // 2. Acumular otherNames del source en target (mantiene matching futuro)
    const srcAliases = (source.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const tgtAliases = (target.otherNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const merged = [...new Set([...tgtAliases, ...srcAliases,
      source.lastName !== target.lastName ? source.lastName : null].filter(Boolean))];
    const newOther = merged.join(', ');
    if (newOther !== (target.otherNames || '')) {
      const { error: upT } = await supabase.from(table)
        .update({ otherNames: newOther, updatedAt: new Date().toISOString() }).eq('id', target.id);
      if (upT) console.warn('[merge silent] no actualizó otherNames:', upT);
    }

    // 3. Repuntar afiliaciones temporales del perdedor al superviviente.
    //    El panel viejo NO tocaba rider_team_affiliations → al borrar el perdedor sus
    //    afiliaciones quedaban colgando (riderId muerto, sin FK que las arrastre) y el
    //    superviviente podía perder la del año. Política "superviviente manda": solo se
    //    traslada una afiliación del perdedor si el superviviente NO tiene ya una del
    //    mismo (teamId, year, affiliationType). Las pruebas usan UUID; las
    //    afiliaciones habituales usan `riderId__teamId__year`, así que
    //    trasladar = INSERTAR una fila nueva con el id del superviviente (no basta con
    //    UPDATE de riderId). Luego se borran TODAS las del perdedor (no hay ON DELETE
    //    CASCADE hacia riders_*, así que el DELETE del paso 4 no las limpiaría solo).
    const gender = table === 'riders_men' ? 'male' : 'female';
    const { data: srcAffs, error: affErr } = await supabase
      .from('rider_team_affiliations')
      .select('*').eq('riderId', source.id).eq('riderGender', gender);
    if (affErr) {
      console.warn('[merge silent] no leyó afiliaciones del perdedor:', affErr);
    } else if (srcAffs && srcAffs.length) {
      const { data: tgtAffs } = await supabase
        .from('rider_team_affiliations')
        .select('teamId,year,affiliationType').eq('riderId', target.id).eq('riderGender', gender);
      const tgtKeys = new Set((tgtAffs || []).map(a => `${a.teamId}__${a.year}__${a.affiliationType}`));
      const toMove = srcAffs
        .filter(a => !tgtKeys.has(`${a.teamId}__${a.year}__${a.affiliationType}`))
        .map(a => ({
          ...a,
          id: a.affiliationType === 'trainee' ? crypto.randomUUID() : `${target.id}__${a.teamId}__${a.year}`,
          riderId: target.id,
          updatedAt: new Date().toISOString(),
        }));
      if (toMove.length) {
        const { error: insErr } = await supabase
          .from('rider_team_affiliations').upsert(toMove, { onConflict: 'id' });
        if (insErr) return { ok: false, error: 'trasladar afiliaciones: ' + insErr.message };
      }
      // Borrar todas las afiliaciones del perdedor (las trasladadas ya están copiadas
      // bajo el id del superviviente; las colisionantes se descartan).
      const { error: delAffErr } = await supabase
        .from('rider_team_affiliations')
        .delete().eq('riderId', source.id).eq('riderGender', gender);
      if (delAffErr) return { ok: false, error: 'limpiar afiliaciones: ' + delAffErr.message };
    }

    // 4. DELETE source
    const { error: delErr } = await supabase.from(table).delete().eq('id', source.id);
    if (delErr) return { ok: false, error: delErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
