// HTML de Últimos resultados: filas de carretera y de ciclocross, ránking y
// pestañas. Sin DOM: lo usan el navegador y el servidor que publica la página.
import { esc, countryFlag, raceName as getRaceName, resolveTypeBadges, nameImpliesFemale, effectiveCountryCode, femaleMark } from './shared.js';
import { t } from './i18n.js';
import { classificationLabel, classificationColor } from './services/race-presentation.js';
import { roadPinButtonHtml } from './components/discipline-switch.js';
import { cxRaceName, cxRacePageUrl, cxRoundBadge } from './cx/presentation.js';
import { decorateUciRanking, formatUciRankingUpdated, UciRankingTier, uciRankingRuleText } from './results/uci-team-ranking.js';
import { LOGO_ONERROR, logoPlaceholderHtml } from './components/logo-placeholder.js';

const TROPHY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-0.12em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';

// Color del tinte de la card (espejo de safeCardColor en app.js): oscurece los
// colores demasiado claros para que el tinte/borde sea visible en ambos temas.
function safeCardColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return '#888';
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 210) {
    const darken = v => Math.round(v * 0.6).toString(16).padStart(2, '0');
    return '#' + darken(r) + darken(g) + darken(b);
  }
  return '#' + full;
}

function stageLabel(sn, isEn, suffix = '') {
  if (sn === 0) return isEn ? 'Prologue' : 'Prólogo';
  if (sn != null) return isEn ? `Stage ${sn}${suffix}` : `Etapa ${sn}${suffix}`;
  return '';   // pruebas de un día: sin etiqueta (decisión 2026-06-11)
}

// ── Render de una fila ─────────────────────────────────────────────
function entryRowHtml(e, isEn, locale) {
  const gcFinalLabel = isEn ? 'Final GC' : 'General final';
  // País efectivo: la jornada puede transcurrir en un país distinto al de la
  // carrera (etapa que sale de otro país) → prevalece el de la jornada.
  const flagCc = effectiveCountryCode(e.rd, e.race);
  const flag = flagCc ? `<span class="feed-row__flag">${countryFlag(flagCc)}</span>` : '';
  // Todas las filas reservan la misma columna para el logo y la bandera.
  // Sin logo (o si no carga), el hueco de la marca; nunca en los Nacionales.
  const national = e.race.uciCategory === 'CN';
  const logo = e.race.logoUrl
    ? `<img class="race-logo-img" src="${esc(e.race.logoUrl)}" alt="" loading="lazy" ${national ? `onerror="this.style.display='none'"` : LOGO_ONERROR}>`
    : (national ? '' : logoPlaceholderHtml('race-logo-img'));
  const leftCol = `<span class="feed-row__logo">${logo}${flag}</span>`;
  const fem = (e.race.gender === 'female' && !nameImpliesFemale(e.race.name || ''))
    ? femaleMark({ cls: 'feed-row__fem' }) : '';
  // Nombre en una línea con puntos suspensivos; el símbolo femenino, visible.
  const name = `<span class="feed-row__race-name">${esc(getRaceName(e.race))}</span>${fem}`;
  const color = safeCardColor(e.race.colorHex);

  // Línea 2: etapa, km y desnivel + badge solo para CRI/CRE/cronoescalada.
  // Las generales finales solo llevan su etiqueta. Un
  // día: sin etiqueta.
  let subHtml = '';
  if (e.isGcFinal) {
    subHtml = `<span class="feed-row__gclabel">${esc(gcFinalLabel)}</span>`;
  } else {
    const rd = e.rd;
    const km = rd?.distanceKm
      ? `${Number(rd.distanceKm).toLocaleString(locale)} km` : '';
    const gain = rd?.elevationGain;
    const elevation = gain != null
      // Separador de millares también con cuatro cifras («+1.810 m»), como en Hoy:
      // es-ES no agrupa por defecto por debajo de 10.000.
      ? `+${Number(Math.round(gain / 10) * 10).toLocaleString(locale, { useGrouping: 'always' })} m`
      : '';
    const stagePart = stageLabel(e.sn, isEn, e.suffix || '');
    const seg = [];
    if (stagePart) seg.push(`<strong>${esc(stagePart)}</strong>`);
    if (km) seg.push(`<strong>${esc(km)}</strong>`);
    if (elevation) seg.push(esc(elevation));
    const text = seg.join(' · ');
    const showType = rd?.primaryType === 'itt' || rd?.primaryType === 'ttt';
    const resultSecondary = rd?.primaryType === 'itt' && ['chrono_climb', 'summit_finish'].includes(rd?.secondaryType)
      ? rd.secondaryType : null;
    const badges = showType
      ? `<span class="feed-row__badges">${resolveTypeBadges(rd.primaryType, resultSecondary, e.race.countryCode)}</span>` : '';
    subHtml = `${text}${badges}`;
  }

  const winnerHtml = e.winner
    ? `<span class="feed-row__winner">${TROPHY_SVG} <strong>${esc(e.winner)}</strong></span>` : '';

  // Destacada (espejo de FeedRowView en iOS/Android): la misma fila con sus
  // clasificaciones complementarias debajo. Solo las vueltas por etapas las
  // tienen; una destacada sin complementarias se pinta como fila normal.
  const leaders = e._featured ? (e.leaders || []).map(c => {
    const dot = classificationColor(c)
      ? `<span class="feed-row__leader-dot" style="background:${classificationColor(c)}"></span>` : '';
    const winners = c.winners.map(w => esc(w.name)).join(' / ');
    return `<span class="feed-row__leader">${dot}<span class="feed-row__leader-label">${esc(classificationLabel(c, isEn ? 'en' : 'es'))}</span>${winners ? `<span class="feed-row__leader-name">${winners}</span>` : ''}</span>`;
  }).join('') : '';

  return `
      <a class="feed-row${e.isGcFinal ? ' feed-row--gc' : ''}${leaders ? ' feed-row--featured' : ''}" style="--card-color:${esc(color)}" href="${esc(e.href)}">
        ${leftCol}
        <span class="feed-row__main"><span class="feed-row__race">${name}</span>
          ${subHtml ? `<span class="feed-row__sub">${subHtml}</span>` : ''}
          ${winnerHtml}${leaders ? `<span class="feed-row__leaders">${leaders}</span>` : ''}</span>
        <span class="feed-row__chevron" aria-hidden="true">›</span>
      </a>`;
}

// ── Fila de ciclocross ─────────────────────────────────────────────
// Prueba CX con la estructura de la destacada de carretera: en lugar de las
// clasificaciones complementarias, una línea por categoría con su código y
// el ganador o la ganadora. La línea secundaria identifica torneo, manga y
// sede, como la tarjeta de Hoy de Ciclocross.
function cxEntryRowHtml(e, isEn, rounds) {
  const lang = isEn ? 'en' : 'es';
  const race = e.race, tournament = race.cx_tournaments;
  const logoUrl = race.logoUrl || tournament?.logoUrl;
  const national = race.class === 'CN';
  const logo = logoUrl
    ? `<img class="race-logo-img" src="${esc(logoUrl)}" alt="" loading="lazy" ${national ? `onerror="this.style.display='none'"` : LOGO_ONERROR}>`
    : (national ? '' : logoPlaceholderHtml('race-logo-img'));
  const flag = race.countryCode ? `<span class="feed-row__flag">${countryFlag(race.countryCode)}</span>` : '';
  const name = cxRaceName(race, lang);
  const sub = [tournament ? esc(cxRaceName(tournament, lang)) : '', cxRoundBadge(rounds?.get(race.id)), race.venue && race.venue !== name ? esc(race.venue) : ''].filter(Boolean).join(' · ');
  const leaders = e.categories.map(c => `<span class="feed-row__leader"><span class="feed-row__leader-label" title="${esc(t(`cx.category.${c.category}`))}">${esc(c.category)}</span><span class="feed-row__leader-name">${esc(c.winnerName)}</span></span>`).join('');
  return `
      <a class="feed-row feed-row--featured feed-row--cx" href="${esc(cxRacePageUrl(race, lang, 'results', e.categories[0].category))}">
        <span class="feed-row__logo">${logo}${flag}</span>
        <span class="feed-row__main"><span class="feed-row__race"><span class="feed-row__race-name">${esc(name)}</span></span>
          ${sub ? `<span class="feed-row__sub">${sub}</span>` : ''}
          <span class="feed-row__leaders">${leaders}</span></span>
        <span class="feed-row__chevron" aria-hidden="true">›</span>
      </a>`;
}

const dayHeaderText = (dk, locale) => {
  const [y, m, d] = dk.split('-').map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Días de carretera, en el orden de `entries`. */
export function feedDaysHtml(entries, isEn, locale) {
  let html = '';
  let curDate = null;
  for (const e of entries) {
    if (e.date !== curDate) {
      if (curDate !== null) html += '</div>';
      curDate = e.date;
      html += `<div class="feed-day"><div class="feed-day__hdr">${esc(dayHeaderText(e.date, locale))}</div>`;
    }
    html += entryRowHtml(e, isEn, locale);
  }
  if (curDate !== null) html += '</div>';
  return html;
}

/** Días de ciclocross, en el orden de `entries`. */
export function cxDaysHtml(entries, rounds, isEn, locale) {
  let html = '';
  let curDate = null;
  for (const e of entries) {
    if (e.date !== curDate) {
      if (curDate !== null) html += '</div></div>';
      curDate = e.date;
      html += `<div class="feed-day feed-day--cx"><div class="feed-day__hdr">${esc(dayHeaderText(e.date, locale))}</div><div class="feed-day__cx-grid">`;
    }
    html += cxEntryRowHtml(e, isEn, rounds);
  }
  if (curDate !== null) html += '</div></div>';
  return html;
}

export const feedEmptyHtml = isEn => `<div class="startlist-empty">${isEn
  ? 'No results in this period.' : 'No hay resultados en este periodo.'}</div>`;

export const cxEmptyHtml = (hasEntries, isEn) => `<div class="startlist-empty">${hasEntries
  ? (isEn ? 'No cyclocross results in this period.' : 'No hay resultados de ciclocross en este periodo.')
  : (isEn ? 'No cyclocross results this season.' : 'No hay resultados de ciclocross en esta temporada.')}</div>`;

export const feedMoreHtml = (id, isEn) => `<div class="feed-more-wrap"><button class="feed-more" id="${id}">${isEn ? 'Load more results' : 'Cargar más resultados'}</button></div>`;

// Conmutador Ciclocross / Carretera / Ránking (components/discipline-switch.js)
// mientras la home es Ciclocross; pestañas el resto del año. Carretera lleva la
// chincheta, como en Hoy: en contorno si está activa y llena si está fijada.
export const feedViews = cxTab => (cxTab ? ['cx', 'latest', 'ranking'] : ['latest', 'ranking']);

export function feedTabsHtml({ cxTab, activeView, pinned, isEn }) {
  const views = feedViews(cxTab);
  const viewLabels = {
    cx: isEn ? 'Cyclocross' : 'Ciclocross',
    latest: cxTab ? (isEn ? 'Road' : 'Carretera') : (isEn ? 'Latest Results' : 'Últimos resultados'),
    ranking: isEn ? 'UCI Ranking' : 'Ránking UCI',
  };
  const viewShortLabels = { cx: 'CX', latest: isEn ? 'Road' : 'Ruta', ranking: isEn ? 'Ranking' : 'Ránking' };
  if (cxTab) {
    return `<div class="discipline-switch feed-view-switch" role="group" aria-label="${isEn ? 'Results view' : 'Vista de resultados'}">${views.map((view) => {
      const active = activeView === view;
      const cls = `discipline-switch__option${active ? ' discipline-switch__option--active' : ''}`;
      const button = className => `<button type="button" class="${className}" aria-pressed="${active}" data-results-view="${view}"><span class="btn-label-full">${viewLabels[view]}</span><span class="btn-label-short">${viewShortLabels[view]}</span></button>`;
      if (view !== 'latest') return button(cls);
      return `<span class="${cls}">${button('discipline-switch__select')}${active || pinned ? roadPinButtonHtml(pinned) : ''}</span>`;
    }).join('')}</div>`;
  }
  return `
        <div class="feed-view-tabs" role="tablist" aria-label="${isEn ? 'Results view' : 'Vista de resultados'}">
          ${views.map(view => `<button class="feed-view-tab${activeView === view ? ' feed-view-tab--active' : ''}"
                  type="button" role="tab" aria-selected="${activeView === view}" data-results-view="${view}">
            ${viewLabels[view]}
          </button>`).join('')}
        </div>`;
}

export const feedHeroHtml = (tabs, isEn) => `
      <div class="feed-hero">
        <h1 class="sr-only">${isEn ? 'Results' : 'Resultados'}</h1>
        ${tabs}
      </div>`;

function tierClass(row) {
  switch (row.invitationTier) {
    case UciRankingTier.WORLD_TOUR: return 'uci-ranking-row--wt';
    case UciRankingTier.ALL_WORLD_TOUR:
    case UciRankingTier.WOMENS_WORLD_TOUR: return 'uci-ranking-row--orange';
    case UciRankingTier.PRO_SERIES: return 'uci-ranking-row--green';
    default: return '';
  }
}

/** Cuerpo del ránking UCI de un género. */
export function rankingBodyHtml(rows, rankingGender, isEn) {
  const _isEn = isEn;
  const locale = isEn ? 'en-GB' : 'es-ES';
  const selected = decorateUciRanking(rows, rankingGender);
  const updated = formatUciRankingUpdated(selected[0]?.rankingDate, _isEn);
  // Puntos enteros con separador de millares siempre: las cifras se alinean.
  const pointsFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: 'always' });
  // Explicación de cada etiqueta de puesto (columna izquierda en escritorio):
  // solo los niveles presentes en el ránking seleccionado.
  const rankingYear = Number(String(selected[0]?.rankingDate || '').slice(0, 4));
  const invitationYear = Number.isFinite(rankingYear) && rankingYear > 0 ? rankingYear + 1 : new Date().getFullYear() + 1;
  const keyItems = [
    ['wt', UciRankingTier.WORLD_TOUR, _isEn ? 'WorldTour licence' : 'Licencia WorldTour',
      _isEn ? 'Entitled and required to ride every UCI WorldTour race.' : 'Derecho y obligación de correr todas las pruebas UCI WorldTour.'],
    ['orange', UciRankingTier.ALL_WORLD_TOUR, _isEn ? 'All WorldTour' : 'Todo el WorldTour',
      _isEn ? `Invitation to every ${invitationYear} UCI WorldTour race, Grand Tours included, and every UCI ProSeries race.` : `Invitación a todas las pruebas UCI WorldTour de ${invitationYear}, Grandes Vueltas incluidas, y a todas las UCI ProSeries.`],
    ['orange', UciRankingTier.WOMENS_WORLD_TOUR, _isEn ? "Women's WorldTour" : "Women's WorldTour",
      _isEn ? `Invitation to every ${invitationYear} UCI Women's WorldTour race.` : `Invitación a todas las pruebas UCI Women's WorldTour de ${invitationYear}.`],
    ['green', UciRankingTier.PRO_SERIES, 'ProSeries',
      _isEn ? `Invitation to every ${invitationYear} UCI ProSeries race.` : `Invitación a todas las pruebas UCI ProSeries de ${invitationYear}.`],
  ].filter(([, tier]) => selected.some(row => row.invitationTier === tier));
  if (selected.some(row => row.grandTourExcluded)) {
    keyItems.push(['excluded', null, _isEn ? 'No Grand Tours' : 'Sin Grandes Vueltas',
      _isEn ? `Outside the overall top 30: not eligible for a ${invitationYear} Grand Tour wildcard.` : `Fuera del top-30 absoluto: sin opción a invitación para una Gran Vuelta de ${invitationYear}.`]);
  }
  const keyHtml = keyItems.length ? `<aside class="uci-ranking-key">
      <h3 class="uci-ranking-key__title">${_isEn ? `Invitations ${invitationYear}` : `Invitaciones ${invitationYear}`}</h3>
      ${keyItems.map(([cls, , label, text]) => `<div class="uci-ranking-key__item"><span class="uci-ranking-legend__item uci-ranking-legend__item--${cls}">${label}</span><p>${text}</p></div>`).join('')}
    </aside>` : '';
  const genderButtons = [
    ['male', _isEn ? 'Men' : 'Masculino'],
    ['female', _isEn ? 'Women' : 'Femenino'],
  ].map(([value, label]) => `
    <button class="feed-view-tab${value === rankingGender ? ' feed-view-tab--active' : ''}"
            type="button" data-ranking-gender="${value}">${label}</button>`).join('');
  const rowsHtml = selected.map((row) => {
    const rule = uciRankingRuleText(row, _isEn);
    const classes = [
      'uci-ranking-row',
      tierClass(row),
      row.grandTourExcluded ? 'uci-ranking-row--excluded' : '',
      rule ? 'uci-ranking-row--explained' : '',
    ].filter(Boolean).join(' ');
    return `
      <div class="${classes}"${rule ? ` tabindex="0" role="button" aria-expanded="false" data-tooltip="${esc(rule)}"` : ''}>
        <span class="uci-ranking-row__rank">${esc(String(row.rank))}</span>
        <span class="uci-ranking-row__flag">${countryFlag(row.countryCode)}</span>
        <span class="uci-ranking-row__team">${esc(row.displayName || row.sourceName)}</span>
        <span class="uci-ranking-row__category">${esc(row.teamCategory || '')}</span>
        <span class="uci-ranking-row__points">${esc(pointsFormat.format(Number(row.points)))}</span>
      </div>`;
  }).join('');
  const body = `
    <section class="uci-ranking">
      <h2 class="sr-only">${_isEn ? 'UCI Team Ranking' : 'Ránking UCI por equipos'}</h2>
      <div class="uci-ranking-bar">
        <div class="feed-view-tabs uci-ranking-gender-tabs" aria-label="${_isEn ? 'Ranking gender' : 'Género del ránking'}">
          ${genderButtons}
        </div>
        <p class="uci-ranking-updated">${esc(updated)}</p>
      </div>
      <div class="uci-ranking-layout">
      ${keyHtml}
      <!-- Sin role="table": las filas son <div> sin role="row"/"cell" y
           además llevan botones e imágenes dentro, así que el rol prometía
           una estructura de tabla que el marcado no cumple y el lector la
           anunciaba rota. Se conserva el nombre accesible como grupo. -->
      <div class="uci-ranking-table" role="group" aria-label="${_isEn ? 'UCI team ranking' : 'Ránking UCI por equipos'}">
        <div class="uci-ranking-table__head">
          <span>#</span><span></span><span>${_isEn ? 'Team' : 'Equipo'}</span><span>${_isEn ? 'Cat.' : 'Cat.'}</span><span>${_isEn ? 'Points' : 'Puntos'}</span>
        </div>
        ${rowsHtml || `<div class="startlist-empty">${_isEn ? 'Ranking not available.' : 'Ránking no disponible.'}</div>`}
      </div>
      </div>
    </section>`;
  return body;
}
