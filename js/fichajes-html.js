// ─────────────────────────────────────────────────────────────────
//  FICHAJES — mercado preparado y HTML de su portada y sus equipos, sin DOM
//  Lo usan js/fichajes.js (pintado en el navegador) y el paso de build que
//  escribe /fichajes/ y /en/transfers/ (tools/site/prerender-fichajes.mjs).
//  El marcado no puede depender del dispositivo, del ancho de pantalla, de
//  localStorage ni del momento de carga: el navegador compara su huella con
//  la del HTML del build (js/html-fingerprint.js). La portada lleva las dos
//  vistas (Mercado y Equipos); cuál se ve lo decide js/fichajes.js sobre el DOM.
// ─────────────────────────────────────────────────────────────────

import { teamStripes, teamHeaderColors } from './team-appearance.js';
import { FIGMA_TEAM_COLORS } from './fichajes-figma-colors.js';
import { seoWeekdayDayMonth, countryFlag, regionName } from './shared.js';
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
const DIVISION_GENDER = { WT: 'male', PT: 'male', WWT: 'female', PRW: 'female' };

// Columnas de las lecturas del mercado, comunes al navegador y al build.
export const SEASON_COLUMNS = 'teamId, name, category, gender, badgeVisible, continuityDoubt, prevColorsHidden, headerBg, headerText, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts';
export const PREV_SEASON_COLUMNS = 'teamId, name, headerBg, headerText, badgeTorsoCenter, badgeTorsoSides, badgeInnerCircle, badgeShorts';
export const RIDER_COLUMNS = 'id, firstName, lastName, nationality, contractUntil, birthDate';
export const ROSTER_COLUMNS = 'id, firstName, lastName, nationality, currentTeamId';
// País de cada equipo de la temporada (losetas y banner de la vista de equipo).
export const TEAM_COUNTRY_COLUMNS = 'id, countryCode';

// Filtros del mercado. Cada grupo lista sus chips (valor + etiqueta). El valor
// de un movimiento para el grupo sale de FILTER_VALUE; un valor desconocido
// (null) solo se oculta si el grupo está filtrado (algún chip apagado).
export const FILTER_GROUPS = [
  { key: 'gender', label: 'filterGender', options: [
    { value: 'male', label: () => t('transfers.genderMale') },
    { value: 'female', label: () => t('transfers.genderFemale') },
  ] },
  { key: 'division', label: 'filterDivision', options: [
    { value: 'world', label: () => t('transfers.divWorld') },
    { value: 'pro', label: () => t('transfers.divPro') },
  ] },
  { key: 'age', label: 'filterAge', options: [
    { value: 'elite', label: () => t('transfers.ageElite') },
    { value: 'u23', label: () => t('transfers.ageU23') },
    { value: 'junior', label: () => t('transfers.ageJunior') },
  ] },
  { key: 'years', label: 'filterContract', options: [
    { value: 1, label: () => t('transfers.years1') },
    { value: 2, label: () => t('transfers.yearsN', { n: 2 }) },
    { value: 3, label: () => t('transfers.yearsN', { n: 3 }) },
    // 4 o más (la etiqueta del diseño decía "Más de 4", que dejaría fuera el 4).
    { value: 4, label: () => t('transfers.years4') },
  ] },
];
// División del equipo de destino (en las renovaciones, el propio equipo) agrupada
// en los dos chips del panel; PTW es el alias de PRW (ver FEED_CATEGORY_RANK).
const DIVISION_GROUP = { WT: 'world', WWT: 'world', PT: 'pro', PRW: 'pro', PTW: 'pro' };

// Categoría UCI por edad (año de la temporada − año de nacimiento).
function ageGroup(birthDate) {
  const year = parseInt(String(birthDate || '').slice(0, 4), 10);
  if (isNaN(year)) return null;
  const age = SEASON - year;
  return age <= 18 ? 'junior' : age <= 22 ? 'u23' : 'elite';
}

// Años de contrato desde la temporada del mercado (2027 → 1, 2028 → 2…); 4 =
// "4 o más". Un contrato ya vencido o sin año es desconocido.
function contractYears(until) {
  const year = Number(until);
  if (!year) return null;
  const n = year - SEASON + 1;
  return n < 1 ? null : Math.min(n, 4);
}

const FILTER_VALUE = {
  gender: (market, x) => x.riderGender || null,
  division: (market, x) => DIVISION_GROUP[market.seasonsByTeamId.get(x.toTeamId)?.category] ?? null,
  age: (market, x) => ageGroup(x.rider?.birthDate),
  years: (market, x) => contractYears(x.contractUntil),
};

/** Filtros del panel: grupo → Set de valores activos; empiezan TODOS activos. */
export const newFilters = () => Object.fromEntries(
  FILTER_GROUPS.map(g => [g.key, new Set(g.options.map(o => o.value))]));

function filtersActive(filters) {
  return FILTER_GROUPS.some(g => filters[g.key].size < g.options.length);
}

// Pasa los filtros del panel: cada grupo con algún chip apagado exige que el
// valor conocido del movimiento esté entre los activos. Sin `filters`, todo pasa.
function matchesFilters(market, filters, x) {
  if (!filters) return true;
  return FILTER_GROUPS.every(g => {
    const active = filters[g.key];
    if (active.size === g.options.length) return true;
    const value = FILTER_VALUE[g.key](market, x);
    return value != null && active.has(value);
  });
}

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
    // muestran mientras la chapa 2027 está oculta, salvo con prevColorsHidden.
    // Un equipo NUEVO (nacido en 2027) no tiene fila 2026 → sin entrada aquí →
    // la chapa queda vacía (mig. 129).
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

// RUMOR a la derecha de la fila (que además va teñida de azul: .tr-row--rumor).
function rumorLabel() {
  return `<span class="tr-rumor-label">${esc(t('transfers.rumor'))}</span>`;
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

// Celda del año de contrato: separada por un filete vertical. Sin año la celda
// queda vacía para que el filete no desaparezca en esa fila.
function yearCell(inner) {
  return inner || '<span class="tr-contract"></span>';
}

// Flecha larga de línea fina (→ salida/destino, ← origen). Decorativa: el
// lector de pantalla recibe la flecha en texto oculto.
function arrowHtml(dir = 'right') {
  return `<span class="tr-arrow-cell${dir === 'left' ? ' tr-arrow-cell--left' : ''}"><svg class="tr-arrow" viewBox="0 0 48 10" aria-hidden="true" focusable="false"><path d="M1 5h45M41 1l5 4-5 4" fill="none" stroke="currentColor" stroke-width="1"/></svg><span class="sr-only">${dir === 'left' ? '←' : '→'}</span></span>`;
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
    .filter(x => x.status === 'confirmed' && x.dateVisible !== false && isRealSigning(x) && matchesFilters(market, filters, x))
    .sort((a, b) => compareFeedMoves(market, a, b));
}

function renewalFeed(market, filters) {
  return market.transfers
    .filter(x => x.status === 'confirmed' && x.dateVisible !== false && x.type === 'renewal' && matchesFilters(market, filters, x))
    .sort((a, b) => compareFeedMoves(market, a, b));
}

// ── Franjas y colores de equipo ───────────────────────────────────
// Franjas de maillot de Resultados; sin colores publicados de la temporada,
// los de la anterior, salvo con prevColorsHidden (denominación sin confirmar):
// sin franjas.
function marketStripesHtml(market, season) {
  const source = season?.badgeVisible === true
    ? season
    : season?.prevColorsHidden === true ? null : market.prevColorsByTeamId.get(season?.teamId);
  return source ? teamStripes(source) : '';
}

// Franjas del diseño (fichajes-figma-colors.js), con el mismo marcado que
// teamStripes(): un elemento con las tres franjas en variables.
function figmaStripesHtml(figma) {
  const [a, b, c] = figma.stripes;
  return `<span class="team-stripes" style="--a:${a};--b:${b};--c:${c}"></span>`;
}

// Franjas del equipo de un movimiento. 'from' (origen) usa los colores de la
// temporada en curso, con los que corre hoy; 'to' (destino) los del mercado.
// Un equipo sin fila en una de las dos temporadas cae a la otra.
function stripesFor(market, teamId, side = 'to') {
  // Con colores del diseño, las mismas tres franjas que su loseta y su banner.
  const figma = FIGMA_TEAM_COLORS[teamId];
  if (figma) return figmaStripesHtml(figma);
  const season = market.seasonsByTeamId.get(teamId);
  const prev = market.prevColorsByTeamId.get(teamId);
  if (side === 'from') return prev ? teamStripes(prev) : (season ? marketStripesHtml(market, season) : '');
  return season ? marketStripesHtml(market, season) : (prev ? teamStripes(prev) : '');
}

// Colores de la loseta/banner: los del diseño (fichajes-figma-colors.js) si
// el equipo tiene entrada; si no, la pareja editorial headerBg/headerText de
// la temporada si la chapa 2027 es visible, o la de la temporada en curso
// (igual que las franjas). Sin pareja válida, los neutros de la página.
function teamColorStyle(market, season) {
  const figma = FIGMA_TEAM_COLORS[season?.teamId];
  if (figma) return `background:${figma.bg};color:${figma.text}`;
  const source = season?.badgeVisible === true ? season : market.prevColorsByTeamId.get(season?.teamId);
  const c = teamHeaderColors(source);
  return `background:${c.background};color:${c.text}`;
}

// País del equipo (bandera y nombre en el idioma de la página).
function countryHtml(market, teamId, cls) {
  const code = market.countryByTeamId.get(teamId);
  if (!code) return '';
  return `<span class="${cls}">${countryFlag(code)}<span>${esc(regionName(code))}</span></span>`;
}

function divisionName(season) {
  return DIVISIONS.includes(season?.category) ? t('transfers.divName' + season.category) : (season?.category || '');
}

// Franjas de la loseta/banner como banda vertical a todo el alto: las del
// diseño si el equipo tiene entrada; si no, las de maillot.
function stripesBand(market, season, cls) {
  const figma = FIGMA_TEAM_COLORS[season?.teamId];
  const stripes = figma ? figmaStripesHtml(figma) : marketStripesHtml(market, season);
  return stripes ? `<span class="${cls}">${stripes}</span>` : '';
}

// ── Feed ──────────────────────────────────────────────────────────
function feedRowHtml(market, x) {
  const name = esc(riderName(x.rider) || x.riderId);
  const year = yearCell(x.midSeason ? midSeasonBit(true) : contractBit(x.contractUntil));
  const flagCell = `<span class="tr-row__flag">${flagHtml(x.rider?.nationality)}</span>`;
  let inner;
  if (x.type === 'transfer') {
    // Solo se muestra el equipo de DESTINO (a dónde va), no el de origen: el
    // corredor ya va aparte → nombre · flecha · franjas + equipo. Columnas fijas
    // para que las flechas y los años queden alineados en toda la tabla.
    inner = `${flagCell}
    <span class="tr-name">${name}</span>
    ${arrowHtml()}
    <span class="tr-dest">${stripesFor(market, x.toTeamId)}<strong>${esc(teamLabel(market, x.toTeamId, x.toTeamName))}</strong></span>
    ${year}`;
  } else {
    // Renovación / retirada: frase corrida (nombre + verbo + equipo).
    const move = x.type === 'renewal'
      ? `${esc(t('transfers.renews'))} <strong>${esc(teamLabel(market, x.toTeamId, x.toTeamName))}</strong>`
      : `${esc(t('transfers.retires'))} <span class="tr-dim">(${esc(teamLabel(market, x.fromTeamId, x.fromTeamName, 'from'))})</span>`;
    inner = `${flagCell}
    <span class="tr-row__body tr-row__body--wide"><span class="tr-name">${name}</span> <span class="tr-move">${move}</span></span>
    ${year}`;
  }
  // El destino puede no tener ficha propia en el mercado (equipo fuera de las
  // cuatro divisiones): la fila conserva el aspecto no enlazado. `data-key`: un
  // movimiento nuevo entra sin rehacer las demás filas (js/dom-patch.js).
  if (x.toTeamId && hasTeamView(market, x.toTeamId)) {
    return `<a class="tr-row tr-row--feed tr-row--link" href="${teamHref(market, x.toTeamId)}" data-team="${esc(x.toTeamId)}" data-key="${esc(x.id)}">${inner}</a>`;
  }
  return `<div class="tr-row tr-row--feed" data-key="${esc(x.id)}">${inner}</div>`;
}

function feedHtml(market, feed) {
  if (feed.length === 0) {
    return `<div class="tr-feed-box"><div class="tr-empty">${esc(t('transfers.feedEmpty'))}</div></div>`;
  }
  // Corte del feed (tras filtrar): hasta FEED_MAX_DAYS fechas distintas O
  // FEED_MAX_ITEMS fichajes, lo que se alcance antes (el feed viene en orden
  // cronológico inverso). No hay "cargar más": el mercado completo se ve por
  // equipo.
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
  return `<div class="tr-feed-box">${html}</div>`;
}

// Fichajes y Renovaciones: las dos columnas (por debajo de 761 px se ve la
// activa, elegida con los botones de feedButtonsHtml).
export function feedColumnsHtml(market, activeFeed, filters = null) {
  return [
    ['signings', t('transfers.feedSignings'), confirmedFeed(market, filters)],
    ['renewals', t('transfers.feedRenewals'), renewalFeed(market, filters)],
  ].map(([kind, title, feed]) => `<section class="tr-feed-column${kind === activeFeed ? ' tr-feed-column--active' : ''}"><h2 class="tr-feed-title">${esc(title)}</h2>${feedHtml(market, feed)}</section>`).join('');
}

export function feedButtonsHtml(activeFeed) {
  return [
    ['signings', t('transfers.feedSignings')],
    ['renewals', t('transfers.feedRenewals')],
  ].map(([value, label]) =>
    `<button class="tr-div-btn${value === activeFeed ? ' tr-div-btn--active' : ''}" data-feed="${value}">${esc(label)}</button>`
  ).join('');
}

// ── Panel de filtros ──────────────────────────────────────────────
// Se repinta con js/dom-patch.js al pulsar un chip: los botones conservan el
// nodo (y el foco del teclado) y solo cambian su estado.
export function filtersHtml(filters = newFilters()) {
  return FILTER_GROUPS.map(g => `
    <div class="tr-filter-group" role="group" aria-labelledby="trFg-${g.key}">
      <span class="tr-filter-label" id="trFg-${g.key}">${esc(t('transfers.' + g.label))}</span>
      <div class="tr-filter-chips">${g.options.map(o => {
        const on = filters[g.key].has(o.value);
        return `<button type="button" class="tr-filter-chip${on ? ' tr-filter-chip--active' : ''}" data-group="${g.key}" data-value="${o.value}" aria-pressed="${on}">${esc(o.label())}</button>`;
      }).join('')}</div>
    </div>`).join('')
    + `<button type="button" class="tr-filters-clear" id="trFiltersClear"${filtersActive(filters) ? '' : ' disabled'}>${esc(t('transfers.clearFilters'))}</button>`;
}

// ── Divisiones + lista de equipos ─────────────────────────────────
/** @public tools/site/prerender-fichajes.mjs lo usa como miembro del módulo cargado con import(). */
export function divisionTeams(market, div) {
  return [...market.seasonsByTeamId.values()]
    .filter(s => s.category === div)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
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
    <a class="tr-team-card" href="${teamHref(market, s.teamId)}" data-team="${esc(s.teamId)}" data-key="${esc(s.teamId)}" style="${teamColorStyle(market, s)}">
      ${stripesBand(market, s, 'tr-team-card__stripes')}
      <span class="tr-team-card__body">
        <span class="tr-team-card__name">${esc(s.name)}</span>
        ${s.continuityDoubt ? `<span class="tr-chip tr-chip--doubt">${esc(t('transfers.teamDoubt'))}</span>` : ''}
        <span class="tr-team-card__division">${esc(divisionName(s))}</span>
        ${countryHtml(market, s.teamId, 'tr-team-card__country')}
      </span>
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
// `arrow` + `team` pintan "nombre ⟵/⟶ franjas equipo"; `yearCol` reserva la
// celda del año aunque no haya contrato; `tint` colorea la fila de la plantilla
// (+ `arrival`: tinte fuerte, y texto oculto "Llega" para que el color no sea la
// única señal); `isRumor` tiñe la fila de azul y pone RUMOR a la derecha.
function personRowHtml(market, { key, flagCode, name, arrow = null, team = null, detail = '', contract = null, yearCol = false,
  isRumor = false, isDoubt = false, linkTeamId = null, tint = '', arrival = false }) {
  const teamHtml = team
    ? `<span class="tr-dest">${stripesFor(market, team.id, team.side)}<strong>${esc(teamLabel(market, team.id, team.freeText, team.side))}</strong></span>`
    : '';
  const status = isDoubt ? doubtChip()
    : isRumor ? rumorLabel()
    : '';
  const inner = `
    <span class="tr-row__flag">${flagHtml(flagCode)}</span>
    <span class="tr-name">${esc(name)}${arrival ? `<span class="sr-only"> (${esc(t('transfers.arrivalCue'))})</span>` : ''}</span>
    ${arrow ? arrowHtml(arrow) : ''}${teamHtml}${detail}
    ${status}
    ${contract || yearCol ? yearCell(contractBit(contract)) : ''}`;
  const cls = `tr-row tr-row--team${arrow || team || detail ? '' : ' tr-row--solo'}${tint ? ` tr-tint tr-tint--${tint}${arrival ? ' tr-tint--strong' : ''}` : ''}${isRumor && !isDoubt ? ' tr-row--rumor' : ''}`;
  if (linkTeamId && hasTeamView(market, linkTeamId)) {
    // href con el param bilingüe `?team=<slug>` (el mismo que escribe openTeam);
    // el clic normal se intercepta y navega in-page.
    return `<a class="${cls} tr-row--link" href="${teamHref(market, linkTeamId)}" data-team="${esc(linkTeamId)}" data-key="${esc(key)}">${inner}</a>`;
  }
  return `<div class="${cls}" data-key="${esc(key)}">${inner}</div>`;
}

// Tinte de la plantilla según el año de fin de contrato respecto a la
// temporada del mercado: 2 o más años de margen → verde, 1 → amarillo, vence
// este año (o antes) → rojo; sin año, sin tinte.
function contractTint(year) {
  if (!year) return '';
  if (year >= SEASON + 2) return 'green';
  return year === SEASON + 1 ? 'yellow' : 'red';
}

// Cada sección solo existe si tiene contenido (una categoría vacía no se pinta,
// título incluido).
function teamSectionHtml(sectionId, contentId, title, rows) {
  if (!rows) return '';
  return `
        <section id="${sectionId}">
          <h3 class="tr-section-title">${esc(title)}</h3>
          <div class="tr-table" id="${contentId}">${rows}</div>
        </section>`;
}

/**
 * HTML completo de #trTeamView: banner del equipo y, en tres columnas,
 * plantilla / en duda y terminan contrato / llegan y se marchan, de una vez.
 * `roster`: rosterFromRows() del equipo; con `rosterError`, la plantilla lleva
 * el aviso y las demás secciones se pintan.
 */
export function teamViewHtml(market, teamId, roster, { rosterError = false } = {}) {
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

  // Llegan: confirmados primero y luego rumores (con etiqueta); el año de
  // contrato va en la plantilla, no aquí.
  const arrivalRows = arrivals.map(x => personRowHtml(market, {
    key: x.id,
    flagCode: x.rider?.nationality,
    name: riderName(x.rider) || x.riderId,
    arrow: 'left',
    team: { id: x.fromTeamId, freeText: x.fromTeamName, side: 'from' },
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

  // Se marchan: fichaje a otro equipo (destino) o retirada, rumores con etiqueta.
  const departureRows = departures.map(x => personRowHtml(market, {
    key: x.id,
    flagCode: x.rider?.nationality,
    name: riderName(x.rider) || x.riderId,
    ...(x.type === 'retirement'
      ? { detail: `<span class="tr-dim">· ${esc(t('transfers.retired'))}</span>` }
      : { arrow: 'right', team: { id: x.toTeamId, freeText: x.toTeamName, side: 'to' } }),
    isRumor: x.status === 'rumor',
    // Se marcha → enlaza al equipo AL QUE VA (una retirada no tiene destino).
    linkTeamId: x.type === 'retirement' ? null : x.toTeamId,
  })).join('');

  let squadRows = '';
  let squadCount = null;
  let doubtfulRows = '';
  if (rosterError) {
    squadRows = `<div class="tr-empty">${esc(t('transfers.loadError'))}</div>`;
  } else {
    // Plantilla: los del squad 2027 que YA estaban en el equipo en la temporada
    // en curso (currentTeamId = equipo) — es lo que separa "continúa" de "llega de
    // fuera" (un fichaje también tiene afiliación 2027, pero su currentTeamId es
    // otro equipo) — MENOS los que tienen salida registrada y MENOS los que están
    // en duda (sección propia), MÁS las llegadas CONFIRMADAS (un rumor no entra en
    // la plantilla). Contrato: el de la renovación registrada gana al de la ficha;
    // una duda NO lo toca.
    // "gone" = toda salida registrada (fichaje, retirada Y fin de contrato):
    // ninguno de ellos continúa.
    const gone = new Set(allDepartures.map(x => x.riderId));
    // Orden: por año de contrato DESC (2030 → 2029 → … → sin año al final) y,
    // como segundo factor, el APELLIDO. El contrato efectivo = el de la
    // renovación registrada, o el de la ficha (afiliación 2027).
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
      if (a.contract !== b.contract) return (b.contract || 0) - (a.contract || 0);   // año mayor primero; sin año (0) al final
      return a.last.localeCompare(b.last, 'es', { sensitivity: 'base' });
    });
    squadRows = squad.map(e => personRowHtml(market, {
      key: e.id,
      flagCode: e.flagCode,
      name: e.name,
      contract: e.contract,
      yearCol: true,
      isRumor: e.isRumor,
      tint: contractTint(e.contract),
      arrival: e.arrival,
    })).join('');
    // «Confirmados»: fuera los que solo tienen una renovación rumoreada.
    const confirmed = squad.filter(e => !e.isRumor).length;
    if (squad.length) squadCount = t(`transfers.squadCount_${confirmed === 1 ? 'one' : 'other'}`, { n: confirmed, season: SEASON });

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

  const squadSection = teamSectionHtml('trSecStaying', 'trStaying', t('transfers.squad', { season: SEASON }), squadRows);
  const endsSection = teamSectionHtml('trSecDoubtful', 'trDoubtful', t('transfers.doubtful'), doubtfulRows)
    + teamSectionHtml('trSecContractEnds', 'trContractEnds', t('transfers.contractEnds'), contractEndRows);
  const movesSection = teamSectionHtml('trSecArrivals', 'trArrivals', t('transfers.arrivals'), arrivalRows)
    + teamSectionHtml('trSecDepartures', 'trDepartures', t('transfers.departures'), departureRows);
  const column = (cls, html) => `
      <div class="tr-col tr-col--${cls}">${html}
      </div>`;

  // Banner a ancho completo con los colores del equipo.
  return `
    <div class="tr-team-banner" style="${teamColorStyle(market, season)}">
      ${stripesBand(market, season, 'tr-team-banner__stripes')}
      <div class="tr-team-banner__content">
        <h2 class="tr-team-banner__name">${esc(season.name)}</h2>
        <div class="tr-team-banner__meta">
          <span>${esc(divisionName(season))}</span>
          ${countryHtml(market, teamId, 'tr-team-banner__country')}
          <span id="trTeamCount">${esc(squadCount || '')}</span>
        </div>
      </div>
    </div>
    ${season.continuityDoubt
      ? `<div class="tr-team-notice">${esc(t('transfers.teamDoubtNotice', { season: SEASON }))}</div>`
      : ''}
    <div class="tr-team-sections">${squadSection || endsSection || movesSection
      ? column('squad', squadSection) + column('ends', endsSection) + column('moves', movesSection)
      : `
      <div id="trTeamEmpty" class="tr-empty">${esc(t('transfers.teamEmpty'))}</div>`}
    </div>`;
}

/**
 * HTML de #transfersContent: interruptor Mercado | Equipos, y las dos vistas
 * (Mercado con filtros y feed; Equipos con las losetas de la división
 * `activeDiv`), más la vista de equipo, vacía u ocupada por `teamHtml`
 * (teamViewHtml) con la portada oculta. Siempre con Mercado a la vista:
 * js/fichajes.js muestra la que pida la URL (applyView).
 */
export function marketHomeHtml(market, { activeDiv = 'WT', activeFeed = 'signings', filters = newFilters(), teamHtml = null } = {}) {
  return `
    <div class="tr-view-switch" id="trViewSwitch" role="group" aria-label="${esc(t('transfers.viewLabel'))}">
      <button type="button" class="tr-view-btn tr-view-btn--active" data-view="market" aria-pressed="true">${esc(t('transfers.viewMarket'))}</button>
      <button type="button" class="tr-view-btn" data-view="teams" aria-pressed="false">${esc(t('transfers.viewTeams'))}</button>
    </div>
    <h1 class="tr-heading" id="trH1">${esc(t('transfers.heading', { season: SEASON }))}</h1>
    <div id="trHome"${teamHtml ? ' hidden' : ''}>
      <div id="trViewMarket">
        <p class="tr-subtitle">${esc(t('transfers.subtitleMarket'))}</p>
        <section class="tr-filters" aria-labelledby="trFiltersTitle">
          <h2 class="tr-filters__title" id="trFiltersTitle">${esc(t('transfers.filtersTitle'))}</h2>
          <div class="tr-filters__panel" id="trFilters">${filtersHtml(filters)}</div>
        </section>
        <section class="tr-home-feed" aria-label="${esc(t('transfers.feedTitle'))}">
          <div class="tr-div-btns" id="trFeedBtns">${feedButtonsHtml(activeFeed)}</div>
          <div class="tr-feed-columns" id="trFeed">${feedColumnsHtml(market, activeFeed, filters)}</div>
        </section>
      </div>
      <div id="trViewTeams" hidden>
        <h2 class="tr-heading">${esc(t('transfers.teamsTitle', { season: SEASON }))}</h2>
        <p class="tr-subtitle">${esc(t('transfers.subtitleTeams'))}</p>
        <div class="tr-div-btns" id="trDivBtns">${divButtonsHtml(activeDiv)}</div>
        <div class="tr-team-grid" id="trTeamGrid">${teamGridHtml(market, activeDiv)}</div>
      </div>
    </div>
    <div id="trTeamView"${teamHtml ? '' : ' hidden'}>${teamHtml || ''}</div>`;
}
