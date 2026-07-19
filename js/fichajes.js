// ─────────────────────────────────────────────────────────────────
//  FICHAJES — /fichajes/ (+ EN /en/transfers/)
//  Mercado de fichajes de la temporada 2027 (tabla rider_transfers, mig. 122).
//
//  Estructura de la página:
//   1. Feed cronológico inverso de CONFIRMACIONES (fichajes + renovaciones;
//      los rumores y las dudas NO aparecen aquí). Un movimiento con la fecha
//      oculta (dateVisible=false, mig. 123) tampoco: la carga inicial mete de
//      golpe anuncios de hace semanas que poblarían el feed de días viejos.
//   2. Botones de división (WT · WWT · PT · PRW) + lista de equipos 2027.
//      Los equipos salen de team_seasons[2027] → los renombres de sponsor y
//      los ascensos/descensos se editan en el panel sin tocar `teams`.
//      La chapa muestra los colores 2027 si team_seasons.badgeVisible; si aún
//      no (kit 2027 sin anunciar), muestra los colores ANTIGUOS del equipo
//      (temporada en curso, 2026) — o nada si es un equipo NUEVO nacido en 2027
//      (sin fila 2026, mig. 129). continuityDoubt → chip + aviso (el equipo
//      mismo puede no tener sponsor para 2027).
//   3. Vista de equipo (sustituye al listado, con volver): continúan /
//      en duda / se marchan / llegan. Regla del rumor (decisión Dani): una
//      salida rumoreada saca al corredor de "continúan" y lo pinta como
//      baja·Rumor (y como alta·Rumor en el destino). Regla de la duda: una
//      renovación en duda (status='doubt', solo en renewal) lo saca también
//      de "continúan" y lo lleva a su propia sección.
//
//  Estado compartible por URL: ?div=WT|WWT|PT|PRW y ?equipo=<teamId>
//  (replaceState, sin recarga).
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, buildTeamBadgeSvg } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';

const SEASON = 2027;
const PREV_SEASON = SEASON - 1;
const DIVISIONS = ['WT', 'WWT', 'PT', 'PRW'];
const FEED_PAGE = 40;

// Género de la tabla riders_* por división (para la plantilla "continúan").
const DIVISION_GENDER = { WT: 'male', PT: 'male', WWT: 'female', PRW: 'female' };

let _seasonsByTeamId = new Map();   // teamId → fila team_seasons 2027
// El nombre de un equipo depende del LADO del movimiento: de dónde sale un
// corredor es el equipo de la temporada en curso (2026, la que se está
// corriendo); a dónde va es el de la temporada del mercado (2027). Un mapa
// por año; `teams` NO sirve de archivo histórico (su trigger sync_team_to_season
// pisa siempre el año en curso).
let _teamNamePrev = new Map();      // teamId → nombre 2026 (origen)
let _teamNameById = new Map();      // teamId → nombre 2027 (destino)
// Colores de la temporada EN CURSO (2026) por equipo: los "antiguos", que se
// muestran mientras la chapa 2027 está oculta. Un equipo NUEVO (nacido en 2027)
// no tiene fila 2026 → sin entrada aquí → la chapa queda vacía (mig. 129).
let _prevColorsByTeamId = new Map();
let _transfers = [];                // rider_transfers 2027 + .rider hidratado
let _feedLimit = FEED_PAGE;
let _activeDiv = 'WT';
let _rosterCache = new Map();       // teamId → [{ ...ficha }]

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function riderName(r) {
  if (!r) return '';
  return `${r.firstName || ''} ${r.lastName || ''}`.trim();
}

// `side`: 'from' → nombre de la temporada en curso (el equipo que el corredor
// deja); 'to' → nombre de la temporada del mercado (con el que va a correr).
function teamLabel(teamId, freeText, side = 'to') {
  if (!teamId) return freeText || t('transfers.unknownTeam');
  const primary = side === 'from' ? _teamNamePrev : _teamNameById;
  const fallback = side === 'from' ? _teamNameById : _teamNamePrev;
  return primary.get(teamId) || fallback.get(teamId) || teamId;
}

function rumorChip() {
  return `<span class="tr-chip tr-chip--rumor">${esc(t('transfers.rumor'))}</span>`;
}

function doubtChip() {
  return `<span class="tr-chip tr-chip--doubt">${esc(t('transfers.doubt'))}</span>`;
}

function contractBit(year) {
  if (!year) return '';
  return `<span class="tr-contract">${esc(t('transfers.until', { year }))}</span>`;
}

function dayHeading(dateKey) {
  if (!dateKey) return '';
  const d = new Date(dateKey + 'T00:00:00');
  const locale = getLang() === 'en' ? 'en-GB' : 'es-ES';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Carga inicial ─────────────────────────────────────────────────
async function loadData() {
  const [seasonsRes, prevSeasonsRes, transfersRes] = await Promise.all([
    supabase.from('team_seasons')
      .select('teamId, name, category, gender, badgeVisible, continuityDoubt, headerBg, headerText, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts')
      .eq('year', SEASON),
    supabase.from('team_seasons')
      .select('teamId, name, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts')
      .eq('year', PREV_SEASON),
    supabase.from('rider_transfers')
      .select('*')
      .eq('season', SEASON)
      .order('announcedAt', { ascending: false })
      .order('createdAt', { ascending: false }),
  ]);
  if (seasonsRes.error) throw seasonsRes.error;
  if (prevSeasonsRes.error) throw prevSeasonsRes.error;
  if (transfersRes.error) throw transfersRes.error;

  _seasonsByTeamId = new Map((seasonsRes.data || []).map(s => [s.teamId, s]));
  _teamNameById = new Map((seasonsRes.data || []).map(s => [s.teamId, s.name]));
  _teamNamePrev = new Map((prevSeasonsRes.data || []).map(s => [s.teamId, s.name]));
  _prevColorsByTeamId = new Map((prevSeasonsRes.data || []).map(s => [s.teamId, s]));
  _transfers = transfersRes.data || [];

  // Hidratar fichas (nombre + bandera) en bulk por género.
  const cols = 'id, firstName, lastName, nationality, contractUntil';
  const menIds   = [...new Set(_transfers.filter(x => x.riderGender === 'male').map(x => x.riderId))];
  const womenIds = [...new Set(_transfers.filter(x => x.riderGender === 'female').map(x => x.riderId))];
  const [men, women] = await Promise.all([
    menIds.length   ? supabase.from('riders_men').select(cols).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
    womenIds.length ? supabase.from('riders_women').select(cols).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
  ]);
  const byKey = new Map();
  men.forEach(r => byKey.set(`male:${r.id}`, r));
  women.forEach(r => byKey.set(`female:${r.id}`, r));
  _transfers.forEach(x => { x.rider = byKey.get(`${x.riderGender}:${x.riderId}`) || null; });

  // Último recurso para equipos sin fila en NINGUNA de las dos temporadas
  // (destinos fuera de las 4 divisiones sembradas, altas sin catalogar…).
  const refIds = new Set();
  const known = (id) => _teamNameById.has(id) || _teamNamePrev.has(id);
  _transfers.forEach(x => {
    if (x.fromTeamId && !known(x.fromTeamId)) refIds.add(x.fromTeamId);
    if (x.toTeamId && !known(x.toTeamId)) refIds.add(x.toTeamId);
  });
  if (refIds.size) {
    const { data: extra } = await supabase.from('teams').select('id, name').in('id', [...refIds]);
    (extra || []).forEach(tm => {
      if (!_teamNameById.has(tm.id)) _teamNameById.set(tm.id, tm.name);
      if (!_teamNamePrev.has(tm.id)) _teamNamePrev.set(tm.id, tm.name);
    });
  }
}

// ── Feed de confirmaciones ────────────────────────────────────────
// Solo confirmaciones con fecha visible. `dateVisible=false` (mig. 123) es un
// flag de publicación en el feed, no una fecha ausente: el movimiento sigue
// contando en la vista de equipo (llegan/se marchan/continúan) — es como se
// puebla el mercado sin llenar el feed de anuncios viejos.
function confirmedFeed() {
  return _transfers.filter(x => x.status === 'confirmed' && x.dateVisible !== false);
}

function feedRowHtml(x) {
  const flag = x.rider?.nationality ? countryFlag(x.rider.nationality) : '';
  const name = `<strong>${esc(riderName(x.rider) || x.riderId)}</strong>`;
  let move;
  if (x.type === 'renewal') {
    move = `${esc(t('transfers.renews'))} <strong>${esc(teamLabel(x.toTeamId, x.toTeamName))}</strong>`;
  } else if (x.type === 'retirement') {
    move = `${esc(t('transfers.retires'))} <span class="tr-dim">(${esc(teamLabel(x.fromTeamId, x.fromTeamName, 'from'))})</span>`;
  } else {
    move = `<span class="tr-dim">${esc(teamLabel(x.fromTeamId, x.fromTeamName, 'from'))}</span>
      <span class="tr-arrow">→</span>
      <strong>${esc(teamLabel(x.toTeamId, x.toTeamName))}</strong>`;
  }
  return `<div class="tr-row">
    <span class="tr-row__flag">${flag}</span>
    <span class="tr-row__body">${name} ${move} ${contractBit(x.contractUntil)}</span>
  </div>`;
}

function renderFeed() {
  const box = $('trFeed');
  if (!box) return;
  const feed = confirmedFeed();
  if (feed.length === 0) {
    box.innerHTML = `<div class="tr-empty">${esc(t('transfers.feedEmpty'))}</div>`;
    return;
  }
  const visible = feed.slice(0, _feedLimit);
  let html = '';
  let lastDay = null;
  visible.forEach(x => {
    if (x.announcedAt !== lastDay) {
      lastDay = x.announcedAt;
      html += `<div class="tr-feed-day">${esc(dayHeading(x.announcedAt))}</div>`;
    }
    html += feedRowHtml(x);
  });
  if (feed.length > _feedLimit) {
    html += `<button class="tr-more" id="trMoreBtn">${esc(t('transfers.loadMore'))}</button>`;
  }
  box.innerHTML = html;
  $('trMoreBtn')?.addEventListener('click', () => { _feedLimit += FEED_PAGE; renderFeed(); });
}

// ── Divisiones + lista de equipos ─────────────────────────────────
function divisionTeams(div) {
  return [..._seasonsByTeamId.values()]
    .filter(s => s.category === div)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
}

function badgeOrPlaceholder(season, size) {
  // Colores 2027 PUBLICADOS: la chapa se pinta con un true EXPLÍCITO. Un dato
  // ausente (fila sembrada por SQL, columna fuera del select) NO cuenta como
  // publicado — enseñar un kit 2027 inventado es peor que no enseñar ninguno.
  if (season && season.badgeVisible === true) {
    return buildTeamBadgeSvg(season, { size });
  }
  // Chapa 2027 sin publicar: si el equipo YA existía en la temporada en curso,
  // se muestran sus colores ANTIGUOS (los que la gente conoce) hasta que se
  // anuncie el kit 2027 (decisión Dani 2026-07-18). Un equipo NUEVO (nacido en
  // 2027, sin fila 2026 → mig. 129) no tiene colores antiguos → queda vacío.
  const prev = season && _prevColorsByTeamId.get(season.teamId);
  if (prev) return buildTeamBadgeSvg(prev, { size });
  return '';
}

function renderTeams() {
  const btns = $('trDivBtns');
  const grid = $('trTeamGrid');
  if (!btns || !grid) return;

  btns.innerHTML = DIVISIONS.map(d =>
    `<button class="tr-div-btn${d === _activeDiv ? ' tr-div-btn--active' : ''}" data-div="${d}">${d}</button>`
  ).join('');
  btns.querySelectorAll('[data-div]').forEach(b =>
    b.addEventListener('click', () => {
      _activeDiv = b.dataset.div;
      const qs = new URLSearchParams(location.search);
      qs.set('div', _activeDiv);
      qs.delete('equipo');
      history.replaceState(null, '', `${location.pathname}?${qs}`);
      renderTeams();
    })
  );

  const teams = divisionTeams(_activeDiv);
  if (teams.length === 0) {
    grid.innerHTML = `<div class="tr-empty">${esc(t('transfers.teamsEmpty'))}</div>`;
    return;
  }
  grid.innerHTML = teams.map(s => `
    <button class="tr-team-card" data-team="${esc(s.teamId)}">
      ${badgeOrPlaceholder(s, 26)}
      <span class="tr-team-card__name">${esc(s.name)}</span>
      ${s.continuityDoubt ? `<span class="tr-chip tr-chip--doubt">${esc(t('transfers.teamDoubt'))}</span>` : ''}
      <svg class="tr-team-card__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`).join('');
  grid.querySelectorAll('[data-team]').forEach(el =>
    el.addEventListener('click', () => openTeam(el.dataset.team))
  );
}

// ── Vista de equipo ───────────────────────────────────────────────
async function loadRoster(teamId) {
  if (_rosterCache.has(teamId)) return _rosterCache.get(teamId);
  const season = _seasonsByTeamId.get(teamId);
  const gender = season?.gender || DIVISION_GENDER[season?.category] || null;
  const cols = 'id, firstName, lastName, nationality, contractUntil';
  const tables = gender === 'male' ? ['riders_men']
    : gender === 'female' ? ['riders_women']
    : ['riders_men', 'riders_women'];
  const results = await Promise.all(tables.map(tb =>
    supabase.from(tb).select(cols).eq('currentTeamId', teamId).then(r => r.data || [])
  ));
  const roster = results.flat().sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
  _rosterCache.set(teamId, roster);
  return roster;
}

function personRowHtml({ flagCode, name, detail = '', contract = null, isRumor = false, isDoubt = false }) {
  return `<div class="tr-row tr-row--team">
    <span class="tr-row__flag">${flagCode ? countryFlag(flagCode) : ''}</span>
    <span class="tr-row__body"><strong>${esc(name)}</strong>${detail ? ` ${detail}` : ''} ${contractBit(contract)}</span>
    ${isDoubt ? doubtChip() : isRumor ? rumorChip() : ''}
  </div>`;
}

async function openTeam(teamId, { push = true } = {}) {
  const season = _seasonsByTeamId.get(teamId);
  if (!season) return;

  if (push) {
    const qs = new URLSearchParams(location.search);
    qs.set('div', _activeDiv);
    qs.set('equipo', teamId);
    history.replaceState(null, '', `${location.pathname}?${qs}`);
  }

  $('trHome').hidden = true;
  const view = $('trTeamView');
  view.hidden = false;
  view.innerHTML = `
    <button class="tr-back" id="trBackBtn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      ${esc(t('transfers.back'))}
    </button>
    <div class="tr-team-header">
      ${badgeOrPlaceholder(season, 44)}
      <div class="tr-team-header__text">
        <h2 class="tr-team-header__name">${esc(season.name)}</h2>
        <span class="tr-team-header__cat">${esc(season.category || '')} · ${SEASON}</span>
      </div>
    </div>
    ${season.continuityDoubt
      ? `<div class="tr-team-notice">${esc(t('transfers.teamDoubtNotice', { season: SEASON }))}</div>`
      : ''}
    <div class="tr-team-sections">
      <section>
        <h3 class="tr-section-title">${esc(t('transfers.staying'))}</h3>
        <div id="trStaying"><div class="tr-empty">…</div></div>
      </section>
      <section>
        <h3 class="tr-section-title">${esc(t('transfers.doubtful'))}</h3>
        <div id="trDoubtful"></div>
      </section>
      <section>
        <h3 class="tr-section-title">${esc(t('transfers.departures'))}</h3>
        <div id="trDepartures"></div>
      </section>
      <section>
        <h3 class="tr-section-title">${esc(t('transfers.arrivals'))}</h3>
        <div id="trArrivals"></div>
      </section>
    </div>`;
  $('trBackBtn').addEventListener('click', closeTeam);
  // El scroll del sitio vive en <body> (overflow-y auto), no en window.
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;

  // Movimientos del equipo
  const arrivals = _transfers.filter(x => x.type === 'transfer' && x.toTeamId === teamId);
  const departures = _transfers.filter(x =>
    (x.type === 'transfer' || x.type === 'retirement') && x.fromTeamId === teamId);
  // Renovaciones: las EN DUDA van a su propia sección; el resto (confirmada o
  // rumoreada) sigue anotando el contrato de quien continúa.
  const renewalsByRider = new Map();
  const doubtsByRider = new Map();
  _transfers.filter(x => x.type === 'renewal' && x.toTeamId === teamId)
    .forEach(x => {
      const bucket = x.status === 'doubt' ? doubtsByRider : renewalsByRider;
      if (!bucket.has(x.riderId)) bucket.set(x.riderId, x);
    });

  // Llegan: cronológico inverso (ya vienen ordenados), rumores con badge.
  $('trArrivals').innerHTML = arrivals.length
    ? arrivals.map(x => personRowHtml({
        flagCode: x.rider?.nationality,
        name: riderName(x.rider) || x.riderId,
        detail: `<span class="tr-dim">· ${esc(teamLabel(x.fromTeamId, x.fromTeamName, 'from'))}</span>`,
        contract: x.contractUntil,
        isRumor: x.status === 'rumor',
      })).join('')
    : `<div class="tr-empty">${esc(t('transfers.arrivalsEmpty'))}</div>`;

  // Se marchan: destino (o retirada), rumores con badge.
  $('trDepartures').innerHTML = departures.length
    ? departures.map(x => personRowHtml({
        flagCode: x.rider?.nationality,
        name: riderName(x.rider) || x.riderId,
        detail: x.type === 'retirement'
          ? `<span class="tr-dim">· ${esc(t('transfers.retires'))}</span>`
          : `<span class="tr-dim">· ${esc(teamLabel(x.toTeamId, x.toTeamName))}</span>`,
        isRumor: x.status === 'rumor',
      })).join('')
    : `<div class="tr-empty">${esc(t('transfers.departuresEmpty'))}</div>`;

  // Continúan: plantilla actual MENOS los que tienen salida registrada
  // (confirmada O rumoreada — el rumor ya los muestra como baja·Rumor) y
  // MENOS los que están en duda (que tienen su propia sección).
  // Contrato: el de la renovación registrada gana al de la ficha; una duda
  // NO lo toca (no es un hecho, no puede pisar el contrato de la ficha).
  try {
    const roster = await loadRoster(teamId);
    const gone = new Set(departures.map(x => x.riderId));
    const staying = roster.filter(r => !gone.has(r.id) && !doubtsByRider.has(r.id));
    $('trStaying').innerHTML = staying.length
      ? staying.map(r => {
          const renewal = renewalsByRider.get(r.id);
          return personRowHtml({
            flagCode: r.nationality,
            name: riderName(r),
            contract: renewal?.contractUntil || r.contractUntil,
            isRumor: renewal?.status === 'rumor',
          });
        }).join('')
      : `<div class="tr-empty">${esc(t('transfers.stayingEmpty'))}</div>`;

    // En duda: los de la plantilla con renovación en duda. La ficha manda
    // para el nombre/bandera; si el corredor ya no está en la plantilla
    // (fichado en enero, ficha ya movida) se cae a la del movimiento.
    const byId = new Map(roster.map(r => [r.id, r]));
    const doubtful = [...doubtsByRider.values()]
      .filter(x => !gone.has(x.riderId))
      .map(x => ({ x, r: byId.get(x.riderId) || x.rider }))
      .sort((a, b) => riderName(a.r).localeCompare(riderName(b.r), 'es', { sensitivity: 'base' }));
    $('trDoubtful').innerHTML = doubtful.length
      ? doubtful.map(({ x, r }) => personRowHtml({
          flagCode: r?.nationality,
          name: riderName(r) || x.riderId,
          contract: r?.contractUntil,
          isDoubt: true,
        })).join('')
      : `<div class="tr-empty">${esc(t('transfers.doubtfulEmpty'))}</div>`;
  } catch (err) {
    console.error('[fichajes] roster', err);
    $('trStaying').innerHTML = `<div class="tr-empty">${esc(t('transfers.loadError'))}</div>`;
    $('trDoubtful').innerHTML = '';
  }
}

function closeTeam() {
  $('trTeamView').hidden = true;
  $('trTeamView').innerHTML = '';
  $('trHome').hidden = false;
  const qs = new URLSearchParams(location.search);
  qs.delete('equipo');
  qs.set('div', _activeDiv);
  history.replaceState(null, '', `${location.pathname}?${qs}`);
}

// ── Bootstrap ─────────────────────────────────────────────────────
async function init() {
  await initI18n();

  const content = $('transfersContent');
  const main = $('fichajesMain');

  try {
    await loadData();
  } catch (err) {
    console.error('[fichajes] load', err);
    content.innerHTML = `<div class="tr-empty" style="padding:2rem 0">${esc(t('transfers.loadError'))}</div>`;
    content.hidden = false;
    main.querySelector('#trStaticLoading')?.remove();
    main.querySelector('.static-prerender')?.remove();
    return;
  }

  const qs = new URLSearchParams(location.search);
  if (DIVISIONS.includes((qs.get('div') || '').toUpperCase())) {
    _activeDiv = qs.get('div').toUpperCase();
  }

  content.innerHTML = `
    <h1 class="tr-heading">${esc(t('transfers.heading', { season: SEASON }))}</h1>
    <div id="trHome">
      <section>
        <h2 class="tr-section-title">${esc(t('transfers.feedTitle'))}</h2>
        <div id="trFeed"></div>
      </section>
      <section>
        <h2 class="tr-section-title">${esc(t('transfers.teamsTitle', { season: SEASON }))}</h2>
        <div class="tr-div-btns" id="trDivBtns"></div>
        <div class="tr-team-grid" id="trTeamGrid"></div>
      </section>
    </div>
    <div id="trTeamView" hidden></div>`;
  content.hidden = false;

  // Retirar los marcadores del overlay de carga (page-loading.js) una vez
  // el contenido real está montado.
  main.querySelector('#trStaticLoading')?.remove();
  main.querySelector('.static-prerender')?.remove();

  renderFeed();
  renderTeams();

  const teamParam = qs.get('equipo');
  if (teamParam && _seasonsByTeamId.has(teamParam)) {
    const cat = _seasonsByTeamId.get(teamParam)?.category;
    if (DIVISIONS.includes(cat)) _activeDiv = cat;
    await openTeam(teamParam, { push: false });
  }
}

init();
