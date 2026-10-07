// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Fichajes: mercado de la temporada
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { activeCatalogTeams } from '../services/team-catalog.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import { confirmDialog } from '../components/dialog.js';
import {
  isInitialTransferImport, isMarketDestinationTeamEligible, MARKET_DESTINATION_DIVISIONS,
  marketDestinationTeamOptions, transferEditorAnnouncementDate,
  transferRiderInitialGender,
} from '../services/transfer-rider.js';
import { panelState } from './state.js';
import { MARKET_PREV_SEASON, MARKET_SEASON } from './constants.js';
import { showToast } from './helpers.js';
import { _slRiderFlagPreview } from './startlist-picker.js';
import { fetchTeams, fetchTeamSeasonsForYear, openTeamEditor } from './teams.js';
import { openRiderEditor } from './riders.js';
import {
  _affYear, _clearOtherTransfersForRider, _deleteAffiliation2027,
  _syncMarketSituationAffiliation, _syncSigningAffiliation, openTeamSituationEditor,
  TSE_LIFETIME_YEAR, TSE_STATES, TSE_UNKNOWN_DEST,
} from './team-situation.js';

// ═════════════════════════════════════════════════════════════════
//  FICHAJES — mercado de la temporada 2027 (rider_transfers, mig. 122)
// ═════════════════════════════════════════════════════════════════
//
// Un movimiento por fila. Convención por type (espejo del CHECK de la 122):
//   'transfer'   → fromTeam* = equipo que deja, toTeam* = al que va.
//   'renewal'    → toTeamId  = equipo con el que renueva (fromTeam* NULL).
//   'retirement' → fromTeam* = equipo que deja (toTeam* NULL).
// fromTeamName/toTeamName = texto libre para equipos fuera del catálogo.
// status 'rumor' NO aparece en el feed público de confirmaciones; en el detalle
// de equipo sale con badge Rumor. Al confirmar con contrato, se sincroniza
// riders_*.contractUntil (lo muestra la sección "continúan").

let _transfersViewReady   = false;
let _marketDiv            = 'WT';    // división activa en la lista de equipos
// El nombre de un equipo depende del LADO del movimiento: de dónde sale un
// corredor es el equipo de la temporada en curso (2026, la que se está
// corriendo); a dónde va es el de la temporada del mercado (2027). Un mapa por
// año; `teams` NO sirve de archivo histórico (su trigger sync_team_to_season
// pisa siempre el año en curso). Espejo de js/fichajes.js.
let _trTeamNamePrev       = new Map();  // teamId → nombre 2026 (origen)
let _editingTransferId    = null;
let _trAutoResolvedExisting = false;
let _trSelectedRider      = null;    // { id, gender, firstName, lastName, nationality, currentTeamId }
let _trSearchDebounce     = null;
let _trSituationState     = 'undecided';
let _trYearUnknown        = false;
let _trLifetime           = false;

export function _localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function setupFichajesView() {
  if (!_transfersViewReady) {
    _transfersViewReady = true;
    const bind = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
      else console.warn(`[setupFichajesView] #${id} no existe en el DOM — listener omitido (¿app.html cacheado?)`);
    };
    // La vista es equipo-céntrica (espejo del front): división → equipo →
    // editor de temporada 2027. La lista plana de TODOS los movimientos queda
    // como herramienta de auditoría en un drawer aparte.
    bind('newTeam27Btn', 'click', openTeamEditorForMarket);
    bind('addTransferDirectBtn', 'click', () => openTransferEditor(null));
    bind('allTransfersBtn', 'click', openAllTransfersDrawer);
    const seasonEl = document.getElementById('fichajesSeason');
    if (seasonEl) seasonEl.textContent = `· temporada ${MARKET_SEASON}`;
  }
  // Fichajes combina `teams` con `team_seasons`. Forzar ambas lecturas evita
  // que un equipo recién creado aparezca en la lista 2027 pero falte en los
  // selectores por conservar un `_teamsCache` anterior de otra sección.
  await fetchTeams({ force: true });
  await loadTransfers();
  renderMarketTeams();
}

// ── Lista de equipos de la temporada del mercado ──────────────────
// Espejo de la lista pública de /fichajes/: 4 divisiones, orden alfabético.
// Es el atajo para renombrar un equipo 2027 (sponsor nuevo), moverlo de
// división, publicar sus colores o marcar su continuidad en duda sin salir a la
// vista Equipos.
const MARKET_DIVISIONS = MARKET_DESTINATION_DIVISIONS;

export function renderMarketTeams() {
  const btns = document.getElementById('marketDivBtns');
  const list = document.getElementById('marketTeamsList');
  if (!btns || !list) return;

  btns.innerHTML = MARKET_DIVISIONS.map(d => {
    const active = d === _marketDiv;
    const n = panelState._marketSeasons.filter(s => s.category === d).length;
    return `<button class="btn ${active ? 'btn--primary' : 'btn--ghost'}" data-mdiv="${d}">${d}${n ? ` <span class="u-o65">${n}</span>` : ''}</button>`;
  }).join('');
  btns.querySelectorAll('[data-mdiv]').forEach(b =>
    b.addEventListener('click', () => { _marketDiv = b.dataset.mdiv; renderMarketTeams(); })
  );

  const teams = panelState._marketSeasons
    .filter(s => s.category === _marketDiv)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));

  if (teams.length === 0) {
    list.innerHTML = `<div class="u-fs-3 u-c-dim u-py-050 u-px-0">Sin equipos en esta división. Usa <strong>+ Equipo ${MARKET_SEASON}</strong> para crear uno que nazca este año.</div>`;
    return;
  }

  const chip = (text, color) =>
    `<span class="market-chip" style="--chip-color:${color}">${esc(text)}</span>`;

  list.innerHTML = teams.map(s => {
    // El nombre de la temporada EN CURSO cuando difiere del del mercado: es la
    // señal de un renombre de sponsor ya registrado.
    const prev = _trTeamNamePrev.get(s.teamId);
    const renamed = prev && prev !== s.name;
    // Colores que se verán en Fichajes: paleta 2027 publicada / paleta anterior
    // (equipo que ya existía en la temporada previa) / vacío (equipo nuevo, sin
    // kit antiguo que enseñar). `prev` truthy = hay fila team_seasons previa.
    const badgeChip = s.badgeVisible
      ? chip(`Colores ${MARKET_SEASON}`, 'var(--green)')
      : prev
        ? chip(`Colores ${MARKET_PREV_SEASON}`, 'var(--text-muted)')
        : chip('Nuevo · sin colores', 'var(--orange)');
    return `
      <div class="market-team-row" data-team="${esc(s.teamId)}">
        <span class="u-grow u-min0 u-fs-3"><strong>${esc(s.name || s.teamId)}</strong>
          ${renamed ? `<span class="u-c-dim u-fs-1 u-ml-030">· ${MARKET_PREV_SEASON}: ${esc(prev)}</span>` : ''}
        </span>
        ${s.continuityDoubt ? chip('Duda', 'var(--orange)') : ''}
        ${badgeChip}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="u-c-dim u-shrink-0"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }).join('');

  list.querySelectorAll('.market-team-row').forEach(row => {
    // Tocar un equipo abre su EDITOR DE TEMPORADA 2027 (situación de cada
    // corredor + incorporaciones), no el editor de identidad — ese vive dentro,
    // en un botón de la cabecera del drawer.
    row.addEventListener('click', () => openTeamSituationEditor(row.dataset.team));
  });
}

/**
 * Abre el editor de un equipo YA existente enfocado en su temporada del
 * mercado: despliega el panel «Temporada 2027» y lleva el foco al nombre (el
 * caso de uso normal desde aquí es un renombre de sponsor).
 */
export async function openTeamEditorForSeason(teamId) {
  await Promise.all([fetchTeams(), fetchTeamSeasonsForYear(MARKET_SEASON)]);
  openTeamEditor(teamId, { seasonYear: MARKET_SEASON });
  setTimeout(() => {
    document.getElementById('te-name')?.focus();
  }, 260);
}

// Equipo NUEVO para el mercado (nace en 2027, aún no existe en el catálogo):
// reutiliza el editor de equipo estándar — al guardar la identidad aparece el
// panel "Temporada 2027", donde se fijan nombre, categoría y colores de 2027.
// Un equipo sin startlists 2026 no aparece en ninguna superficie pública del
// año en curso, así que crear la identidad ahora es inocuo.
async function openTeamEditorForMarket() {
  await fetchTeams();
  openTeamEditor(null);
  // Nace en la temporada del mercado → firstSeason en el INSERT (mig. 129): el
  // trigger no le estampará una temporada del año en curso, así que NO tendrá
  // colores anteriores y el mercado lo dejará vacío hasta publicar los nuevos.
  panelState._newTeamMarketBorn = true;
  const status = document.getElementById('teamSaveStatus');
  if (status) status.textContent = `Equipo nuevo para el mercado ${MARKET_SEASON}: guarda la identidad (nombre + categoría) y rellena después el panel «Temporada ${MARKET_SEASON}».`;
}

// ── Drawer de auditoría: TODOS los movimientos (lista plana, filtros) ──
function openAllTransfersDrawer() {
  openDrawer({
    title: `Todos los movimientos · ${MARKET_SEASON}`,
    level: 1,
    wide: true,
    render: (body) => {
      body.innerHTML = `
        <div class="u-row u-gap-060 u-wrap u-mb-075">
          <input type="search" id="transfersSearch" placeholder="Buscar corredor o equipo…" class="panel-search u-grow u-minw-1200">
          <select id="transfersStatusFilter" class="panel-search u-px-050 u-fs-2">
            <option value="all">Todos</option>
            <option value="confirmed">Confirmados</option>
            <option value="rumor">Rumores</option>
            <option value="doubt">Dudas</option>
            <option value="hidden">Fecha oculta</option>
          </select>
          <button class="btn btn--primary btn--view" id="addTransferBtn">+ Nuevo movimiento</button>
          <span class="u-fs-1 u-c-dim u-self-center" id="transfersCount"></span>
        </div>
        <div class="panel-list" id="transfersList"><div class="u-fs-3 u-c-dim">Cargando…</div></div>
      `;
      document.getElementById('addTransferBtn').addEventListener('click', () => openTransferEditor(null));
      document.getElementById('transfersStatusFilter').addEventListener('change', renderTransfersList);
      document.getElementById('transfersSearch').addEventListener('input', renderTransfersList);
      renderTransfersList();
    },
  });
}

export async function loadTransfers() {
  const list = document.getElementById('transfersList');
  if (list) list.innerHTML = '<div class="u-fs-3 u-c-dim">Cargando…</div>';
  try {
    const [transfersRes, seasonsRes, prevSeasonsRes] = await Promise.all([
      supabase.from('rider_transfers')
        .select('*')
        .eq('season', MARKET_SEASON)
        .order('announcedAt', { ascending: false })
        .order('createdAt', { ascending: false }),
      supabase.from('team_seasons')
        .select('teamId, name, category, badgeVisible, continuityDoubt')
        .eq('year', MARKET_SEASON),
      supabase.from('team_seasons').select('teamId, name').eq('year', MARKET_PREV_SEASON),
    ]);
    if (transfersRes.error) throw transfersRes.error;
    if (seasonsRes.error) throw seasonsRes.error;
    if (prevSeasonsRes.error) throw prevSeasonsRes.error;
    const rows = transfersRes.data || [];
    // Filas completas de la temporada del mercado: alimentan la lista de
    // equipos 2027 de esta vista (renombres, colores, continuidad en duda).
    panelState._marketSeasons = seasonsRes.data || [];
    panelState._trTeamNameById = new Map(panelState._marketSeasons.map(s => [s.teamId, s.name]));
    _trTeamNamePrev = new Map((prevSeasonsRes.data || []).map(s => [s.teamId, s.name]));

    // Hidratar fichas (nombre + bandera) por género, en bulk.
    const cols = 'id, firstName, lastName, nationality, currentTeamId, contractUntil';
    const menIds   = [...new Set(rows.filter(r => r.riderGender === 'male').map(r => r.riderId))];
    const womenIds = [...new Set(rows.filter(r => r.riderGender === 'female').map(r => r.riderId))];
    const [men, women] = await Promise.all([
      menIds.length   ? supabase.from('riders_men').select(cols).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
      womenIds.length ? supabase.from('riders_women').select(cols).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
    ]);
    const riderByKey = new Map();
    men.forEach(r => riderByKey.set(`male:${r.id}`, r));
    women.forEach(r => riderByKey.set(`female:${r.id}`, r));
    panelState._transfersCache = rows.map(t => ({ ...t, rider: riderByKey.get(`${t.riderGender}:${t.riderId}`) || null }));
  } catch (err) {
    console.error('[loadTransfers]', err);
    if (list) list.innerHTML = `<div class="u-c-red u-fs-3">Error cargando los movimientos: ${esc(err.message || String(err))}</div>`;
    panelState._transfersCache = [];
  }
}

const TRANSFER_TYPE_LABELS = { transfer: 'Fichaje', renewal: 'Renovación', retirement: 'Retirada' };

// `side`: 'from' → nombre de la temporada en curso (el equipo que el corredor
// deja); 'to' → nombre de la temporada del mercado (con el que va a correr).
// Último recurso = el catálogo `teams`, para equipos sin fila en ninguna de las
// dos temporadas (destinos fuera de las 4 divisiones sembradas…).
export function _trTeamLabel(teamId, freeText, side = 'to') {
  if (!teamId) return freeText || '—';
  const primary  = side === 'from' ? _trTeamNamePrev : panelState._trTeamNameById;
  const fallback = side === 'from' ? panelState._trTeamNameById : _trTeamNamePrev;
  return primary.get(teamId)
    || fallback.get(teamId)
    || (panelState._teamsCache || []).find(x => x.id === teamId)?.name
    || teamId;
}

function _trRiderLabel(t) {
  const r = t.rider;
  return r ? `${r.lastName}, ${r.firstName}` : t.riderId;
}

export function renderTransfersList() {
  const container = document.getElementById('transfersList');
  const countEl = document.getElementById('transfersCount');
  if (!container) return;

  const statusFilter = document.getElementById('transfersStatusFilter')?.value || 'all';
  const q = (document.getElementById('transfersSearch')?.value || '').toLowerCase().trim();

  const filtered = (panelState._transfersCache || []).filter(t => {
    // Las filas del volcado inicial sin edición manual no aportan una novedad
    // editorial. Aparecen en cuanto se modifica cualquier campo o su fecha.
    if (isInitialTransferImport(t)) return false;
    // 'hidden' no es un status: cruza los tres (lo que no sale en el feed).
    if (statusFilter === 'hidden') {
      if (t.dateVisible !== false) return false;
    } else if (statusFilter !== 'all' && t.status !== statusFilter) {
      return false;
    }
    if (!q) return true;
    const hay = [
      _trRiderLabel(t),
      _trTeamLabel(t.fromTeamId, t.fromTeamName, 'from'),
      _trTeamLabel(t.toTeamId, t.toTeamName),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (countEl) countEl.textContent = filtered.length ? `${filtered.length} movimiento${filtered.length === 1 ? '' : 's'}` : '';

  if (filtered.length === 0) {
    container.innerHTML = `<div class="u-c-dim u-fs-3 u-py-050 u-px-0">
      ${(panelState._transfersCache || []).length === 0
        ? 'No hay movimientos todavía. Pulsa <strong>+ Nuevo movimiento</strong> para registrar el primero.'
        : 'Sin resultados con ese filtro.'}
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(t => {
    const isRumor = t.status === 'rumor';
    const isDoubt = t.status === 'doubt';
    const dateHidden = t.dateVisible === false;
    const dateBit = t.announcedAt ? `${t.announcedAt.slice(8, 10)}/${t.announcedAt.slice(5, 7)}/${t.announcedAt.slice(2, 4)}` : '';
    // Una DUDA no es una renovación: es "duda de si sigue o se va". Se etiqueta
    // como Duda y su texto es neutro ("en duda · <equipo>"), no "renueva con".
    const typeLabel = isDoubt ? 'Duda' : (TRANSFER_TYPE_LABELS[t.type] || t.type);
    let movement;
    if (isDoubt) {
      movement = `en duda <span class="u-c-dim">·</span> <strong>${esc(_trTeamLabel(t.toTeamId, t.toTeamName))}</strong>`;
    } else if (t.type === 'renewal') {
      movement = `renueva con <strong>${esc(_trTeamLabel(t.toTeamId, t.toTeamName))}</strong>`;
    } else if (t.type === 'retirement') {
      movement = `se retira <span class="u-c-dim">(${esc(_trTeamLabel(t.fromTeamId, t.fromTeamName, 'from'))})</span>`;
    } else {
      movement = `${esc(_trTeamLabel(t.fromTeamId, t.fromTeamName, 'from'))} <span class="u-c-dim">→</span> <strong>${esc(_trTeamLabel(t.toTeamId, t.toTeamName))}</strong>`;
    }
    const contractBit = t.contractUntil
      ? `<span class="u-c-dim u-nowrap">${t.contractUntil === TSE_LIFETIME_YEAR ? 'vitalicio ∞' : `hasta ${esc(String(t.contractUntil))}`}</span>`
      : '';
    const statusChip = isRumor
      ? `<span class="tr-chip tr-chip--rumor">Rumor</span>`
      : isDoubt
      ? `<span class="tr-chip tr-chip--doubt">Duda</span>`
      : `<span class="tr-chip tr-chip--confirmed">Confirmado</span>`;
    const midSeasonChip = t.midSeason
      ? `<span class="tr-chip tr-chip--midseason">M. temporada</span>`
      : '';
    return `
      <div class="transfer-row" data-id="${esc(t.id)}">
        <span class="u-fs-1 u-c-dim tr-date${dateHidden ? ' tr-date--hidden' : ''}" ${dateHidden ? 'title="Oculto del listado de últimos"' : ''}>${esc(dateBit)}</span>
        <span class="u-shrink-0 u-w-150em u-center">${_slRiderFlagPreview(t.rider?.nationality || '')}</span>
        <span class="u-minw-1000 u-fs-3"><strong>${esc(_trRiderLabel(t))}</strong>
          <span class="u-c-dim u-fs-1 u-ml-025">${t.riderGender === 'female' ? '♀' : '♂'}</span>
        </span>
        <span class="u-fs-1 u-c-dim u-nowrap">${esc(typeLabel)}</span>
        <span class="u-grow u-minw-1200 u-fs-2">${movement} ${contractBit}</span>
        ${statusChip}
        ${midSeasonChip}
        ${isRumor || isDoubt ? `<button class="btn btn--ghost transfer-confirm u-btn-xs u-c-accent">Confirmar</button>` : ''}
        <button class="btn btn--ghost transfer-edit u-btn-xs">Editar</button>
      </div>`;
  }).join('');

  container.querySelectorAll('.transfer-row').forEach(rowEl => {
    const t = (panelState._transfersCache || []).find(x => x.id === rowEl.dataset.id);
    if (!t) return;
    rowEl.querySelector('.transfer-edit')?.addEventListener('click', () => openTransferEditor(t));
    rowEl.querySelector('.transfer-confirm')?.addEventListener('click', () => confirmTransferQuick(t));
  });
}

// Confirmación rápida de un rumor o una duda desde el listado: pasa a
// confirmado con fecha de anuncio HOY (editable después en el editor) + sync
// de contrato. Confirmar es PUBLICAR → la fecha se hace visible aunque
// estuviera oculta (si no, quedaría confirmado pero fuera del feed).
async function confirmTransferQuick(t) {
  const label = TRANSFER_TYPE_LABELS[t.type] || t.type;
  if (!await confirmDialog(`¿Confirmar ${label.toLowerCase()} de ${_trRiderLabel(t)}? La fecha de anuncio pasará a hoy (editable).`)) return;
  try {
    const { error } = await supabase.from('rider_transfers')
      .update({ status: 'confirmed', announcedAt: _localDateKey(), dateVisible: true, updatedAt: new Date().toISOString() })
      .eq('id', t.id);
    if (error) throw error;
    // Un corredor = un solo movimiento: al confirmar, el resto de sus movimientos
    // de la temporada sobran (p. ej. un fin de contrato huérfano tras confirmar un
    // rumor de fichaje). Antes de sincronizar la afiliación del destino.
    await _clearOtherTransfersForRider(t.riderId, t.id);
    await _syncTransferContractToRider({ ...t, status: 'confirmed' });
    // Confirmar un fichaje lo mete en la plantilla 2027 (materializa la afiliación).
    await _syncSigningAffiliation({ ...t, status: 'confirmed' });
    showToast('Movimiento confirmado', 'success', 2500);
    await loadTransfers();
    renderTransfersList();
  } catch (err) {
    console.error('[confirmTransferQuick]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}

// Sync del fin de contrato a la ficha: solo movimientos CONFIRMADOS con año de
// contrato. Ni un rumor ni una DUDA tocan la ficha (no son hechos: no pueden
// pisar el contrato conocido); una retirada tampoco.
export async function _syncTransferContractToRider(t) {
  if (t.status !== 'confirmed' || !t.contractUntil || t.contractUntil === TSE_LIFETIME_YEAR || t.type === 'retirement') return;
  const table = t.riderGender === 'male' ? 'riders_men' : 'riders_women';
  const { error } = await supabase.from(table)
    .update({ contractUntil: t.contractUntil, updatedAt: new Date().toISOString() })
    .eq('id', t.riderId);
  if (error) console.warn('[transfers] sync contractUntil a la ficha falló', error);
}

// ── Editor de movimiento (drawer nivel 1) ─────────────────────────
function transferEditorBodyHtml() {
  return `
    <div class="u-stack">
      <div class="field" id="tr-rider-row">
        <label>Corredor</label>
        <input type="search" id="tr-rider-search" placeholder="Busca por nombre o apellido (mín. 3 letras)…" autocomplete="off" class="u-w-full">
        <div id="tr-rider-results" class="tr-rider-results panel-list" style="display:none"></div>
        <div id="tr-rider-selected" class="tr-rider-selected" style="display:none">
          <span id="tr-rider-selected-flag" class="u-w-150em u-center"></span>
          <span id="tr-rider-selected-name" class="u-grow u-fs-3 u-fw-600"></span>
          <span id="tr-rider-selected-team" class="u-fs-1 u-c-dim"></span>
          <button class="btn btn--ghost u-py-025 u-px-055 u-fs-1" id="tr-rider-clear">Cambiar</button>
        </div>
      </div>

      <div>
        <label class="panel-field-heading">Situación ${MARKET_SEASON}</label>
        <div class="u-flex u-gap-040 u-wrap">
          ${TSE_STATES.map(st => `<button type="button" class="tr-situation-btn" data-state="${st.key}">${st.label}</button>`).join('')}
        </div>
      </div>

      <div class="field" id="tr-from-row">
        <label>Equipo de origen <span class="u-dim" id="tr-from-hint">— solo editable si el corredor no tiene equipo asociado</span></label>
        <div id="tr-from-associated" class="u-fs-3 tr-from-associated" style="display:none"></div>
        <div class="u-row u-row--gap-sm" id="tr-from-inputs">
          <select id="tr-fromTeamId" class="u-grow u-minw-1000"></select>
          <input type="text" id="tr-fromTeamName" placeholder="Texto libre (júnior, amateur…)" class="u-grow u-minw-800">
        </div>
      </div>

      <div class="field" id="tr-to-row">
        <label>Equipo de destino <span class="u-dim">— si no está en el catálogo, usa el texto libre</span></label>
        <div class="u-row u-row--gap-sm">
          <select id="tr-toTeamId" class="u-grow u-minw-1000"></select>
          <input type="text" id="tr-toTeamName" placeholder="Texto libre" class="u-grow u-minw-800">
        </div>
      </div>

      <div class="field-row field-row--3" id="tr-detail-row">
        <div class="field" id="tr-contract-row">
          <label>Contrato hasta <span class="u-dim">— año</span></label>
          <input type="number" id="tr-contractUntil" min="2026" max="2040" placeholder="2029" class="u-w-full">
          <div id="tr-stay-contract-options" class="u-gap-080 u-wrap u-mt-040" style="display:none">
            <label class="tr-check tr-check--option"><input type="checkbox" id="tr-yearUnknown"><span>No se sabe el año</span></label>
            <label class="tr-check tr-check--option"><input type="checkbox" id="tr-lifetime"><span>Vitalicio ∞</span></label>
          </div>
        </div>
        <div class="field" id="tr-flags-row">
          <label>Condición</label>
          <label id="tr-rumor-label" class="tr-check tr-check--flag">
            <input type="checkbox" id="tr-rumor"><span>Rumor (sin confirmar)</span>
          </label>
          <label id="tr-retired-label" class="tr-check tr-check--flag" style="display:none">
            <input type="checkbox" id="tr-retired"><span>Se retira</span>
          </label>
          <span id="tr-doubt-label" class="u-fs-1 u-c-dim u-pt-035" style="display:none">Duda de renovación.</span>
        </div>
        <div class="field">
          <label>Fecha del anuncio</label>
          <input type="date" id="tr-announcedAt" class="u-w-full">
          <label class="tr-check tr-check--date">
            <input type="checkbox" id="tr-dateHidden">
            <span>Ocultar del listado de últimos</span>
          </label>
          <label class="tr-check tr-check--date">
            <input type="checkbox" id="tr-midSeason">
            <span>Fichaje de mitad de temporada</span>
          </label>
        </div>
      </div>
    </div>
    <div class="u-row u-gap-075 u-wrap u-mt-100">
      <button class="btn btn--primary" id="saveTransferBtn">Guardar</button>
      <button class="btn btn--ghost u-c-red" id="deleteTransferBtn" style="display:none">Eliminar</button>
      <span class="u-fs-2 u-c-dim" id="transferSaveStatus"></span>
    </div>
  `;
}

function wireTransferEditor() {
  document.getElementById('saveTransferBtn').addEventListener('click', saveTransfer);
  document.getElementById('deleteTransferBtn').addEventListener('click', deleteTransfer);
  document.getElementById('tr-rider-clear').addEventListener('click', _trClearRiderSelection);
  document.getElementById('tr-rider-search').addEventListener('input', (e) => {
    clearTimeout(_trSearchDebounce);
    _trSearchDebounce = setTimeout(() => _trSearchRiders(e.target.value), 280);
  });
  document.querySelectorAll('.tr-situation-btn').forEach(btn => btn.addEventListener('click', () => {
    _trSituationState = btn.dataset.state;
    _trRefreshTypeVisibility();
  }));
  document.getElementById('tr-yearUnknown')?.addEventListener('change', (e) => {
    _trYearUnknown = e.target.checked;
    if (_trYearUnknown) _trLifetime = false;
    _trRefreshTypeVisibility();
  });
  document.getElementById('tr-lifetime')?.addEventListener('change', (e) => {
    _trLifetime = e.target.checked;
    if (_trLifetime) _trYearUnknown = false;
    _trRefreshTypeVisibility();
  });
}

// Muestra los mismos cuatro estados que el editor por equipo. El equipo asociado
// fija origen y continuidad; un origen manual solo existe para fichas sin equipo.
function _trRefreshTypeVisibility() {
  const state = _trSituationState;
  const hasSituation = TSE_STATES.some(x => x.key === state);
  const fromRow = document.getElementById('tr-from-row');
  const toRow   = document.getElementById('tr-to-row');
  const hasAssociatedTeam = !!_trSelectedRider?.currentTeamId;
  const needsOrigin = state === 'change' || state === 'end';
  if (fromRow) fromRow.style.display = needsOrigin ? '' : 'none';
  if (toRow) toRow.style.display = state === 'change' ? '' : 'none';
  const associated = document.getElementById('tr-from-associated');
  const inputs = document.getElementById('tr-from-inputs');
  if (associated) {
    associated.style.display = needsOrigin && hasAssociatedTeam ? '' : 'none';
    const team = (panelState._teamsCache || []).find(t => t.id === _trSelectedRider?.currentTeamId);
    associated.textContent = team?.name || _trSelectedRider?.currentTeamId || '';
  }
  if (inputs) inputs.style.display = needsOrigin && !hasAssociatedTeam ? 'flex' : 'none';

  const contractRow = document.getElementById('tr-contract-row');
  if (contractRow) contractRow.style.display = state === 'end' ? 'none' : '';
  const detailRow = document.getElementById('tr-detail-row');
  if (detailRow) detailRow.style.display = hasSituation ? '' : 'none';
  const stayOpts = document.getElementById('tr-stay-contract-options');
  if (stayOpts) stayOpts.style.display = state === 'stay' ? 'flex' : 'none';
  const contractInput = document.getElementById('tr-contractUntil');
  if (contractInput) contractInput.disabled = state === 'stay' && (_trYearUnknown || _trLifetime);
  const unknown = document.getElementById('tr-yearUnknown');
  const lifetime = document.getElementById('tr-lifetime');
  if (unknown) unknown.checked = _trYearUnknown;
  if (lifetime) lifetime.checked = _trLifetime;

  const rumorLabel = document.getElementById('tr-rumor-label');
  const retiredLabel = document.getElementById('tr-retired-label');
  const doubtLabel = document.getElementById('tr-doubt-label');
  if (rumorLabel) rumorLabel.style.display = state === 'stay' || state === 'change' ? 'inline-flex' : 'none';
  if (retiredLabel) retiredLabel.style.display = state === 'end' ? 'inline-flex' : 'none';
  if (doubtLabel) doubtLabel.style.display = state === 'doubt' ? 'block' : 'none';
  const mid = document.getElementById('tr-midSeason')?.closest('label');
  if (mid) mid.style.display = state === 'change' ? 'inline-flex' : 'none';

  document.querySelectorAll('.tr-situation-btn').forEach(btn => {
    const meta = TSE_STATES.find(x => x.key === btn.dataset.state);
    const active = btn.dataset.state === state;
    btn.classList.toggle('is-active', active);
    btn.style.setProperty('--seg-color', meta.color);
  });
}

function _trPopulateTeamSelect(selId, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const gender = _trSelectedRider?.gender || null;
  const teams = (selId === 'tr-toTeamId'
    ? marketDestinationTeamOptions({
        teams: activeCatalogTeams(panelState._teamsCache),
        marketSeasons: panelState._marketSeasons || [],
        gender,
      })
    : activeCatalogTeams(panelState._teamsCache).filter(t => !t.specialEdition && (!gender || !t.gender || t.gender === gender)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sel.innerHTML = '<option value="">— Fuera del catálogo / ninguno —</option>' +
    teams.map(t =>
      `<option value="${esc(t.id)}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)}${t.category ? ` (${esc(t.category)})` : ''}</option>`
    ).join('');
  sel.value = selectedId || '';
}

async function _trSearchRiders(q) {
  const results = document.getElementById('tr-rider-results');
  if (!results) return;
  const term = (q || '').trim();
  if (term.length < 3) { results.style.display = 'none'; results.innerHTML = ''; return; }
  const safe = term.replace(/[%,()]/g, '');
  results.style.display = 'flex';
  results.innerHTML = '<div class="u-c-dim u-fs-2 u-py-030 u-px-0">Buscando…</div>';
  try {
    const cols = 'id, firstName, lastName, nationality, birthDate, currentTeamId, contractUntil';
    const filter = `lastName.ilike.%${safe}%,firstName.ilike.%${safe}%,otherNames.ilike.%${safe}%`;
    const [men, women] = await Promise.all([
      supabase.from('riders_men').select(cols).or(filter).order('lastName').limit(12).then(r => r.data || []),
      supabase.from('riders_women').select(cols).or(filter).order('lastName').limit(12).then(r => r.data || []),
    ]);
    const rows = [
      ...men.map(r => ({ ...r, gender: 'male' })),
      ...women.map(r => ({ ...r, gender: 'female' })),
    ].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
    if (rows.length === 0) {
      results.innerHTML = `
        <div class="u-c-dim u-fs-2 u-py-030 u-px-0">Sin resultados para «${esc(term)}».</div>
        ${_trCreateRiderBtnHtml(term)}`;
      _trWireCreateRiderBtn(term);
      return;
    }
    results.innerHTML = rows.map((r, i) => {
      const team = r.currentTeamId ? (panelState._teamsCache || []).find(t => t.id === r.currentTeamId) : null;
      return `<div class="tr-rider-option" data-idx="${i}">
        <span class="u-w-150em u-center">${_slRiderFlagPreview(r.nationality)}</span>
        <span class="u-grow u-min0 u-fs-2"><strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
          <span class="u-c-dim u-fs-1">${r.gender === 'female' ? '♀' : '♂'}${r.birthDate ? ` '${esc(String(r.birthDate).slice(2, 4))}` : ''}</span>
          ${team ? `<span class="u-block u-fs-1 u-c-dim">${esc(team.name)}</span>` : ''}
        </span>
      </div>`;
    // Con resultados también se ofrece crear: ninguno puede ser el corredor
    // buscado (homónimos, o la ficha aún no existe pese a haber parecidos).
    }).join('') + _trCreateRiderBtnHtml(term);
    results.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => _trSelectRider(rows[Number(el.dataset.idx)]));
    });
    _trWireCreateRiderBtn(term);
  } catch (err) {
    console.error('[_trSearchRiders]', err);
    results.innerHTML = `<div class="u-c-red u-fs-2 u-py-030 u-px-0">Error: ${esc(err.message || String(err))}</div>`;
  }
}

/**
 * Atajo para dar de alta una ficha que no está en el catálogo sin salir del
 * editor del movimiento (el mercado trae corredores nuevos constantemente:
 * júniors que suben, fichajes desde fuera del catálogo).
 */
function _trCreateRiderBtnHtml(term) {
  return `<button type="button" class="btn btn--ghost tr-create-rider-btn" id="tr-create-rider">
    + Crear ficha de «${esc(term)}»
  </button>`;
}

function _trWireCreateRiderBtn(term) {
  const btn = document.getElementById('tr-create-rider');
  if (btn) btn.addEventListener('click', () => _trCreateRiderFromSearch(term));
}

/**
 * Abre el editor de ficha ESTÁNDAR en drawer nivel 2 (sobre el del movimiento),
 * precargado con lo tecleado. Reutilizarlo —en vez de un mini-formulario propio—
 * mantiene una sola vía de alta: el id sale del plegado canónico (fold_name_rpc)
 * y las colisiones de identityKey siguen ofreciendo fusionar en vez de crear un
 * duplicado, que es justo lo que ensucia el catálogo.
 * Al guardar, la ficha queda seleccionada en el movimiento (_onRiderSavedOnce).
 */
async function _trCreateRiderFromSearch(term) {
  // Refrescar el catálogo antes de abrir la ficha: el destino puede ser un
  // equipo creado en esta misma sesión o desde otra pestaña.
  await fetchTeams({ force: true });

  // El género del movimiento lo decide la ficha. Prioridad: equipo de origen;
  // si todavía no existe (alta de una incorporación), equipo de destino
  // prefijado por el editor de temporada; solo sin contexto se usa masculino.
  const fromTeamId = document.getElementById('tr-fromTeamId')?.value || '';
  panelState._ridersGender = transferRiderInitialGender({
    teams: panelState._teamsCache || [],
    fromTeamId,
    presetToTeamId: _transferEditorOpts?.presetToTeamId || null,
  });

  panelState._ridersAllCache = [];
  openRiderEditor(null, { level: 2 }); // se apila sobre el movimiento

  // Precargar lo tecleado: "Apellido, Nombre" o "Nombre Apellido" → campos.
  const parts = term.split(',').map(s => s.trim()).filter(Boolean);
  let firstName = '', lastName = term.trim();
  if (parts.length >= 2) {
    lastName = parts[0];
    firstName = parts.slice(1).join(' ');
  } else {
    const words = term.trim().split(/\s+/);
    if (words.length >= 2) { firstName = words[0]; lastName = words.slice(1).join(' '); }
  }
  const fnEl = document.getElementById('re-firstName');
  const lnEl = document.getElementById('re-lastName');
  if (fnEl) fnEl.value = firstName;
  if (lnEl) lnEl.value = lastName;
  if (fromTeamId) {
    const teamSel = document.getElementById('re-teamId');
    if (teamSel) teamSel.value = fromTeamId;   // equipo actual = el de origen
  }
  const st = document.getElementById('riderSaveStatus');
  if (st) st.textContent = 'Ficha nueva para el mercado: al guardar queda seleccionada en el movimiento.';
  (firstName ? lnEl : fnEl)?.focus();

  // Al guardar: seleccionar en el movimiento y cerrar el drawer de la ficha.
  panelState._onRiderSavedOnce = (rider) => {
    _trSelectRider({
      id: rider.id,
      gender: rider.gender,
      firstName: rider.firstName,
      lastName: rider.lastName,
      nationality: rider.nationality,
      currentTeamId: rider.currentTeamId,
      contractUntil: rider.contractUntil,
    });
    closeDrawer(2);
  };
}

function _trSelectRider(r) {
  _trSelectedRider = r;
  const search = document.getElementById('tr-rider-search');
  const results = document.getElementById('tr-rider-results');
  const sel = document.getElementById('tr-rider-selected');
  if (search) { search.style.display = 'none'; search.value = ''; }
  if (results) { results.style.display = 'none'; results.innerHTML = ''; }
  if (sel) sel.style.display = 'flex';
  const team = r.currentTeamId ? (panelState._teamsCache || []).find(t => t.id === r.currentTeamId) : null;
  document.getElementById('tr-rider-selected-flag').innerHTML = _slRiderFlagPreview(r.nationality || '');
  document.getElementById('tr-rider-selected-name').textContent = `${r.lastName}, ${r.firstName} ${r.gender === 'female' ? '♀' : '♂'}`;
  document.getElementById('tr-rider-selected-team').textContent = team ? team.name : (r.currentTeamId || 'sin equipo');
  // Repoblar selects con el género del corredor + preseleccionar su equipo
  // actual como origen (si el campo estaba vacío).
  const fromSel = document.getElementById('tr-fromTeamId');
  const prevFrom = fromSel?.value || '';
  _trPopulateTeamSelect('tr-fromTeamId', prevFrom || r.currentTeamId || '');
  _trPopulateTeamSelect('tr-toTeamId', document.getElementById('tr-toTeamId')?.value || '');
  _trRefreshTypeVisibility();
  if (!_editingTransferId) _trResolveSelectedRiderSituation(r);
}

// Carga en el formulario una situación ya registrada. Cuando procede de un
// rider_transfers real, el drawer pasa a editar esa fila en lugar de crear un
// duplicado. Una situación sintética derivada de afiliación solo precarga la UI.
function _trApplySituation(t, { existing = false } = {}) {
  const isContractEnd = t?.type === 'transfer' && !t?.toTeamId && t?.toTeamName === TSE_UNKNOWN_DEST;
  _trSituationState = t?.type === 'renewal'
    ? (t.status === 'doubt' ? 'doubt' : 'stay')
    : (t?.type === 'retirement' || isContractEnd)
      ? 'end'
      : 'change';
  _trLifetime = _trSituationState === 'stay' && t?.contractUntil === TSE_LIFETIME_YEAR;
  _trYearUnknown = _trSituationState === 'stay' && t?.contractUntil == null;

  if (existing) {
    _editingTransferId = t.id;
    _trAutoResolvedExisting = true;
    const title = document.getElementById('ccDrawer1Title');
    if (title) title.textContent = 'Editar movimiento';
    const del = document.getElementById('deleteTransferBtn');
    if (del) del.style.display = 'inline-block';
  }

  const presetTo = _trSituationState === 'change' ? (t?.toTeamId || '') : '';
  _trPopulateTeamSelect('tr-fromTeamId', t?.fromTeamId || _trSelectedRider?.currentTeamId || '');
  _trPopulateTeamSelect('tr-toTeamId', presetTo);
  document.getElementById('tr-fromTeamName').value = t?.fromTeamName || '';
  document.getElementById('tr-toTeamName').value = _trSituationState === 'change' ? (t?.toTeamName || '') : '';
  document.getElementById('tr-contractUntil').value = _trLifetime ? '' : (t?.contractUntil || '');
  document.getElementById('tr-rumor').checked = t?.status === 'rumor';
  document.getElementById('tr-retired').checked = t?.type === 'retirement';
  document.getElementById('tr-announcedAt').value = transferEditorAnnouncementDate({
    transfer: t,
    today: _localDateKey(),
    autoResolvedFromNew: existing,
  });
  document.getElementById('tr-dateHidden').checked = t ? t.dateVisible === false : false;
  document.getElementById('tr-midSeason').checked = t?.midSeason === true;
  _trRefreshTypeVisibility();
}

async function _trResolveSelectedRiderSituation(r) {
  const existing = (panelState._transfersCache || []).find(t =>
    t.riderId === r.id && t.riderGender === r.gender && !t.midSeason);
  if (existing) {
    _trApplySituation(existing, { existing: true });
    return;
  }

  const selectedKey = `${r.gender}:${r.id}`;
  const status = document.getElementById('transferSaveStatus');
  if (status) status.textContent = 'Comprobando situación registrada…';
  const { data: aff, error } = await supabase.from('rider_team_affiliations')
    .select('teamId, dateTo')
    .eq('affiliationType', 'regular')
    .eq('riderId', r.id)
    .eq('riderGender', r.gender)
    .eq('year', MARKET_SEASON)
    .limit(1)
    .maybeSingle();
  if (`${_trSelectedRider?.gender}:${_trSelectedRider?.id}` !== selectedKey || _editingTransferId) return;
  if (status) status.textContent = '';
  if (error) {
    console.error('[_trResolveSelectedRiderSituation]', error);
    return;
  }
  if (!aff) {
    _trSituationState = _transferEditorOpts?.presetToTeamId ? 'change' : 'undecided';
    _trRefreshTypeVisibility();
    return;
  }

  const contractUntil = _affYear(aff.dateTo);
  const derived = aff.teamId === r.currentTeamId
    ? { type: 'renewal', status: 'confirmed', toTeamId: aff.teamId, contractUntil }
    : { type: 'transfer', status: 'confirmed', fromTeamId: r.currentTeamId, toTeamId: aff.teamId, contractUntil };
  _trApplySituation(derived);
}

function _trClearRiderSelection() {
  if (_trAutoResolvedExisting) {
    _editingTransferId = null;
    _trAutoResolvedExisting = false;
    const title = document.getElementById('ccDrawer1Title');
    if (title) title.textContent = 'Nuevo movimiento';
    const del = document.getElementById('deleteTransferBtn');
    if (del) del.style.display = 'none';
  }
  _trSelectedRider = null;
  const search = document.getElementById('tr-rider-search');
  const sel = document.getElementById('tr-rider-selected');
  if (search) { search.style.display = ''; search.value = ''; search.focus(); }
  if (sel) sel.style.display = 'none';
  _trRefreshTypeVisibility();
}

// opts = { presetToTeamId, onSaved } — usado por "Nueva incorporación" del
// editor de equipo: prefija el destino y ejecuta un hook al guardar (para
// materializar la afiliación 2027 y volver al equipo).
let _transferEditorOpts = null;

export function openTransferEditor(t, opts = null) {
  _editingTransferId = t?.id || null;
  _trAutoResolvedExisting = false;
  _transferEditorOpts = opts;

  openDrawer({
    title: t ? 'Editar movimiento' : 'Nuevo movimiento',
    level: 1,
    render: (body) => {
      body.innerHTML = transferEditorBodyHtml();
      wireTransferEditor();
    },
    onClose: () => { _transferEditorOpts = null; },
  });

  document.getElementById('transferSaveStatus').textContent = '';
  document.getElementById('deleteTransferBtn').style.display = t ? 'inline-block' : 'none';

  // Estado base. Un movimiento nuevo no presupone un cambio: al seleccionar
  // corredor se resuelve su situación real; si no existe, el usuario la marca.
  _trSituationState = opts?.presetToTeamId ? 'change' : 'undecided';
  _trLifetime = false;
  _trYearUnknown = false;

  // Corredor
  _trSelectedRider = null;
  if (t) {
    const r = t.rider || { id: t.riderId, firstName: '', lastName: t.riderId, nationality: '', currentTeamId: null };
    _trSelectRider({ ...r, gender: t.riderGender });
  } else {
    _trClearRiderSelection();
  }

  if (t) {
    _trApplySituation(t);
  } else {
    _trPopulateTeamSelect('tr-fromTeamId', '');
    _trPopulateTeamSelect('tr-toTeamId', opts?.presetToTeamId || '');
    document.getElementById('tr-fromTeamName').value = '';
    document.getElementById('tr-toTeamName').value = '';
    document.getElementById('tr-contractUntil').value = '';
    document.getElementById('tr-rumor').checked = false;
    document.getElementById('tr-retired').checked = false;
    document.getElementById('tr-announcedAt').value = transferEditorAnnouncementDate({ today: _localDateKey() });
    document.getElementById('tr-dateHidden').checked = false;
    document.getElementById('tr-midSeason').checked = false;
    _trRefreshTypeVisibility();
  }
}

async function saveTransfer() {
  const status = document.getElementById('transferSaveStatus');
  status.style.color = 'var(--text-dim)';

  if (!_trSelectedRider) { status.style.color = 'var(--red)'; status.textContent = 'Selecciona un corredor.'; return; }

  const state = _trSituationState;
  if (!TSE_STATES.some(x => x.key === state)) {
    status.style.color = 'var(--red)'; status.textContent = 'Selecciona la situación 2027.'; return;
  }
  const associatedTeamId = _trSelectedRider.currentTeamId || null;
  let type = null, trStatus = 'confirmed';
  let fromTeamId = null, fromTeamName = null, toTeamId = null, toTeamName = null;

  if (state === 'stay' || state === 'doubt') {
    if (!associatedTeamId) {
      status.style.color = 'var(--red)';
      status.textContent = 'Para continuar o quedar en duda, el corredor necesita un equipo asociado en su ficha.';
      return;
    }
    type = 'renewal';
    trStatus = state === 'doubt' ? 'doubt' : (document.getElementById('tr-rumor').checked ? 'rumor' : 'confirmed');
    toTeamId = associatedTeamId;
  } else {
    fromTeamId = associatedTeamId || document.getElementById('tr-fromTeamId').value || null;
    fromTeamName = associatedTeamId ? null : (document.getElementById('tr-fromTeamName').value.trim() || null);
    if (fromTeamId) fromTeamName = null;
    if (!fromTeamId && !fromTeamName) {
      status.style.color = 'var(--red)';
      status.textContent = 'Indica el equipo de origen del corredor sin equipo asociado.';
      return;
    }
    if (state === 'change') {
      type = 'transfer';
      trStatus = document.getElementById('tr-rumor').checked ? 'rumor' : 'confirmed';
      toTeamId = document.getElementById('tr-toTeamId').value || null;
      toTeamName = document.getElementById('tr-toTeamName').value.trim() || null;
      if (toTeamId) toTeamName = null;
      if (!toTeamId && !toTeamName) {
        status.style.color = 'var(--red)'; status.textContent = 'Elige el equipo de destino (catálogo o texto libre).'; return;
      }
      if (toTeamId && !isMarketDestinationTeamEligible({
        teamId: toTeamId,
        teams: panelState._teamsCache || [],
        marketSeasons: panelState._marketSeasons || [],
        gender: _trSelectedRider.gender,
      })) {
        status.style.color = 'var(--red)'; status.textContent = `El destino debe pertenecer a las dos primeras divisiones de ${MARKET_SEASON}.`; return;
      }
      if (toTeamId && toTeamId === fromTeamId) {
        status.style.color = 'var(--red)'; status.textContent = 'El destino debe ser distinto del equipo de origen.'; return;
      }
    } else {
      const retired = document.getElementById('tr-retired').checked;
      type = retired ? 'retirement' : 'transfer';
      toTeamName = retired ? null : TSE_UNKNOWN_DEST;
    }
  }

  const contractRaw = state === 'end' ? '' : document.getElementById('tr-contractUntil').value.trim();
  const contractUntil = state === 'stay' && _trLifetime
    ? TSE_LIFETIME_YEAR
    : (state === 'stay' && _trYearUnknown ? null : (contractRaw ? parseInt(contractRaw, 10) : null));
  if (contractUntil !== null && contractUntil !== TSE_LIFETIME_YEAR && (isNaN(contractUntil) || contractUntil < 2026 || contractUntil > 2040)) {
    status.style.color = 'var(--red)'; status.textContent = 'El año de contrato debe estar entre 2026 y 2040.'; return;
  }

  const payload = {
    season: MARKET_SEASON,
    riderId: _trSelectedRider.id,
    riderGender: _trSelectedRider.gender,
    fromTeamId, fromTeamName, toTeamId, toTeamName,
    type,
    status: trStatus,
    contractUntil,
    announcedAt: document.getElementById('tr-announcedAt').value || _localDateKey(),
    dateVisible: !document.getElementById('tr-dateHidden').checked,
    midSeason: state === 'change' && document.getElementById('tr-midSeason').checked,
    updatedAt: new Date().toISOString(),
  };

  status.textContent = 'Guardando…';
  try {
    let savedId = _editingTransferId;
    if (_editingTransferId) {
      const { error } = await supabase.from('rider_transfers').update(payload).eq('id', _editingTransferId);
      if (error) throw error;
    } else {
      const id = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await supabase.from('rider_transfers').insert({ id, ...payload });
      if (error) throw error;
      _editingTransferId = id;
      savedId = id;
    }
    // Un corredor = un solo movimiento: borrar cualquier otro suyo de la temporada
    // (deja huérfano un fin de contrato al fichar por otro equipo, o duplicados al
    // mismo destino). Antes de sincronizar afiliaciones para no repisar la buena.
    await _clearOtherTransfersForRider(payload.riderId, savedId);
    await _syncTransferContractToRider(payload);
    // Mantener la plantilla 2027 coherente con los cuatro estados del editor.
    await _syncMarketSituationAffiliation(payload);
    const onSaved = _transferEditorOpts?.onSaved;
    showToast('Movimiento guardado', 'success', 2500);
    _transferEditorOpts = null;
    closeDrawer(1);
    _editingTransferId = null;
    if (onSaved) {
      // Hook de "Nueva incorporación": vuelve al editor de equipo (la afiliación
      // ya quedó sincronizada arriba).
      await onSaved({ id: savedId, ...payload });
    } else {
      await loadTransfers();
      renderTransfersList();
      renderMarketTeams();
    }
  } catch (err) {
    console.error('[saveTransfer]', err);
    status.style.color = 'var(--red)';
    status.textContent = 'Error: ' + (err.message || err);
  }
}

async function deleteTransfer() {
  if (!_editingTransferId) return;
  if (!await confirmDialog('¿Eliminar este movimiento del mercado?', { danger: true })) return;
  try {
    // Si el movimiento era un fichaje confirmado, su afiliación 2027 de destino
    // se creó al confirmarlo → limpiarla al borrar (deja de estar en la plantilla).
    const del = (panelState._transfersCache || []).find(x => x.id === _editingTransferId);
    const { error } = await supabase.from('rider_transfers').delete().eq('id', _editingTransferId);
    if (error) throw error;
    if (del && !del.midSeason && del.type === 'transfer' && del.status === 'confirmed' && del.toTeamId) {
      await _deleteAffiliation2027(del.riderId, del.toTeamId, del.riderGender);
    }
    showToast('Movimiento eliminado', 'success', 2500);
    closeDrawer(1);
    _editingTransferId = null;
    await loadTransfers();
    renderTransfersList();
  } catch (err) {
    console.error('[deleteTransfer]', err);
    showToast('Error: ' + (err.message || err), 'error');
  }
}
