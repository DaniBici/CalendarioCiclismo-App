// ─────────────────────────────────────────────────────────────────
//  FICHAJES — mercado preparado y HTML de su portada, sin DOM
//  Lo usan js/fichajes.js (pintado en el navegador) y el paso de build que
//  escribe /fichajes/ y /en/transfers/ (tools/site/prerender-fichajes.mjs).
//  El marcado no puede depender del dispositivo, del ancho de pantalla, de
//  localStorage ni del momento de carga: el navegador compara su huella con
//  la del HTML del build (js/html-fingerprint.js).
// ─────────────────────────────────────────────────────────────────

import { teamStripes } from './team-appearance.js';
import { seoWeekdayDayMonth } from './shared.js';
import { flagIconUrl } from './flag-url.js';
import { t } from './i18n.js';

export const SEASON = 2027;
export const PREV_SEASON = SEASON - 1;
export const DIVISIONS = ['WT', 'PT', 'WWT', 'PRW'];
// Feed "Últimas confirmaciones": lista de altura fija con desplazamiento.
const FEED_MAX_DAYS = 30;
const FEED_MAX_ITEMS = 60;
// Orden editorial diario del equipo de destino. La categoría femenina se
// guarda como PRW en la base de datos; PTW se admite como alias del rótulo
// solicitado para Women's ProTeams.
const FEED_CATEGORY_RANK = { WT: 0, PT: 1, WWT: 2, PRW: 3, PTW: 3 };

// Género de la tabla riders_* por división (para la plantilla "continúan").
export const DIVISION_GENDER = { WT: 'male', PT: 'male', WWT: 'female', PRW: 'female' };

// Columnas de las lecturas del mercado, comunes al navegador y al build.
export const SEASON_COLUMNS = 'teamId, name, category, gender, badgeVisible, continuityDoubt, headerBg, headerText, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts';
export const PREV_SEASON_COLUMNS = 'teamId, name, headerBg, headerText, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts';
export const RIDER_COLUMNS = 'id, firstName, lastName, nationality, contractUntil';

// Destino de un fin de contrato sin equipo conocido (transfer con toTeamName='?').
export const UNKNOWN_DEST = '?';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Slug legible para la URL: minúsculas, sin acentos, separadores → guiones.
function teamSlug(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'equipo';
}

export function riderName(r) {
  if (!r) return '';
  return `${r.firstName || ''} ${r.lastName || ''}`.trim();
}

// ── Datos ─────────────────────────────────────────────────────────
// Fichas que leer por género, sin repetir.
export function marketRiderIds(transfers, gender) {
  return [...new Set(transfers.filter(x => x.riderGender === gender).map(x => x.riderId))];
}

// Último recurso para equipos sin fila en NINGUNA de las dos temporadas
// (destinos fuera de las 4 divisiones sembradas, altas sin catalogar…).
export function marketExtraTeamIds(seasons, prevSeasons, transfers) {
  const knownIds = new Set([...seasons, ...prevSeasons].map(s => s.teamId));
  return [...new Set(transfers.flatMap(x => [x.fromTeamId, x.toTeamId]).filter(id => id && !knownIds.has(id)))];
}

// Cada movimiento con su ficha (`rider`, nombre + bandera), o null sin ella.
export function attachRiders(transfers, men, women) {
  const byKey = new Map();
  men.forEach(r => byKey.set(`male:${r.id}`, r));
  women.forEach(r => byKey.set(`female:${r.id}`, r));
  transfers.forEach(x => { x.rider = byKey.get(`${x.riderGender}:${x.riderId}`) || null; });
  return transfers;
}

/**
 * Mercado preparado a partir de las lecturas (temporadas 2027 y 2026,
 * movimientos con su ficha y equipos fuera de ambas temporadas).
 */
export function buildMarket({ seasons, prevSeasons, transfers, extraTeams }) {
  const seasonsByTeamId = new Map(seasons.map(s => [s.teamId, s]));
  // Slug legible del nombre 2027 para la URL (?equipo=visma-lease-a-bike).
  // Varias marcas tienen equipo masculino Y femenino con el MISMO nombre
  // (Cofidis, Lidl-Trek, Movistar…): su slug base colisiona. En ese caso se
  // desambigua por GÉNERO con el sufijo -me (men's elite) / -we (women's
  // elite), una convención neutra, así el slug es idéntico
  // en la web ES y en la EN (/en/transfers/ comparte este módulo y el slug se
  // arrastra tal cual al cambiar de idioma). Estable, a diferencia del sufijo
  // -2 posicional anterior que dependía del orden de la query. Los equipos sin
  // colisión conservan el slug corto. Un remanente de colisión (mismo nombre +
  // mismo género, improbable) cae al sufijo -N.
  const slugToTeamId = new Map();
  const teamIdToSlug = new Map();
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
    while (slugToTeamId.has(candidate)) { n++; candidate = `${slug}-${n}`; }
    slugToTeamId.set(candidate, s.teamId);
    teamIdToSlug.set(s.teamId, candidate);
  }
  // El nombre de un equipo depende del LADO del movimiento: de dónde sale un
  // corredor es el equipo de la temporada en curso (2026, la que se está
  // corriendo); a dónde va es el de la temporada del mercado (2027). Un mapa
  // por año; `teams` NO sirve de archivo histórico (su trigger sync_team_to_season
  // pisa siempre el año en curso).
  const teamNameById = new Map(seasons.map(s => [s.teamId, s.name]));
  const teamNamePrev = new Map(prevSeasons.map(s => [s.teamId, s.name]));
  (extraTeams || []).forEach(tm => {
    if (!teamNameById.has(tm.id)) teamNameById.set(tm.id, tm.name);
    if (!teamNamePrev.has(tm.id)) teamNamePrev.set(tm.id, tm.name);
  });
  return {
    seasonsByTeamId,
    teamNameById,
    teamNamePrev,
    // Colores de la temporada EN CURSO (2026) por equipo: los "antiguos", que se
    // muestran mientras la chapa 2027 está oculta. Un equipo NUEVO (nacido en
    // 2027) no tiene fila 2026 → sin entrada aquí → la chapa queda vacía (mig. 129).
    prevColorsByTeamId: new Map(prevSeasons.map(s => [s.teamId, s])),
    transfers,
    slugToTeamId,
    teamIdToSlug,
  };
}

// `side`: 'from' → nombre de la temporada en curso (el equipo que el corredor
// deja); 'to' → nombre de la temporada del mercado (con el que va a correr).
export function teamLabel(market, teamId, freeText, side = 'to') {
  if (!teamId) return freeText || t('transfers.unknownTeam');
  const primary = side === 'from' ? market.teamNamePrev : market.teamNameById;
  const fallback = side === 'from' ? market.teamNameById : market.teamNamePrev;
  return primary.get(teamId) || fallback.get(teamId) || teamId;
}

// Solo los equipos de las cuatro divisiones del mercado tienen vista propia; un
// equipo de otra categoría con fila team_seasons (filial, continental) no enlaza.
export function hasTeamView(market, teamId) {
  return DIVISIONS.includes(market.seasonsByTeamId.get(teamId)?.category);
}

// href de la vista de equipo con el param bilingüe `?team=<slug>`.
export function teamHref(market, teamId) {
  return `?team=${esc(market.teamIdToSlug.get(teamId) || teamId)}`;
}

// ── Piezas de fila ────────────────────────────────────────────────
// Bandera sin estilo en línea (tamaño y recorte en `.tr-row__flag > img`,
// css/fichajes.css) y diferida: el feed lleva hasta 120 filas en listas con
// desplazamiento propio.
export function flagHtml(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  return `<img src="${flagIconUrl(c)}" alt="${esc(c)}" loading="lazy">`;
}

export function rumorChip() {
  return `<span class="tr-chip tr-chip--rumor">${esc(t('transfers.rumor'))}</span>`;
}

export function doubtChip() {
  return `<span class="tr-chip tr-chip--doubt">${esc(t('transfers.doubt'))}</span>`;
}

// Año centinela para contrato VITALICIO (dateTo 9999-12-31): se pinta ∞.
const LIFETIME_YEAR = 9999;
export function contractBit(year) {
  if (!year) return '';
  const label = year === LIFETIME_YEAR ? '∞' : t('transfers.until', { year });
  return `<span class="tr-contract"${year === LIFETIME_YEAR ? ' title="Vitalicio"' : ''}>${esc(label)}</span>`;
}

function midSeasonBit(isMidSeason) {
  return isMidSeason ? `<span class="tr-contract tr-contract--midseason">${esc(t('transfers.midSeason'))}</span>` : '';
}

// Fecha del feed: día de la semana + día + mes, SIN año (ES: "Martes 24 de
// junio"; EN: "Tuesday 24 June"), sin coma tras el día de la semana para casar
// con el formato de las apps. Primera letra en mayúscula. Tablas fijas
// (seoWeekdayDayMonth): el render de Google degrada toLocaleDateString.
function dayHeading(dateKey) {
  if (!dateKey) return '';
  const s = seoWeekdayDayMonth(dateKey);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Feed de confirmaciones ────────────────────────────────────────
// Solo confirmaciones con fecha visible. `dateVisible=false` (mig. 123) es un
// flag de publicación en el feed, no una fecha ausente: el movimiento sigue
// contando en la vista de equipo (llegan/se marchan/continúan) — es como se
// puebla el mercado sin llenar el feed de anuncios viejos.
// Solo FICHAJES REALES: un corredor que cambia de equipo (type='transfer' con
// destino conocido). Fuera del feed las renovaciones, las retiradas y los fines
// de contrato sin destino (transfer con toTeamName='?'). Decisión Dani 2026-07-20.
function isRealSigning(x) {
  return x.type === 'transfer' && (x.toTeamId || (x.toTeamName && x.toTeamName !== UNKNOWN_DEST));
}

function compareFeedMoves(market, a, b) {
  const dateA = a.announcedAt || '';
  const dateB = b.announcedAt || '';
  if (dateA !== dateB) return dateB.localeCompare(dateA);

  // Los movimientos para próximas temporadas forman el primer bloque del día;
  // los efectivos durante la temporada en curso quedan siempre al final.
  if (Boolean(a.midSeason) !== Boolean(b.midSeason)) return a.midSeason ? 1 : -1;

  const categoryA = market.seasonsByTeamId.get(a.toTeamId)?.category;
  const categoryB = market.seasonsByTeamId.get(b.toTeamId)?.category;
  const rankA = FEED_CATEGORY_RANK[categoryA] ?? 90;
  const rankB = FEED_CATEGORY_RANK[categoryB] ?? 90;
  if (rankA !== rankB) return rankA - rankB;

  const teamA = teamLabel(market, a.toTeamId, a.toTeamName);
  const teamB = teamLabel(market, b.toTeamId, b.toTeamName);
  const byTeam = teamA.localeCompare(teamB, 'es', { sensitivity: 'base' });
  if (byTeam !== 0) return byTeam;

  const byCreation = (b.createdAt || '').localeCompare(a.createdAt || '');
  return byCreation || String(a.id || '').localeCompare(String(b.id || ''));
}

/** @public tools/site/prerender-fichajes.mjs lo usa como miembro del módulo cargado con import(). */
export function confirmedFeed(market) {
  return market.transfers
    .filter(x => x.status === 'confirmed' && x.dateVisible !== false && isRealSigning(x))
    .sort((a, b) => compareFeedMoves(market, a, b));
}

function renewalFeed(market) {
  return market.transfers
    .filter(x => x.status === 'confirmed' && x.dateVisible !== false && x.type === 'renewal')
    .sort((a, b) => compareFeedMoves(market, a, b));
}

function feedRowHtml(market, x) {
  const flag = flagHtml(x.rider?.nationality);
  const name = `<strong>${esc(riderName(x.rider) || x.riderId)}</strong>`;
  let move;
  if (x.type === 'renewal') {
    // Punto central en lugar de «renueva con»: la fila se lee igual en todos los anchos.
    move = `<span class="tr-arrow">·</span>
      ${esc(teamLabel(market, x.toTeamId, x.toTeamName))}`;
  } else if (x.type === 'retirement') {
    move = `${esc(t('transfers.retires'))} <span class="tr-dim">(${esc(teamLabel(market, x.fromTeamId, x.fromTeamName, 'from'))})</span>`;
  } else {
    // Por falta de espacio en el feed móvil solo se muestra el equipo de
    // DESTINO (a dónde va), no el de origen. El corredor ya va aparte en
    // .tr-name → la flecha + destino basta. El destino NO va en negrita: el
    // nombre del corredor ya lo está. Decisión Dani 2026-07-20.
    move = `<span class="tr-arrow">→</span>
      ${esc(teamLabel(market, x.toTeamId, x.toTeamName))}`;
  }
  const inner = `
    <span class="tr-row__flag">${flag}</span>
    <span class="tr-row__body"><span class="tr-name">${name}</span> <span class="tr-move">${move}</span></span>
    ${x.midSeason ? midSeasonBit(true) : contractBit(x.contractUntil)}`;
  // El feed solo contiene fichajes reales, pero el destino puede no tener ficha
  // propia en el mercado (equipo fuera de las cuatro divisiones). En ese caso,
  // la fila conserva el aspecto no enlazado. `data-key`: un movimiento nuevo
  // entra sin rehacer las demás filas (js/dom-patch.js).
  if (x.toTeamId && hasTeamView(market, x.toTeamId)) {
    return `<a class="tr-row tr-row--link" href="${teamHref(market, x.toTeamId)}" data-team="${esc(x.toTeamId)}" data-key="${esc(x.id)}">${inner}</a>`;
  }
  return `<div class="tr-row" data-key="${esc(x.id)}">${inner}</div>`;
}

function feedHtml(market, feed) {
  if (feed.length === 0) {
    return `<div class="tr-empty">${esc(t('transfers.feedEmpty'))}</div>`;
  }
  // Corte del feed: hasta FEED_MAX_DAYS fechas distintas O FEED_MAX_ITEMS
  // fichajes, lo que se alcance antes (el feed viene en orden cronológico
  // inverso). La lista tiene altura fija con desplazamiento en todos los
  // anchos. No hay "cargar más": el mercado completo se ve por equipo.
  let html = '';
  let lastDay = null;
  let daysShown = 0;
  let itemsShown = 0;
  for (const x of feed) {
    const newDay = x.announcedAt !== lastDay;
    if (newDay && daysShown >= FEED_MAX_DAYS) break;
    if (itemsShown >= FEED_MAX_ITEMS) break;
    if (newDay) {
      lastDay = x.announcedAt;
      daysShown++;
      html += `<div class="tr-feed-day" data-key="day-${esc(x.announcedAt)}">${esc(dayHeading(x.announcedAt))}</div>`;
    }
    html += feedRowHtml(market, x);
    itemsShown++;
  }
  return `<div class="tr-feed-list">${html}</div>`;
}

// Fichajes y Renovaciones: las dos columnas (por debajo de 900 px se ve la
// activa, elegida con los botones de feedButtonsHtml).
export function feedColumnsHtml(market, activeFeed) {
  return [
    ['signings', t('transfers.feedSignings'), confirmedFeed(market)],
    ['renewals', t('transfers.feedRenewals'), renewalFeed(market)],
  ].map(([kind, title, feed]) => `<section class="tr-feed-column${kind === activeFeed ? ' tr-feed-column--active' : ''}"><h3 class="tr-feed-title">${esc(title)}</h3>${feedHtml(market, feed)}</section>`).join('');
}

export function feedButtonsHtml(activeFeed) {
  return [
    ['signings', t('transfers.feedSignings')],
    ['renewals', t('transfers.feedRenewals')],
  ].map(([value, label]) =>
    `<button class="tr-div-btn${value === activeFeed ? ' tr-div-btn--active' : ''}" data-feed="${value}">${esc(label)}</button>`
  ).join('');
}

// ── Divisiones + lista de equipos ─────────────────────────────────
/** @public tools/site/prerender-fichajes.mjs lo usa como miembro del módulo cargado con import(). */
export function divisionTeams(market, div) {
  return [...market.seasonsByTeamId.values()]
    .filter(s => s.category === div)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
}

// Franjas de maillot de Resultados; sin colores publicados de la temporada,
// los de la anterior.
export function marketStripesHtml(market, season) {
  const source = season?.badgeVisible === true ? season : market.prevColorsByTeamId.get(season?.teamId);
  return source ? teamStripes(source) : '';
}

export function divButtonsHtml(activeDiv) {
  return DIVISIONS.map(d =>
    `<button class="tr-div-btn${d === activeDiv ? ' tr-div-btn--active' : ''}" data-div="${d}">${d}</button>`
  ).join('');
}

export function teamGridHtml(market, div) {
  const teams = divisionTeams(market, div);
  if (teams.length === 0) {
    return `<div class="tr-empty">${esc(t('transfers.teamsEmpty'))}</div>`;
  }
  return teams.map(s => `
    <button class="tr-team-card" data-team="${esc(s.teamId)}" data-key="${esc(s.teamId)}">
      <span class="tr-team-card__label${s.continuityDoubt ? ' tr-team-card__label--doubt' : ''}">
        <span class="tr-team-card__name">${marketStripesHtml(market, s)}${esc(s.name)}</span>
        ${s.continuityDoubt ? `<span class="tr-chip tr-chip--doubt">${esc(t('transfers.teamDoubt'))}</span>` : ''}
      </span><span class="tr-team-chevron" aria-hidden="true">›</span>
    </button>`).join('');
}

/**
 * HTML de #transfersContent: portada del mercado (feed y equipos de la
 * división `activeDiv`) y el contenedor vacío de la vista de equipo.
 */
export function marketHomeHtml(market, { activeDiv = 'WT', activeFeed = 'signings' } = {}) {
  return `
    <h1 class="tr-heading">${esc(t('transfers.heading', { season: SEASON }))}</h1>
    <div id="trHome">
      <section class="tr-home-feed" aria-label="${esc(t('transfers.feedTitle'))}">
        <div class="tr-div-btns" id="trFeedBtns">${feedButtonsHtml(activeFeed)}</div>
        <div class="tr-home-scroll" id="trFeed">${feedColumnsHtml(market, activeFeed)}</div>
      </section>
      <section class="tr-home-teams">
        <h2 class="tr-section-title">${esc(t('transfers.teamsTitle', { season: SEASON }))}</h2>
        <div class="tr-div-btns" id="trDivBtns">${divButtonsHtml(activeDiv)}</div>
        <div class="tr-home-scroll tr-team-grid" id="trTeamGrid">${teamGridHtml(market, activeDiv)}</div>
      </section>
    </div>
    <div id="trTeamView" hidden></div>`;
}
