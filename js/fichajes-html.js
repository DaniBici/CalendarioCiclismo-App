// ─────────────────────────────────────────────────────────────────
//  FICHAJES — mercado preparado y HTML de su portada y sus equipos, sin DOM
//  Lo usan js/fichajes.js (pintado en el navegador) y el paso de build que
//  escribe /fichajes/ y /en/transfers/ (tools/site/prerender-fichajes.mjs).
//  El marcado no puede depender del dispositivo, del ancho de pantalla, de
//  localStorage ni del momento de carga: el navegador compara su huella con
//  la del HTML del build (js/html-fingerprint.js). La portada lleva una
//  pantalla única (filtros, feed y lista de equipos) y la vista de equipo.
// ─────────────────────────────────────────────────────────────────

import { teamStripes, teamHeaderColors } from './team-appearance.js';
import { seoWeekdayDayMonth, countryFlag, regionName } from './shared.js';
import { flagIconUrl } from './flag-url.js';
import { t } from './i18n.js';
import { newFilters as newFilterState, matchesFilters, filterMenuItemsHtml as filterMenuItems, filterMenuHtml as filterMenu } from './components/filter-menu.js';

export const SEASON = 2027;
export const PREV_SEASON = SEASON - 1;
export const DIVISIONS = ['WT', 'PT', 'WWT', 'PRW'];

// Nombre completo de la división en la cabecera del equipo; otra categoría, tal cual.
function divisionName(season) {
  return DIVISIONS.includes(season?.category) ? t('transfers.divName' + season.category) : (season?.category || '');
}
// Feed "Últimas confirmaciones": cada columna muestra hasta 30 fechas distintas
// o 60 movimientos, lo que se alcance antes, en una lista de altura fija con
// scroll propio en todos los anchos (css/fichajes.css), como en las apps
// (TransfersLogic.feedScrollMaxDays y feedScrollMaxItems).
const FEED_MAX_DAYS = 30;
const FEED_MAX_ITEMS = 60;
// Orden editorial diario del equipo de destino. La categoría femenina se
// guarda como PRW en la base de datos; PTW se admite como alias del rótulo
// solicitado para Women's ProTeams.
const FEED_CATEGORY_RANK = { WT: 0, PT: 1, WWT: 2, PRW: 3, PTW: 3 };

// Género de la tabla riders_* por división (para la plantilla "continúan").
const DIVISION_GENDER = { WT: 'male', PT: 'male', WWT: 'female', PRW: 'female' };

// Columnas de las lecturas del mercado, comunes al navegador y al build.
export const SEASON_COLUMNS = 'teamId, name, category, gender, badgeVisible, continuityDoubt, prevColorsHidden, headerBg, headerText, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts';
export const PREV_SEASON_COLUMNS = 'teamId, name, headerBg, headerText, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts';
// Fichas del mercado: se leen de riders_men/women nombre, nacionalidad y año de
// contrato. Ningún filtro usa la edad, así que no se pide la fecha de nacimiento.
export const RIDER_COLUMNS = 'id, firstName, lastName, nationality, contractUntil';
export const RIDER_TABLES = { male: 'riders_men', female: 'riders_women' };
export const ROSTER_COLUMNS = 'id, firstName, lastName, nationality, currentTeamId';
// País de cada equipo de la temporada (cabecera de la vista de equipo).
export const TEAM_COUNTRY_COLUMNS = 'id, countryCode';

// ── Filtros del mercado ───────────────────────────────────────────
// Menú de js/components/filter-menu.js con dos grupos rotulados. El valor de un
// movimiento para cada grupo sale de FILTER_VALUE; un valor desconocido (null)
// solo se oculta si el grupo filtra. La selección se recuerda
// (TRANSFER_FILTERS_KEY), como en las apps.
export const TRANSFER_FILTERS_KEY = 'cc_transfer_filters';
export const FILTER_GROUPS = [
  { key: 'gender', label: () => t('transfers.filterGender'), options: [
    { value: 'male', label: () => t('transfers.genderMale') },
    { value: 'female', label: () => t('transfers.genderFemale') },
  ] },
  { key: 'division', label: () => t('transfers.filterDivision'), options: [
    { value: 'world', label: () => t('transfers.divWorld') },
    { value: 'pro', label: () => t('transfers.divPro') },
  ] },
];
// División del equipo de destino (en las renovaciones, el propio equipo) agrupada
// en los dos chips del panel; PTW es el alias de PRW (ver FEED_CATEGORY_RANK).
const DIVISION_GROUP = { WT: 'world', WWT: 'world', PT: 'pro', PRW: 'pro', PTW: 'pro' };

const FILTER_VALUE = {
  gender: (market, x) => x.riderGender || null,
  division: (market, x) => DIVISION_GROUP[market.seasonsByTeamId.get(x.toTeamId)?.category] ?? null,
};

/** Filtros del panel: grupo → Set de valores activos; empiezan TODOS activos. */
const newFilters = () => newFilterState(FILTER_GROUPS);

const matchesMarketFilters = (market, filters, x) =>
  matchesFilters(FILTER_GROUPS, filters, key => FILTER_VALUE[key](market, x));

// Destino de un fin de contrato sin equipo conocido (transfer con toTeamName='?').
const UNKNOWN_DEST = '?';

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

function riderName(r) {
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

// Equipos de la temporada del mercado, cuyo país se lee aparte (teams.countryCode).
export function marketSeasonTeamIds(seasons) {
  return [...new Set(seasons.map(s => s.teamId))];
}

// Cada movimiento con su ficha (`rider`, nombre + bandera + año de nacimiento),
// o null sin ella.
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
export function buildMarket({ seasons, prevSeasons, transfers, extraTeams, teamCountries }) {
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
    // muestran mientras los colores 2027 no están publicados, salvo con
    // prevColorsHidden. Un equipo NUEVO (nacido en 2027) no tiene fila 2026 →
    // sin entrada aquí → sin colores (mig. 129).
    prevColorsByTeamId: new Map(prevSeasons.map(s => [s.teamId, s])),
    // La copia local anterior a esta versión no trae países: sin ellos la loseta
    // simplemente no muestra país hasta la revalidación.
    countryByTeamId: new Map((teamCountries || []).map(c => [c.id, c.countryCode])),
    transfers,
    slugToTeamId,
    teamIdToSlug,
  };
}

// `side`: 'from' → nombre de la temporada en curso (el equipo que el corredor
// deja); 'to' → nombre de la temporada del mercado (con el que va a correr).
function teamLabel(market, teamId, freeText, side = 'to') {
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
function teamHref(market, teamId) {
  return `?team=${esc(market.teamIdToSlug.get(teamId) || teamId)}`;
}

// Género de la plantilla de un equipo: el de su temporada o el de su división.
export function rosterGender(market, teamId) {
  const season = market.seasonsByTeamId.get(teamId);
  return season?.gender || DIVISION_GENDER[season?.category] || null;
}

// Plantilla a partir de las afiliaciones regulares del equipo y sus fichas (la
// `riderGender` de la afiliación decide la tabla). El contrato es el año de
// dateTo de la afiliación (31-dic del año de fin), no riders_*.contractUntil.
export function rosterFromRows(affRows, men, women) {
  const affYear = (d) => { if (!d) return null; const y = parseInt(String(d).slice(0, 4), 10); return isNaN(y) ? null : y; };
  const contractByRider = new Map(affRows.map(a => [a.riderId, affYear(a.dateTo)]));
  return [...men, ...women]
    .map(r => ({ ...r, contractUntil: contractByRider.get(r.id) ?? null }))
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'es', { sensitivity: 'base' }));
}

// ── Piezas de fila ────────────────────────────────────────────────
// Bandera sin estilo en línea (tamaño y recorte en `.tr-row__flag > img`,
// css/fichajes.css) y diferida: el feed lleva hasta 120 filas en listas con
// desplazamiento propio.
function flagHtml(code) {
  if (!code) return '';
  const c = code.toLowerCase();
  return `<img src="${flagIconUrl(c)}" alt="${esc(c)}" loading="lazy">`;
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
export function confirmedFeed(market, filters = null) {
  return market.transfers
    .filter(x => x.status === 'confirmed' && x.dateVisible !== false && isRealSigning(x) && matchesMarketFilters(market, filters, x))
    .sort((a, b) => compareFeedMoves(market, a, b));
}

function renewalFeed(market, filters) {
  return market.transfers
    .filter(x => x.status === 'confirmed' && x.dateVisible !== false && x.type === 'renewal' && matchesMarketFilters(market, filters, x))
    .sort((a, b) => compareFeedMoves(market, a, b));
}

// Equipo de destino de una fila del feed, con su cuadrado de colores (el color
// de los datos). Sin temporada de mercado del equipo, solo el nombre.
function destHtml(market, x) {
  const stripes = marketStripesHtml(market, market.seasonsByTeamId.get(x.toTeamId));
  return `${stripes}${esc(teamLabel(market, x.toTeamId, x.toTeamName))}`;
}

function feedRowHtml(market, x, reserve = false) {
  // Valores de los filtros y fecha: la página publicada aplica los recordados antes del primer
  // pintado (tools/publicacion/cliente/pre-pintado-fichajes.js). Una fila de reserva solo se ve
  // con algún filtro.
  const filtro = FILTER_GROUPS.map(g => ` data-${g.key}="${esc(FILTER_VALUE[g.key](market, x) ?? '')}"`).join('')
    + ` data-day="${esc(x.announcedAt ?? '')}"${reserve ? ' hidden data-reserve=""' : ''}`;
  const flag = flagHtml(x.rider?.nationality);
  const name = `<strong>${esc(riderName(x.rider) || x.riderId)}</strong>`;
  let move;
  if (x.type === 'renewal') {
    // Punto central en lugar de «renueva con»: la fila se lee igual en todos los anchos.
    move = `<span class="tr-arrow">·</span>
      ${destHtml(market, x)}`;
  } else if (x.type === 'retirement') {
    move = `${esc(t('transfers.retires'))} <span class="tr-dim">(${esc(teamLabel(market, x.fromTeamId, x.fromTeamName, 'from'))})</span>`;
  } else {
    // Por falta de espacio en el feed móvil solo se muestra el equipo de
    // DESTINO (a dónde va), no el de origen. El corredor ya va aparte en
    // .tr-name → la flecha + destino basta. El destino NO va en negrita: el
    // nombre del corredor ya lo está. Decisión Dani 2026-07-20.
    move = `<span class="tr-arrow">→</span>
      ${destHtml(market, x)}`;
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
    return `<a class="tr-row tr-row--link" href="${teamHref(market, x.toTeamId)}" data-team="${esc(x.toTeamId)}" data-key="${esc(x.id)}"${filtro}>${inner}</a>`;
  }
  return `<div class="tr-row" data-key="${esc(x.id)}"${filtro}>${inner}</div>`;
}

// Corte del feed (tras filtrar, en orden cronológico inverso): hasta
// FEED_MAX_DAYS fechas distintas o FEED_MAX_ITEMS movimientos, lo que se
// alcance antes. Espejo del corte de tools/publicacion/cliente/pre-pintado-fichajes.js.
function feedCut(feed) {
  const shown = [];
  let lastDay = null;
  let daysShown = 0;
  for (const x of feed) {
    const newDay = x.announcedAt !== lastDay;
    if (newDay && daysShown >= FEED_MAX_DAYS) break;
    if (shown.length >= FEED_MAX_ITEMS) break;
    if (newDay) {
      lastDay = x.announcedAt;
      daysShown++;
    }
    shown.push(x);
  }
  return shown;
}

// HTML de la columna. Con `reserve` (página publicada), las filas que cada combinación de
// filtros mostraría, en el orden del feed: las que no están en el corte de `feed` van ocultas, y
// el aviso de lista vacía va en el documento, oculto si hay filas.
function feedHtml(market, feed, reserve = null) {
  const shown = feedCut(feed);
  const empty = `<div class="tr-empty"${reserve && shown.length ? ' hidden' : ''}>${esc(t('transfers.feedEmpty'))}</div>`;
  if (!reserve && shown.length === 0) return empty;
  const visible = new Set(shown.map(x => x.id));
  const rows = reserve || shown;
  let html = '';
  let lastDay = null;
  for (const x of rows) {
    if (x.announcedAt !== lastDay) {
      lastDay = x.announcedAt;
      const day = lastDay;
      const hidden = !rows.some(y => y.announcedAt === day && visible.has(y.id));
      html += `<div class="tr-feed-day" data-key="day-${esc(x.announcedAt)}"${hidden ? ' hidden' : ''}>${esc(dayHeading(x.announcedAt))}</div>`;
    }
    html += feedRowHtml(market, x, !visible.has(x.id));
  }
  return `${reserve ? empty : ''}<div class="tr-feed-list"${reserve && !shown.length ? ' hidden' : ''}>${html}</div>`;
}

// Filas de reserva de la página publicada: la unión, en el orden del feed, de los cortes de cada
// combinación de filtros (cada grupo, cualquier subconjunto no vacío de sus opciones).
function reserveFeed(market, select) {
  const subsets = values => Array.from({ length: (1 << values.length) - 1 }, (_, mask) => values.filter((__, i) => (mask + 1) & (1 << i)));
  let combos = [{}];
  for (const g of FILTER_GROUPS) {
    const options = subsets(g.options.map(o => o.value));
    combos = combos.flatMap(combo => options.map(option => ({ ...combo, [g.key]: new Set(option) })));
  }
  const ids = new Set(combos.flatMap(filters => feedCut(select(filters)).map(x => x.id)));
  return select(null).filter(x => ids.has(x.id));
}

// Fichajes y Renovaciones: las dos columnas (por debajo de 761 px se ve la
// activa, elegida con los botones de feedButtonsHtml).
// Con `reserve` (página publicada), cada columna lleva ocultas las filas que mostraría
// cualquier combinación de filtros.
export function feedColumnsHtml(market, activeFeed, filters = null, { reserve = false } = {}) {
  return [
    ['signings', t('transfers.feedSignings'), f => confirmedFeed(market, f)],
    ['renewals', t('transfers.feedRenewals'), f => renewalFeed(market, f)],
  ].map(([kind, title, select]) =>
    `<section class="tr-feed-column${kind === activeFeed ? ' tr-feed-column--active' : ''}"><h2 class="tr-feed-title">${esc(title)}</h2>${feedHtml(market, select(filters), reserve ? reserveFeed(market, select) : null)}</section>`
  ).join('');
}

export function feedButtonsHtml(activeFeed) {
  return [
    ['signings', t('transfers.feedSignings')],
    ['renewals', t('transfers.feedRenewals')],
  ].map(([value, label]) =>
    `<button class="tr-div-btn${value === activeFeed ? ' tr-div-btn--active' : ''}" data-feed="${value}">${esc(label)}</button>`
  ).join('');
}

// ── Filtros ───────────────────────────────────────────────────────
// Como en las apps: botón «Filtros» con menú desplegable de opciones con marca
// por grupo y «Limpiar filtros» (js/components/filter-menu.js); sin filas
// añadidas sobre los paneles (decisión de Dani, 2026-11-18).
const svgIcon = (paths, size = 16, stroke = 2) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const FILTER_MENU = { idPrefix: 'trFilters', activeClass: 'agenda-filter-btn--active' };

export const filterMenuItemsHtml = filters =>
  filterMenuItems(FILTER_GROUPS, filters, { idPrefix: FILTER_MENU.idPrefix, clearLabel: t('transfers.clearFilters') });

function filtersHtml(filters) {
  return filterMenu(FILTER_GROUPS, filters, { ...FILTER_MENU, label: t('transfers.filtersTitle'), clearLabel: t('transfers.clearFilters'), wrapClass: 'tr-filter', buttonClass: 'agenda-filter-btn' });
}

// ── Divisiones + lista de equipos ─────────────────────────────────
/** @public tools/site/prerender-fichajes.mjs lo usa como miembro del módulo cargado con import(). */
export function divisionTeams(market, div) {
  return [...market.seasonsByTeamId.values()]
    .filter(s => s.category === div)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
}

// País del equipo (bandera y nombre en el idioma de la página); sin dato, nada.
function countryHtml(market, teamId) {
  const code = market.countryByTeamId.get(teamId);
  if (!code) return '';
  return `<span class="tr-team-country">${countryFlag(code)}<span>${esc(regionName(code))}</span></span>`;
}

// Cuadrado de colores del equipo, como en Resultados; sin colores publicados
// de la temporada, los de la anterior, salvo con prevColorsHidden
// (denominación sin confirmar): sin cuadrado.
function marketStripesHtml(market, season) {
  const source = season?.badgeVisible === true
    ? season
    : season?.prevColorsHidden === true ? null : market.prevColorsByTeamId.get(season?.teamId);
  return source ? teamStripes(source) : '';
}

// Colores de la loseta y de la cabecera del equipo: los de cabecera de la
// temporada de mercado si sus colores están publicados; si no, los de la
// temporada en curso, salvo con prevColorsHidden (igual que el cuadrado). Sin
// pareja válida, los neutros de la página.
function teamColorStyle(market, season) {
  const source = season?.badgeVisible === true
    ? season
    : season?.prevColorsHidden === true ? null : market.prevColorsByTeamId.get(season?.teamId);
  const c = teamHeaderColors(source);
  return `background:${c.background};color:${c.text}`;
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
    <a class="tr-team-card" style="${teamColorStyle(market, s)}" href="${teamHref(market, s.teamId)}" data-team="${esc(s.teamId)}" data-key="${esc(s.teamId)}">
      <span class="tr-team-card__label${s.continuityDoubt ? ' tr-team-card__label--doubt' : ''}">
        <span class="tr-team-card__name">${marketStripesHtml(market, s)}${esc(s.name)}</span>
        ${s.continuityDoubt ? `<span class="tr-chip tr-chip--doubt">${esc(t('transfers.teamDoubt'))}</span>` : ''}
      </span><span class="tr-team-chevron" aria-hidden="true">›</span>
    </a>`).join('');
}

// ── Vista de equipo ───────────────────────────────────────────────
// `linkTeamId`: si se pasa Y ese equipo tiene ficha en el mercado (fila en
// team_seasons 2027 de una de las cuatro divisiones), la FILA ENTERA del corredor enlaza a la vista de ese
// equipo — un fichaje que LLEGA enlaza al equipo del que VENÍA; uno que se
// MARCHA, al equipo AL QUE VA (decisión Dani 2026-07-20). No hay ficha pública
// de corredor (retirada), así que el destino del enlace es siempre un equipo.
// Sin destino enlazable (retirada, fin de contrato, equipo fuera de las 4
// divisiones) la fila queda como texto plano. `key`: un movimiento nuevo entra
// sin rehacer las demás filas (js/dom-patch.js).
// `tint`: tinte de la fila de la plantilla según los años de contrato
// (contractTint); con `arrival`, el tinte fuerte de las llegadas y el texto
// oculto «(Llega)» para que el color no sea la única señal.
function personRowHtml(market, { key, flagCode, name, detail = '', contract = null, isRumor = false, isDoubt = false, linkTeamId = null, tint = '', arrival = false }) {
  // El año de contrato y el estado (rumor/duda) van como BADGES al final de la
  // fila, no en el texto.
  const cue = arrival ? `<span class="sr-only"> (${esc(t('transfers.arrivalCue'))})</span>` : '';
  const inner = `
    <span class="tr-row__flag">${flagHtml(flagCode)}</span>
    <span class="tr-row__body"><strong>${esc(name)}</strong>${cue}${detail ? ` ${detail}` : ''}</span>
    ${contractBit(contract)}
    ${isDoubt ? doubtChip() : isRumor ? rumorChip() : ''}`;
  const cls = `tr-row tr-row--team${tint ? ` tr-tint--${tint}${arrival ? ' tr-tint--strong' : ''}` : ''}`;
  if (linkTeamId && hasTeamView(market, linkTeamId)) {
    // href con el param bilingüe `?team=<slug>` (el mismo que escribe openTeam);
    // el clic normal se intercepta y navega in-page.
    return `<a class="${cls} tr-row--link" href="${teamHref(market, linkTeamId)}" data-team="${esc(linkTeamId)}" data-key="${esc(key)}">${inner}</a>`;
  }
  return `<div class="${cls}" data-key="${esc(key)}">${inner}</div>`;
}

// Tinte de la plantilla según el año de fin de contrato respecto a la
// temporada del mercado: 2 o más años de margen → verde, 1 → amarillo, vence
// este año (o antes) → rojo; sin año, sin tinte. La leyenda va bajo las listas
// del equipo (contractLegendHtml).
function contractTint(year) {
  if (!year) return '';
  if (year >= SEASON + 2) return 'green';
  return year === SEASON + 1 ? 'yellow' : 'red';
}

// Leyenda de los tintes de la plantilla: un cuadrado por color con el año de
// fin de contrato y, aparte, el tono fuerte de las llegadas.
function contractLegendHtml() {
  const item = (tint, label) =>
    `<span class="tr-legend__item"><span class="tr-legend__swatch tr-tint--${tint}" aria-hidden="true"></span>${esc(label)}</span>`;
  return `
    <div class="tr-legend">
      <span class="tr-legend__label">${esc(t('transfers.legendContract'))}</span>
      ${item('green', t('transfers.legendOrLater', { year: SEASON + 2 }))}
      ${item('yellow', String(SEASON + 1))}
      ${item('red', String(SEASON))}
      <span class="tr-legend__sep" aria-hidden="true">·</span>
      ${item('green tr-tint--strong', t('transfers.legendArrival'))}
    </div>`;
}

// Orden de la plantilla: por año de contrato (por defecto) o alfabético por
// apellido. El botón muestra el orden al que cambia: A-Z (Lucide
// arrow-down-a-z) con el de contrato activo y el lápiz sobre hoja (Lucide
// file-pen-line, el contrato) con el alfabético.
const SORT_AZ_ICON = svgIcon('<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>');
const CONTRACT_ICON = svgIcon('<path d="M14.364 13.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 0 0-3.004-3.004z"/><path d="M14.487 7.858A1 1 0 0 1 14 7V2"/><path d="M20 19.645V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l2.516 2.516"/><path d="M8 18h1"/>');
function squadOrderToggleHtml(order) {
  const alpha = order === 'alpha';
  const label = esc(t(alpha ? 'transfers.squadOrderContract' : 'transfers.squadOrderAlpha'));
  return `<button type="button" class="tr-sort-toggle" id="trSquadOrder" data-squad-order aria-label="${label}" title="${label}">${alpha ? CONTRACT_ICON : SORT_AZ_ICON}</button>`;
}

// Cada sección solo existe si tiene contenido (una categoría vacía no se pinta,
// título incluido). `action`: control a la derecha del título.
function teamSectionHtml(sectionId, contentId, title, rows, action = '') {
  if (!rows) return '';
  const heading = `<h3 class="tr-section-title">${esc(title)}</h3>`;
  return `
      <section id="${sectionId}">
        ${action ? `<div class="tr-section-head">${heading}${action}</div>` : heading}
        <div id="${contentId}">${rows}</div>
      </section>`;
}

/**
 * HTML completo de #trTeamView, de una vez, en dos columnas: plantilla | estados
 * (en duda, terminan contrato, llegan y se marchan). `roster`: rosterFromRows() del equipo; con
 * `rosterError`, la plantilla lleva el aviso y las demás secciones se pintan.
 * `squadOrder`: 'contract' (año de contrato, el del build) o 'alpha' (apellido).
 */
export function teamViewHtml(market, teamId, roster, { rosterError = false, squadOrder = 'contract' } = {}) {
  const season = market.seasonsByTeamId.get(teamId);
  // Movimientos del equipo. Llegan (fichajes): primero los CONFIRMADOS, luego
  // los rumores; dentro de cada grupo, alfabético por apellido.
  const arrivalLastName = (x) => `${x.rider?.lastName || ''} ${x.rider?.firstName || ''}`.toLowerCase();
  // Un fichaje efectivo a mitad de temporada se muestra en el feed, pero no
  // como llegada/salida del mercado siguiente. Su afiliación contractual sí
  // puede aparecer en la situación de plantilla ("continúan").
  const marketTransfers = market.transfers.filter(x => !x.midSeason);
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
    const cat = market.seasonsByTeamId.get(x.toTeamId)?.category;
    return { retire: 0, cat: (cat in CAT_RANK ? CAT_RANK[cat] : 90), team: teamLabel(market, x.toTeamId, x.toTeamName) };
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

  // Llegan: confirmados primero y luego rumores (con badge). El año de contrato
  // va aquí y también en la plantilla.
  const arrivalRows = arrivals.map(x => personRowHtml(market, {
    key: x.id,
    flagCode: x.rider?.nationality,
    name: riderName(x.rider) || x.riderId,
    detail: `<span class="tr-dim">· ${esc(teamLabel(market, x.fromTeamId, x.fromTeamName, 'from'))}</span>`,
    contract: x.contractUntil,
    isRumor: x.status === 'rumor',
    linkTeamId: x.fromTeamId,   // llega → enlaza al equipo del que VENÍA
  })).join('');

  // Terminan contrato: acaban su contrato sin equipo conocido (sin destino).
  const contractEndRows = contractEnds.map(x => personRowHtml(market, {
    key: x.id,
    flagCode: x.rider?.nationality,
    name: riderName(x.rider) || x.riderId,
    isRumor: x.status === 'rumor',
  })).join('');

  // Se marchan: fichaje a otro equipo (destino) o retirada, rumores con badge.
  const departureRows = departures.map(x => personRowHtml(market, {
    key: x.id,
    flagCode: x.rider?.nationality,
    name: riderName(x.rider) || x.riderId,
    detail: x.type === 'retirement'
      ? `<span class="tr-dim">· ${esc(t('transfers.retired'))}</span>`
      : `<span class="tr-dim">· ${esc(teamLabel(market, x.toTeamId, x.toTeamName))}</span>`,
    isRumor: x.status === 'rumor',
    // Se marcha → enlaza al equipo AL QUE VA (una retirada no tiene destino).
    linkTeamId: x.type === 'retirement' ? null : x.toTeamId,
  })).join('');

  let squadRows = '';
  let squadCount = null;
  let squadToggle = '';
  let legend = '';
  let doubtfulRows = '';
  if (rosterError) {
    squadRows = `<div class="tr-empty">${esc(t('transfers.loadError'))}</div>`;
  } else {
    // Plantilla: los del squad 2027 que YA estaban en el equipo en la temporada
    // en curso (currentTeamId = equipo) — es lo que separa "continúa" de "llega de
    // fuera" (un fichaje también tiene afiliación 2027, pero su currentTeamId es
    // otro equipo) — MENOS los que tienen salida registrada y MENOS los que están
    // en duda (sección propia), MÁS las llegadas CONFIRMADAS (un rumor no entra en
    // la plantilla; la llegada sigue también en "Llegan"). Contrato: el de la
    // renovación registrada gana al de la ficha; una duda NO lo toca.
    // "gone" = toda salida registrada (fichaje, retirada Y fin de contrato):
    // ninguno de ellos continúa.
    const gone = new Set(allDepartures.map(x => x.riderId));
    // Orden por defecto: por año de contrato DESC (2030 → 2029 → … → sin año al
    // final) y, como segundo factor, el APELLIDO; con `squadOrder` 'alpha', solo
    // el apellido. El contrato efectivo = el de la renovación registrada, o el
    // de la ficha (afiliación 2027).
    const contractOf = (r) => (renewalsByRider.get(r.id)?.contractUntil) || r.contractUntil || null;
    const lastNameFirst = (r) => `${r.lastName || ''} ${r.firstName || ''}`.toLowerCase();
    const squad = roster
      .filter(r => r.currentTeamId === teamId && !gone.has(r.id) && !doubtsByRider.has(r.id))
      .map(r => ({
        id: r.id, flagCode: r.nationality, name: riderName(r), last: lastNameFirst(r),
        contract: contractOf(r), isRumor: renewalsByRider.get(r.id)?.status === 'rumor', arrival: false,
      }));
    const squadIds = new Set(squad.map(e => e.id));
    arrivals.filter(x => x.status === 'confirmed' && !squadIds.has(x.riderId) && !doubtsByRider.has(x.riderId)).forEach(x => squad.push({
      id: x.riderId, flagCode: x.rider?.nationality, name: riderName(x.rider) || x.riderId,
      last: lastNameFirst(x.rider || {}), contract: x.contractUntil || null, isRumor: false, arrival: true,
    }));
    squad.sort((a, b) => {
      if (squadOrder !== 'alpha' && a.contract !== b.contract) return (b.contract || 0) - (a.contract || 0);   // año mayor primero; sin año (0) al final
      return a.last.localeCompare(b.last, 'es', { sensitivity: 'base' });
    });
    if (squad.length > 1) squadToggle = squadOrderToggleHtml(squadOrder);
    if (squad.some(e => contractTint(e.contract))) legend = contractLegendHtml();
    squadRows = squad.map(e => personRowHtml(market, {
      key: e.id,
      flagCode: e.flagCode,
      name: e.name,
      contract: e.contract,
      isRumor: e.isRumor,
      tint: contractTint(e.contract),
      arrival: e.arrival,
    })).join('');
    // «Confirmados»: fuera los que solo tienen una renovación rumoreada. El
    // texto empieza por {n} en los dos idiomas: ese número va en negrita.
    const confirmed = squad.filter(e => !e.isRumor).length;
    if (squad.length) {
      squadCount = esc(t(`transfers.squadCount_${confirmed === 1 ? 'one' : 'other'}`, { n: confirmed }))
        .replace(/^\d+/, n => `<strong>${n}</strong>`);
    }

    // En duda: los de la plantilla con renovación en duda. La ficha manda
    // para el nombre/bandera; si el corredor ya no está en la plantilla
    // (fichado en enero, ficha ya movida) se cae a la del movimiento.
    const byId = new Map(roster.map(r => [r.id, r]));
    // Sin badge "Duda": ya están bajo la sección "En duda".
    doubtfulRows = [...doubtsByRider.values()]
      .filter(x => !gone.has(x.riderId))
      .map(x => ({ x, r: byId.get(x.riderId) || x.rider }))
      .sort((a, b) => riderName(a.r).localeCompare(riderName(b.r), 'es', { sensitivity: 'base' }))
      .map(({ x, r }) => personRowHtml(market, {
        key: x.id,
        flagCode: r?.nationality,
        name: riderName(r) || x.riderId,
        contract: r?.contractUntil,
      })).join('');
  }

  // Dos columnas: la plantilla y, juntos, todos los estados (en duda, terminan
  // contrato, llegan, se marchan). Una columna sin secciones no se pinta.
  const squadSection = teamSectionHtml('trSecStaying', 'trStaying', t('transfers.squad', { season: SEASON }), squadRows, squadToggle);
  const statesSections = teamSectionHtml('trSecDoubtful', 'trDoubtful', t('transfers.doubtful'), doubtfulRows)
    + teamSectionHtml('trSecContractEnds', 'trContractEnds', t('transfers.contractEnds'), contractEndRows)
    + teamSectionHtml('trSecArrivals', 'trArrivals', t('transfers.arrivals'), arrivalRows)
    + teamSectionHtml('trSecDepartures', 'trDepartures', t('transfers.departures'), departureRows);
  const sections = (squadSection ? `
      <div class="tr-team-col" id="trColSquad">${squadSection}
      </div>` : '')
    + (statesSections ? `
      <div class="tr-team-col" id="trColStates">${statesSections}
      </div>` : '');

  // Cabecera: nombre con la división y la temporada al final; debajo, país y
  // ciclistas confirmados separados por «·». En móvil, tres líneas (css/fichajes.css).
  const facts = [countryHtml(market, teamId),
    squadCount ? `<span class="tr-team-header__count" id="trTeamCount">${squadCount}</span>` : '']
    .filter(Boolean).join('<span class="tr-team-header__sep" aria-hidden="true">·</span>');

  return `
    <div class="tr-team-header" style="${teamColorStyle(market, season)}">
      <div class="tr-team-header__text">
        <div class="tr-team-header__top">
          <h2 class="tr-team-header__name">${esc(season.name)}</h2>
          <span class="tr-team-header__cat">${esc(divisionName(season))} · ${SEASON}</span>
        </div>
        ${facts ? `<div class="tr-team-header__facts">${facts}</div>` : ''}
      </div>
    </div>
    ${season.continuityDoubt
      ? `<div class="tr-team-notice">${esc(t('transfers.teamDoubtNotice', { season: SEASON }))}</div>`
      : ''}
    <div class="tr-team-sections">${sections || `
      <div id="trTeamEmpty" class="tr-empty">${esc(t('transfers.teamEmpty'))}</div>`}
    </div>${legend}`;
}

/**
 * HTML de #transfersContent: título y, en una sola pantalla, el feed de
 * confirmaciones con su botón de filtros y la lista de equipos (botones de
 * división y losetas de la división `activeDiv`), más la vista de equipo, vacía
 * u ocupada por `teamHtml` (teamViewHtml) con la portada oculta. El botón de
 * filtros va junto a Fichajes | Renovaciones; desde 761 px, el CSS lo lleva a
 * la fila del título.
 */
export function marketHomeHtml(market, { activeDiv = 'WT', activeFeed = 'signings', filters = newFilters(), teamHtml = null, reserve = false } = {}) {
  return `
    <h1 class="tr-heading" id="trH1">${esc(t('transfers.heading', { season: SEASON }))}</h1>
    <div id="trHome"${teamHtml ? ' hidden' : ''}>
      <section class="tr-home-feed" aria-label="${esc(t('transfers.feedTitle'))}">
        <div class="tr-feed-bar">
          <div class="tr-div-btns" id="trFeedBtns">${feedButtonsHtml(activeFeed)}</div>
          <div class="tr-filter-slot" id="trFilters">${filtersHtml(filters)}</div>
        </div>
        <div class="tr-home-scroll" id="trFeed" data-max-days="${FEED_MAX_DAYS}" data-max-items="${FEED_MAX_ITEMS}">${feedColumnsHtml(market, activeFeed, filters, { reserve })}</div>
      </section>
      <section class="tr-home-teams">
        <h2 class="tr-section-title">${esc(t('transfers.teamsTitle', { season: SEASON }))}</h2>
        <div class="tr-div-btns" id="trDivBtns">${divButtonsHtml(activeDiv)}</div>
        <div class="tr-home-scroll tr-team-grid" id="trTeamGrid">${teamGridHtml(market, activeDiv)}</div>
      </section>
    </div>
    <div id="trTeamView"${teamHtml ? '' : ' hidden'}>${teamHtml || ''}</div>`;
}
