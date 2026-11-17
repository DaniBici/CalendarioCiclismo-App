// HTML de la sección Vídeos (docs/plans/videos-5-2.md, fase 5), sin DOM: lo
// usan el navegador y el publicador. Días con cabecera, como Últimos
// resultados; cada carrera es una tarjeta que se despliega hacia abajo al
// pulsarla (decisiones de Dani, 2026-11-11) con el acordeón de vídeos de la
// jornada: la primera fila se abre al desplegar, sin reproducción automática,
// y el resto se despliega, y después las emisiones de Revive que no están en
// Vídeos, como filas externas. Plegada, la tarjeta muestra solo la carrera (logo
// y bandera, nombre y línea secundaria) y una flecha hacia abajo. Una carrera
// sin vídeos y con una sola emisión de Revive no se despliega: lleva el botón
// de la emisión («Emisión ↗»); con varias, se despliega con todas (decisión de
// Dani, 2026-11-11). Sin ganador ni miniatura (D6). Al pie de la desplegada, el
// enlace a la jornada o a la ficha CX.
import { esc, jornadaUrl } from './shared.js';
import { t } from './i18n.js';
import { cxRacePageUrl } from './cx/presentation.js';
import { cardReviveBroadcast } from './services/stage-videos.js';
import { cxRowHead, dayHeaderText, roadRowHead, roadRowSubHtml } from './resultados-feed-html.js';
import { cxVideoKind } from './services/video-feed-entries.js';
import { roadPinButtonHtml } from './components/discipline-switch.js';
import { videoRowsHtml } from './stage/videos-html.js';

const CHEVRON_DOWN = '<svg class="video-card__chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

function cardHtml({ color, leftCol, name, sub, rows, href, goLabel, cx = false, full = null }) {
  const style = color ? ` style="--card-color:${esc(color)}"` : '';
  // Sin vídeos: la emisión de Revive, sin desplegar.
  if (!rows) {
    const label = full.channel ? `${t('videos.broadcast')} · ${full.channel}` : t('videos.broadcast');
    return `
      <div class="video-card video-card--static${cx ? ' video-card--cx' : ''}"${style}>
        <div class="feed-row feed-row--videos">
          ${leftCol}
          <span class="feed-row__main"><span class="feed-row__race">${name}</span>
            ${sub ? `<span class="feed-row__sub">${sub}</span>` : ''}</span>
          <a class="video-link video-card__full" href="${esc(full.url)}" target="_blank" rel="noopener" title="${esc(label)}" aria-label="${esc(label)}">${esc(t('videos.broadcast'))} ↗&#xFE0E;</a>
        </div>
      </div>`;
  }
  return `
      <details class="video-card${cx ? ' video-card--cx' : ''}" name="videos-feed"${style}>
        <summary class="feed-row feed-row--videos">
          ${leftCol}
          <span class="feed-row__main"><span class="feed-row__race">${name}</span>
            ${sub ? `<span class="feed-row__sub">${sub}</span>` : ''}</span>
          ${CHEVRON_DOWN}
        </summary>
        <div class="video-card__body"><div class="video-list">${rows}</div><a class="video-card__go" href="${esc(href)}">${esc(goLabel)} ›</a></div>
      </details>`;
}

// Emisiones de Revive como filas del acordeón: con el rótulo de la emisión
// completa y su canal; las que no se insertan, como enlace externo.
const reviveEntry = (broadcast, title = null) => ({
  kind: 'full', title, titleEn: title, channel: broadcast.channel || null, url: broadcast.url,
  embeddable: broadcast.embeddable ?? null, converted: title == null,
});

function roadCardHtml(entry, isEn, locale) {
  const { race, rd } = entry;
  const { leftCol, name, color } = roadRowHead(race, rd);
  const revive = entry.revive || [];
  const all = [...entry.videos, ...revive.map(broadcast => reviveEntry(broadcast))];
  // Sin vídeos y una sola emisión: botón «Emisión ↗»; si no, acordeón.
  const expandable = entry.videos.length > 0 || revive.length > 1;
  return cardHtml({
    color, leftCol, name,
    sub: roadRowSubHtml(rd, race, { sn: rd.stageNumber, suffix: rd.stageSuffix || '', isEn, locale }),
    rows: expandable ? videoRowsHtml(all, race, { openFirst: false }) : '',
    full: expandable ? null : cardReviveBroadcast(revive),
    href: `${jornadaUrl(rd)}#videos`,
    goLabel: t(race.raceFormat === 'one_day' ? 'videos.goRace' : 'videos.goStage'),
  });
}

function cxCardHtml(entry, isEn, rounds) {
  const lang = isEn ? 'en' : 'es';
  const { logo, flag, name, sub } = cxRowHead(entry.race, isEn, rounds);
  // Vídeos de la ficha CX con la forma y el orden por tipo de carretera;
  // Revive, al final, con el rótulo de la carrera completa de su categoría.
  const videos = entry.videos.map(video => ({ kind: cxVideoKind(video), title: video.title, titleEn: video.titleEn, channel: video.channel || null, url: video.url, embeddable: null, converted: false }));
  const revive = (entry.revive || []).map(row => reviveEntry(row,
    row.category ? t('cx.fullRace', { category: t(`cx.category.${row.category}`) }) : t('cx.fullBroadcast')));
  return cardHtml({
    cx: true,
    leftCol: `<span class="feed-row__logo">${logo}${flag}</span>`,
    name: `<span class="feed-row__race-name">${esc(name)}</span>`,
    sub,
    rows: videos.length || revive.length > 1 ? videoRowsHtml([...videos, ...revive], entry.race, { openFirst: false }) : '',
    full: videos.length || revive.length > 1 ? null : entry.revive[0],
    href: cxRacePageUrl(entry.race, lang, 'videos'),
    goLabel: t('videos.goCx'),
  });
}

/** Días de videoFeedDays(): cabecera y tarjetas en una sola columna centrada, como en las apps. */
export function videoDaysHtml(days, { isEn, locale, rounds = null }) {
  return days.map(day => `<div class="feed-day feed-day--videos"><div class="feed-day__hdr">${esc(dayHeaderText(day.date, locale))}</div>${day.entries.map(entry =>
    entry.discipline === 'cx' ? cxCardHtml(entry, isEn, rounds) : roadCardHtml(entry, isEn, locale)).join('')}</div>`).join('');
}

/**
 * Conmutador Ciclocross / Carretera («CX | Ruta» hasta 600 px), como el de
 * Resultados (decisión de Dani, 2026-11-11): botones con aria-pressed; Carretera
 * lleva la chincheta de la disciplina predeterminada (cc_default_discipline).
 */
export function videosSwitchHtml({ view, pinned, isEn }) {
  const labels = { cx: [isEn ? 'Cyclocross' : 'Ciclocross', 'CX'], road: [isEn ? 'Road' : 'Carretera', isEn ? 'Road' : 'Ruta'] };
  return `<div class="discipline-switch feed-view-switch" role="group" aria-label="${isEn ? 'Discipline' : 'Disciplina'}">${['cx', 'road'].map(key => {
    const active = view === key;
    const cls = `discipline-switch__option${active ? ' discipline-switch__option--active' : ''}`;
    const button = className => `<button type="button" class="${className}" aria-pressed="${active}" data-videos-view="${key}"><span class="btn-label-full">${labels[key][0]}</span><span class="btn-label-short">${labels[key][1]}</span></button>`;
    if (key !== 'road') return button(cls);
    return `<span class="${cls}">${button('discipline-switch__select')}${active || pinned ? roadPinButtonHtml(pinned) : ''}</span>`;
  }).join('')}</div>`;
}

export const videosHeroHtml = (switchHtml = '') => `
      <div class="feed-hero">
        <h1 class="sr-only">${t('videos.pageTitle')}</h1>
        ${switchHtml}
      </div>`;

export const videosEmptyHtml = (isEn, cx = false) => `<div class="startlist-empty">${cx
  ? (isEn ? 'No cyclocross videos in this period.' : 'No hay vídeos de ciclocross en este periodo.')
  : (isEn ? 'No road videos in this period.' : 'No hay vídeos de carretera en este periodo.')}</div>`;

export const videosMoreHtml = isEn => `<div class="feed-more-wrap"><button class="feed-more" id="videosMoreBtn">${isEn ? 'Load more races' : 'Cargar más carreras'}</button></div>`;
