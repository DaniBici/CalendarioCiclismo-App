import { createHash } from 'node:crypto';

export const ETBON_ORIGIN = 'https://etbon.eus';
export const ETBON_PAGE_URLS = Object.freeze([`${ETBON_ORIGIN}/api/v1/pages/kirolak-on`]);
export const ETBON_TIME_ZONE = 'Europe/Madrid';

const CYCLING_RE = /\b(?:txirrindularitza|ciclismo|cycling)\b/i;
// Resúmenes, repeticiones y magazines no son la retransmisión del directo.
const REPLAY_RE = /\b(?:laburpena|errepikapena|errepikatua|onena|resumen|repetici[oó]n|diferido|highlights?)\b/i;
const STAGE_PATTERNS = [
  /\b(?:etapa|stage|jardunaldia)\s*(\d{1,2})\b/i,
  /\b(\d{1,2})\s*\.?\s*(?:etapa|stage|jardunaldia)\b/i,
];
const MIN_DURATION_SECONDS = 30 * 60;
const MAX_MEDIA_REQUESTS = 60;
// La emisión lineal puede entrar unos minutos antes que el directo de ETB On.
const LINEAR_EARLY_TOLERANCE_MS = 15 * 60_000;
const LINEAR_SAME_START_MS = 5 * 60_000;
const DEFAULT_LIVE_WINDOW_MS = 4 * 60 * 60_000;
const LINEAR_STOP_WORDS = new Set(['txirrindularitza', 'ciclismo', 'etapa', 'km']);

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function fold(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function parseStageNumber(value) {
  for (const pattern of STAGE_PATTERNS) {
    const match = String(value || '').match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function dateKeyInZone(value, timeZone = ETBON_TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseJson(payload, label) {
  if (payload && typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error(`ETB On devolvió un JSON no válido para ${label}`);
  }
}

export function etbonMediaApiUrl(slug) {
  return `${ETBON_ORIGIN}/api/v1/media/${encodeURIComponent(slug)}`;
}

export function etbonMediaUrl(slug) {
  return `${ETBON_ORIGIN}/m/${slug}`;
}

export function isEtbonMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'etbon.eus' && /^\/m\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

// Recorre la página de Kirolak On y devuelve los medios que pueden ser un
// directo de ciclismo: todos los directos anunciados y cualquier contenido
// cuyo slug o título declare la disciplina.
export function parseEtbonPageSlugs(payload) {
  const page = parseJson(payload, 'la página de Kirolak On');
  if (!Array.isArray(page?.children)) {
    throw new Error('ETB On no devolvió una página de Kirolak On reconocible');
  }
  const slugs = new Set();
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node.slug === 'string' && ['live', 'vod'].includes(node.type)) {
      if (node.type === 'live' || CYCLING_RE.test(`${node.slug} ${node.title || ''}`)) slugs.add(node.slug);
    }
    if (node.first_episode?.slug && CYCLING_RE.test(`${node.first_episode.slug} ${node.first_episode.title || ''}`)) {
      slugs.add(node.first_episode.slug);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(page.children);
  return [...slugs];
}

function isCyclingMedia(media) {
  const tags = Array.isArray(media.tags) ? media.tags : [];
  if (tags.some((tag) => tag?.slug === 'txirrindularitza')) return true;
  return CYCLING_RE.test(`${media.slug} ${media.title || ''} ${media.season_data?.series_title || ''}`);
}

// Convierte la ficha pública de un medio en un evento. Solo acepta directos o
// su grabación íntegra posterior (mismo slug), nunca resúmenes ni piezas cortas.
export function parseEtbonMedia(payload) {
  const media = parseJson(payload, 'un medio');
  if (typeof media?.slug !== 'string' || !['live', 'vod'].includes(media.type)) return null;
  if (!isCyclingMedia(media)) return null;
  const seriesTitle = String(media.season_data?.series_title || '').trim();
  const episodeTitle = String(media.title || '').trim();
  if (REPLAY_RE.test(`${seriesTitle} ${episodeTitle}`)) return null;
  const start = new Date(media.start_date);
  if (!media.start_date || Number.isNaN(start.getTime())) return null;
  const duration = Number(media.duration);
  if (Number.isFinite(duration) && duration > 0 && duration < MIN_DURATION_SECONDS) return null;
  const end = media.end_date ? new Date(media.end_date) : null;
  const title = seriesTitle && !fold(episodeTitle).includes(fold(seriesTitle))
    ? `${seriesTitle} · ${episodeTitle}`
    : episodeTitle || seriesTitle;
  return {
    source: 'eitb',
    externalEventId: hash(`etbon|${media.slug}`),
    dateKey: dateKeyInZone(start),
    title,
    subtitle: episodeTitle || null,
    seriesTitle: seriesTitle || null,
    stageNumber: parseStageNumber(episodeTitle) ?? parseStageNumber(title),
    startTimeUtc: start.toISOString(),
    endTimeUtc: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
    mediaType: media.type,
    slug: media.slug,
    siblingSlugs: (Array.isArray(media.siblings) ? media.siblings : [])
      .map((item) => item?.slug).filter((slug) => typeof slug === 'string'),
    sourceChannel: 'ETB On',
    channel: 'EITB',
    country: 'ES',
    sourceUrl: etbonMediaApiUrl(media.slug),
    broadcastUrl: etbonMediaUrl(media.slug),
  };
}

export async function collectEtbon({
  fetcher,
  dateKeys,
  pageUrls = ETBON_PAGE_URLS,
  maxMediaRequests = MAX_MEDIA_REQUESTS,
} = {}) {
  if (typeof fetcher !== 'function' || !Array.isArray(dateKeys) || !dateKeys.length) {
    throw new TypeError('collectEtbon requiere fetcher y al menos una fecha');
  }
  const queue = [];
  for (const url of pageUrls) queue.push(...parseEtbonPageSlugs(await fetcher(url)));
  const seen = new Set();
  const events = new Map();
  let requests = 0;
  let failedMedia = 0;
  while (queue.length && requests < maxMediaRequests) {
    const slug = queue.shift();
    if (seen.has(slug)) continue;
    seen.add(slug);
    requests += 1;
    let event = null;
    try {
      event = parseEtbonMedia(await fetcher(etbonMediaApiUrl(slug)));
    } catch {
      // Una ficha retirada o inválida no invalida el resto de directos.
      failedMedia += 1;
    }
    if (!event) continue;
    // Las demás etapas de la temporada cuelgan del mismo medio aunque la
    // página ya no las destaque.
    for (const sibling of event.siblingSlugs) if (!seen.has(sibling)) queue.push(sibling);
    events.set(event.externalEventId, event);
  }
  if (requests > 0 && failedMedia === requests) {
    throw new Error('ETB On no devolvió ninguna ficha de medio legible');
  }
  const allowed = new Set(dateKeys);
  return [...events.values()]
    .filter((event) => allowed.has(event.dateKey))
    .sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
}

function raceWords(value) {
  return fold(value).split(' ')
    .filter((word) => word.length > 2 && !/^\d+$/.test(word) && !LINEAR_STOP_WORDS.has(word));
}

function sameRace(linear, event) {
  const words = new Set(raceWords(`${event.seriesTitle || ''} ${event.title}`));
  return raceWords(linear.title).some((word) => words.has(word));
}

// Combina el directo de ETB On con la parrilla lineal de ETB1/ETB2. Si la
// emisión lineal empieza a la vez, el canal es el lineal; si entra después,
// se conserva ETB On y se anota el relevo en hora de Madrid.
export function mergeEtbonWithLinear(etbonEvents, linearEvents) {
  const used = new Set();
  const events = etbonEvents.map((event) => {
    const start = Date.parse(event.startTimeUtc);
    const end = event.endTimeUtc ? Date.parse(event.endTimeUtc) : start + DEFAULT_LIVE_WINDOW_MS;
    const linear = linearEvents
      .filter((item) => !used.has(item) && item.dateKey === event.dateKey
        && (item.stageNumber ?? null) === (event.stageNumber ?? null) && sameRace(item, event))
      .filter((item) => {
        const linearStart = Date.parse(item.startTimeUtc);
        return linearStart >= start - LINEAR_EARLY_TOLERANCE_MS && linearStart < end;
      })
      .sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc))[0];
    if (!linear) return { ...event, note: null };
    used.add(linear);
    const offset = Date.parse(linear.startTimeUtc) - start;
    if (offset <= LINEAR_SAME_START_MS) {
      return { ...event, channel: linear.sourceChannel, note: null, linearEvent: linear.externalEventId };
    }
    return {
      ...event,
      note: `Pasa a ${linear.sourceChannel} a las ${linear.localStartTime}.`,
      linearEvent: linear.externalEventId,
    };
  });
  return { events, unpairedLinear: linearEvents.filter((item) => !used.has(item)) };
}
