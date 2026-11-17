// ─────────────────────────────────────────────────────────────────
//  Vídeos de una jornada de carretera (docs/plans/videos-5-2.md, fase 2)
//
//  Regla común, sin DOM: la usan la jornada, la columna de clasificaciones, la
//  tarjeta terminada, la sección Vídeos y el publicador. Espejo en iOS
//  (StageVideoLogic.swift) y Android (StageVideoLogic.kt).
//
//  Entradas: emisiones y vídeos (race_day_videos) ya filtrados por región y si
//  la jornada tiene clasificaciones propias.
//  - Emisión convertida: emisión de Revive de la jornada con clasificaciones
//    propias, de YouTube con vídeo fijo y `embeddable` distinto de false. Pasa a
//    Vídeos como «Emisión de la etapa/carrera» (tipo full) y sale de Revive.
//  - Orden: emisión completa, resumen, último kilómetro y el resto; dentro de
//    cada tipo, sortOrder (en full, primero race_day_videos y después las
//    convertidas). El mismo vídeo (ID de YouTube o URL normalizada) aparece una
//    vez; se conserva la fila de race_day_videos.
// ─────────────────────────────────────────────────────────────────

import { extractYouTubeId } from '../broadcast-embed.js';
import { isReviveBroadcast, reviveBroadcastsForDay } from '../broadcast-priority.js';

const KIND_RANK = { full: 0, summary: 1, last_km: 2, other: 3 };

/** Columnas de race_day_videos que leen web y publicador. */
export const RACE_DAY_VIDEO_COLUMNS = 'id,raceDayId,kind,title,titleEn,channel,url,embeddable,country,sortOrder,updatedAt';
export const VIDEO_KINDS = Object.keys(KIND_RANK);

/** Clave de identidad de un vídeo: ID de YouTube o URL sin protocolo, www, fragmento ni barra final. */
export function videoKey(url) {
  if (!url) return '';
  const yt = extractYouTubeId(url);
  if (yt) return `yt:${yt}`;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

/** Emisión de YouTube con vídeo fijo que admite inserción (la condición de conversión, sin la jornada). */
export function isConvertibleBroadcast(broadcast) {
  return !!broadcast?.url && broadcast.embeddable !== false && !!extractYouTubeId(broadcast.url);
}

/** Emisiones convertidas de la jornada, en su orden. */
export function convertedBroadcasts(broadcasts, { hasResults = false, isCancelled = false } = {}) {
  if (!hasResults) return [];
  return reviveBroadcastsForDay(broadcasts, isCancelled).filter(isConvertibleBroadcast);
}

const kindOf = kind => (Object.hasOwn(KIND_RANK, kind) ? kind : 'other');

/**
 * Vídeos de la jornada en el orden de presentación. Cada entrada:
 * { source: 'video'|'broadcast', id, kind, title, titleEn, channel, url,
 *   embeddable, country, sortOrder, converted }. Las convertidas llevan
 * title null: el rótulo depende del formato de la carrera.
 */
export function stageVideoEntries({ broadcasts = [], videos = [], hasResults = false, isCancelled = false } = {}) {
  const own = (videos || []).filter(video => video?.url).map(video => ({
    source: 'video', id: video.id, kind: kindOf(video.kind), title: video.title || '', titleEn: video.titleEn || null,
    channel: video.channel || null, url: video.url, embeddable: video.embeddable ?? null, country: video.country ?? null,
    sortOrder: video.sortOrder ?? 0, converted: false,
  }));
  const converted = convertedBroadcasts(broadcasts, { hasResults, isCancelled }).map(broadcast => ({
    source: 'broadcast', id: broadcast.id, kind: 'full', title: null, titleEn: null,
    channel: broadcast.channel || null, url: broadcast.url, embeddable: broadcast.embeddable ?? null, country: broadcast.country ?? null,
    sortOrder: broadcast.sortOrder ?? 0, converted: true,
  }));
  const ordered = [...own, ...converted].sort((a, b) =>
    (KIND_RANK[a.kind] - KIND_RANK[b.kind])
    || ((a.converted ? 1 : 0) - (b.converted ? 1 : 0))
    || (a.sortOrder - b.sortOrder));
  const seen = new Set();
  return ordered.filter(entry => {
    const key = videoKey(entry.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Estado de Revive y Vídeos de la jornada: `entries` (vídeos), `revive`
 * (emisiones de Revive que no están en Vídeos) y `hasRevive` (la jornada tiene
 * clasificaciones propias y le queda alguna emisión de Revive con enlace).
 */
export function stageMediaState({ broadcasts = [], videos = [], hasResults = false, isCancelled = false } = {}) {
  const entries = stageVideoEntries({ broadcasts, videos, hasResults, isCancelled });
  const keys = new Set(entries.map(entry => videoKey(entry.url)));
  const revive = reviveBroadcastsForDay(broadcasts, isCancelled).filter(broadcast => !keys.has(videoKey(broadcast.url)));
  return { entries, revive, hasRevive: hasResults === true && revive.some(broadcast => !!broadcast.url) };
}

/** Emisión que abre Revive en la tarjeta terminada: redes sociales antes que el resto, después sortOrder. */
export function cardReviveBroadcast(broadcasts) {
  const social = url => (/youtube\.com|youtu\.be|facebook\.com/i.test(url || '') ? 0 : 1);
  return (broadcasts || [])
    .filter(isReviveBroadcast)
    .sort((a, b) => (social(a.url) - social(b.url)) || ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)))[0] ?? null;
}

/**
 * Destinos de la tarjeta terminada (decisión de Dani, 2026-11-11): { videos,
 * revive }. `videos`: la jornada tiene vídeos propios (race_day_videos de la
 * región) distintos de Revive, y la tarjeta lleva a su panel Vídeos; `revive`:
 * la emisión íntegra. Con los dos, menú «Vídeos» / «Completa».
 */
export function cardVideoActions({ broadcasts = [], videos = [] } = {}) {
  const revive = cardReviveBroadcast(broadcasts);
  const reviveWithUrl = revive?.url ? revive : null;
  const reviveKey = reviveWithUrl ? videoKey(reviveWithUrl.url) : null;
  const hasVideos = (videos || []).some(video => video?.url && videoKey(video.url) !== reviveKey);
  return { videos: hasVideos, revive: reviveWithUrl };
}
