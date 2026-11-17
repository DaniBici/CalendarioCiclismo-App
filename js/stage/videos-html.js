// HTML de los vídeos de una jornada de carretera, sin DOM: panel Vídeos de la
// jornada (acordeón, docs/plans/videos-5-2.md D10) y lista de la columna de
// clasificaciones. Lo usan el navegador y el publicador; el marcado no depende
// del dispositivo (la huella del HTML generado debe coincidir).
import { esc } from '../shared.js';
import { t, getLang } from '../i18n.js';
import { extractYouTubeId, getBroadcastEmbed } from '../broadcast-embed.js';

/** Rótulo del vídeo: las emisiones convertidas, según el formato de la carrera. */
export function videoEntryTitle(entry, race, lang = getLang()) {
  if (entry.converted) return t(race?.raceFormat === 'one_day' ? 'videos.raceBroadcast' : 'videos.stageBroadcast');
  return lang === 'en' ? (entry.titleEn || entry.title || '') : (entry.title || '');
}

const PLATFORMS = [
  [/(^|\.)rtve\.es$/, 'RTVE Play'],
  [/(^|\.)(etbon\.eus|eitb\.eus)$/, 'ETB On'],
  [/(^|\.)raiplay\.it$/, 'RaiPlay'],
  [/(^|\.)rtbf\.be$/, 'Auvio'],
  [/(^|\.)(hbomax\.com|max\.com)$/, 'HBO Max'],
  [/(^|\.)sporza\.be$/, 'Sporza'],
  [/(^|\.)vrt\.be$/, 'VRT MAX'],
  [/(^|\.)rtp\.pt$/, 'RTP Play'],
  [/(^|\.)(3cat\.cat|ccma\.cat)$/, '3Cat'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)(facebook\.com|fb\.watch)$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'X'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
];

/** Plataforma del enlace externo («RTVE Play ↗»): nombre conocido o el dominio. */
export function videoPlatformLabel(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  return PLATFORMS.find(([pattern]) => pattern.test(host))?.[1] || host.replace(/^www\./, '');
}

/** URL del reproductor insertado, o null si el vídeo se abre fuera (proveedor sin inserción o embeddable false). */
export function videoEmbedSrc(entry) {
  const embed = getBroadcastEmbed(entry?.url, entry?.embeddable ?? null);
  if (!embed) return null;
  if (embed.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${extractYouTubeId(entry.url)}?playsinline=1`;
  return embed.src;
}

// Mismos atributos que el reproductor que crea js/stage/videos-panel.js.
export function videoFrameHtml(src, title) {
  return `<iframe class="video-frame" src="${esc(src)}" title="${esc(title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

const textHtml = (title, channel) => `<span class="video-row__text"><span class="video-row__title">${esc(title)}</span>${channel ? `<span class="video-row__channel">${esc(channel)}</span>` : ''}</span>`;

function externalRowHtml(entry, title, region) {
  return `<div class="video-row video-row--external" data-kind="${esc(entry.kind)}"${region}>${textHtml(title, entry.channel)}<a class="video-link" href="${esc(entry.url)}" target="_blank" rel="noopener">${esc(videoPlatformLabel(entry.url))} ↗&#xFE0E;</a></div>`;
}

/**
 * Filas del acordeón de vídeos, en el orden de la regla común. Insertables en
 * acordeón exclusivo (<details name>): el primero nace abierto con su
 * reproductor, sin arrancar; el resto lo crea js/stage/videos-panel.js al
 * abrir. Externos: fila con «<plataforma> ↗». `withRegion`: cada fila
 * restringida lleva su grupo (data-country) para que el navegador oculte las
 * que el visitante no ve (applyVideoRegion); el HTML no depende de la región.
 * `openFirst: false`: ninguna nace abierta ni con reproductor (tarjetas de la
 * sección Vídeos, que abren la primera al desplegarse).
 */
export function videoRowsHtml(entries, race, { withRegion = false, openFirst = true } = {}) {
  let first = openFirst;
  return entries.map(entry => {
    const title = videoEntryTitle(entry, race);
    const src = videoEmbedSrc(entry);
    const region = withRegion && entry.country && entry.country !== 'ALL' ? ` data-country="${esc(entry.country)}"` : '';
    if (!src) return externalRowHtml(entry, title, region);
    const frameTitle = entry.channel ? `${title} · ${entry.channel}` : title;
    const open = first;
    first = false;
    return `<details class="video-fold" name="videos-jornada" data-src="${esc(src)}" data-title="${esc(frameTitle)}" data-kind="${esc(entry.kind)}"${region}${open ? ' open' : ''}>`
      + `<summary class="video-row">${textHtml(title, entry.channel)}<span class="video-row__action"><span class="video-fold__ver">${t('stage.watch')}</span></span></summary>`
      + `<div class="video-fold__body">${open ? videoFrameHtml(src, frameTitle) : ''}</div></details>`;
  }).join('');
}

/**
 * Panel Vídeos de la jornada (acordeón de videoRowsHtml). `extra`: panel de la
 * mampostería de la jornada (data-profile-extra, js/stage/profile.js).
 */
export function stageVideosPanelHtml(entries, race, { extra = false } = {}) {
  if (!entries?.length) return '';
  return `<section class="jornada-section video-panel" id="videos"${extra ? ' data-profile-extra="side"' : ''}><header class="stage-profile-heading"><h2>${t('videos.title')}</h2></header><div class="video-list">${videoRowsHtml(entries, race)}</div></section>`;
}

/**
 * Vídeos de la columna de clasificaciones: el mismo acordeón que la jornada,
 * sin filtrar por región (data-country en las filas restringidas).
 */
export function stageVideosContextHtml(entries, race) {
  if (!entries?.length) return '';
  return `<section class="res-videos video-panel"><header class="stage-profile-heading"><h2>${t('videos.title')}</h2></header><div class="video-list">${videoRowsHtml(entries, race, { withRegion: true })}</div></section>`;
}
