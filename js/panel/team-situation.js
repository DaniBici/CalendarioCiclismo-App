// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Fichajes: editor de situación de la plantilla por equipo
// ─────────────────────────────────────────────────────────────────

import { supabase, esc } from '../shared.js';
import { openDrawer, closeDrawer } from '../components/drawer.js';
import {
  isMarketDestinationTeamEligible, marketDestinationTeamOptions,
} from '../services/transfer-rider.js';
import { panelState } from './state.js';
import { MARKET_SEASON } from './constants.js';
import { showToast } from './helpers.js';
import { _slRiderFlagPreview } from './startlist-picker.js';
import { fetchTeams } from './teams.js';
import {
  _localDateKey, _syncTransferContractToRider, _trTeamLabel, loadTransfers,
  openTeamEditorForSeason, openTransferEditor, renderMarketTeams,
} from './fichajes.js';

// ══════════════════════════════════════════════════════════════════
//  EDITOR DE TEMPORADA 2027 POR EQUIPO (situación de cada corredor)
// ══════════════════════════════════════════════════════════════════
//
// Espejo del front /fichajes/: se entra en un equipo y se decide la situación
// 2027 de cada corredor de su plantilla 2026. Cuatro estados, que se traducen
// a DB así (T = el equipo abierto):
//
//   Continúa (+año / "sin año") → afiliación 2027 (teamId=T, contractUntil) y
//       se BORRA cualquier rider_transfers de T para ese corredor. La
//       plantilla 2027 se MATERIALIZA aquí (el front la lee de las afiliaciones).
//   Duda (+año opcional)       → rider_transfers renewal+doubt (toTeamId=T) +
//       afiliación 2027 (sigue "formando parte", pero el front lo saca de
//       "continúan" a "en duda").
//   Cambio (+equipo +año)      → rider_transfers transfer (from=T, to=nuevo) y
//       se BORRA la afiliación 2027 a T (ya no continúa aquí).
//   Fin de contrato            → se BORRA la afiliación 2027 a T. Con "retirada"
//       marcada → rider_transfers retirement (from=T); sin ella → transfer con
//       destino DESCONOCIDO (from=T, toTeamName='?') = baja sin destino.
//
// El género del corredor decide la tabla riders_* y el año va como smallint.

let _tseTeamId       = null;   // equipo abierto
let _tseSituations   = new Map();   // riderId → { rider, state, year, yearUnknown, newTeamId, retired, initial }
let _tseIncoming     = [];     // transfers type=transfer con toTeamId = este equipo
let _tseGender       = null;   // género del equipo (para el picker de destino)

export const TSE_STATES = [
  { key: 'stay',   label: 'Continúa',        color: 'var(--green)' },
  { key: 'doubt',  label: 'Duda',            color: 'var(--orange)' },
  { key: 'change', label: 'Cambio',          color: 'var(--text)' },
  { key: 'end',    label: 'Fin de contrato', color: 'var(--red)' },
];

function _tseNewId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Marcador de "baja sin destino conocido" en el texto libre de destino.
export const TSE_UNKNOWN_DEST = '?';
// Contrato VITALICIO: año centinela (dateTo = 9999-12-31) → sin fecha de fin
// declarada; ordena el primero de "continúan" y se pinta ∞ en vez de año.
export const TSE_LIFETIME_YEAR = 9999;

/**
 * Carga plantilla 2026 + afiliaciones 2027 + movimientos del equipo y abre el
 * drawer con la situación de cada corredor.
 */
export async function openTeamSituationEditor(teamId) {
  await fetchTeams();
  _tseTeamId = teamId;
  const season = panelState._marketSeasons.find(s => s.teamId === teamId);
  const teamCat = season?.category || (panelState._teamsCache || []).find(t => t.id === teamId)?.category || null;
  _tseGender = season?.gender
    || (panelState._teamsCache || []).find(t => t.id === teamId)?.gender
    || ({ WT: 'male', PT: 'male', WWT: 'female', PRW: 'female' })[teamCat]
    || null;

  const teamName = season?.name || (panelState._teamsCache || []).find(t => t.id === teamId)?.name || teamId;

  openDrawer({
    title: `${teamName} · Temporada ${MARKET_SEASON}`,
    level: 1,
    wide: true,
    render: (body) => {
      body.innerHTML = `<div class="u-fs-3 u-c-dim u-py-100 u-px-0">Cargando plantilla…</div>`;
    },
  });

  try {
    const [roster, affiliations] = await Promise.all([
      _tseFetchRoster(teamId, _tseGender),
      _tseFetchAffiliations(teamId),
    ]);
    // Movimientos ya cargados en _transfersCache (loadTransfers). Origen (from=T)
    // decide continua/cambio/fin; destino (to=T, transfer) son las incorporaciones.
    const affByRider = new Map(affiliations.map(a => [a.riderId, a]));
    const outByRider = new Map();   // salidas registradas de T (transfer/retirement from=T)
    panelState._transfersCache.forEach(t => {
      if ((t.type === 'transfer' || t.type === 'retirement') && t.fromTeamId === teamId) {
        outByRider.set(t.riderId, t);
      }
    });
    const renewalByRider = new Map(); // renovaciones confirmadas/rumor/duda con este equipo
    panelState._transfersCache.forEach(t => {
      if (t.type === 'renewal' && t.toTeamId === teamId) renewalByRider.set(t.riderId, t);
    });

    // Estado inicial por corredor de la plantilla 2026.
    _tseSituations = new Map();
    roster.forEach(r => {
      const out = outByRider.get(r.id);
      const renewal = renewalByRider.get(r.id);
      const aff = affByRider.get(r.id);
      let state = 'undecided', year = null, yearUnknown = false, newTeamId = null, retired = false;
      let rumor = false, announcedAt = _localDateKey(), lifetime = false;
      if (out) {
        if (out.type === 'retirement') { state = 'end'; retired = true; }
        else if (out.toTeamName === TSE_UNKNOWN_DEST && !out.toTeamId) { state = 'end'; retired = false; }
        else {
          state = 'change'; newTeamId = out.toTeamId || null; year = out.contractUntil || null;
          rumor = out.status === 'rumor';
          announcedAt = out.announcedAt || _localDateKey();
        }
      } else if (renewal?.status === 'doubt') {
        state = 'doubt'; year = renewal.contractUntil || null;
      } else if (aff || renewal) {
        const affYear = _affYear(aff?.dateTo);
        const effectiveYear = renewal?.contractUntil ?? affYear;
        state = 'stay';
        rumor = renewal?.status === 'rumor';
        announcedAt = renewal?.announcedAt || _localDateKey();
        if (effectiveYear === TSE_LIFETIME_YEAR) { lifetime = true; year = null; yearUnknown = false; }
        else { year = effectiveYear; yearUnknown = effectiveYear == null; }
      }
      const init = { state, year, yearUnknown, lifetime, newTeamId, retired, rumor, announcedAt };
      _tseSituations.set(r.id, { rider: r, ...init, initial: { ...init } });
    });

    // Incorporaciones del mercado: los fichajes efectivos a mitad de temporada
    // pertenecen al feed informativo, no a la plantilla editable de 2027.
    _tseIncoming = panelState._transfersCache.filter(t =>
      !t.midSeason && t.type === 'transfer' && t.toTeamId === teamId);

    _tseRenderEditor(body_of(1), { teamId, teamName, teamCat });
  } catch (err) {
    console.error('[openTeamSituationEditor]', err);
    const b = body_of(1);
    if (b) b.innerHTML = `<div class="u-c-red u-fs-3 u-py-100 u-px-0">Error cargando la plantilla: ${esc(err.message || String(err))}</div>`;
  }
}

// Devuelve el body del drawer de un nivel sin exponer internals de drawer.js.
function body_of(level) {
  return document.getElementById(level === 2 ? 'ccDrawer2Body' : 'ccDrawer1Body');
}

async function _tseFetchRoster(teamId, gender) {
  const cols = 'id, firstName, lastName, nationality, currentTeamId, contractUntil';
  const tables = gender === 'male' ? ['riders_men']
    : gender === 'female' ? ['riders_women']
    : ['riders_men', 'riders_women'];
  const results = await Promise.all(tables.map(tb =>
    supabase.from(tb).select(cols).eq('currentTeamId', teamId).then(r => (r.data || []).map(x => ({ ...x, gender: tb === 'riders_men' ? 'male' : 'female' })))
  ));
  return results.flat().sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
}

async function _tseFetchAffiliations(teamId) {
  const { data, error } = await supabase.from('rider_team_affiliations')
    .select('id, riderId, riderGender, teamId, year, dateFrom, dateTo')
    .eq('affiliationType', 'regular')
    .eq('year', MARKET_SEASON)
    .eq('teamId', teamId);
  if (error) throw error;
  return data || [];
}

// El contrato se guarda como FECHAS en la afiliación: fin = 31-dic del año
// marcado (decisión Dani), inicio = 1-ene de la temporada del mercado. La UI y
// el front trabajan con el AÑO; estas dos funciones convierten.
export function _affYear(dateTo) {
  if (!dateTo) return null;
  const y = parseInt(String(dateTo).slice(0, 4), 10);
  return isNaN(y) ? null : y;
}
function _affDateTo(year) { return year ? `${year}-12-31` : null; }
const _AFF_DATE_FROM = `${MARKET_SEASON}-01-01`;

function _tseRenderEditor(body, { teamName, teamCat }) {
  if (!body) return;
  const rows = [..._tseSituations.values()];

  body.innerHTML = `
    <div class="u-stack u-gap-100">
      <div class="tse-header">
        <div class="u-grow u-min0">
          <div class="u-fs-4 u-fw-700">${esc(teamName)}</div>
          <div class="u-fs-1 u-c-dim">${esc(teamCat || '')} · temporada ${MARKET_SEASON}</div>
        </div>
        <button class="btn btn--ghost u-py-030 u-px-070 u-fs-1" id="tse-edit-identity" title="Renombre de sponsor, colores 2027, continuidad en duda…">Editar identidad 2027</button>
      </div>

      <div class="u-stack u-stack--xs">
        <div class="u-flex u-items-center u-gap-075">
          <div class="u-micro u-nowrap">Plantilla 2026 → situación ${MARKET_SEASON}</div>
          <span class="u-fs-1 u-c-dim" id="tse-roster-count">${rows.length} corredor${rows.length === 1 ? '' : 'es'}</span>
        </div>
        <div class="u-fs-1 u-c-dim">Marca la situación de cada corredor. <strong class="u-c-ok">Continúa</strong> lo incluye en la plantilla ${MARKET_SEASON}; el resto lo saca. Los que dejes sin marcar NO entran en ${MARKET_SEASON}.</div>
        <div id="tse-roster" class="panel-list u-mt-035"></div>
      </div>

      <div class="u-stack u-stack--xs">
        <div class="u-flex u-items-center u-gap-075">
          <div class="u-micro u-nowrap">Incorporaciones ${MARKET_SEASON}</div>
          <button class="btn btn--ghost u-py-020 u-px-060 u-fs-1 u-c-accent" id="tse-new-signing">+ Nueva incorporación</button>
        </div>
        <div id="tse-incoming" class="panel-list"></div>
      </div>
    </div>
    <div class="u-row tse-save-bar">
      <button class="btn btn--primary" id="tse-save">Guardar equipo</button>
      <span class="u-fs-2 u-c-dim" id="tse-save-status"></span>
    </div>
  `;

  _tseRenderRoster();
  _tseRenderIncoming();

  document.getElementById('tse-edit-identity')?.addEventListener('click', () => openTeamEditorForSeason(_tseTeamId));
  document.getElementById('tse-new-signing')?.addEventListener('click', _tseOpenNewSigning);
  document.getElementById('tse-save')?.addEventListener('click', _tseSaveTeam);
}

// Un año de contrato entre 2026 y 2040, o null.
function _tseParseYear(v) {
  const n = parseInt(String(v || '').trim(), 10);
  if (isNaN(n) || n < 2026 || n > 2040) return null;
  return n;
}

function _tseRenderRoster() {
  const box = document.getElementById('tse-roster');
  if (!box) return;
  const rows = [..._tseSituations.values()];
  if (rows.length === 0) {
    box.innerHTML = `<div class="u-fs-3 u-c-dim u-py-050 u-px-0">Este equipo no tiene plantilla 2026 (sin corredores con currentTeamId aquí).</div>`;
    return;
  }
  box.innerHTML = rows.map(s => {
    const r = s.rider;
    const seg = TSE_STATES.map(st => {
      const active = s.state === st.key;
      return `<button type="button" class="tse-seg-btn${active ? ' is-active' : ''}" data-rider="${esc(r.id)}" data-state="${st.key}"${active ? ` style="--seg-color:${st.color}"` : ''}>${st.label}</button>`;
    }).join('');
    return `
      <div class="tse-rider-row" data-rider="${esc(r.id)}">
        <div class="tse-rider-main">
          <span class="u-w-150em u-center">${_slRiderFlagPreview(r.nationality || '')}</span>
          <span class="u-grow u-minw-900 u-fs-3"><strong>${esc(r.lastName)}</strong>, ${esc(r.firstName)}
            <span class="u-c-dim u-fs-1">${r.gender === 'female' ? '♀' : '♂'}</span></span>
          <div class="u-flex u-gap-030 u-wrap">${seg}</div>
        </div>
        <div class="tse-rider-extra" data-rider="${esc(r.id)}"></div>
      </div>`;
  }).join('');

  box.querySelectorAll('.tse-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = _tseSituations.get(btn.dataset.rider);
      if (!s) return;
      // Toggle-off: volver a "sin decidir" si se re-pulsa el estado activo.
      s.state = (s.state === btn.dataset.state) ? 'undecided' : btn.dataset.state;
      _tseRenderRoster();
      _tseUpdateStayCount();
    });
  });
  [..._tseSituations.values()].forEach(s => _tseRenderRiderExtra(s));
  _tseUpdateStayCount();
}

function _tseUpdateStayCount() {
  // (contador informativo, opcional — dejado por si se quiere mostrar)
}

// Campos contextuales bajo cada corredor según su estado.
function _tseRenderRiderExtra(s) {
  const wrap = document.querySelector(`.tse-rider-extra[data-rider="${CSS.escape(s.rider.id)}"]`);
  if (!wrap) return;
  const yearInput = (disabled) => `<input type="number" class="tse-year" data-rider="${esc(s.rider.id)}" min="2026" max="2040" placeholder="año contrato"
      value="${s.year || ''}" ${disabled ? 'disabled' : ''}>`;
  const chk = (cls, checked, label) => `<label class="tse-check u-pointer">
      <input type="checkbox" class="${cls}" data-rider="${esc(s.rider.id)}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;

  let html = '';
  if (s.state === 'stay') {
    // Vitalicio deshabilita el año y el "sin año" (contrato sin fecha de fin).
    html = `<div class="tse-extra-row">
      ${yearInput(s.yearUnknown || s.lifetime)}
      ${chk('tse-yearunknown', s.yearUnknown, 'No se sabe el año')}
      ${chk('tse-lifetime', s.lifetime, 'Vitalicio ∞')}
      ${chk('tse-stay-rumor', s.rumor, 'Rumor (continuidad sin confirmar)')}
    </div>`;
  } else if (s.state === 'doubt') {
    html = `<div class="tse-extra-row">
      ${yearInput(false)}
      <span class="u-fs-1 u-c-dim">Duda de renovación: sigue en plantilla ${MARKET_SEASON} pero sin confirmar.</span>
    </div>`;
  } else if (s.state === 'change') {
    // El destino de un fichaje es la temporada del MERCADO → nombre/categoría de
    // team_seasons[2027] (con el que va a correr). Solo son destinos elegibles
    // las dos primeras divisiones masculina y femenina del mercado.
    const teams = marketDestinationTeamOptions({
      teams: panelState._teamsCache || [],
      marketSeasons: panelState._marketSeasons || [],
      gender: s.rider.gender,
      excludeTeamId: _tseTeamId,
    })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    // Fecha de confirmación (announcedAt): solo aplica a un fichaje CONFIRMADO
    // (ordena y agrupa el feed). Un rumor no sale en el feed → sin fecha.
    const dateRow = s.rumor ? '' : `<label class="tse-check">
        <span class="u-c-dim">Confirmado el</span>
        <input type="date" class="tse-announced" data-rider="${esc(s.rider.id)}" value="${esc(s.announcedAt || _localDateKey())}">
      </label>`;
    html = `<div class="tse-change-box">
      <div class="editor-actions u-wrap">
        <select class="tse-newteam" data-rider="${esc(s.rider.id)}">
          <option value="">— Equipo de destino —</option>
          ${teams.map(t => `<option value="${esc(t.id)}"${t.id === s.newTeamId ? ' selected' : ''}>${esc(t.name)}${t.category ? ` (${esc(t.category)})` : ''}</option>`).join('')}
        </select>
        ${yearInput(false)}
      </div>
      <div class="tse-extra-row u-pl-0">
        ${chk('tse-rumor', s.rumor, 'Rumor (aún sin confirmar)')}
        ${dateRow}
      </div>
    </div>`;
  } else if (s.state === 'end') {
    html = `<div class="tse-extra-row">
      ${chk('tse-retired', s.retired, 'Se retira')}
      <span class="u-fs-1 u-c-dim">${s.retired ? 'Cuelga la bici.' : 'Acaba contrato sin equipo conocido (baja sin destino).'}</span>
    </div>`;
  }
  wrap.innerHTML = html;

  wrap.querySelector('.tse-year')?.addEventListener('input', (e) => { s.year = _tseParseYear(e.target.value); });
  wrap.querySelector('.tse-yearunknown')?.addEventListener('change', (e) => {
    s.yearUnknown = e.target.checked;
    if (s.yearUnknown) { s.year = null; s.lifetime = false; }
    _tseRenderRiderExtra(s);
  });
  wrap.querySelector('.tse-lifetime')?.addEventListener('change', (e) => {
    s.lifetime = e.target.checked;
    if (s.lifetime) { s.year = null; s.yearUnknown = false; }
    _tseRenderRiderExtra(s);
  });
  wrap.querySelector('.tse-stay-rumor')?.addEventListener('change', (e) => { s.rumor = e.target.checked; });
  wrap.querySelector('.tse-newteam')?.addEventListener('change', (e) => { s.newTeamId = e.target.value || null; });
  wrap.querySelector('.tse-retired')?.addEventListener('change', (e) => { s.retired = e.target.checked; _tseRenderRiderExtra(s); });
  wrap.querySelector('.tse-rumor')?.addEventListener('change', (e) => { s.rumor = e.target.checked; _tseRenderRiderExtra(s); });
  wrap.querySelector('.tse-announced')?.addEventListener('change', (e) => { s.announcedAt = e.target.value || _localDateKey(); });
}

function _tseRenderIncoming() {
  const box = document.getElementById('tse-incoming');
  if (!box) return;
  if (_tseIncoming.length === 0) {
    box.innerHTML = `<div class="u-fs-3 u-c-dim u-py-035 u-px-0">Sin incorporaciones registradas hacia este equipo.</div>`;
    return;
  }
  box.innerHTML = _tseIncoming.map(t => {
    const r = t.rider;
    const name = r ? `${r.lastName}, ${r.firstName}` : t.riderId;
    const from = _trTeamLabel(t.fromTeamId, t.fromTeamName, 'from');
    const isRumor = t.status === 'rumor';
    return `<div class="transfer-row u-gap-055">
      <span class="u-w-150em u-center">${_slRiderFlagPreview(t.rider?.nationality || '')}</span>
      <span class="u-grow u-minw-900 u-fs-3"><strong>${esc(name)}</strong>
        <span class="u-c-dim u-fs-1">· ${esc(from)}</span></span>
      ${t.contractUntil ? `<span class="u-fs-1 u-c-dim">${esc(String(t.contractUntil))}</span>` : ''}
      ${isRumor ? `<span class="tse-rumor-chip">Rumor</span>` : ''}
      <button class="btn btn--ghost tse-incoming-edit u-py-015 u-px-045 u-fs-1" data-id="${esc(t.id)}">Editar</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.tse-incoming-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = panelState._transfersCache.find(x => x.id === btn.dataset.id);
      if (t) openTransferEditor(t);
    });
  });
}

/**
 * "Nueva incorporación": busca/crea una ficha y la asocia a ESTE equipo desde
 * 2027 → transfer (from = equipo actual del corredor, to = T) + afiliación 2027.
 * Reutiliza el editor de movimiento estándar pero con el destino prefijado a T.
 */
function _tseOpenNewSigning() {
  // Reusa el editor de movimiento estándar (drawer nivel 1) con el destino
  // prefijado a ESTE equipo; el editor de ficha nueva se apila en nivel 2 sin
  // colisión (el team-editor de nivel 1 se ha reemplazado por el movimiento).
  // Al guardar: además del transfer, se materializa la afiliación 2027 hacia T,
  // y se vuelve al editor de equipo.
  // La afiliación 2027 del destino la sincroniza saveTransfer (solo si el
  // fichaje es confirmado); aquí basta con recargar y volver al equipo.
  const teamId = _tseTeamId;
  openTransferEditor(null, { presetToTeamId: teamId, onSaved: async () => {
    await loadTransfers();
    await openTeamSituationEditor(teamId);
  } });
}

// ── Escritura de afiliaciones 2027 (materialización de plantilla) ──────
// El mercado solo materializa afiliaciones habituales; nunca vínculos de prueba.
// Un corredor solo puede tener UNA afiliación de mercado por año → la clave lógica es
// (riderId, year). Al continuar en T se borra cualquier afiliación 2027 previa
// (a otro equipo) y se inserta/actualiza la de T. `year` = año de fin de
// contrato (UI); se guarda como dateTo = 31-dic de ese año (dateFrom = 1-ene
// de la temporada del mercado). year null = contrato sin definir → dateTo NULL.
async function _upsertAffiliation2027(riderId, gender, teamId, year) {
  const { data: existing, error: selErr } = await supabase.from('rider_team_affiliations')
    .select('id, teamId')
    .eq('affiliationType', 'regular')
    .eq('riderGender', gender)
    .eq('riderId', riderId)
    .eq('year', MARKET_SEASON);
  if (selErr) throw selErr;
  const rows = existing || [];
  const mine = rows.find(a => a.teamId === teamId);
  // Borrar afiliaciones 2027 a OTROS equipos (el corredor cambió de casa).
  const others = rows.filter(a => a.teamId !== teamId).map(a => a.id);
  if (others.length) {
    const { error } = await supabase.from('rider_team_affiliations').delete().in('id', others);
    if (error) throw error;
  }
  const dateTo = _affDateTo(year);
  const now = new Date().toISOString();
  if (mine) {
    const { error } = await supabase.from('rider_team_affiliations')
      .update({ dateFrom: _AFF_DATE_FROM, dateTo, updatedAt: now })
      .eq('id', mine.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('rider_team_affiliations').insert({
      id: _tseNewId('aff'),
      riderId, riderGender: gender, teamId, year: MARKET_SEASON,
      dateFrom: _AFF_DATE_FROM, dateTo, source: 'manual', verified: true,
    });
    if (error) throw error;
  }
}

export async function _deleteAffiliation2027(riderId, teamId, gender) {
  const { error } = await supabase.from('rider_team_affiliations')
    .delete()
    .eq('affiliationType', 'regular')
    .eq('riderGender', gender)
    .eq('riderId', riderId)
    .eq('year', MARKET_SEASON)
    .eq('teamId', teamId);
  if (error) throw error;
}

// Sincroniza la afiliación 2027 de destino de un FICHAJE (type='transfer' con
// equipo del catálogo): un fichaje CONFIRMADO materializa la afiliación al
// destino (entra en la plantilla 2027); un rumor NO (no es un hecho → solo sale
// en "Llegan · Rumor"). Al confirmar un rumor de llegada se crea; al degradar a
// rumor se borra. Solo actúa sobre fichajes al catálogo; el resto (renovación,
// retirada, destino texto libre) no toca afiliaciones aquí.
export async function _syncSigningAffiliation(t) {
  if (!t || t.type !== 'transfer' || !t.toTeamId) return;
  // `midSeason` no es evidencia contractual para la temporada siguiente. La
  // afiliación 2027 solo se escribe desde un contrato/roster verificado; no
  // tocarla aquí preserva tanto una continuidad ya confirmada como la ausencia
  // correcta de afiliación cuando aún no se ha anunciado el contrato.
  if (t.midSeason) return;
  if (t.status === 'confirmed') {
    await _upsertAffiliation2027(t.riderId, t.riderGender, t.toTeamId, t.contractUntil || null);
  } else {
    await _deleteAffiliation2027(t.riderId, t.toTeamId, t.riderGender);
  }
}

// Sincronización común del editor individual de Fichajes. Primero elimina la
// materialización previa de la temporada y después aplica exactamente el estado
// guardado: continuidad/duda en el equipo asociado, cambio confirmado en el
// destino, o ninguna afiliación para cambio rumoreado/fin de contrato.
export async function _syncMarketSituationAffiliation(t) {
  if (!t || t.midSeason) return;
  const { error: clearErr } = await supabase.from('rider_team_affiliations')
    .delete().eq('affiliationType', 'regular').eq('riderGender', t.riderGender)
    .eq('riderId', t.riderId).eq('year', MARKET_SEASON);
  if (clearErr) throw clearErr;
  if (t.type === 'renewal' && t.toTeamId) {
    await _upsertAffiliation2027(t.riderId, t.riderGender, t.toTeamId, t.contractUntil || null);
  } else if (t.type === 'transfer' && t.status === 'confirmed' && t.toTeamId) {
    await _upsertAffiliation2027(t.riderId, t.riderGender, t.toTeamId, t.contractUntil || null);
  }
}

// Borra las filas rider_transfers de T (from=T, o renewal+doubt to=T) de un
// corredor: se usa al cambiar su estado (p. ej. de "cambio"/"duda" a "continúa").
async function _tseClearRiderTransfersForTeam(riderId, teamId) {
  const ids = panelState._transfersCache.filter(t =>
    t.riderId === riderId && !t.midSeason && (
      ((t.type === 'transfer' || t.type === 'retirement') && t.fromTeamId === teamId) ||
      (t.type === 'renewal' && t.toTeamId === teamId)
    )).map(t => t.id);
  if (!ids.length) return;
  const { error } = await supabase.from('rider_transfers').delete().in('id', ids);
  if (error) throw error;
}

// Un corredor debe tener UN SOLO movimiento vigente en el mercado (decisión Dani,
// 2026-07-20). Al guardar un movimiento desde el editor independiente, se borran
// TODOS los demás de ese corredor en la temporada (salvo el que se está guardando):
// arregla el caso "fin de contrato huérfano + cambio a otro equipo" (el saliente
// seguía mostrándolo como fin de contrato) y evita dos movimientos coexistentes,
// incluso al mismo equipo. Se limpian también sus afiliaciones 2027 (la del
// movimiento guardado la vuelve a poner _syncSigningAffiliation / _tseSaveTeam).
export async function _clearOtherTransfersForRider(riderId, keepId) {
  const ids = (panelState._transfersCache || [])
    // Los movimientos mid-season comparten tabla y temporada del mercado por
    // comodidad editorial, pero pueden coexistir con un fichaje para 2027.
    .filter(t => t.riderId === riderId && t.season === MARKET_SEASON && t.id !== keepId && !t.midSeason)
    .map(t => t.id);
  if (!ids.length) return;
  const { error } = await supabase.from('rider_transfers').delete().in('id', ids);
  if (error) throw error;
}

/**
 * Aplica en lote la situación de cada corredor que cambió respecto al estado
 * inicial. Cada estado se traduce a afiliación 2027 + rider_transfers según la
 * tabla del encabezado.
 */
async function _tseSaveTeam() {
  const status = document.getElementById('tse-save-status');
  const teamId = _tseTeamId;

  // Validación previa: cambio sin destino / año fuera de rango se avisan.
  for (const s of _tseSituations.values()) {
    if (s.state === 'change' && !s.newTeamId) {
      if (status) { status.style.color = 'var(--red)'; status.textContent = `${s.rider.lastName}: elige el equipo de destino del cambio.`; }
      return;
    }
    if (s.state === 'change' && !isMarketDestinationTeamEligible({
      teamId: s.newTeamId,
      teams: panelState._teamsCache || [],
      marketSeasons: panelState._marketSeasons || [],
      gender: s.rider.gender,
    })) {
      if (status) { status.style.color = 'var(--red)'; status.textContent = `${s.rider.lastName}: el destino debe pertenecer a las dos primeras divisiones de ${MARKET_SEASON}.`; }
      return;
    }
  }

  if (status) { status.style.color = 'var(--text-dim)'; status.textContent = 'Guardando…'; }
  try {
    for (const s of _tseSituations.values()) {
      const r = s.rider;
      // Nada que hacer si no cambió respecto al estado inicial.
      if (_tseSameSituation(s, s.initial)) continue;

      // Todo estado (menos "sin decidir") reescribe desde cero: limpiar las
      // filas de transfers de T de ese corredor y decidir la afiliación.
      await _tseClearRiderTransfersForTeam(r.id, teamId);

      if (s.state === 'stay') {
        // Vitalicio → año centinela 9999; "sin año" → null; si no, el año.
        const year = s.lifetime ? TSE_LIFETIME_YEAR : (s.yearUnknown ? null : s.year);
        await _upsertAffiliation2027(r.id, r.gender, teamId, year);
        if (s.rumor) {
          const { error } = await supabase.from('rider_transfers').insert({
            id: _tseNewId('tr'),
            season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
            toTeamId: teamId, type: 'renewal', status: 'rumor',
            contractUntil: year, announcedAt: s.announcedAt || _localDateKey(), dateVisible: true,
          });
          if (error) throw error;
        }
        // Sync opcional del año a la ficha (no el centinela ni el desconocido).
        if (year && year !== TSE_LIFETIME_YEAR) await _syncTransferContractToRider({ status: 'confirmed', type: 'renewal', contractUntil: year, riderGender: r.gender, riderId: r.id });
      } else if (s.state === 'doubt') {
        // Duda: sigue afiliado a T, + rider_transfers renewal+doubt.
        await _upsertAffiliation2027(r.id, r.gender, teamId, s.year || null);
        await supabase.from('rider_transfers').insert({
          id: _tseNewId('tr'),
          season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
          toTeamId: teamId, type: 'renewal', status: 'doubt',
          contractUntil: s.year || null, announcedAt: _localDateKey(), dateVisible: true,
        });
      } else if (s.state === 'change') {
        await _deleteAffiliation2027(r.id, teamId, r.gender);
        // Un rumor no sale en el feed → su fecha de anuncio es HOY (irrelevante);
        // un cambio confirmado lleva la fecha de confirmación que marcó el editor.
        await supabase.from('rider_transfers').insert({
          id: _tseNewId('tr'),
          season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
          fromTeamId: teamId, toTeamId: s.newTeamId, type: 'transfer',
          status: s.rumor ? 'rumor' : 'confirmed',
          contractUntil: s.year || null,
          announcedAt: (s.rumor ? _localDateKey() : (s.announcedAt || _localDateKey())),
          dateVisible: true,
        });
      } else if (s.state === 'end') {
        await _deleteAffiliation2027(r.id, teamId, r.gender);
        if (s.retired) {
          await supabase.from('rider_transfers').insert({
            id: _tseNewId('tr'),
            season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
            fromTeamId: teamId, type: 'retirement', status: 'confirmed',
            announcedAt: _localDateKey(), dateVisible: true,
          });
        } else {
          // Baja sin destino conocido: transfer con destino '?'.
          await supabase.from('rider_transfers').insert({
            id: _tseNewId('tr'),
            season: MARKET_SEASON, riderId: r.id, riderGender: r.gender,
            fromTeamId: teamId, toTeamName: TSE_UNKNOWN_DEST, type: 'transfer', status: 'confirmed',
            announcedAt: _localDateKey(), dateVisible: true,
          });
        }
      } else {
        // 'undecided': ya se limpiaron sus transfers de T arriba; también quitar
        // su afiliación 2027 a T (deja de formar parte hasta que se decida).
        await _deleteAffiliation2027(r.id, teamId, r.gender);
      }
    }

    showToast('Equipo guardado', 'success', 2500);
    closeDrawer(1);
    await loadTransfers();
    renderMarketTeams();
  } catch (err) {
    console.error('[_tseSaveTeam]', err);
    if (status) { status.style.color = 'var(--red)'; status.textContent = 'Error: ' + (err.message || err); }
  }
}

function _tseSameSituation(a, b) {
  if (a.state !== b.state) return false;
  const yearA = a.state === 'stay' && a.yearUnknown ? null : a.year;
  const yearB = b.state === 'stay' && b.yearUnknown ? null : b.year;
  if ((yearA || null) !== (yearB || null)) return false;
  if (a.state === 'stay' && a.yearUnknown !== b.yearUnknown) return false;
  if (a.state === 'stay' && !!a.lifetime !== !!b.lifetime) return false;
  if (a.state === 'stay' && !!a.rumor !== !!b.rumor) return false;
  if (a.state === 'change') {
    if ((a.newTeamId || null) !== (b.newTeamId || null)) return false;
    if (!!a.rumor !== !!b.rumor) return false;
    // La fecha de confirmación solo importa si NO es rumor.
    if (!a.rumor && (a.announcedAt || null) !== (b.announcedAt || null)) return false;
  }
  if (a.state === 'end' && a.retired !== b.retired) return false;
  return true;
}
