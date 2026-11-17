// Entradas de la sección Vídeos (docs/plans/videos-5-2.md, fase 5), sin DOM: lo
// usan el navegador y el publicador. Una lista por día en orden cronológico
// inverso, por disciplina: carretera en el orden canónico de Hoy y ciclocross
// en el de la agenda CX. Carretera llega de video_feed_days (jornadas con
// vídeos propios o, con clasificaciones propias, con emisiones de Revive); CX,
// de la temporada ya leída, con cxRaceMedia() por prueba y día. Cada entrada
// lleva sus vídeos y las emisiones de Revive que no están en ellos: una carrera
// sin vídeos pero con Revive también sale (decisión de Dani, 2026-11-11).
import { stageMediaState } from './stage-videos.js';
import { categoryRank, genderRank, grandTourRank, tsSeconds } from './race-order.js';
import { compareChampionships } from '../campeonatos-config.js';
import { cxCategories, cxCategoryDate, cxCategoryRank, cxDayRaces, cxRaceMedia } from '../cx/presentation.js';

/** Jornadas de carretera de [fromKey, toKey]; con fromKey null, solo el último día con contenido. */
export async function fetchRoadVideoDays(client, fromKey, toKey) {
  // GET con fechas: la función es STABLE y la copia breve del proxy del VPS la
  // sirve a todos. El ancla (fromKey null) va por POST: en GET el nulo llegaría
  // como texto.
  const { data, error } = await client.rpc('video_feed_days', { p_from: fromKey, p_to: toKey }, fromKey ? { get: true } : undefined);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// Orden canónico de Hoy entre carreras (espejo de cmpEntries de
// result-feed-entries.js): Campeonatos Nacionales, gran vuelta, categoría,
// género, hora de salida y nombre.
function compareRoad(a, b) {
  const cn = compareChampionships(a.race, a.rd, b.race, b.rd);
  if (cn != null && cn !== 0) return cn;
  return (grandTourRank(a.race) - grandTourRank(b.race))
    || (categoryRank(a.race.uciCategory, a.race.name, a.race.countryCode) - categoryRank(b.race.uciCategory, b.race.name, b.race.countryCode))
    || (genderRank(a.race.gender) - genderRank(b.race.gender))
    || ((tsSeconds(a.rd.neutralStartTimeUtc) ?? Infinity) - (tsSeconds(b.rd.neutralStartTimeUtc) ?? Infinity))
    || String(a.race.name || '').localeCompare(String(b.race.name || ''));
}

/**
 * Entradas de carretera: una por jornada con algún vídeo o emisión de Revive
 * visible en la región (`filter`, la regla de filterBroadcastsByRegion), con
 * sus vídeos en el orden de la regla común y el Revive restante.
 */
export function roadVideoEntries(days, filter) {
  return (days || []).flatMap(day => {
    const media = stageMediaState({ broadcasts: filter(day.broadcasts || []), videos: filter(day.videos || []),
      hasResults: (day.broadcasts || []).length > 0, isCancelled: !!day.isCancelledDay });
    const revive = media.revive.filter(broadcast => broadcast.url);
    if ((!media.entries.length && !revive.length) || !day.race) return [];
    const { race, videos: _v, broadcasts: _b, ...rd } = day;
    return [{ discipline: 'road', date: day.dateKey, race, rd, videos: media.entries, revive }];
  });
}

// Tipo de un vídeo CX (carrera completa, resumen, meta y el resto). cx_videos
// no guarda el tipo: sale de la convención de títulos de la skill
// cc-cx-carreras («Carrera completa …», «Resumen …», «Meta …»); las emisiones
// de YouTube convertidas llegan marcadas con fullRace.
const CX_KIND_RANK = { full: 0, summary: 1, last_km: 2, other: 3 };
export function cxVideoKind(video) {
  if (video.fullRace) return 'full';
  const title = String(video.title || '').trim().toLowerCase();
  if (/^(carrera completa|retransmisión completa)/.test(title)) return 'full';
  if (/^resumen/.test(title)) return 'summary';
  if (/^meta\b/.test(title)) return 'last_km';
  return 'other';
}
// Orden de los vídeos de una tarjeta CX (decisión de Dani, 2026-11-14): las
// emisiones convertidas en «Carrera completa» siempre al final; delante, por
// categoría (ME, WE, MU, WU, MJ, WJ) y, dentro de cada una, por tipo y después
// el orden recibido. Las emisiones, por categoría.
const byCxOrder = videos => videos.map((video, index) => ({ video, index }))
  .sort((a, b) => (Number(!!a.video.fullRace) - Number(!!b.video.fullRace))
    || (cxCategoryRank(a.video.category) - cxCategoryRank(b.video.category))
    || (CX_KIND_RANK[cxVideoKind(a.video)] - CX_KIND_RANK[cxVideoKind(b.video)])
    || (a.index - b.index))
  .map(({ video }) => video);

/**
 * Entradas de ciclocross: una por prueba y día con vídeos o Revive. La fecha de
 * cada vídeo o emisión es la de su categoría o, sin categoría, la de la prueba;
 * una prueba de varios días sale en cada día con contenido. `filter`: emisiones
 * visibles en la región (las convertidas en «Carrera completa» y Revive).
 */
export function cxVideoEntries(races, filter) {
  const entries = [];
  for (const race of races || []) {
    if (race.isCancelled) continue;
    const categories = cxCategories(race);
    const results = categories.filter(c => ['official', 'provisional'].includes(c.resultsStatus)).map(c => ({ category: c.category }));
    const broadcasts = race.cx_broadcasts || [];
    const { videos, revive } = cxRaceMedia(race, categories, broadcasts, race.cx_videos || [], { results, visibleBroadcasts: filter(broadcasts) });
    if (!videos.length && !revive.length) continue;
    const byCode = new Map(categories.map(c => [c.category, c]));
    const byDate = new Map();
    const add = (row, key) => {
      const category = row.category ? byCode.get(row.category) : null;
      const date = category ? cxCategoryDate(race, category) : race.dateKey;
      if (!byDate.has(date)) byDate.set(date, { videos: [], revive: [] });
      byDate.get(date)[key].push(row);
    };
    videos.forEach(video => add(video, 'videos'));
    revive.forEach(row => add(row, 'revive'));
    // Vídeos por categoría y tipo, con las emisiones al final; el Revive llega
    // ya por categoría de cxRaceMedia.
    for (const [date, lists] of byDate) entries.push({ discipline: 'cx', date, race, videos: byCxOrder(lists.videos), revive: lists.revive });
  }
  return entries;
}

/**
 * Días de [fromKey, toKey] en orden cronológico inverso: [{ date, entries }],
 * con carretera en el orden de Hoy y ciclocross en el de la agenda CX.
 */
export function videoFeedDays(roadEntries, cxEntries, { fromKey, toKey }) {
  const inWindow = entry => (!fromKey || entry.date >= fromKey) && (!toKey || entry.date <= toKey);
  const dates = [...new Set([...roadEntries, ...cxEntries].filter(inWindow).map(entry => entry.date))].sort().reverse();
  return dates.map(date => {
    const road = roadEntries.filter(entry => entry.date === date).sort(compareRoad);
    const cxOfDay = cxEntries.filter(entry => entry.date === date);
    const order = cxDayRaces(cxOfDay.map(entry => entry.race), date);
    const cx = [...cxOfDay].sort((a, b) => {
      const ia = order.indexOf(a.race), ib = order.indexOf(b.race);
      return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
    });
    return { date, entries: [...road, ...cx] };
  });
}

/** Último día con vídeos hasta `toKey` entre carretera (ancla de la RPC) y ciclocross. */
export function latestVideoDate(roadAnchorDays, cxEntries, toKey) {
  const dates = [...(roadAnchorDays || []).map(day => day.dateKey), ...cxEntries.map(entry => entry.date)]
    .filter(date => date && date <= toKey);
  return dates.length ? dates.sort().at(-1) : null;
}
