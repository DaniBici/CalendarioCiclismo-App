import {
  contentHash, dateKeyInZone, fold, parseStageNumber,
} from './broadcasts-sync-core.mjs';

export const RTBF_SCHEDULE_BASE_URL = 'https://bff-service.rtbf.be/oaos/v1.6/schedulings';
export const RTBF_CHANNELS = [
  { id: 1, label: 'La Une' },
  { id: 33, label: 'Tipik' },
];

const FULL_BROADCAST_SECONDS = 60 * 60;
const CYCLING_RE = /\b(cyclisme|cycliste|cycling|vuelta|giro|tour de france|classique|championnats?.*route)\b/i;
const SUMMARY_RE = /\b(resume|résumé|highlights?|best of|magazine|debrief|débrief)\b/i;

function parsedPayload(payload) {
  try { return typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { return null; }
}

function officialAuvioUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'auvio.rtbf.be'
      && (url.pathname.startsWith('/live/') || url.pathname.startsWith('/media/'));
  } catch { return false; }
}

function localTime(value) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return formatter.format(new Date(value));
}

function canonicalChannel(value) {
  if (value === 'La Une') return 'La Une / RTBF Auvio';
  if (value === 'Tipik') return 'Tipik / RTBF Auvio';
  return null;
}

function eventIdentity(event) {
  const title = fold(event.title)
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\betape\s*\d+.*$/, '')
    .trim();
  return `${event.dateKey}|${event.stageNumber ?? 'one-day'}|${title}`;
}

export function rtbfScheduleUrl(channelId, scheduledAfter, scheduledBefore, page = 1) {
  const query = new URLSearchParams({
    scheduledAfter, scheduledBefore, channelIds: String(channelId),
    _limit: '500', _page: String(page), platform: 'WEB',
  });
  return `${RTBF_SCHEDULE_BASE_URL}?${query}`;
}

export function rtbfPageInfo(payload) {
  const parsed = parsedPayload(payload);
  if (parsed?.status !== 200 || !Array.isArray(parsed?.data)) {
    throw new Error('RTBF devolvió una respuesta de programación no utilizable');
  }
  const last = Number(parsed?.meta?.page?.last || 1);
  return { last: Number.isInteger(last) && last > 0 ? Math.min(last, 10) : 1 };
}

export function parseRtbfSchedules(payloads) {
  const raw = payloads.flatMap((payload) => {
    const parsed = parsedPayload(payload);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  });
  const events = [];
  for (const item of raw) {
    const sourceChannel = RTBF_CHANNELS.find((channel) => channel.id === Number(item?.channel?.id))?.label;
    const channel = canonicalChannel(sourceChannel);
    const scheduledAt = String(item?.scheduledAt || '');
    const start = new Date(scheduledAt);
    const title = String(item?.title || '').trim();
    const subtitle = String(item?.subtitle || '').trim();
    const description = String(item?.description || '');
    const category = String(item?.categoryLabel || '');
    const text = `${title} ${subtitle} ${description} ${category}`;
    const stageNumber = parseStageNumber(`${title} ${subtitle}`);
    const duration = Number(item?.duration || 0);
    const broadcastType = String(item?.broadcast?.type || '').toUpperCase();
    const broadcastStatus = String(item?.broadcast?.status || '').toUpperCase();
    const fullReplay = broadcastType === 'VIDEO' && broadcastStatus === 'AVAILABLE'
      && duration >= FULL_BROADCAST_SECONDS;
    const live = broadcastType === 'LIVE' && ['SCHEDULED', 'PLAYING'].includes(broadcastStatus);
    const shortStageSegment = live && stageNumber != null;
    if (!channel || !Number.isFinite(start.getTime()) || !officialAuvioUrl(item?.deepLink)) continue;
    if (!CYCLING_RE.test(text) || SUMMARY_RE.test(text)) continue;
    if (!fullReplay && !live) continue;
    if (duration < FULL_BROADCAST_SECONDS && !shortStageSegment) continue;
    const dateKey = dateKeyInZone(start, 'Europe/Brussels');
    events.push({
      source: 'rtbf',
      scheduleId: String(item.id),
      dateKey,
      title,
      subtitle,
      stageNumber,
      startTimeUtc: start.toISOString(),
      localStartTime: localTime(start),
      duration,
      sourceChannel,
      channel,
      country: 'BE',
      sourceUrl: RTBF_SCHEDULE_BASE_URL,
      broadcastUrl: item.deepLink,
      reviveCapable: fullReplay,
      finalizeReplay: fullReplay,
      broadcastType,
      broadcastStatus,
      insertSortOrder: 10,
    });
  }

  const groups = new Map();
  for (const event of events) {
    const identity = eventIdentity(event);
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(event);
  }
  return [...groups.entries()].map(([identity, group]) => {
    group.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
    const primary = group[0];
    const transition = group.find((event) => event.sourceChannel !== primary.sourceChannel
      && event.startTimeUtc > primary.startTimeUtc);
    return {
      ...primary,
      externalEventId: contentHash(identity).slice(0, 32),
      note: transition ? `${transition.localStartTime} > ${transition.sourceChannel}` : null,
      reviveCapable: group.some((event) => event.reviveCapable),
      finalizeReplay: group.some((event) => event.finalizeReplay),
      scheduleIds: group.map((event) => event.scheduleId),
    };
  }).sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
}
