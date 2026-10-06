// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Corredores: fusión y detector de duplicados
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { openDrawer } from '../components/drawer.js';
import { confirmDialog } from '../components/dialog.js';
import {
  genderToggleHtml, setGenderToggleActive, wireGenderToggle,
} from '../components/gender-toggle.js';
import { panelState } from './state.js';
import { showToast } from './helpers.js';
import { _slRiderFlagPreview } from './startlist-picker.js';
import { _refreshOpenRoster } from './team-roster.js';
import { closeRiderEditor } from './riders.js';

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
    <div class="u-fs-080 u-c-text u-mb-060">
      <div class="u-fw-700 u-mb-020">Fusionar corredor</div>
      <div class="u-fs-072 u-c-dim">
        Origen: <strong class="u-c-text">${esc(source.lastName)}, ${esc(source.firstName)}</strong> (${linkedCount || 0} startlist${linkedCount === 1 ? '' : 's'} linkada${linkedCount === 1 ? '' : 's'})
      </div>
      <div class="u-fs-072 u-c-dim u-mt-015">Elige el corredor destino al que moverlas. El origen se eliminará.</div>
    </div>
    <input type="search" class="merge-picker-input" placeholder="Buscar destino por apellido, nombre u otherNames…">
    <div class="merge-picker-results"></div>
    <div class="merge-picker-footer">
      <button data-action="close" type="button" class="btn btn--ghost u-btn-sm u-fs-072">Cancelar</button>
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
    if (q.length < 2) {
      results.innerHTML = '<div class="u-c-dim u-fs-072 u-p-030">Escribe al menos 2 letras.</div>';
      return;
    }
    results.innerHTML = '<div class="u-c-dim u-fs-072 u-p-030">Buscando…</div>';
    const safe = q.replace(/[%,()]/g, '');
    const { data, error } = await supabase.from(table)
      .select('id,firstName,lastName,otherNames,nationality,currentTeamId,verified,source')
      .or(`lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`)
      .neq('id', panelState._editingRiderId)   // no permitir auto-merge
      .order('lastName').limit(25);
    if (myId !== reqId) return;
    if (error) { results.innerHTML = `<div class="u-c-red u-fs-072 u-p-030">Error: ${esc(error.message)}</div>`; return; }
    if (!data?.length) {
      results.innerHTML = '<div class="u-c-dim u-fs-072 u-p-030">Sin resultados.</div>';
      return;
    }
    results.innerHTML = data.map(rd => `
      <button type="button" data-tid="${esc(rd.id)}" class="merge-picker-option">
        ${_slRiderFlagPreview(rd.nationality)}
        <span class="u-grow u-min0"><strong>${esc(rd.lastName)}</strong>, ${esc(rd.firstName)}${rd.otherNames ? ` <span class="u-c-dim u-fs-070">(${esc(rd.otherNames)})</span>` : ''}</span>
        ${rd.verified === false ? '<span title="Sin verificar" class="u-c-warn u-fs-065 u-fw-700">?</span>' : '<span title="Verificado" class="u-c-ok u-fs-065 u-fw-700">✓</span>'}
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

// ── Detector de duplicados ──────────────────────────────────────────
// Heurística: agrupa por (lastName_normalizado, primera_letra_firstName_normalizado).
// Score por cluster: misma nacionalidad +2, mismo equipo +1, firstName completo
// idéntico +3, mezcla verified/unverified +2. Los de score alto son los más
// probables duplicados y se muestran primero.

function _dupNorm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

// ¿Comparten estos dos riders alguna carrera? Si sí, son PERSONAS DISTINTAS con
// práctica certeza (nadie corre dos veces la misma carrera) → NO fusionar.
// Usa el mapa racesByRider que ya carga el escáner (sin consulta extra).
function _dupShareRace(a, b, racesByRider) {
  const ra = racesByRider.get(a.id), rb = racesByRider.get(b.id);
  if (!ra || !rb || !ra.length || !rb.length) return false;
  const set = new Set(ra.map(r => r.raceId));
  return rb.some(r => set.has(r.raceId));
}

// Señal "mismo humano por nombre": uno es prefijo del otro (nombre incompleto vs
// con 2º nombre: "Sven" ⊂ "Sven Aleksander") o difieren en muy poco (typo /
// transliteración: "Jillian"/"Jilllian", "Yulia"/"Yuliia").
function _dupNameLikelySame(a, b) {
  const na = _dupNorm(a.firstName), nb = _dupNorm(b.firstName);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;   // prefijo
  if (Math.abs(na.length - nb.length) <= 2 && _dupEditDistance(na, nb) <= 2) return true;
  return false;
}

// Levenshtein simple (sin dependencias; nombres son cortos).
function _dupEditDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Devuelve { score, distinct } para un cluster. Si racesByRider está disponible,
// refina: penaliza fuerte los pares que comparten carrera (personas distintas) y
// premia los que comparten fecha de nacimiento o nombre casi idéntico.
function _scoreDupCluster(riders, racesByRider = null) {
  const nationalities = new Set(riders.map(r => r.nationality).filter(Boolean));
  const teams         = new Set(riders.map(r => r.currentTeamId).filter(Boolean));
  const firstNames    = new Set(riders.map(r => _dupNorm(r.firstName)));
  const hasVerified   = riders.some(r => r.verified === true);
  const hasUnverified = riders.some(r => r.verified === false);
  let s = 0;
  if (nationalities.size <= 1)                s += 2;   // todos misma nat (o NULL)
  if (teams.size === 1)                       s += 1;
  if (firstNames.size === 1 && [...firstNames][0]) s += 3;  // nombre exacto idéntico
  if (hasVerified && hasUnverified)           s += 2;

  // Señales por par (solo con el mapa de carreras cargado).
  let anyShareRace = false, anySameDob = false, anyNameSame = false;
  if (racesByRider) {
    for (let i = 0; i < riders.length; i++) {
      for (let j = i + 1; j < riders.length; j++) {
        const a = riders[i], b = riders[j];
        if (_dupShareRace(a, b, racesByRider)) anyShareRace = true;
        if (a.birthDate && b.birthDate && a.birthDate === b.birthDate) anySameDob = true;
        if (_dupNameLikelySame(a, b)) anyNameSame = true;
      }
    }
  }
  // Misma fecha de nacimiento = señal fuerte de mismo humano (salvo gemelos, que
  // suelen compartir carrera → los caza anyShareRace). Nombre casi idéntico = idem.
  if (anySameDob)  s += 4;
  if (anyNameSame) s += 3;
  // Compartir carrera DESCARTA: son personas distintas. Hundir el cluster.
  if (anyShareRace) s -= 10;

  return { score: s, distinct: anyShareRace };
}

// Catálogo (masc/fem) que escanea el detector de duplicados. Independiente del
// editor: el escáner se dispara desde Equipos y tiene su propio toggle en el modal.
let _dupScanGender = 'male';
const _updateDupScanGenderToggle = () =>
  setGenderToggleActive('dupScanGenderMale', 'dupScanGenderFemale', _dupScanGender);

// Cuerpo del escáner de duplicados (mismos ids que el markup estático que
// sustituye). El ✕ lo da el drawer; el toggle masc/fem se cablea por apertura.
function dupScanBodyHtml() {
  return `
    <div class="u-between u-gap-100 u-mb-100 u-wrap">
      <div class="u-fs-080 u-c-dim" id="dupScanSubtitle"></div>
      ${genderToggleHtml({ idMale: 'dupScanGenderMale', idFemale: 'dupScanGenderFemale', value: _dupScanGender, labels: { male: 'Masculino', female: 'Femenino' } })}
    </div>
    <div class="u-stack" id="dupScanContent"></div>`;
}

function wireDupScan() {
  wireGenderToggle('dupScanGenderMale', 'dupScanGenderFemale', (g) => {
    _dupScanGender = g; _updateDupScanGenderToggle(); openDuplicateScanner();
  });
}

export async function openDuplicateScanner() {
  // Montar el escáner en el drawer (ancho). Si ya está abierto (p.ej. al
  // togglear género), se reusa y solo se re-renderiza el contenido.
  if (!document.getElementById('dupScanContent')) {
    openDrawer({
      title: 'Posibles duplicados',
      level: 1,
      wide: true,
      render: (body) => { body.innerHTML = dupScanBodyHtml(); wireDupScan(); },
    });
  }
  const content = document.getElementById('dupScanContent');
  const subtitle = document.getElementById('dupScanSubtitle');
  _updateDupScanGenderToggle();
  content.innerHTML = '<div class="u-empty-note">Cargando catálogo…</div>';
  subtitle.textContent = `Catálogo: ${_dupScanGender === 'male' ? 'masculino' : 'femenino'}`;

  const table = _dupScanGender === 'male' ? 'riders_men' : 'riders_women';
  // PostgREST aplica un tope server-side de 1.000 filas que ignora .range()
  // por encima de ese valor. Paginamos manualmente en chunks de 1.000 hasta
  // agotar la tabla para garantizar el barrido COMPLETO del catálogo.
  const riders = [];
  let error = null;
  let offset = 0;
  const CHUNK = 1000;
  while (true) {
    // Paginar por una clave ÚNICA (id), no por lastName: lastName se repite mucho
    // (cientos de apellidos iguales) y PostgREST no garantiza orden estable entre
    // páginas con claves no únicas → filas del borde se duplican o se saltan
    // (causa del "mismo corredor ×2" en el escáner).
    const { data, error: err } = await supabase
      .from(table).select('*').order('id').range(offset, offset + CHUNK - 1);
    if (err) { error = err; break; }
    if (!data || !data.length) break;
    riders.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
    content.innerHTML = `<div class="u-empty-note">Cargando catálogo… ${riders.length} corredores leídos</div>`;
  }
  if (error) {
    content.innerHTML = `<div class="u-c-red u-p-100">Error: ${esc(error.message)}</div>`;
    return;
  }

  const groups = new Map();
  for (const r of (riders || [])) {
    const last = _dupNorm(r.lastName);
    const firstInitial = _dupNorm(r.firstName).charAt(0);
    if (!last) continue;
    const key = `${last}|${firstInitial}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const skipped = _getDupSkipSet();
  const clusters = [];
  let skippedCount = 0;
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const idsKey = list.map(r => r.id).sort().join('|');
    if (skipped.has(idsKey)) { skippedCount++; continue; }
    // Score base (sin carreras todavía). Se refina tras cargar racesByRider.
    const base = _scoreDupCluster(list);
    clusters.push({ key, idsKey, riders: list, score: base.score, distinct: base.distinct });
  }
  clusters.sort((a, b) => b.score - a.score || b.riders.length - a.riders.length);

  subtitle.innerHTML = `${clusters.length} grupos a revisar en ${riders.length} ${_dupScanGender === 'male' ? 'corredores' : 'corredoras'} · ordenados por probabilidad${skippedCount ? ` · <button id="dupClearSkipped" class="link-button">${skippedCount} saltados (limpiar)</button>` : ''}.`;
  document.getElementById('dupClearSkipped')?.addEventListener('click', async () => {
    if (await confirmDialog(`¿Olvidar los ${skippedCount} grupos saltados y volver a mostrarlos?`)) {
      _clearDupSkipSet();
      openDuplicateScanner();
    }
  });

  if (!clusters.length) {
    content.innerHTML = `<div class="u-empty-note">${skippedCount ? `Sin duplicados nuevos. ${skippedCount} grupos saltados previamente.` : 'Sin duplicados aparentes 🎉'}</div>`;
    return;
  }

  // Carga las carreras donde aparece cada rider de los clusters detectados,
  // para mostrarlas en cada fila como ayuda al admin (saber dónde se ha visto
  // a cada candidato facilita decidir cuál es el canónico).
  content.innerHTML = '<div class="u-empty-note">Cargando carreras…</div>';
  const allClusterIds = [...new Set(clusters.flatMap(c => c.riders.map(r => r.id)))];
  const racesByRider = await _loadRacesForRiders(allClusterIds);

  // Ahora que tenemos las carreras, refinamos score+distinct (compartir carrera =
  // personas distintas → se hunde; misma fecha / nombre casi idéntico → sube) y
  // reordenamos: los duplicados REALES suben arriba, los falsos positivos
  // (gemelos, hermanos, homónimos) caen al fondo.
  for (const c of clusters) {
    const refined = _scoreDupCluster(c.riders, racesByRider);
    c.score = refined.score;
    c.distinct = refined.distinct;
  }
  clusters.sort((a, b) => b.score - a.score || b.riders.length - a.riders.length);

  _renderDupClusters(clusters, table, racesByRider);
}

// Map<riderId, [{raceId, name, year}, ...]> para cada rider que aparece en
// startlist_riders. Pagina chunks de 200 IDs (URL length) × páginas de 1000
// (límite PostgREST) y deduplica por raceId.
async function _loadRacesForRiders(riderIds) {
  const map = new Map();
  if (!riderIds.length) return map;
  const CHUNK = 200;
  for (let i = 0; i < riderIds.length; i += CHUNK) {
    const slice = riderIds.slice(i, i + CHUNK);
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('startlist_riders')
        .select('globalRiderId, raceId, races!inner(name, year)')
        .in('globalRiderId', slice)
        .range(offset, offset + 999);
      if (error) { console.warn('[loadRacesForRiders]', error); break; }
      if (!data?.length) break;
      for (const row of data) {
        const rid = row.globalRiderId;
        if (!map.has(rid)) map.set(rid, new Map());
        const inner = map.get(rid);
        if (!inner.has(row.raceId)) {
          inner.set(row.raceId, { raceId: row.raceId, name: row.races?.name || row.raceId, year: row.races?.year });
        }
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  // Convertir Maps internos a arrays ordenados por año desc
  const out = new Map();
  for (const [rid, inner] of map) {
    out.set(rid, [...inner.values()].sort((a, b) => (b.year || 0) - (a.year || 0)));
  }
  return out;
}

// Persistencia local de los clusters saltados (per-navegador, suficiente para
// una herramienta de admin individual). La clave es el join de IDs ordenados;
// si alguno de los riders del cluster cambia (fusión externa, edición), el
// cluster pasa a tener IDs distintos y vuelve a aparecer.
const DUP_SKIP_KEY = 'cc_dupScanSkipped';
function _getDupSkipSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DUP_SKIP_KEY) || '[]')); }
  catch { return new Set(); }
}
function _addDupSkip(idsKey) {
  const s = _getDupSkipSet();
  s.add(idsKey);
  localStorage.setItem(DUP_SKIP_KEY, JSON.stringify([...s]));
}
function _clearDupSkipSet() {
  localStorage.removeItem(DUP_SKIP_KEY);
}

function _renderDupClusters(clusters, table, racesByRider = new Map()) {
  const content = document.getElementById('dupScanContent');
  const teamsMap = Object.fromEntries((panelState._teamsCache || []).map(t => [t.id, t]));

  // Helper para listar las carreras de un rider de forma compacta.
  const racesChip = (riderId) => {
    const races = racesByRider.get(riderId) || [];
    if (!races.length) return '<span class="u-fs-068 u-c-dim u-italic">sin startlists</span>';
    const fullList = races.map(r => `${r.name}${r.year ? ' ' + r.year : ''}`).join(' · ');
    const visible = races.slice(0, 3).map(r => `<span class="dup-race-chip">${esc(r.name || r.raceId)}${r.year ? ` <span class="u-o70">${r.year}</span>` : ''}</span>`).join(' ');
    const more = races.length > 3 ? ` <span class="u-fs-066 u-c-dim u-help" title="${esc(fullList)}">+${races.length - 3} más</span>` : '';
    return `<span class="dup-race-list" title="${esc(fullList)}">${visible}${more}</span>`;
  };

  content.innerHTML = clusters.map((c, idx) => {
    const sample = c.riders[0];
    const headerName = `${sample.lastName}, ${_dupNorm(sample.firstName).charAt(0).toUpperCase() || '·'}…`;
    // distinct = comparten al menos una carrera → personas distintas con certeza.
    // Se avisa explícitamente para que el admin NO los fusione por error.
    const scoreBadge = c.distinct
      ? '<span title="Comparten carrera → no pueden ser la misma persona" class="dup-score dup-score--distinct">⚠ DISTINTOS (misma carrera)</span>'
      : c.score >= 7
        ? '<span class="dup-score dup-score--probable">PROBABLE</span>'
        : c.score >= 4
          ? '<span class="dup-score dup-score--possible">POSIBLE</span>'
          : '<span class="dup-score dup-score--doubtful">DUDOSO</span>';

    const ridersHtml = c.riders.map(r => {
      const team = teamsMap[r.currentTeamId];
      const checked = r.verified === true ? 'checked' : '';
      // Inputs editables: el admin puede afinar firstName/lastName/nationality
      // directamente en la fila antes (o sin) fusionar. Cada fila tiene un
      // botón "Guardar" que aplica los cambios SOLO a esa fila sin fusionar.
      // Guardamos el estado original como data-attrs para detectar cambios.
      const origLast = r.lastName || '';
      const origFirst = r.firstName || '';
      const origNat = r.nationality || '';
      return `<div data-rider-id="${esc(r.id)}" data-orig-last="${esc(origLast)}" data-orig-first="${esc(origFirst)}" data-orig-nat="${esc(origNat)}" class="dup-rider-row">
        <div class="dup-rider-fields">
          <input type="radio" name="dup-cluster-${idx}" value="${esc(r.id)}" ${checked} title="Marcar como canónico" class="u-m0 u-shrink-0 u-pointer">
          <span class="dup-flag-preview u-minw-140 u-center u-shrink-0">${_slRiderFlagPreview(r.nationality)}</span>
          <input type="text" class="dup-lastname dup-input dup-input--last" value="${esc(origLast)}" placeholder="Apellidos">
          <input type="text" class="dup-firstname dup-input dup-input--first" value="${esc(origFirst)}" placeholder="Nombre">
          <input type="text" class="dup-nationality dup-input dup-input--nat" value="${esc(origNat)}" placeholder="es" maxlength="5" title="ISO 3166-1 alpha-2">
          <button data-dup-action="save-row" title="Guardar cambios de esta fila (sin fusionar)" disabled class="dup-save-btn" style="opacity:0.45">💾</button>
          ${r.otherNames ? `<span class="u-c-dim u-fs-070 u-shrink-0" title="otherNames: ${esc(r.otherNames)}">+aliases</span>` : ''}
          <span class="u-fs-068 u-fw-700 u-shrink-0 ${r.verified ? 'u-c-ok' : 'u-c-warn'}">${r.verified ? '✓' : '?'}</span>
          <span class="u-fs-068 u-c-dim u-shrink-0">${esc(r.source || '')}</span>
          <span class="dup-team-name">${team ? esc(team.name) : '<em>sin equipo</em>'}</span>
          <code class="u-fs-062 u-c-dim u-shrink-0">${esc(r.id)}</code>
        </div>
        <div class="u-pl-160">${racesChip(r.id)}</div>
      </div>`;
    }).join('');

    return `<div data-cluster-idx="${idx}" class="dup-cluster">
      <div class="u-row u-justify-between u-mb-050 u-wrap">
        <div class="u-row">
          <strong class="u-fs-085">${esc(headerName)}</strong>
          <span class="u-fs-072 u-c-dim">${c.riders.length} candidatos</span>
          ${scoreBadge}
        </div>
        <div class="u-flex u-gap-040">
          <button data-dup-action="merge" data-cluster-idx="${idx}" class="btn btn--primary btn--compact">Fusionar en el seleccionado</button>
          <button data-dup-action="skip" data-cluster-idx="${idx}" class="btn btn--ghost btn--compact">Saltar</button>
        </div>
      </div>
      <div class="u-stack u-stack--xs">${ridersHtml}</div>
    </div>`;
  }).join('');

  // Listeners
  content.querySelectorAll('[data-dup-action="skip"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.clusterIdx);
      const cluster = clusters[idx];
      // Persistir el "saltar" en localStorage. Mientras los IDs del cluster
      // no cambien (fusión, edición), no se volverá a mostrar.
      if (cluster?.idsKey) _addDupSkip(cluster.idsKey);
      content.querySelector(`[data-cluster-idx="${idx}"]`).remove();
    });
  });
  // Detección de cambios en cualquier input → habilita el botón Guardar.
  // Y al teclear nacionalidad, refresca la bandera.
  const _toggleRowSave = (row) => {
    const last  = row.querySelector('.dup-lastname').value.trim();
    const first = row.querySelector('.dup-firstname').value.trim();
    const nat   = row.querySelector('.dup-nationality').value.trim().toLowerCase();
    const dirty = (
      last  !== (row.dataset.origLast  || '') ||
      first !== (row.dataset.origFirst || '') ||
      nat   !== (row.dataset.origNat   || '')
    ) && last && first;
    const btn = row.querySelector('[data-dup-action="save-row"]');
    if (btn) { btn.disabled = !dirty; btn.style.opacity = dirty ? '1' : '0.45'; }
  };
  content.querySelectorAll('[data-rider-id]').forEach(row => {
    row.querySelectorAll('.dup-lastname, .dup-firstname, .dup-nationality').forEach(inp => {
      inp.addEventListener('input', () => {
        if (inp.classList.contains('dup-nationality')) {
          const flagEl = row.querySelector('.dup-flag-preview');
          if (flagEl) flagEl.innerHTML = _slRiderFlagPreview(inp.value.trim().toLowerCase());
        }
        _toggleRowSave(row);
      });
    });
  });
  content.querySelectorAll('[data-dup-action="save-row"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-rider-id]');
      const id  = row.dataset.riderId;
      const last  = row.querySelector('.dup-lastname').value.trim();
      const first = row.querySelector('.dup-firstname').value.trim();
      const natRaw = row.querySelector('.dup-nationality').value.trim().toLowerCase();
      const nat = natRaw || null;
      if (!last || !first) { showToast('Necesita nombre y apellido', 'error'); return; }
      btn.disabled = true; btn.textContent = '…';
      const { error } = await supabase.from(table).update({
        firstName: first, lastName: last, nationality: nat,
        verified: true,  // editar manualmente implica validación
        updatedAt: new Date().toISOString(),
      }).eq('id', id);
      if (error) {
        btn.disabled = false; btn.textContent = '💾';
        if (error.code === '23505' && /identity_key/i.test(error.message || '')) {
          // Renombrar esta ficha la dejaría con el mismo DNI que otra existente.
          // Si las dos son la MISMA persona, no la edites: fusiónalas (botón
          // "Fusionar en el seleccionado"). Si es otra persona, ponle un nombre
          // distinto.
          showToast('Ese nombre ya lo tiene otro corredor (mismo DNI). Si es el mismo, fusiónalos en vez de editar; si es otro, usa un nombre distinto.', 'error');
        } else {
          showToast('Error: ' + error.message, 'error');
        }
        return;
      }
      // Actualizar baseline + objeto en memoria del cluster
      row.dataset.origLast = last;
      row.dataset.origFirst = first;
      row.dataset.origNat = natRaw;
      const cluster = clusters.find(c => c.riders.some(r => r.id === id));
      const cached = cluster?.riders.find(r => r.id === id);
      if (cached) { cached.firstName = first; cached.lastName = last; cached.nationality = nat; cached.verified = true; }
      btn.textContent = '💾'; btn.style.opacity = '0.45';
      // Flash verde breve para feedback visual
      const prevBg = row.style.background;
      row.style.background = '#22c55e22';
      setTimeout(() => { row.style.background = prevBg; }, 600);
      showToast('Guardado', 'success');
    });
  });
  content.querySelectorAll('[data-dup-action="merge"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.clusterIdx);
      const cluster = clusters[idx];
      const selected = content.querySelector(`input[name="dup-cluster-${idx}"]:checked`);
      if (!selected) { showToast('Marca el corredor que se queda', 'error'); return; }
      const targetId = selected.value;
      const target = cluster.riders.find(r => r.id === targetId);
      const sources = cluster.riders.filter(r => r.id !== targetId);

      // Leer valores editados de la fila seleccionada (puede que el admin haya
      // ajustado mayúsculas, apellido compuesto o nacionalidad).
      const targetRow = selected.closest('[data-rider-id]');
      const editedFirst = (targetRow.querySelector('.dup-firstname').value || '').trim();
      const editedLast  = (targetRow.querySelector('.dup-lastname').value  || '').trim();
      const editedNatRaw = (targetRow.querySelector('.dup-nationality').value || '').trim().toLowerCase();
      const editedNat = editedNatRaw || null;

      if (!editedFirst || !editedLast) { showToast('El canónico necesita nombre y apellido', 'error'); return; }

      const targetChanged =
        editedFirst !== (target.firstName || '') ||
        editedLast  !== (target.lastName  || '') ||
        editedNat   !== (target.nationality || null);

      const summary = `Fusionar ${sources.length} corredor(es) en "${editedLast}, ${editedFirst}"${editedNat ? ' (' + editedNat + ')' : ''}?

${targetChanged ? '• El canónico se actualizará con los valores editados (verified=true).\n' : ''}• Todas las startlists de los demás se reapuntarán al canónico.
• Los demás se eliminarán de la BD.`;
      if (!await confirmDialog(summary, { danger: true, title: 'Fusionar corredores' })) return;

      btn.disabled = true; btn.textContent = 'Fusionando…';

      // ORDEN CLAVE: borrar los duplicados PRIMERO, editar el canónico DESPUÉS.
      // Si editáramos el canónico antes, su identityKey recalculado (trigger 075)
      // podría chocar con el de un duplicado del MISMO cluster que aún no se ha
      // borrado → el índice UNIQUE rechaza el UPDATE ("duplicate key identity_key").
      // Refrescamos el objeto target en memoria con los valores editados para que
      // _mergeRidersSilent consolide otherNames bien (no depende de que el UPDATE
      // ya esté en BD).
      target.firstName   = editedFirst;
      target.lastName    = editedLast;
      target.nationality = editedNat;

      // 1. Fusionar/borrar los perdedores (libera sus identityKey del índice).
      let merged = 0;
      let failed = 0;
      for (const src of sources) {
        const { ok, error } = await _mergeRidersSilent(src, target, table);
        if (ok) merged++; else { failed++; console.error('[merge]', src.id, error); }
      }

      // 2. Aplicar la edición al canónico (verified=true: el admin lo revisó).
      //    Ya borrados los duplicados del cluster, un identityKey que solo chocaba
      //    con ellos pasa sin problema. Si AÚN choca, es un homónimo de FUERA del
      //    cluster (otra persona real) → mensaje claro en vez del error crudo.
      if (targetChanged || target.verified !== true) {
        const { error: upErr } = await supabase.from(table).update({
          firstName: editedFirst,
          lastName: editedLast,
          nationality: editedNat,
          verified: true,
          updatedAt: new Date().toISOString(),
        }).eq('id', target.id);
        if (upErr) {
          btn.disabled = false; btn.textContent = 'Fusionar en el seleccionado';
          if (upErr.code === '23505' && /identity_key/i.test(upErr.message || '')) {
            showToast('Los duplicados se fusionaron, pero ese nombre ya lo tiene OTRO corredor (mismo DNI) fuera de este grupo. Edítalo distinto o déjalo como estaba.', 'error');
          } else {
            showToast('Duplicados fusionados, pero no se pudo guardar el nombre editado: ' + upErr.message, 'error');
          }
          content.querySelector(`[data-cluster-idx="${idx}"]`)?.remove();
          return;
        }
        target.verified = true;
      }

      content.querySelector(`[data-cluster-idx="${idx}"]`).remove();
      showToast(failed
        ? `Fusionados ${merged}/${sources.length}. Errores: ${failed}. Revisa consola.`
        : `${merged} corredor(es) fusionados en ${target.lastName}.`,
        failed ? 'error' : 'success');
    });
  });
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
