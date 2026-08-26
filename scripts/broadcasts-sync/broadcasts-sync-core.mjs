import { createHash, randomUUID } from 'node:crypto';

export const HBO_SOURCE_URL = 'https://www.hbomax.com/es/es/sports/cycling';
export const RTVE_SOURCE_URLS = [
  { channel: null, url: 'https://www.rtve.es/play/guia-tve/' },
];
export const RTVE_VUELTA_VIDEOS_URL = 'https://www.rtve.es/api/programas/144990/videos.json?page=1&size=50';
export const PARSER_VERSION = '2026-08-26.1';

const STAGE_RE = /\b(?:stage|etapa)\s*(\d{1,2})(?:[a-z])?\b/i;
const CYCLING_RE = /\b(ciclismo|ciclista|cycling|vuelta|giro|tour de france|tour femenino|clasica|clásica|mundial.*ruta|campeonato.*ruta)\b/i;
const GENERIC_WORDS = new Set([
  'la', 'el', 'los', 'las', 'de', 'del', 'a', 'en', 'the', 'of', 'stage', 'etapa',
  'men', 'women', 'masculino', 'femenino', 'ciclismo', 'cycling',
]);

export function decodeHtml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function fold(value) {
  return decodeHtml(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function significant(value) {
  return fold(value).split(' ').filter((word) => word.length > 1 && !GENERIC_WORDS.has(word));
}

function aliasesForRace(race) {
  const aliases = [race.name, race.nameEn];
  for (const language of Object.values(race.translations || {})) {
    if (language && typeof language === 'object') aliases.push(language.name);
  }
  const folded = new Set(aliases.filter(Boolean).map(fold));
  for (const alias of [...folded]) {
    if (/\bla vuelta\b/.test(alias)) folded.add('vuelta a espana');
    if (/\bvuelta a espana\b/.test(alias)) folded.add('la vuelta');
    if (/\btour de france femmes\b/.test(alias)) folded.add('tour de france femmes avec zwift');
  }
  return [...folded];
}

export function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parseStageNumber(value) {
  const text = String(value || '');
  const match = text.match(STAGE_RE) || text.match(/\b(\d{1,2})\s*[ªºa]?\s*(?:etapa|stage)\b/i);
  return match ? Number(match[1]) : null;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeHtml(match?.[1] ?? match?.[2] ?? '');
}

function classText(body, className) {
  const match = body.match(new RegExp(`<[^>]+class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'));
  return stripHtml(match?.[1]);
}

export function isMontoneraEligible(title, subtitle) {
  const race = fold(title);
  const detail = fold(subtitle);
  if (!/\bmen\b|\bmasculin[oa]\b/.test(detail) || /\bwomen\b|femenin[ao]/.test(detail)) return false;
  return [
    /\bgiro d italia\b/,
    /\btour de france\b/,
    /\bla vuelta\b/,
    /\b(?:uci )?(?:road )?world championships?\b/,
    /\b(?:milan|milano)[ -]san remo\b/,
    /\b(?:tour of flanders|ronde van vlaanderen)\b/,
    /\bparis[ -]roubaix\b/,
  ].some((pattern) => pattern.test(race));
}

export function parseHboCatalog(html) {
  const metadata = new Map();
  const montoneraKeys = new Set();
  const metadataRe = /"hbomaxId":"([0-9a-f-]{36})"[\s\S]{0,10000}?"title":\{"short":"([^"]*)","full":"([^"]*)"\}[\s\S]{0,3000}?"scheduleDates":\{"startDate":"([^"]+)"/gi;
  for (const match of html.matchAll(metadataRe)) {
    if (Number.isFinite(Date.parse(match[4]))) {
      metadata.set(match[1].toLowerCase(), {
        title: decodeHtml(match[3]), subtitle: decodeHtml(match[2]),
        startTimeUtc: new Date(match[4]).toISOString(),
      });
    }
  }
  const events = [];
  const anchorRe = /(<a\b[^>]*href="[^"]*\/sport\/\d{4}-\d{1,2}-\d{1,2}\/[0-9a-f-]{36}"[^>]*>)([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const href = attr(match[1], 'href');
    const path = href.match(/\/sport\/(\d{4})-(\d{1,2})-(\d{1,2})\/([0-9a-f-]{36})/i);
    if (!path) continue;
    const sport = classText(match[2], 'event-sport');
    const title = classText(match[2], 'event-full-title');
    const subtitle = classText(match[2], 'event-short-title');
    if (fold(sport) !== 'cycling') continue;
    const details = metadata.get(path[4].toLowerCase()) || {};
    const dateKey = `${path[1]}-${path[2].padStart(2, '0')}-${path[3].padStart(2, '0')}`;
    const stageNumber = parseStageNumber(`${title} ${subtitle}`);
    const baseTitle = title.replace(/\s*\|\s*La Montonera\b.*$/i, '').trim();
    const montoneraKey = `${dateKey}|${stageNumber ?? 'one-day'}|${fold(baseTitle)}`;
    if (/montonera/i.test(title)) {
      if (isMontoneraEligible(baseTitle, subtitle)) montoneraKeys.add(montoneraKey);
      continue;
    }
    events.push({
      source: 'hbo_max',
      externalEventId: path[4].toLowerCase(),
      dateKey,
      title: details.title || title,
      subtitle: details.subtitle || subtitle,
      sourceUrl: `https://www.hbomax.com${href}`,
      broadcastUrl: `https://play.hbomax.com/sport/${path[4].toLowerCase()}`,
      stageNumber,
      startTimeUtc: details.startTimeUtc || null,
      montoneraKey,
    });
  }
  return [...new Map(events.map((event) => [event.externalEventId, event])).values()]
    .map(({ montoneraKey, ...event }) => ({
      ...event,
      hasMontonera: montoneraKeys.has(montoneraKey),
    }));
}

export function parseHboEventStart(html) {
  const patterns = [
    /"eventScheduleDates"\s*:\s*\{\s*"startDate"\s*:\s*"([^"]+)"/,
    /\\"eventScheduleDates\\"\s*:\s*\{\s*\\"startDate\\"\s*:\s*\\"([^\\"]+)\\"/,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  }
  return null;
}

const SPANISH_MONTHS = new Map([
  ['enero', 1], ['febrero', 2], ['marzo', 3], ['abril', 4], ['mayo', 5], ['junio', 6],
  ['julio', 7], ['agosto', 8], ['septiembre', 9], ['octubre', 10], ['noviembre', 11], ['diciembre', 12],
]);

export function parseSpanishDate(value) {
  const match = fold(value).match(/\b(\d{1,2}) de ([a-z]+) de (\d{4})\b/);
  const month = match && SPANISH_MONTHS.get(match[2]);
  return month ? `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

export function zonedTimeToUtc(dateKey, time, timeZone = 'Europe/Madrid') {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let candidate = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const wanted = Date.UTC(year, month - 1, day, hour, minute);
    const delta = wanted - represented;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate).toISOString();
}

export function dateKeyInZone(now = new Date(), timeZone = 'Europe/Madrid') {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

function rtveChannel(value) {
  const folded = fold(value);
  if (folded.includes('teledeporte')) return 'Teledeporte';
  if (/\bla 2\b/.test(folded)) return 'La 2';
  if (/\bla 1\b/.test(folded)) return 'La 1';
  return null;
}

function canonicalRtveChannel(channel) {
  if (channel === 'Teledeporte') return 'TDP / RTVE Play';
  if (channel === 'La 2') return 'La 2 / RTVE Play';
  if (channel === 'La 1') return 'La 1 / RTVE Play';
  return null;
}

function rtveLiveUrl(channel) {
  if (channel === 'Teledeporte') return 'https://www.rtve.es/play/teledeporte/directo/';
  if (channel === 'La 2') return 'https://www.rtve.es/play/videos/directo/la-2/';
  return 'https://www.rtve.es/play/videos/directo/la-1/';
}

export function parseRtveStructuredGuide(html) {
  const decoded = String(html).replace(/\\"/g, '"');
  const groupRe = /"nombreCanal":"([^"]+)"[\s\S]{0,500}?"items":(\[[\s\S]*?\]),"canal":\{"id":"([^"]+)"/gi;
  const events = [];
  for (const group of decoded.matchAll(groupRe)) {
    const channel = rtveChannel(group[1]) || rtveChannel(group[3]);
    if (!channel) continue;
    const items = [...group[2].matchAll(/\{"name":[\s\S]*?"orden":\d+\}/g)].map((match) => match[0]);
    const stringField = (item, name) => {
      const value = item.match(new RegExp(`"${name}":"((?:\\\\.|[^"])*)"`))?.[1];
      return value == null ? null : decodeHtml(value.replace(/\\+r|\\+n/g, ' ').replace(/\\+"/g, '"'));
    };
    const numberField = (item, name) => Number(item.match(new RegExp(`"${name}":(?:"(\\d+)"|(\\d+))`))?.slice(1).find(Boolean));
    for (const item of items) {
      const begin = stringField(item, 'begintime') || '';
      if (!/^\d{14}$/.test(begin)) continue;
      const title = stripHtml(stringField(item, 'original_event_name') || stringField(item, 'name'));
      const subtitle = stripHtml(stringField(item, 'original_episode_name')
        || stringField(item, 'episode_name') || stringField(item, 'description'));
      if (!CYCLING_RE.test(`${title} ${subtitle}`)) continue;
      const dateKey = `${begin.slice(0, 4)}-${begin.slice(4, 6)}-${begin.slice(6, 8)}`;
      const localTime = `${begin.slice(8, 10)}:${begin.slice(10, 12)}`;
      const episodeNumber = numberField(item, 'episode_number');
      const stageNumber = episodeNumber > 0 ? episodeNumber : parseStageNumber(`${title} ${subtitle}`);
      const titleIdentity = fold(title)
        .replace(/\b\d{4}\b/g, '')
        .replace(/\b\d+\s*a?\s*(?:etapa|stage)\b.*$/, '')
        .trim();
      const stableKey = `${dateKey}|${stageNumber ?? 'one-day'}|${titleIdentity}`;
      events.push({
        source: 'rtve', externalEventId: contentHash(stableKey).slice(0, 32),
        dateKey, title, subtitle, sourceChannel: channel,
        channel: canonicalRtveChannel(channel), country: 'ES',
        sourceUrl: RTVE_SOURCE_URLS[0].url, broadcastUrl: rtveLiveUrl(channel),
        startTimeUtc: zonedTimeToUtc(dateKey, localTime), localStartTime: localTime,
        stageNumber,
      });
    }
  }
  events.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
  const byEvent = new Map();
  for (const event of events) {
    if (!byEvent.has(event.externalEventId)) byEvent.set(event.externalEventId, []);
    byEvent.get(event.externalEventId).push(event);
  }
  return [...byEvent.values()].map((group) => {
    const teledeporte = group.filter((event) => event.sourceChannel === 'Teledeporte');
    const isLaVuelta = group.some((event) => fold(`${event.title} ${event.subtitle}`).includes('vuelta a espana'));
    if (isLaVuelta && !teledeporte.length) return null;
    const primary = teledeporte[0] || group[0];
    if (!teledeporte.length) return primary;
    const transition = group.find((event) => event.sourceChannel !== 'Teledeporte'
      && event.startTimeUtc > primary.startTimeUtc);
    return {
      ...primary,
      channel: 'TDP / RTVE Play',
      broadcastUrl: rtveLiveUrl('Teledeporte'),
      note: transition ? `Pasa a ${transition.sourceChannel} a las ${transition.localStartTime}.` : null,
    };
  }).filter(Boolean);
}

function rtvePublicationDateKey(value) {
  const match = String(value || '').match(/^(\d{2})-(\d{2})-(20\d{2})\b/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function parseRtveVueltaVideos(payload) {
  let parsed;
  try { parsed = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { return []; }
  const items = Array.isArray(parsed?.page?.items) ? parsed.page.items : [];
  const events = [];
  for (const item of items) {
    const title = String(item?.title || item?.shortTitle || '').trim();
    const longTitle = String(item?.longTitle || title).trim();
    const stageMatch = title.match(/^Etapa\s+(\d{1,2})\s*:/i);
    const dateKey = rtvePublicationDateKey(item?.publicationDate);
    const year = Number(longTitle.match(/\b(20\d{2})\b/)?.[1]);
    const duration = Number(item?.duration || 0);
    let url;
    try { url = new URL(item?.htmlUrl); } catch { continue; }
    if (!stageMatch || !dateKey || year !== Number(dateKey.slice(0, 4))) continue;
    if (!/\b(?:la )?vuelta(?: a españa)?\b/i.test(longTitle)) continue;
    if (item?.pubState?.code !== 'ENPUB' || duration < 60 * 60_000) continue;
    if (url.protocol !== 'https:' || url.hostname !== 'www.rtve.es'
      || !url.pathname.startsWith('/play/videos/vuelta-ciclista-a-espana/')) continue;
    const stageNumber = Number(stageMatch[1]);
    events.push({
      source: 'rtve', externalEventId: `vuelta-replay-${item.id}`,
      dateKey, title: `La Vuelta ${year} Etapa ${stageNumber}`, subtitle: longTitle,
      stageNumber, sourceUrl: RTVE_VUELTA_VIDEOS_URL, broadcastUrl: url.href,
      channel: 'RTVE', country: 'ES', reviveCapable: true,
      finalizeReplay: true,
    });
  }
  return events;
}

export function parseRtveGuide(html, { channel: channelOption = null, referenceDate = dateKeyInZone() } = {}) {
  const events = [];
  const blocks = [...html.matchAll(/<li\b[^>]*class="[^"]*\belem_[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)];
  for (const block of blocks) {
      const item = block[1];
      const timeRange = item.match(/class="horemi"[^>]*>(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
      if (!timeRange) continue;
      const dateLabel = classText(item, 'datemi');
      const explicitDate = parseSpanishDate(dateLabel);
      const offset = fold(dateLabel) === 'manana' ? 1 : fold(dateLabel) === 'hoy' ? 0 : null;
      const dateKey = explicitDate || (offset == null ? null : addDays(referenceDate, offset));
      const channel = channelOption || rtveChannel(classText(item, 'cademi'));
      if (!channel || !dateKey) continue;
      const strong = item.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] || '';
      const title = classText(strong, 'maintitle') || stripHtml(strong);
      const description = stripHtml(item.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
      if (!CYCLING_RE.test(`${title} ${description}`)) continue;
      const link = item.match(/href="([^"]+)"/i)?.[1] || 'https://www.rtve.es/play/';
      const programId = item.match(/data-idprogram="([^"]+)"/i)?.[1] || 'sin-programa';
      const stageNumber = parseStageNumber(`${title} ${description}`);
      const stableKey = `${channel}|${dateKey}|${programId}|${stageNumber ?? fold(title)}`;
      events.push({
        source: 'rtve',
        externalEventId: contentHash(stableKey).slice(0, 32),
        dateKey,
        title,
        subtitle: description,
        sourceChannel: channel,
        channel: 'RTVE',
        country: 'ES',
        sourceUrl: new URL(link, 'https://www.rtve.es').href,
        broadcastUrl: channel === 'Teledeporte'
          ? 'https://www.rtve.es/play/teledeporte/ciclismo/'
          : new URL(link, 'https://www.rtve.es').href,
        startTimeUtc: zonedTimeToUtc(dateKey, timeRange[1]),
        endTimeUtc: zonedTimeToUtc(dateKey, timeRange[2]),
        stageNumber,
      });
  }
  events.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
  const firstByEvent = new Map();
  for (const event of events) {
    if (!firstByEvent.has(event.externalEventId)) firstByEvent.set(event.externalEventId, event);
  }
  return [...firstByEvent.values()];
}

export function normalizedObservation(event) {
  const start = new Date(event.startTimeUtc);
  start.setUTCSeconds(0, 0);
  const normalized = {
    source: event.source,
    externalEventId: event.externalEventId,
    dateKey: event.dateKey,
    title: event.title,
    subtitle: event.subtitle || null,
    stageNumber: event.stageNumber ?? null,
    startTimeUtc: start.toISOString(),
    broadcastUrl: event.broadcastUrl,
    sourceUrl: event.sourceUrl,
    sourceChannel: event.sourceChannel || null,
    channel: event.channel || null,
    country: event.country || null,
    note: event.note || null,
    reviveCapable: event.reviveCapable === true,
    finalizeReplay: event.finalizeReplay === true,
    hasMontonera: event.source === 'hbo_max' ? event.hasMontonera === true : null,
    writeEligible: event.writeEligible !== false,
    insertSortOrder: event.insertSortOrder ?? null,
  };
  return { ...normalized, sourceHash: contentHash(normalized) };
}

export function matchObservation(observation, raceDays) {
  const sourceText = fold(`${observation.title} ${observation.subtitle || ''}`);
  const candidates = raceDays.filter((day) => day.dateKey === observation.dateKey).map((day) => {
    const aliases = aliasesForRace(day);
    const aliasScores = aliases.map((alias) => {
      if (!alias) return 0;
      if (sourceText.includes(alias)) return 100 + Math.min(alias.length, 30);
      const words = significant(alias);
      return words.length >= 2 && words.every((word) => sourceText.includes(word)) ? 80 + words.length : 0;
    });
    let score = Math.max(0, ...aliasScores);
    if (observation.stageNumber != null) {
      if (Number(day.stageNumber) === observation.stageNumber) score += 40;
      else score = 0;
    }
    const sourceFemale = /\b(women|female|femenin[ao]|femmes)\b/.test(sourceText);
    if (sourceFemale && day.gender !== 'female') score = 0;
    if (!sourceFemale && day.gender === 'female' && !aliases.some((alias) => /women|fem|dames/.test(alias))) score -= 20;
    return { day, score, aliases: aliases.filter((alias) => sourceText.includes(alias)) };
  }).filter((candidate) => candidate.score >= 100).sort((a, b) => b.score - a.score);

  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return { status: 'ambiguous', candidates: candidates.map(({ day, score }) => ({ raceDayId: day.raceDayId, score })) };
  }
  if (!candidates.length) return { status: 'unmatched', candidates: [] };
  if (candidates[1] && candidates[0].score - candidates[1].score < 20) {
    return { status: 'ambiguous', candidates: candidates.slice(0, 3).map(({ day, score }) => ({ raceDayId: day.raceDayId, score })) };
  }
  const winner = candidates[0];
  return {
    status: 'matched',
    raceDayId: winner.day.raceDayId,
    raceId: winner.day.raceId,
    score: winner.score,
    evidence: { dateKey: observation.dateKey, stageNumber: observation.stageNumber, aliases: winner.aliases },
  };
}

export function desiredBroadcasts(observation) {
  if (observation.source === 'hbo_max') {
    return [
      { channel: 'Eurosport (HBO Max)', country: 'EUROPA', startTimeUtc: observation.startTimeUtc, url: observation.broadcastUrl, note: observation.hasMontonera ? 'La Montonera al terminar.' : null, showInRevive: true, hasMontonera: observation.hasMontonera === true, insertSortOrder: -20 },
      { channel: 'TNT Sports (HBO Max)', country: 'UK_IE', startTimeUtc: observation.startTimeUtc, url: 'https://www.hbomax.com/gb/en/sports/cycling', note: null, showInRevive: true, hasMontonera: false, insertSortOrder: -10 },
    ];
  }
  return [{
    channel: observation.channel, country: observation.country || 'ES', startTimeUtc: observation.startTimeUtc,
    url: observation.broadcastUrl, note: observation.note || null,
    showInRevive: observation.reviveCapable === true,
    insertSortOrder: observation.insertSortOrder ?? -30,
  }];
}

export function newBroadcastRow(raceDayId, desired) {
  return {
    id: randomUUID(), raceDayId, channel: desired.channel, country: desired.country,
    startTimeUtc: desired.startTimeUtc, url: desired.url, note: desired.note || null,
    sortOrder: desired.insertSortOrder, showInRevive: desired.showInRevive === true, translations: {},
  };
}
