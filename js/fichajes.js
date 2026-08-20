// ─────────────────────────────────────────────────────────────────
//  FICHAJES — /fichajes/ (+ EN /en/transfers/)
//  Mercado de fichajes de la temporada 2027 (tabla rider_transfers, mig. 122).
//
//  Estructura de la página:
//   1. Feed cronológico inverso de CONFIRMACIONES (fichajes + renovaciones;
//      los rumores y las dudas NO aparecen aquí). Un movimiento con la fecha
//      oculta (dateVisible=false, mig. 123) tampoco: la carga inicial mete de
//      golpe anuncios de hace semanas que poblarían el feed de días viejos.
//   2. Botones de división (WT · PT · WWT · PRW) + lista de equipos 2027.
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
//  Estado compartible por URL: ?div=WT|WWT|PT|PRW y ?team=<slug> (bilingüe
//  ES/EN; ?equipo= antiguo se sigue leyendo por retrocompatibilidad), sin
//  recarga. Abrir un equipo apila una entrada de historial (pushState) → el
//  botón atrás del navegador vuelve a la home de mercado (o al equipo anterior),
//  no a la home global; el listener popstate sincroniza la vista con la URL.
//  Cambiar de división es replaceState (no apila).
// ─────────────────────────────────────────────────────────────────

import { supabase, countryFlag, buildTeamBadgeSvg, trapFocus } from './shared.js';
import { t, getLang, initI18n } from './i18n.js';

const SEASON = 2027;
const PREV_SEASON = SEASON - 1;
const DIVISIONS = ['WT', 'PT', 'WWT', 'PRW'];
// Corte del feed "Últimas confirmaciones": 5 fechas distintas U 8 fichajes, lo
// que se alcance antes.
const FEED_MAX_DAYS = 5;
const FEED_MAX_ITEMS = 8;

// Periodistas acreditados en /abierto.html. Se mantienen aquí para que los
// enlaces del aviso de fuentes sean interactivos también en el modal web.
const TRANSFER_SOURCES = [
  { name: 'Nacho Labarga', outlet: 'MARCA', url: 'https://x.com/nacholabarga' },
  { name: 'Dani Miranda', outlet: 'AS', url: 'https://x.com/danimiranda9' },
  { name: 'Ciro Scognamiglio', outlet: 'La Gazzetta dello Sport', url: 'https://x.com/cirogazzetta' },
  { name: 'Youri IJnsen', outlet: 'WielerFlits', url: 'https://x.com/Youri_IJnsen' },
  { name: 'James Odvart', outlet: 'DirectVelo', url: 'https://x.com/OdvartJames' },
  { name: 'Daniel Benson', outlet: '', url: 'https://x.com/dnlbenson' },
  { name: 'Bram Vandecapelle', outlet: 'Het Laatste Nieuws', url: 'https://x.com/bvdecape' },
];

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
let _activeDiv = 'WT';
let _activeFeed = 'signings';
let _rosterCache = new Map();       // teamId → [{ ...ficha }]
let _slugToTeamId = new Map();      // slug del nombre 2027 → teamId (URL)
let _teamIdToSlug = new Map();      // teamId → slug

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Slug legible para la URL: minúsculas, sin acentos, separadores → guiones.
function teamSlug(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'equipo';
}

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

// Año centinela para contrato VITALICIO (dateTo 9999-12-31): se pinta ∞.
const LIFETIME_YEAR = 9999;
function contractBit(year) {
  if (!year) return '';
  const label = year === LIFETIME_YEAR ? '∞' : t('transfers.until', { year });
  return `<span class="tr-contract"${year === LIFETIME_YEAR ? ' title="Vitalicio"' : ''}>${esc(label)}</span>`;
}

function midSeasonBit(isMidSeason) {
  return isMidSeason ? `<span class="tr-contract tr-contract--midseason">${esc(t('transfers.midSeason'))}</span>` : '';
}

// Fecha del feed: día de la semana + día + mes, SIN año (ES: "martes 24 de
// junio"; EN: "Tuesday 24 June"). Primera letra en mayúscula.
function dayHeading(dateKey) {
  if (!dateKey) return '';
  const d = new Date(dateKey + 'T00:00:00');
  const locale = getLang() === 'en' ? 'en-GB' : 'es-ES';
  // Sin coma tras el día de la semana, para casar con el formato de las apps
  // ("Miércoles 24 de junio").
  const s = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  // Slug legible del nombre 2027 para la URL (?equipo=visma-lease-a-bike).
  // Varias marcas tienen equipo masculino Y femenino con el MISMO nombre
  // (Cofidis, Lidl-Trek, Movistar…): su slug base colisiona. En ese caso se
  // desambigua por GÉNERO con el sufijo -me (men's elite) / -we (women's
  // elite) — la misma convención neutra que usa PCS, así el slug es idéntico
  // en la web ES y en la EN (/en/transfers/ comparte este módulo y el slug se
  // arrastra tal cual al cambiar de idioma). Estable, a diferencia del sufijo
  // -2 posicional anterior que dependía del orden de la query. Los equipos sin
  // colisión conservan el slug corto. Un remanente de colisión (mismo nombre +
  // mismo género, improbable) cae al sufijo -N.
  _slugToTeamId = new Map();
  _teamIdToSlug = new Map();
  const seasons = seasonsRes.data || [];
  const baseCount = new Map();
  for (const s of seasons) {
    const base = teamSlug(s.name || s.teamId);
    baseCount.set(base, (baseCount.get(base) || 0) + 1);
  }
  const GENDER_SUFFIX = { male: 'me', female: 'we' };
  for (const s of seasons) {
    const base = teamSlug(s.name || s.teamId);
    let slug = base;
    if (baseCount.get(base) > 1) {
      const gender = s.gender || DIVISION_GENDER[s.category] || null;
      slug = GENDER_SUFFIX[gender] ? `${base}-${GENDER_SUFFIX[gender]}` : base;
    }
    let candidate = slug, n = 1;
    while (_slugToTeamId.has(candidate)) { n++; candidate = `${slug}-${n}`; }
    _slugToTeamId.set(candidate, s.teamId);
    _teamIdToSlug.set(s.teamId, candidate);
  }
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
// Solo FICHAJES REALES: un corredor que cambia de equipo (type='transfer' con
// destino conocido). Fuera del feed las renovaciones, las retiradas y los fines
// de contrato sin destino (transfer con toTeamName='?'). Decisión Dani 2026-07-20.
const UNKNOWN_DEST = '?';
function isRealSigning(x) {
  return x.type === 'transfer' && (x.toTeamId || (x.toTeamName && x.toTeamName !== UNKNOWN_DEST));
}
function confirmedFeed() {
  // Dentro de una misma fecha, el mercado de la próxima temporada siempre
  // precede a los fichajes efectivos de mitad de temporada.
  return _transfers
    .filter(x => x.status === 'confirmed' && x.dateVisible !== false && isRealSigning(x))
    .sort((a, b) => {
      const dateA = a.announcedAt || '';
      const dateB = b.announcedAt || '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      if (Boolean(a.midSeason) !== Boolean(b.midSeason)) return a.midSeason ? 1 : -1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
}

function renewalFeed() {
  return _transfers.filter(x => x.status === 'confirmed' && x.dateVisible !== false && x.type === 'renewal');
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
    // Por falta de espacio en el feed móvil solo se muestra el equipo de
    // DESTINO (a dónde va), no el de origen. El corredor ya va aparte en
    // .tr-name → la flecha + destino basta. El destino NO va en negrita: el
    // nombre del corredor ya lo está. Decisión Dani 2026-07-20.
    move = `<span class="tr-arrow">→</span>
      ${esc(teamLabel(x.toTeamId, x.toTeamName))}`;
  }
  const inner = `
    <span class="tr-row__flag">${flag}</span>
    <span class="tr-row__body"><span class="tr-name">${name}</span> <span class="tr-move">${move}</span></span>
    ${x.midSeason ? midSeasonBit(true) : contractBit(x.contractUntil)}`;
  // El feed solo contiene fichajes reales, pero el destino puede no tener ficha
  // propia en el mercado (equipo fuera de las cuatro divisiones). En ese caso,
  // la fila conserva el aspecto no enlazado.
  if (x.toTeamId && _seasonsByTeamId.has(x.toTeamId)) {
    const href = `?team=${esc(_teamIdToSlug.get(x.toTeamId) || x.toTeamId)}`;
    return `<a class="tr-row tr-row--link" href="${href}" data-team="${esc(x.toTeamId)}">${inner}</a>`;
  }
  return `<div class="tr-row">${inner}</div>`;
}

function renderFeed() {
  const box = $('trFeed');
  if (!box) return;
  const feed = _activeFeed === 'renewals' ? renewalFeed() : confirmedFeed();
  if (feed.length === 0) {
    box.innerHTML = `<div class="tr-empty">${esc(t('transfers.feedEmpty'))}</div>`;
    return;
  }
  // Corte del feed: hasta FEED_MAX_DAYS fechas distintas O FEED_MAX_ITEMS
  // fichajes, lo que se alcance antes (el feed viene en orden cronológico
  // inverso). No hay "cargar más": el mercado completo se ve por equipo.
  let html = '';
  let lastDay = null;
  let daysShown = 0;
  let itemsShown = 0;
  for (const x of feed) {
    const newDay = x.announcedAt !== lastDay;
    // ¿Cabe? Si abre una fecha nueva, no debe superar el límite de fechas.
    if (newDay && daysShown >= FEED_MAX_DAYS) break;
    if (itemsShown >= FEED_MAX_ITEMS) break;
    if (newDay) {
      lastDay = x.announcedAt;
      daysShown++;
      html += `<div class="tr-feed-day">${esc(dayHeading(x.announcedAt))}</div>`;
    }
    html += feedRowHtml(x);
    itemsShown++;
  }
  box.innerHTML = html;
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
      qs.delete('team');
      qs.delete('equipo');   // barre también el param ES antiguo
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
      ${badgeOrPlaceholder(s, 34)}
      <span class="tr-team-card__label${s.continuityDoubt ? ' tr-team-card__label--doubt' : ''}">
        <span class="tr-team-card__name">${esc(s.name)}</span>
        ${s.continuityDoubt ? `<span class="tr-chip tr-chip--doubt">${esc(t('transfers.teamDoubt'))}</span>` : ''}
      </span>
    </button>`).join('');
  grid.querySelectorAll('[data-team]').forEach(el =>
    el.addEventListener('click', () => openTeam(el.dataset.team))
  );
}

// ── Vista de equipo ───────────────────────────────────────────────
// "Continúan" = corredores que YA estaban en el equipo en la temporada en curso
// (currentTeamId = equipo) y siguen para el mercado — se materializan como una
// afiliación al año del mercado (year=SEASON) al marcarlos "continúa" en el
// panel. Los afiliados cuyo currentTeamId es OTRO equipo son fichajes (llegan de
// fuera): tienen afiliación pero NO continúan → los separa openTeam por origen.
// El año de contrato efectivo viene de la afiliación, no de riders_*.
async function loadRoster(teamId) {
  if (_rosterCache.has(teamId)) return _rosterCache.get(teamId);
  const season = _seasonsByTeamId.get(teamId);
  const gender = season?.gender || DIVISION_GENDER[season?.category] || null;

  const { data: affs, error: affErr } = await supabase.from('rider_team_affiliations')
    .select('riderId, riderGender, dateTo')
    .eq('year', SEASON)
    .eq('teamId', teamId);
  if (affErr) throw affErr;
  const affRows = affs || [];
  if (affRows.length === 0) { _rosterCache.set(teamId, []); return []; }

  // Hidratar fichas por id (el riderGender de la afiliación decide la tabla; sin
  // él, el género del equipo). Se trae currentTeamId para distinguir continúa
  // (venía ya del equipo) de llegada (venía de fuera). El contrato = año de
  // dateTo de la afiliación (31-dic del año de fin), no riders_*.contractUntil.
  const cols = 'id, firstName, lastName, nationality, currentTeamId';
  const menIds = affRows.filter(a => (a.riderGender || gender) === 'male').map(a => a.riderId);
  const womenIds = affRows.filter(a => (a.riderGender || gender) === 'female').map(a => a.riderId);
  const [men, women] = await Promise.all([
    menIds.length   ? supabase.from('riders_men').select(cols).in('id', menIds).then(r => r.data || [])     : Promise.resolve([]),
    womenIds.length ? supabase.from('riders_women').select(cols).in('id', womenIds).then(r => r.data || []) : Promise.resolve([]),
  ]);
  const affYear = (d) => { if (!d) return null; const y = parseInt(String(d).slice(0, 4), 10); return isNaN(y) ? null : y; };
  const contractByRider = new Map(affRows.map(a => [a.riderId, affYear(a.dateTo)]));
  const roster = [...men, ...women]
    .map(r => ({ ...r, contractUntil: contractByRider.get(r.id) ?? null }))
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
  _rosterCache.set(teamId, roster);
  return roster;
}

// `linkTeamId`: si se pasa Y ese equipo tiene ficha en el mercado (fila en
// team_seasons 2027), la FILA ENTERA del corredor enlaza a la vista de ese
// equipo — un fichaje que LLEGA enlaza al equipo del que VENÍA; uno que se
// MARCHA, al equipo AL QUE VA (decisión Dani 2026-07-20). No hay ficha pública
// de corredor (retirada), así que el destino del enlace es siempre un equipo.
// Sin destino enlazable (retirada, fin de contrato, equipo fuera de las 4
// divisiones) la fila queda como texto plano.
function personRowHtml({ flagCode, name, detail = '', contract = null, isRumor = false, isDoubt = false, linkTeamId = null }) {
  // El año de contrato y el estado (rumor/duda) van como BADGES al final de la
  // fila, no en el texto.
  const inner = `
    <span class="tr-row__flag">${flagCode ? countryFlag(flagCode) : ''}</span>
    <span class="tr-row__body"><strong>${esc(name)}</strong>${detail ? ` ${detail}` : ''}</span>
    ${contractBit(contract)}
    ${isDoubt ? doubtChip() : isRumor ? rumorChip() : ''}`;
  if (linkTeamId && _seasonsByTeamId.has(linkTeamId)) {
    // href con el param bilingüe `?team=<slug>` (el mismo que escribe openTeam);
    // el clic normal se intercepta y navega in-page.
    const href = `?team=${esc(_teamIdToSlug.get(linkTeamId) || linkTeamId)}`;
    return `<a class="tr-row tr-row--team tr-row--link" href="${href}" data-team="${esc(linkTeamId)}">${inner}</a>`;
  }
  return `<div class="tr-row tr-row--team">${inner}</div>`;
}

async function openTeam(teamId, { push = true } = {}) {
  const season = _seasonsByTeamId.get(teamId);
  if (!season) return;

  if (push) {
    const qs = new URLSearchParams(location.search);
    qs.set('div', _activeDiv);
    qs.delete('equipo');   // limpia el param ES antiguo si venía en la URL
    qs.set('team', _teamIdToSlug.get(teamId) || teamId);   // slug legible, bilingüe
    // pushState (no replaceState): abrir un equipo apila una entrada de
    // historial → el botón atrás del navegador vuelve a la home de mercado (o al
    // equipo anterior si se saltó de equipo a equipo), no a la home global. La
    // sincronización vista↔URL al usar atrás/adelante la hace el listener
    // popstate (ver más abajo). El estado guarda el teamId para que popstate
    // resuelva la vista sin depender de parsear la URL.
    history.pushState({ trTeam: teamId }, '', `${location.pathname}?${qs}`);
  }

  $('trHome').hidden = true;
  const view = $('trTeamView');
  view.hidden = false;
  // El "volver a todos los equipos" vive en el botón ← del header (aparece solo
  // dentro de un equipo y cierra la vista sin recargar).
  if (typeof window.ccHeaderBack === 'function') {
    // El ← del header hace lo MISMO que el botón atrás del navegador
    // (history.back): así el historial no acumula basura y ambos caminos
    // convergen en el listener popstate, que repinta la home de mercado.
    window.ccHeaderBack({ onClick: () => history.back(), label: t('transfers.back') });
  }
  view.innerHTML = `
    <div class="tr-team-header">
      ${badgeOrPlaceholder(season, 44)}
      <div class="tr-team-header__text">
        <h2 class="tr-team-header__name">${esc(season.name)}</h2>
        <span class="tr-team-header__cat">${esc(season.category || '')}</span>
      </div>
    </div>
    ${season.continuityDoubt
      ? `<div class="tr-team-notice">${esc(t('transfers.teamDoubtNotice', { season: SEASON }))}</div>`
      : ''}
    <div class="tr-team-sections">
      <section id="trSecStaying" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.staying'))}</h3>
        <div id="trStaying"></div>
      </section>
      <section id="trSecDoubtful" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.doubtful'))}</h3>
        <div id="trDoubtful"></div>
      </section>
      <section id="trSecContractEnds" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.contractEnds'))}</h3>
        <div id="trContractEnds"></div>
      </section>
      <section id="trSecArrivals" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.arrivals'))}</h3>
        <div id="trArrivals"></div>
      </section>
      <section id="trSecDepartures" hidden>
        <h3 class="tr-section-title">${esc(t('transfers.departures'))}</h3>
        <div id="trDepartures"></div>
      </section>
      <div id="trTeamEmpty" class="tr-empty" hidden>${esc(t('transfers.teamEmpty'))}</div>
    </div>`;
  // (El clic en filas de corredor enlazadas se delega UNA vez en init sobre
  // #trTeamView, que persiste entre aperturas — no se cablea aquí para no
  // acumular handlers en cada openTeam, que con pushState apilaría varias
  // entradas de historial por clic.)
  // El scroll del sitio vive en <body> (overflow-y auto), no en window.
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;

  // Movimientos del equipo. Llegan (fichajes): primero los CONFIRMADOS, luego
  // los rumores; dentro de cada grupo, alfabético por apellido.
  const arrivalLastName = (x) => `${x.rider?.lastName || ''} ${x.rider?.firstName || ''}`.toLowerCase();
  // Un fichaje efectivo a mitad de temporada se muestra en el feed, pero no
  // como llegada/salida del mercado siguiente. Su afiliación contractual sí
  // puede aparecer en la situación de plantilla ("continúan").
  const marketTransfers = _transfers.filter(x => !x.midSeason);
  const arrivals = marketTransfers.filter(x => x.type === 'transfer' && x.toTeamId === teamId)
    .sort((a, b) => {
      const ra = a.status === 'rumor' ? 1 : 0, rb = b.status === 'rumor' ? 1 : 0;
      if (ra !== rb) return ra - rb;   // confirmados (0) antes que rumores (1)
      return arrivalLastName(a).localeCompare(arrivalLastName(b), 'es', { sensitivity: 'base' });
    });
  // Salidas del equipo. Un "fin de contrato sin destino" (transfer con
  // toTeamName='?' y sin toTeamId) NO es marcharse a otro equipo → va a su
  // propia sección "Terminan contrato". El resto (fichaje con destino conocido
  // o retirada) sigue en "Se marchan".
  const allDepartures = marketTransfers.filter(x =>
    (x.type === 'transfer' || x.type === 'retirement') && x.fromTeamId === teamId);
  const isContractEnd = (x) => x.type === 'transfer' && !x.toTeamId && x.toTeamName === UNKNOWN_DEST;
  // Terminan contrato: alfabético por apellido.
  const lastNameKey = (x) => `${x.rider?.lastName || ''} ${x.rider?.firstName || ''}`.toLowerCase();
  const contractEnds = allDepartures.filter(isContractEnd)
    .sort((a, b) => lastNameKey(a).localeCompare(lastNameKey(b), 'es', { sensitivity: 'base' }));
  // Se marchan: por categoría del equipo de destino (WT→WWT→PT→PRW→resto), luego
  // alfabético por nombre del equipo de destino; los retiros al final.
  const CAT_RANK = { WT: 0, WWT: 1, PT: 2, PRW: 3 };
  const depSortKey = (x) => {
    if (x.type === 'retirement') return { retire: 1, cat: 99, team: '' };
    const cat = _seasonsByTeamId.get(x.toTeamId)?.category;
    return { retire: 0, cat: (cat in CAT_RANK ? CAT_RANK[cat] : 90), team: teamLabel(x.toTeamId, x.toTeamName) };
  };
  const departures = allDepartures.filter(x => !isContractEnd(x))
    .sort((a, b) => {
      const ka = depSortKey(a), kb = depSortKey(b);
      if (ka.retire !== kb.retire) return ka.retire - kb.retire;
      if (ka.cat !== kb.cat) return ka.cat - kb.cat;
      return ka.team.localeCompare(kb.team, 'es', { sensitivity: 'base' });
    });
  // Renovaciones: las EN DUDA van a su propia sección; el resto (confirmada o
  // rumoreada) sigue anotando el contrato de quien continúa.
  const renewalsByRider = new Map();
  const doubtsByRider = new Map();
  marketTransfers.filter(x => x.type === 'renewal' && x.toTeamId === teamId)
    .forEach(x => {
      const bucket = x.status === 'doubt' ? doubtsByRider : renewalsByRider;
      if (!bucket.has(x.riderId)) bucket.set(x.riderId, x);
    });

  // Cada sección solo se muestra si tiene contenido (una categoría vacía se
  // oculta por completo, título incluido).
  const showSection = (secId, contentId, has) => {
    const sec = $(secId);
    if (sec) sec.hidden = !has;
    if (!has) { const c = $(contentId); if (c) c.innerHTML = ''; }
  };

  // Llegan: cronológico inverso (ya vienen ordenados), rumores con badge.
  if (arrivals.length) {
    $('trArrivals').innerHTML = arrivals.map(x => personRowHtml({
      flagCode: x.rider?.nationality,
      name: riderName(x.rider) || x.riderId,
      detail: `<span class="tr-dim">· ${esc(teamLabel(x.fromTeamId, x.fromTeamName, 'from'))}</span>`,
      contract: x.contractUntil,
      isRumor: x.status === 'rumor',
      linkTeamId: x.fromTeamId,   // llega → enlaza al equipo del que VENÍA
    })).join('');
  }
  showSection('trSecArrivals', 'trArrivals', arrivals.length > 0);

  // Terminan contrato: acaban su contrato sin equipo conocido (sin destino).
  if (contractEnds.length) {
    $('trContractEnds').innerHTML = contractEnds.map(x => personRowHtml({
      flagCode: x.rider?.nationality,
      name: riderName(x.rider) || x.riderId,
      isRumor: x.status === 'rumor',
    })).join('');
  }
  showSection('trSecContractEnds', 'trContractEnds', contractEnds.length > 0);

  // Se marchan: fichaje a otro equipo (destino) o retirada, rumores con badge.
  if (departures.length) {
    $('trDepartures').innerHTML = departures.map(x => personRowHtml({
      flagCode: x.rider?.nationality,
      name: riderName(x.rider) || x.riderId,
      detail: x.type === 'retirement'
        ? `<span class="tr-dim">· ${esc(t('transfers.retired'))}</span>`
        : `<span class="tr-dim">· ${esc(teamLabel(x.toTeamId, x.toTeamName))}</span>`,
      isRumor: x.status === 'rumor',
      // Se marcha → enlaza al equipo AL QUE VA (una retirada no tiene destino).
      linkTeamId: x.type === 'retirement' ? null : x.toTeamId,
    })).join('');
  }
  showSection('trSecDepartures', 'trDepartures', departures.length > 0);

  // Continúan: los del squad 2027 que YA estaban en el equipo en la temporada
  // en curso (currentTeamId = equipo) — es lo que separa "continúa" de "llega de
  // fuera" (un fichaje también tiene afiliación 2027, pero su currentTeamId es
  // otro equipo, así que va a "Llegan", no aquí). MENOS los que tienen salida
  // registrada y MENOS los que están en duda (sección propia). Contrato: el de
  // la renovación registrada gana al de la ficha; una duda NO lo toca.
  try {
    const roster = await loadRoster(teamId);
    // "gone" = toda salida registrada (fichaje, retirada Y fin de contrato):
    // ninguno de ellos continúa.
    const gone = new Set(allDepartures.map(x => x.riderId));
    // Orden: por año de contrato DESC (2030 → 2029 → … → sin año al final) y,
    // como segundo factor, el APELLIDO. El contrato efectivo = el de la
    // renovación registrada, o el de la ficha (afiliación 2027).
    const contractOf = (r) => (renewalsByRider.get(r.id)?.contractUntil) || r.contractUntil || null;
    const lastNameFirst = (r) => `${r.lastName || ''} ${r.firstName || ''}`.toLowerCase();
    const staying = roster
      .filter(r => r.currentTeamId === teamId && !gone.has(r.id) && !doubtsByRider.has(r.id))
      .sort((a, b) => {
        const ya = contractOf(a), yb = contractOf(b);
        if (ya !== yb) return (yb || 0) - (ya || 0);   // año mayor primero; sin año (0) al final
        return lastNameFirst(a).localeCompare(lastNameFirst(b), 'es', { sensitivity: 'base' });
      });
    if (staying.length) {
      $('trStaying').innerHTML = staying.map(r => {
        const renewal = renewalsByRider.get(r.id);
        return personRowHtml({
          flagCode: r.nationality,
          name: riderName(r),
          contract: renewal?.contractUntil || r.contractUntil,
          isRumor: renewal?.status === 'rumor',
        });
      }).join('');
    }
    showSection('trSecStaying', 'trStaying', staying.length > 0);

    // En duda: los de la plantilla con renovación en duda. La ficha manda
    // para el nombre/bandera; si el corredor ya no está en la plantilla
    // (fichado en enero, ficha ya movida) se cae a la del movimiento.
    const byId = new Map(roster.map(r => [r.id, r]));
    const doubtful = [...doubtsByRider.values()]
      .filter(x => !gone.has(x.riderId))
      .map(x => ({ x, r: byId.get(x.riderId) || x.rider }))
      .sort((a, b) => riderName(a.r).localeCompare(riderName(b.r), 'es', { sensitivity: 'base' }));
    // Sin badge "Duda": ya están bajo la sección "En duda".
    if (doubtful.length) {
      $('trDoubtful').innerHTML = doubtful.map(({ x, r }) => personRowHtml({
        flagCode: r?.nationality,
        name: riderName(r) || x.riderId,
        contract: r?.contractUntil,
      })).join('');
    }
    showSection('trSecDoubtful', 'trDoubtful', doubtful.length > 0);

    // Si TODAS las secciones quedaron vacías, un único aviso (equipo sin datos).
    const anyShown = ['trSecStaying', 'trSecDoubtful', 'trSecContractEnds', 'trSecArrivals', 'trSecDepartures']
      .some(id => $(id) && !$(id).hidden);
    const emptyEl = $('trTeamEmpty'); if (emptyEl) emptyEl.hidden = anyShown;
  } catch (err) {
    console.error('[fichajes] roster', err);
    // Error al cargar la plantilla: mostrar la sección "continúan" con el aviso.
    const sec = $('trSecStaying'); if (sec) sec.hidden = false;
    $('trStaying').innerHTML = `<div class="tr-empty">${esc(t('transfers.loadError'))}</div>`;
  }
}

// Repinta la home de mercado (oculta el detalle de equipo). Es SOLO visual: NO
// toca el historial. Lo dispara el listener popstate cuando la URL ya no lleva
// ?team= (por el botón atrás del navegador o el ← del header, que hace back()).
function closeTeam() {
  const view = $('trTeamView');
  if (view.hidden) return;   // ya en la home → nada que hacer
  view.hidden = true;
  view.innerHTML = '';
  $('trHome').hidden = false;
  // Ocultar el ← del header: en la lista de equipos no hay "volver".
  if (typeof window.ccHeaderBack === 'function') window.ccHeaderBack(null);
  window.scrollTo(0, 0);
}

// Resuelve un teamId desde el valor de ?team=/?equipo= (slug legible bilingüe o,
// retrocompatible, el teamId antiguo team_...). Devuelve null si no casa.
function resolveTeamParam(value) {
  if (!value) return null;
  return _slugToTeamId.get(value)
    || (_seasonsByTeamId.has(value) ? value : null);
}

// ── Sincronización con el botón atrás/adelante del navegador ───────
// openTeam apila una entrada con pushState; el ← del header hace history.back().
// Aquí reaccionamos al cambio de historial: si la nueva URL lleva ?team= abrimos
// ese equipo (sin volver a apilar), y si no, repintamos la home de mercado. Con
// esto, atrás desde un equipo va a la home de mercado (o al equipo anterior si se
// saltó de equipo a equipo), no a la home global, y adelante rehace el camino.
window.addEventListener('popstate', (e) => {
  // El feed/lista aún no está montado (navegación muy temprana): lo resuelve init.
  if (!$('trTeamView')) return;
  const qs = new URLSearchParams(location.search);
  const div = (qs.get('div') || '').toUpperCase();
  if (DIVISIONS.includes(div)) { _activeDiv = div; renderTeams(); }
  const teamId = (e.state && e.state.trTeam)
    || resolveTeamParam(qs.get('team') || qs.get('equipo'));
  if (teamId && _seasonsByTeamId.has(teamId)) {
    openTeam(teamId, { push: false });   // sin pushState: no duplica historial
  } else {
    closeTeam();
  }
});

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

  const transfersInfo = t('transfers.infoText');
  const transfersSources = TRANSFER_SOURCES.map(({ name, outlet, url }) => `
    <li><a href="${url}" target="_blank" rel="noopener">${esc(name)}</a>${outlet ? ` <span>(${esc(outlet)})</span>` : ''}</li>
  `).join('');
  content.innerHTML = `
    <div class="tr-heading-row">
      <h1 class="tr-heading">${esc(t('transfers.heading', { season: SEASON }))}</h1>
      <button class="tr-info-button" type="button" aria-label="${esc(t('transfers.infoLabel'))}" aria-describedby="trInfoTooltip" aria-expanded="false">i</button>
      <div class="tr-info-tooltip" id="trInfoTooltip" role="tooltip">${esc(transfersInfo)}<ul class="tr-info-sources">${transfersSources}</ul></div>
    </div>
    <div id="trHome">
      <section class="tr-home-feed">
        <h2 class="tr-section-title">${esc(t('transfers.feedTitle'))}</h2>
        <div class="tr-div-btns" id="trFeedBtns"></div>
        <div class="tr-home-scroll" id="trFeed"></div>
      </section>
      <section class="tr-home-teams">
        <h2 class="tr-section-title">${esc(t('transfers.teamsTitle', { season: SEASON }))}</h2>
        <div class="tr-div-btns" id="trDivBtns"></div>
        <div class="tr-home-scroll tr-team-grid" id="trTeamGrid"></div>
      </section>
    </div>
    <div id="trTeamView" hidden></div>`;
  content.hidden = false;

  const feedBtns = $('trFeedBtns');
  const renderFeedButtons = () => {
    if (!feedBtns) return;
    feedBtns.innerHTML = [
      ['signings', t('transfers.feedSignings')],
      ['renewals', t('transfers.feedRenewals')],
    ].map(([value, label]) =>
      `<button class="tr-div-btn${value === _activeFeed ? ' tr-div-btn--active' : ''}" data-feed="${value}">${esc(label)}</button>`
    ).join('');
    feedBtns.querySelectorAll('[data-feed]').forEach(button => button.addEventListener('click', () => {
      _activeFeed = button.dataset.feed;
      renderFeedButtons();
      renderFeed();
    }));
  };
  renderFeedButtons();

  const infoButton = content.querySelector('.tr-info-button');
  let infoModal = null;
  let _releaseInfoFocus = null;
  const closeInfoModal = () => {
    if (!infoModal) return;
    infoModal.classList.remove('rd-modal--open');
    document.body.style.overflow = '';
    if (_releaseInfoFocus) { _releaseInfoFocus(); _releaseInfoFocus = null; }
    infoButton?.focus();
  };
  const openInfoModal = () => {
    if (!infoModal) {
      infoModal = document.createElement('div');
      infoModal.className = 'rd-modal-overlay';
      infoModal.innerHTML = `
        <div class="rd-modal tr-info-modal" role="dialog" aria-modal="true" aria-labelledby="trInfoModalTitle">
          <div class="rd-modal__bar">
            <div class="rd-modal__header-text"><span class="rd-modal__race-name" id="trInfoModalTitle"></span></div>
            <button class="rd-modal__close" type="button" aria-label="${esc(t('transfers.close'))}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="rd-modal__body tr-info-modal__body"><p></p><ul class="tr-info-sources"></ul></div>
        </div>`;
      infoModal.querySelector('#trInfoModalTitle').textContent = t('transfers.infoModalTitle');
      infoModal.querySelector('.tr-info-modal__body p').textContent = transfersInfo;
      infoModal.querySelector('.tr-info-sources').innerHTML = transfersSources;
      infoModal.addEventListener('click', (event) => { if (event.target === infoModal) closeInfoModal(); });
      infoModal.querySelector('.rd-modal__close').addEventListener('click', closeInfoModal);
      document.body.appendChild(infoModal);
    }
    infoModal.classList.add('rd-modal--open');
    document.body.style.overflow = 'hidden';
    // Ya enfocaba el botón de cerrar; faltaba retener el tabulador dentro.
    _releaseInfoFocus = trapFocus(infoModal.querySelector('.rd-modal'),
      { initial: infoModal.querySelector('.rd-modal__close') });
  };
  infoButton?.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 768px)').matches) openInfoModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && infoModal?.classList.contains('rd-modal--open')) closeInfoModal();
  });

  // Clic en fila de corredor enlazada (Llegan → equipo de origen; Se marchan →
  // equipo destino): navegación interna a ese equipo, sin recarga. Delegado UNA
  // vez sobre #trTeamView, que persiste entre aperturas (su innerHTML se
  // reemplaza pero el nodo no) → no se acumulan handlers. La <a> lleva href real
  // para accesibilidad/copiar-enlace; interceptamos el clic normal.
  $('trTeamView').addEventListener('click', (e) => {
    const link = e.target.closest('.tr-row--link[data-team]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // abrir en pestaña nueva
    e.preventDefault();
    openTeam(link.dataset.team);
  });

  // El feed también lleva a la ficha del equipo de DESTINO del fichaje. Usa la
  // misma navegación interna que las filas de la ficha de equipo, conservando
  // el href real para accesibilidad y para abrir el destino en otra pestaña.
  $('trFeed').addEventListener('click', (e) => {
    const link = e.target.closest('.tr-row--link[data-team]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    openTeam(link.dataset.team);
  });

  // Retirar los marcadores del overlay de carga (page-loading.js) una vez
  // el contenido real está montado.
  main.querySelector('#trStaticLoading')?.remove();
  main.querySelector('.static-prerender')?.remove();

  renderFeed();
  renderTeams();
  // ?team= (bilingüe ES/EN) acepta el slug legible (visma-lease-a-bike) o,
  // retrocompatible, el teamId antiguo (team_...). El ?equipo= previo se sigue
  // leyendo para no romper enlaces ya compartidos.
  const teamId = resolveTeamParam(qs.get('team') || qs.get('equipo'));
  if (teamId) {
    const cat = _seasonsByTeamId.get(teamId)?.category;
    if (DIVISIONS.includes(cat)) _activeDiv = cat;
    await openTeam(teamId, { push: false });
    // Deep link a un equipo: sembramos el teamId en el estado de ESTA entrada de
    // historial (la de entrada al sitio). Así, si el usuario navega dentro y
    // luego vuelve, popstate reconstruye la vista de equipo sin reparsear.
    history.replaceState({ trTeam: teamId }, '', location.href);
  }
}

init();
