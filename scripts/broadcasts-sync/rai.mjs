import { dateKeyInZone, fold, normalizedObservation, parseStageNumber, zonedTimeToUtc } from './broadcasts-sync-core.mjs';

export const RAI_BASE_URL = 'https://www.raiplay.it';
export const RAI_PROGRAM_URL = `${RAI_BASE_URL}/programmi/ciclismo.json`;
export const RAI_CHANNELS = ['rai-sport', 'rai-1', 'rai-2', 'rai-3'];
const EXCLUDED = /\b(mountain bike|mtb|cross country|ciclocross|pista|radiocorsa|magazine|intervista|presentazione)\b/;
const SUMMARY = /\b(highlights?|sintesi|riassunto)\b/;
const REPEAT = /\b(replica|differita|riproposizione)\b/;

export function raiUrl(value, prefix) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, RAI_BASE_URL);
    return url.origin === RAI_BASE_URL && url.pathname.startsWith(prefix) ? url.href : null;
  } catch { return null; }
}
function payload(value, field) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(parsed?.[field])) throw new Error(`RAI: falta ${field} en la respuesta oficial`);
  return parsed;
}
function date(value) {
  const text = String(value || '');
  const match = text.match(/\b(\d{2})[-/ ](\d{2})[-/ ](20\d{2})\b/);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : /^20\d{2}-\d{2}-\d{2}$/.test(text) ? text : null;
  return iso && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso ? iso : null;
}
function windowDates(now, before, after) {
  const today = dateKeyInZone(now, 'Europe/Rome');
  return Array.from({ length: before + after + 1 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i - before);
    return d.toISOString().slice(0, 10);
  });
}
export function raiScheduleUrl(channel, day) {
  return `${RAI_BASE_URL}/palinsesto/app/${channel}/${day.split('-').reverse().join('-')}.json`;
}
function cycling(item) {
  const text = fold(`${item.name || ''} ${item.episode_title || ''} ${item.program?.name || ''}`);
  return /\b(ciclismo|giro d italia|tour de france|la vuelta|vuelta a espana)\b/.test(text) && !EXCLUDED.test(text);
}
export function parseRaiSchedule(value, sourceUrl) {
  const p = payload(value, 'events');
  const events = [];
  for (const item of p.events) {
    if (!cycling(item)) continue;
    const dateKey = date(item.date);
    const text = fold(`${item.name} ${item.episode_title || ''} ${item.description || ''}`);
    const statedYear = text.match(/\b(20\d{2})\b/)?.[1];
    if (statedYear && statedYear !== dateKey?.slice(0, 4)) continue;
    const broadcastUrl = raiUrl(item.event_weblink, '/dirette/');
    if (!dateKey || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.hour) || !broadcastUrl || !item.id) continue;
    const sourceChannel = item.channel || p.channel;
    if (!/^Rai (Sport|[123])$/.test(sourceChannel)) continue;
    const explicitDelayed = SUMMARY.test(text) || REPEAT.test(text);
    const durationSeconds = String(item.duration || '').split(':').reduce((n, part) => n * 60 + Number(part), 0);
    events.push({
      source: 'rai', externalEventId: `schedule:${item.id}`, dateKey,
      title: item.name, subtitle: item.episode_title || null,
      stageNumber: parseStageNumber(`${item.name} ${item.episode_title || ''}`),
      startTimeUtc: zonedTimeToUtc(dateKey, item.hour, 'Europe/Rome'),
      sourceUrl, broadcastUrl, sourceChannel, channel: sourceChannel.replace(/^Rai /, 'RAI '),
      country: 'IT', mediaKind: 'scheduled', explicitDelayed, durationSeconds, writeEligible: true, insertSortOrder: 10,
      programUrl: raiUrl(item.program?.path_id, '/programmi/'),
      videoUrl: item.has_video === true ? raiUrl(item.path_id, '/video/') : null,
    });
  }
  // Conservar los horarios: la clasificación directo/diferido necesita el calendario de la DB.
  return events;
}

export function parseRaiVideo(value, { now = new Date(), highlights = false } = {}) {
  const p = typeof value === 'string' ? JSON.parse(value) : value;
  const title = p.name || '';
  const text = fold(`${title} ${p.episode_title || ''}`);
  const broadcastUrl = raiUrl(p.weblink, '/video/');
  const dateKey = date(title) || date(p.track_info?.date) || date(p.date_published);
  const duration = String(p.video?.duration || '').split(':').reduce((n, part) => n * 60 + Number(part), 0);
  const expiry = p.availabilities?.expiration_date_iso;
  if (!cycling({ name: title, episode_title: p.episode_title, program: { name: p.program_info?.name } })) return null;
  if (p.type !== 'RaiPlay Video Item' || p.is_live !== false || !p.video?.content_url
      || !broadcastUrl || !p.id || !dateKey || EXCLUDED.test(text) || !Number.isFinite(duration) || duration <= 0) return null;
  if (expiry && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= now.getTime())) return null;
  if (p.season && String(p.season) !== dateKey.slice(0, 4)) return null;
  if (!windowDates(now, 14, 0).includes(dateKey)) return null;
  const summary = SUMMARY.test(text) || (highlights && fold(p.form) === 'clip');
  const full = !summary && fold(p.form) === 'integrale';
  if (!summary && !full) return null;
  return {
    source: 'rai', externalEventId: `video:${p.id}`, dateKey, title,
    subtitle: p.episode_title || null, stageNumber: parseStageNumber(text),
    startTimeUtc: null, sourceUrl: raiUrl(p.path_id, '/video/') || broadcastUrl,
    broadcastUrl, channel: 'RAI / RaiPlay', country: 'IT',
    note: summary ? 'Resumen.' : null,
    mediaKind: summary ? 'highlights' : 'replay', durationSeconds: duration, reviveCapable: true,
    writeEligible: true, insertSortOrder: 11,
  };
}
async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: {
    Accept: 'application/json', 'User-Agent': 'CalendarioCiclismo/broadcasts-sync (+https://calendariociclismo.app)',
  } });
  if (!response.ok) {
    const error = new Error(`RAI: ${response.status} en ${url}`); error.status = response.status; throw error;
  }
  return response.json();
}
async function mapBounded(items, callback) {
  const results = []; let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (index < items.length) { const i = index++; results[i] = await callback(items[i]); }
  }));
  return results;
}
export async function collectRai(now = new Date(), { fetcher = fetchJson, dateKeys, channels = RAI_CHANNELS, diagnostics = [] } = {}) {
  const days = dateKeys || windowDates(now, 7, 8);
  const today = dateKeyInZone(now, 'Europe/Rome');
  const schedules = await mapBounded(channels.flatMap((channel) => days.map((day) => ({ day, url: raiScheduleUrl(channel, day) }))), async ({ day, url }) => {
    try { return parseRaiSchedule(await fetcher(url), url); }
    catch (error) {
      // RAI publica el horizonte futuro en fechas distintas para cada canal.
      if (error.status === 404 && day > today) return [];
      throw error;
    }
  });
  const events = schedules.flat();
  const programs = [...new Set([RAI_PROGRAM_URL, ...events.map((e) => e.programUrl).filter(Boolean)])];
  const sets = (await mapBounded(programs, async (url) => {
    const p = payload(await fetcher(url), 'blocks');
    return p.blocks.flatMap((block) => (block.sets || []).map((set) => ({
      url: raiUrl(set.path_id, '/programmi/'), highlights: SUMMARY.test(fold(`${block.name} ${set.name}`)),
    }))).filter((set) => set.url);
  })).flat();
  const videoPaths = new Map(events.filter((e) => e.videoUrl).map((e) => [e.videoUrl, false]));
  for (const { set, items } of await mapBounded(sets, async (set) => ({ set, items: payload(await fetcher(set.url), 'items').items }))) {
    for (const item of items) {
      const path = raiUrl(item.path_id, '/video/');
      const month = path?.match(/\/video\/(20\d{2})\/(\d{2})\//);
      if (!month || !windowDates(now, 14, 0).some((d) => d.startsWith(`${month[1]}-${month[2]}`))) continue;
      videoPaths.set(path, videoPaths.get(path) === true || set.highlights);
    }
  }
  const videos = (await mapBounded([...videoPaths], async ([url, highlights]) =>
    parseRaiVideo(await fetcher(url), { now, highlights }))).filter(Boolean);
  // El título editorial puede variar: la identidad de cada vídeo es su ContentItem.
  const result = [...events, ...new Map(videos.map((v) => [v.externalEventId, v])).values()].map(normalizedObservation);
  if (!result.length) diagnostics.push({ source: 'rai', action: 'no_cycling_events', sourceUrl: RAI_PROGRAM_URL });
  return result;
}

export function classifyRaiObservation(observation, day) {
  if (observation.mediaKind !== 'scheduled') return observation;
  const start = Date.parse(day.neutralStartTimeUtc);
  const finish = Date.parse(day.estimatedFinishTimeUtc);
  const broadcast = Date.parse(observation.startTimeUtc);
  const end = broadcast + observation.durationSeconds * 1000;
  const known = Number.isFinite(start) && Number.isFinite(finish) && finish > start
    && Number.isFinite(observation.durationSeconds) && observation.durationSeconds > 0;
  const live = known && !observation.explicitDelayed && broadcast < finish && end > start;
  return normalizedObservation({
    ...observation, mediaKind: live ? 'live' : 'delayed',
    note: live ? null : 'Diferido.', writeEligible: known,
  });
}
const ROME_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
// Nota gestionada del relevo entre canales RAI; incluye el formato anterior.
export const RAI_TRANSITION_NOTE = /(?:^|\s+)(?:\d{2}:\d{2} > RAI (?:Sport|[123])|Pasa a RAI (?:Sport|[123]) a las \d{2}:\d{2}\.)(?=\s|$)/gi;

// Un directo que continúa en otro canal RAI se conserva en una sola fila, la
// del primer canal, con la nota «HH:MM > RAI 2» en hora de Roma.
export function withRaiTransition(primary, observations = []) {
  if (primary.mediaKind !== 'live' || !primary.startTimeUtc) return primary;
  const next = observations
    .filter((o) => o.mediaKind === 'live' && o.channel && o.channel !== primary.channel
      && o.startTimeUtc > primary.startTimeUtc)
    .sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc))[0];
  if (!next) return primary;
  const { sourceHash, ...event } = primary;
  return normalizedObservation({ ...event, note: `${ROME_TIME.format(new Date(next.startTimeUtc))} > ${next.channel}` });
}
export function raiMediaRank(kind) {
  return { highlights: 4, replay: 3, live: 2, delayed: 1, scheduled: 0 }[kind] || 0;
}
export function raiRowRank(row) {
  if (raiUrl(row.url, '/video/')) return /resumen|highlights/i.test(row.note || '') ? 4 : 3;
  return /diferido/i.test(row.note || '') ? 1 : 2;
}
// Un vídeo nunca cede ante una emisión de menor prioridad; un directo ya emitido
// tampoco cede ante un diferido posterior de la misma jornada.
export function raiKeepsCurrent(rows, observation, now = Date.now()) {
  const rank = raiMediaRank(observation.mediaKind);
  return rows.some((row) => {
    const current = raiRowRank(row);
    if (current <= rank) return false;
    return current >= 3 || (!!row.startTimeUtc && Date.parse(row.startTimeUtc) <= now);
  });
}
