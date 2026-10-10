// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Resultados: alta manual y editor de clasificaciones
// ─────────────────────────────────────────────────────────────────

import { supabase, stageLabel, esc } from '../shared.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import {
  manualResultClassificationRow, nextResultRank, normalizeResultTimeInput,
  shouldMirrorFinalClassification, uniqueStartlistSurnameMatch,
} from '../results/panel-logic.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { buildResolvedRiderMapForRace } from './start-order.js';
import { setupUciResultsSection, UCI_CLASS_LABELS, UCI_EDITABLE_IRM_CODES } from './results.js';
import { _ruOpenRiderMatchPicker, _ruOpenTeamPicker } from './results-pickers.js';
import { fetchTeams } from './teams.js';

// ── Crear una clasificación A MANO ────────────────────────────────────────
// Para pruebas sin fuente automática (CN, carreras pequeñas) o para añadir un
// tipo que el cron no trajo. El único punto del sistema que da de alta filas en
// race_uci_stages es el upsert del cron; esto replica esa alta desde el panel.
// La fila se construye en manualResultClassificationRow (results/panel-logic.js).

// Diálogo: elegir tipo de clasificación (+ "es la final/de la prueba") y crear.
export async function _ruNewClass(rd, race, stages, finalStageDay = false, raceDays = []) {
  const isOneDay = race?.raceFormat === 'one_day';
  // En carrera de un día la clasificación es la prueba entera (final, sin etapa).
  // En carrera por etapas, por defecto cuelga de ESTA jornada (su stageNumber).
  const opts = Object.keys(UCI_CLASS_LABELS)
    .map(k => `<option value="${k}"${k === (isOneDay ? 'gc' : 'stage') ? ' selected' : ''}>${UCI_CLASS_LABELS[k]}</option>`)
    .join('');

  const h = openDrawer({
    title: 'Nueva clasificación',
    level: 2,
    render: (body) => {
      body.innerHTML = `
        <div class="ru-ed-note">
          Crea una clasificación vacía para teclear sus resultados a mano. Se crea como
          <strong>placeholder</strong>: si más tarde la UCI/PDF publica esa misma clasificación,
          su volcado la sustituye. Guardar no cambia el candado; si quieres impedir que el cron
          la toque, usa «Bloquear» en la lista.
        </div>
        <div class="field u-mt-080">
          <label for="ruNewKind">Tipo de clasificación</label>
          <select id="ruNewKind">${opts}</select>
        </div>
        <div class="field">
          <label class="editor-check">
            <input type="checkbox" id="ruNewFinal" class="editor-check__box"${isOneDay ? ' checked' : ''}>
            <span>Es la clasificación <strong>final / de la prueba</strong>
              ${isOneDay ? '' : '(general definitiva del último día; no cuelga de una etapa)'}</span>
          </label>
        </div>
        <div class="u-row u-mt-110 u-justify-end">
          <button type="button" class="btn btn--ghost ru-new-cancel">Cancelar</button>
          <button type="button" class="btn btn--primary ru-new-create">Crear y editar</button>
        </div>`;
      body.querySelector('.ru-new-cancel').addEventListener('click', () => closeDrawer(2));
      body.querySelector('.ru-new-create').addEventListener('click', async (e) => {
        const kind = body.querySelector('#ruNewKind').value;
        const isFinal = body.querySelector('#ruNewFinal').checked;
        e.target.disabled = true;
        try {
          const st = await _ruCreateClass(rd, race, stages, kind, isFinal, raceDays);
          st._isFinalRaceDay = finalStageDay;
          closeDrawer(2);
          openUciClassEditor(st, rd, race);   // abre el editor de filas YA existente
        } catch (err) {
          console.error(err);
          showToast('Error al crear: ' + (err.message || err));
          e.target.disabled = false;
        }
      });
    },
  });
  return h;
}

// Inserta la fila en race_uci_stages y devuelve el objeto stage para editarla.
async function _ruCreateClass(rd, race, stages, kind, isFinal, raceDays = []) {
  const row = manualResultClassificationRow(rd, stages, kind, isFinal, raceDays,
    UCI_CLASS_LABELS[kind] || kind);
  const { data, error } = await supabase.from('race_uci_stages').insert(row).select().single();
  if (error) throw error;
  return data;
}

async function _ruMirrorFinalClassification(st, rd, race, records, headerPatch) {
  let twin = null;
  let created = false;
  if (st._finalTwinId) {
    const { data, error } = await supabase.from('race_uci_stages')
      .select('*').eq('id', st._finalTwinId).maybeSingle();
    if (error) throw error;
    twin = data || null;
  }

  if (!twin) {
    const { data: stages, error } = await supabase.from('race_uci_stages')
      .select('*').eq('raceId', rd.raceId);
    if (error) throw error;
    twin = (stages || []).find((candidate) => candidate.classKind === st.classKind
      && candidate.stageNumber == null && candidate.isFinalClassification) || null;
    if (!twin) {
      twin = await _ruCreateClass(rd, race, stages || [], st.classKind, true);
      created = true;
    }
  }

  const { error: delErr } = await supabase.from('race_uci_results')
    .delete().eq('stageRef', twin.id);
  if (delErr) throw delErr;

  if (records.length) {
    const mirrored = records.map((record) => ({
      ...record,
      stageRef: twin.id,
      eventId: twin.eventId,
    }));
    const { error: insErr } = await supabase.from('race_uci_results').insert(mirrored);
    if (insErr) throw insErr;
  }

  const twinPatch = created && st.lockedAt
    ? { ...headerPatch, lockedAt: st.lockedAt }
    : headerPatch;
  const { error: updErr } = await supabase.from('race_uci_stages')
    .update(twinPatch).eq('id', twin.id);
  if (updErr) throw updErr;
}

// ── Editor de una clasificación (drawer nivel 2) ──────────────────────────
// Tabla editable con las columnas CRUDAS de race_uci_results. Guardar reemplaza
// las filas (insert tras delete, sortOrder = orden visual), conserva el candado
// y re-resuelve los corredores por dorsal (RPC resolve_uci_results).
export async function openUciClassEditor(st, rd, race) {
  const stageLbl = st.isFinalClassification ? 'Final' : stageLabel(st.stageNumber, rd._stageSuffix) || (race?.name || '');
  const h = openDrawer({
    title: `${UCI_CLASS_LABELS[st.classKind] || st.classKind} — ${stageLbl}`,
    level: 2,
    wide: true,
    render: (body) => {
      body.innerHTML = '<div class="u-c-muted u-fs-3 u-p-100">Cargando clasificación…</div>';
    },
  });

  let rows = [], riderMap = {};
  try {
    const [rowsRes, map] = await Promise.all([
      supabase.from('race_uci_results').select('*')
        .eq('stageRef', st.id).order('sortOrder', { ascending: true }),
      buildResolvedRiderMapForRace(rd.raceId).catch(() => ({})),
    ]);
    if (rowsRes.error) throw rowsRes.error;
    rows = rowsRes.data || [];
    riderMap = map || {};
  } catch (err) {
    console.error(err);
    h.body.innerHTML = `<div class="u-c-danger u-p-100 u-fs-3">Error al cargar: ${esc(err.message || String(err))}</div>`;
    return;
  }

  const isTeamsClass = st.classKind === 'teams';
  // Tipo de clasificación → qué columna de valor mostrar:
  //   · Puntos/Montaña (points/kom) → columna Pts (sin tiempo).
  //   · Etapa/General/Jóvenes/Equipos → columna Tiempo/Gap (sin puntos).
  const isPtsClass = st.classKind === 'points' || st.classKind === 'kom';
  // Equipos globales para el override manual (nombre y selector).
  await fetchTeams().catch(() => {});
  const teamById = (id) => (id ? (panelState._teamsCache || []).find(t => t.id === id) : null);
  const gidIndex = riderMap.__byGid || {};
  // Corredor resuelto: por dorsal contra la startlist (preferente) o, sin dorsal
  // casable, por globalRiderId (CN sin startlist) — espejo de la cascada de la web.
  const resolvedOf = (bib, gid) => {
    if (isTeamsClass) return null;
    const t = String(bib ?? '').trim();
    return (/^\d+$/.test(t) ? riderMap[Number(t)] : null) || (gid ? gidIndex[gid] : null) || null;
  };
  // Pinta la celda Equipo de una fila:
  //   · Con override (teamId) → equipo elegido a mano, color normal.
  //   · Sin override pero con corredor casado → equipo AUTO-resuelto en gris
  //     (es el que pintará la web; lo muestra para no parecer "sin equipo").
  //   · Sin nada → "— equipo —".
  const teamCellHtml = (teamId, bib, gid) => {
    const ovr = teamById(teamId);
    if (ovr) {
      return `<span class="ru-team-name">${esc(ovr.name)}</span>`;
    }
    const auto = resolvedOf(bib, gid);
    const autoName = auto?.teamDisplay || auto?.team || '';
    if (autoName) {
      return `<span class="ru-team-auto" title="Equipo auto-resuelto del corredor (pulsa para fijar otro)"><span class="ru-team-name">${esc(autoName)}</span></span>`;
    }
    return `<span class="ru-team-name ru-team-name--empty">— equipo —</span>`;
  };

  // Celda de valor según el tipo: Pts (points/kom) o Tiempo/Gap (resto).
  const valueCell = (r) => isPtsClass
    ? `<td class="ru-td-value"><input class="ru-in ru-pts" data-ru-field="value" type="number" value="${r.points ?? ''}" placeholder="pts"></td>`
    : `<td class="ru-td-value"><input class="ru-in ru-time" data-ru-field="value" type="text" value="${esc(r.timeText ?? r.gapText ?? '')}" placeholder="H:MM:SS o +0:14" title="Atajos: 4.18.18 → 4:18:18 en #1 o +4:18:18 desde #2 · 33 → +0:33 · 1.18 → +1:18"></td>`;

  const rowHtml = (r) => {
    const resolvedName = resolvedOf(r.bib, r.globalRiderId)?.name || '';
    const nameValue = isTeamsClass ? (r.riderDisplay ?? '') : (resolvedName || r.riderDisplay || '');
    return `<tr class="ru-row" draggable="true" data-gid="${esc(r.globalRiderId || '')}" data-team-id="${esc(r.teamId || '')}" data-rv="${esc(r.resultValue ?? '')}">
    <td class="ru-td-drag"><span class="ru-drag-handle" title="Arrastra para reordenar">⠿</span></td>
    <td class="ru-td-rank"><input class="ru-in ru-rank" data-ru-field="rank" type="number" min="0" value="${r.rank ?? ''}" placeholder="#"></td>
    <td class="ru-td-bib"><input class="ru-in ru-bib" data-ru-field="bib" type="text" inputmode="numeric" value="${esc(r.bib ?? '')}" title="Dorsal (casa el corredor por la startlist al teclearlo)"></td>
    <td class="ru-td-name">
      <div class="ru-name-row">
        <input class="ru-in ru-name" data-ru-field="name" type="text" value="${esc(nameValue)}">
        ${isTeamsClass ? '' : `<button type="button" class="ru-act ru-match" data-ru-field="match" title="Casar corredor con la BD">🔗</button>`}
      </div>
    </td>
    <td class="ru-td-team">
      <button type="button" class="ru-team-btn" data-ru-field="team" title="Asignar equipo a mano (override)">${teamCellHtml(r.teamId, r.bib, r.globalRiderId)}</button>
    </td>
    ${valueCell(r)}
    <td class="ru-td-irm">
      <select class="ru-in ru-irm" data-ru-field="irm">
        ${UCI_EDITABLE_IRM_CODES.map(c => `<option value="${c}" ${(r.irm ?? '') === c ? 'selected' : ''}>${c || '—'}</option>`).join('')}
      </select>
    </td>
    <td class="ru-actions">
      <button type="button" class="ru-act ru-del" data-ru-field="delete" title="Quitar fila">✕</button>
    </td>
  </tr>`;
  };

  h.body.innerHTML = `
    <div class="u-row u-wrap u-mt-060 u-mb-060">
      <button type="button" class="btn btn--ghost u-fs-1" id="ruAddRow">＋ Añadir fila</button>
      <button type="button" class="btn btn--ghost u-fs-1" id="ruSortRank"
              title="Reordena las filas por la columna # (sin puesto → al final, en su orden actual)">Ordenar por puesto</button>
      <span class="u-grow"></span>
      <button type="button" class="btn btn--primary ru-save u-fs-2">Guardar</button>
    </div>
    <table class="ru-edit-table">
      <thead><tr>
        <th class="u-w-160"></th>
        <th class="ru-th-rank" title="Puesto (vacío = no clasificado)">#</th>
        <th class="u-w-280" title="Dorsal — casa el corredor por la startlist al teclearlo">Dor.</th>
        <th>${isTeamsClass ? 'Equipo' : 'Corredor'}</th>
        <th class="u-w-900" title="Equipo (override manual; gana a la resolución por dorsal)">Equipo</th>
        ${isPtsClass
          ? '<th class="u-w-500" title="Puntos">Pts</th>'
          : '<th class="u-w-700" title="Tiempo del ganador, o gap del resto empezando por +">Tiempo / gap</th>'}
        <th class="u-w-460" title="DNF/DNS/OTL/DSQ/DF/NR">IRM</th>
        <th class="u-w-240"></th>
      </tr></thead>
      <tbody id="ruRows">${rows.map(rowHtml).join('')}</tbody>
    </table>
    <div class="u-row u-mt-080 u-justify-end">
      <button type="button" class="btn btn--ghost ru-cancel">Cancelar</button>
      <button type="button" class="btn btn--primary ru-save">Guardar</button>
    </div>`;

  const tbody = h.body.querySelector('#ruRows');
  const startlistRiders = Object.values(riderMap);
  const bibOf = (tr) => tr.querySelector('.ru-bib')?.value || '';
  const appendResultRow = () => {
    const rankValues = [...tbody.querySelectorAll('.ru-rank')].map((input) => input.value);
    tbody.insertAdjacentHTML('beforeend', rowHtml({ rank: nextResultRank(rankValues) }));
    return tbody.lastElementChild;
  };

  // Refresca la celda de equipo (override o auto-resuelto en gris) de una fila.
  const refreshTeamCell = (tr) => {
    const btn = tr.querySelector('.ru-team-btn');
    if (btn) btn.innerHTML = teamCellHtml(tr.dataset.teamId || '', bibOf(tr), tr.dataset.gid || '');
  };
  // Resuelve el texto ya escrito contra la startlist antes de abrir el selector.
  // Esto cubre el flujo escribir apellido → pulsar 🔗 aunque el campo todavía no
  // haya emitido `change` y evita una selección manual cuando el match es único.
  const applyUniqueStartlistNameMatch = (tr) => {
    const nameInput = tr.querySelector('.ru-name');
    const hit = uniqueStartlistSurnameMatch(nameInput?.value, startlistRiders);
    if (!hit) return false;
    tr.dataset.gid = hit.globalRiderId || '';
    nameInput.value = hit.name;
    const bibInput = tr.querySelector('.ru-bib');
    if (bibInput && hit.dorsal != null) bibInput.value = hit.dorsal;
    refreshTeamCell(tr);
    return true;
  };
  // Acciones de fila por delegación (sobreviven a añadir/mover filas).
  tbody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    // Casar corredor a mano (🔗): fija globalRiderId como override.
    if (e.target.closest('.ru-match')) {
      if (startlistRiders.length && applyUniqueStartlistNameMatch(tr)) return;
      _ruOpenRiderMatchPicker(tr, race?.gender, refreshTeamCell,
        startlistRiders.length ? startlistRiders : null);
      return;
    }
    // Asignar equipo a mano (override): selector de equipos globales.
    if (e.target.closest('.ru-team-btn')) {
      _ruOpenTeamPicker(tr, race, refreshTeamCell);
      return;
    }
    if (e.target.closest('.ru-del')) tr.remove();
  });
  // Dorsal editado → CASAR al instante contra la startlist: si el dorsal existe,
  // fija el corredor (gid + nombre) sin esperar a guardar; si no, limpia el gid
  // heredado y deja el corredor sin enlazar (lo re-resuelve la RPC si procede).
  tbody.addEventListener('input', (e) => {
    if (!e.target.classList.contains('ru-bib')) return;
    const tr = e.target.closest('tr');
    const t = String(e.target.value ?? '').trim();
    const hit = /^\d+$/.test(t) ? riderMap[Number(t)] : null;
    if (hit) {
      tr.dataset.gid = hit.globalRiderId || '';
      const nameInput = tr.querySelector('.ru-name');
      if (nameInput && hit.name) nameInput.value = hit.name;
    } else {
      tr.dataset.gid = '';
    }
    refreshTeamCell(tr);
  });

  // Al abandonar el campo Corredor, un apellido exacto y no ambiguo de la
  // startlist fija dorsal, nombre canónico y globalRiderId de forma inmediata.
  tbody.addEventListener('change', (e) => {
    if (e.target.classList.contains('ru-time')) {
      const rank = Number.parseInt(e.target.closest('tr')?.querySelector('.ru-rank')?.value, 10);
      e.target.value = normalizeResultTimeInput(e.target.value, rank);
      return;
    }
    if (isTeamsClass || !e.target.classList.contains('ru-name')) return;
    const tr = e.target.closest('tr');
    applyUniqueStartlistNameMatch(tr);
  });

  // Tab conserva la columna y avanza una fila. Si se alcanza el final, crea una
  // fila vacía para mantener el flujo vertical; Shift+Tab recorre hacia arriba.
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const control = e.target.closest('[data-ru-field]');
    const tr = control?.closest('tr.ru-row');
    if (!control || !tr) return;
    let targetRow = e.shiftKey ? tr.previousElementSibling : tr.nextElementSibling;
    if (!targetRow && !e.shiftKey) {
      targetRow = appendResultRow();
    }
    const target = targetRow?.querySelector(`[data-ru-field="${control.dataset.ruField}"]`);
    if (!target) return;
    e.preventDefault();
    target.focus();
    if (typeof target.select === 'function' && target.matches('input')) target.select();
  });

  // ── Reordenar filas arrastrando con el ratón (HTML5 drag-and-drop) ──
  let dragRow = null;
  tbody.addEventListener('dragstart', (e) => {
    dragRow = e.target.closest('tr.ru-row');
    if (!dragRow) return;
    dragRow.classList.add('ru-row--dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox exige setData para iniciar el arrastre.
    try { e.dataTransfer.setData('text/plain', ''); } catch (_) {}
  });
  tbody.addEventListener('dragend', () => {
    dragRow?.classList.remove('ru-row--dragging');
    dragRow = null;
  });
  tbody.addEventListener('dragover', (e) => {
    if (!dragRow) return;
    e.preventDefault();
    const over = e.target.closest('tr.ru-row');
    if (!over || over === dragRow) return;
    const rect = over.getBoundingClientRect();
    const after = (e.clientY - rect.top) > rect.height / 2;
    tbody.insertBefore(dragRow, after ? over.nextElementSibling : over);
  });

  h.body.querySelector('#ruAddRow').addEventListener('click', () => {
    appendResultRow()?.querySelector('.ru-rank')?.focus();
  });
  h.body.querySelector('#ruSortRank').addEventListener('click', () => {
    const trs = [...tbody.children];
    const keyOf = (tr) => {
      const v = parseInt(tr.querySelector('.ru-rank')?.value, 10);
      return Number.isFinite(v) ? v : Infinity;
    };
    trs.map((tr, i) => ({ tr, k: keyOf(tr), i }))
      .sort((a, b) => (a.k - b.k) || (a.i - b.i))
      .forEach(({ tr }) => tbody.appendChild(tr));
  });
  h.body.querySelector('.ru-cancel').addEventListener('click', () => closeDrawer(2));

  // ── Guardado: reemplazo de filas → cabecera → pseudo-final → re-resolución ──
  const save = async () => {
    const records = [];
    for (const tr of tbody.querySelectorAll('tr.ru-row')) {
      const val = (sel) => tr.querySelector(sel)?.value.trim() ?? '';
      const txtOf = (sel) => (val(sel) === '' ? null : val(sel));
      const intOf = (sel) => {
        const v = val(sel);
        if (v === '') return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
      };
      const rank = intOf('.ru-rank');
      const irm = txtOf('.ru-irm')?.toUpperCase() || null;
      const bib = txtOf('.ru-bib');
      const name = txtOf('.ru-name');
      // Columna de tiempo única: empieza por '+' → gap; si no → tiempo absoluto.
      const timeInput = txtOf('.ru-time');
      const timeRaw = timeInput == null ? null : normalizeResultTimeInput(timeInput, rank);
      const isGap = timeRaw != null && timeRaw.startsWith('+');
      const timeText = isGap ? null : timeRaw;
      const gapText  = isGap ? timeRaw : null;
      // resultValue (crudo de la UCI) ya no se edita: se conserva el original de
      // la fila (data-rv) para no perder el respaldo que vuelca el cron.
      const resultValue = tr.dataset.rv ? tr.dataset.rv : null;
      // Descartar filas totalmente vacías ("+ Añadir fila" sin rellenar).
      if (rank == null && !bib && !name && !timeRaw
          && intOf('.ru-pts') == null && !resultValue && !irm) continue;
      records.push({
        stageRef: st.id,
        raceId: rd.raceId,
        eventId: st.eventId,
        rank,
        rankText: rank != null ? String(rank) : irm,
        bib,
        riderDisplay: name || '—',   // NOT NULL en schema; la web resuelve por dorsal
        globalRiderId: tr.dataset.gid || null,
        teamId: tr.dataset.teamId || null,   // override manual de equipo (gana al dorsal)
        resultValue,
        timeText,
        gapText,
        points: intOf('.ru-pts'),
        irm,
        sortOrder: records.length,
      });
    }

    const btns = h.body.querySelectorAll('.ru-save, .ru-cancel, #ruAddRow, #ruSortRank');
    btns.forEach(b => b.disabled = true);
    try {
      // 1) Reemplazo de filas. lockedAt se conserva: el candado solo cambia
      //    mediante el control explícito de la lista.
      const { error: delErr } = await supabase.from('race_uci_results')
        .delete().eq('stageRef', st.id);
      if (delErr) throw delErr;
      if (records.length) {
        const { error: insErr } = await supabase.from('race_uci_results').insert(records);
        if (insErr) throw insErr;
      }
      // 2) Cabecera coherente con lo editado (rowCount/winnerName son el resumen).
      const winner = records.find(r => r.rank === 1);
      const winnerName = winner
        ? (resolvedOf(winner.bib, winner.globalRiderId)?.name || (winner.riderDisplay !== '—' ? winner.riderDisplay : null))
        : null;
      const { error: updErr } = await supabase.from('race_uci_stages')
        .update({ rowCount: records.length, winnerName }).eq('id', st.id);
      if (updErr) throw updErr;

      // 3) En el último día de una vuelta, cualquier acumulada distinta de «Etapa»
      //    mantiene automáticamente su pseudo-final. Son dos cabeceras y dos juegos
      //    de filas para las rutas públicas, pero una sola unidad visible en el panel.
      if (shouldMirrorFinalClassification(st, st._isFinalRaceDay)) {
        await _ruMirrorFinalClassification(st, rd, race, records, {
          rowCount: records.length,
          winnerName,
        });
      }

      // 4) Re-resolver corredores por dorsal (no fatal: los datos ya están guardados).
      const { error: rpcErr } = await supabase.rpc('resolve_uci_results', { p_race_id: rd.raceId });
      if (rpcErr) showToast('Guardado, pero falló la re-resolución por dorsal: ' + rpcErr.message);

      showToast(shouldMirrorFinalClassification(st, st._isFinalRaceDay)
        ? 'Clasificación guardada y general final actualizada.'
        : 'Clasificación guardada.', 'success');
      closeDrawer(2);
      setupUciResultsSection(rd, race);
    } catch (err) {
      console.error(err);
      showToast('Error al guardar: ' + (err.message || err));
      btns.forEach(b => b.disabled = false);
    }
  };
  h.body.querySelectorAll('.ru-save').forEach(b => b.addEventListener('click', save));
}
