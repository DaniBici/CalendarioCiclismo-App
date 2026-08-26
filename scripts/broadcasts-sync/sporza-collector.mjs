export const SPORZA_SCHEDULE_BASE_URL = 'https://api.sporza.be/web/content/schedule';
export const SPORZA_TIME_ZONE = 'Europe/Brussels';

const STAGE_RE = /\b(?:etappe|rit|stage)\s*(\d{1,2})(?:[a-z])?\b/i;
const SUMMARY_RE = /\b(?:samenvatting|hoogtepunten|herhaling|summary|highlights|resume)\b/i;

function decodeHtml(value) {
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

function stripHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function hostIsOfficial(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'sporza.be' || host.endsWith('.sporza.be'));
  } catch {
    return false;
  }
}

function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visit(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visit, seen);
}

function parseStageNumber(value) {
  const match = String(value || '').match(STAGE_RE);
  return match ? Number(match[1]) : null;
}

export function sporzaScheduleUrl(dateKey) {
  const date = validDateKey(dateKey);
  if (!date) throw new Error(`Fecha Sporza inválida: ${dateKey}`);
  return `${SPORZA_SCHEDULE_BASE_URL}?date=${date}`;
}

export function parseSporzaSchedule(payload, { sourceUrl } = {}) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const dateKey = validDateKey(data?.componentProps?.date);
  if (!dateKey) throw new Error('El calendario de Sporza no contiene una fecha ISO válida');
  const calendarUrl = sourceUrl || sporzaScheduleUrl(dateKey);
  if (!hostIsOfficial(calendarUrl)) throw new Error('El calendario de Sporza debe proceder de un host oficial');

  const identities = [];
  walk(data, (node) => {
    const item = node?.componentProps;
    if (!item || item.sport !== 'cycling' || item.matchId == null) return;
    const externalEventId = String(item.matchId);
    const editorialUrl = item.url || `https://sporza.be/nl/sport/wielrennen/~${externalEventId}/`;
    const identityUrl = item.sportApiUrl
      || `https://api.sporza.be/web/content/cycling/matches/${externalEventId}`;
    if (!/^\d+$/.test(externalEventId) || !hostIsOfficial(editorialUrl) || !hostIsOfficial(identityUrl)) return;
    identities.push({
      source: 'sporza',
      externalEventId,
      dateKey,
      title: stripHtml(item.competitionName),
      subtitle: stripHtml(item.stage || item.ariaLabel),
      stageNumber: parseStageNumber(`${item.stage || ''} ${item.ariaLabel || ''}`),
      calendarUrl,
      identityUrl,
      editorialUrl,
      sportsStartLabel: stripHtml(item.startLabel) || null,
    });
  });

  const unique = new Map();
  for (const identity of identities) {
    if (!unique.has(identity.externalEventId)) unique.set(identity.externalEventId, identity);
  }
  return [...unique.values()];
}

function jsonLdObjects(html) {
  const objects = [];
  const pattern = /<script\b[^>]*type=(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]));
      walk(parsed, (object) => objects.push(object));
    } catch {
      // Un bloque JSON-LD malformado no invalida los restantes.
    }
  }
  return objects;
}

function metaContent(html, name) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = tag.match(/\b(?:name|property)=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean);
    if (key?.toLowerCase() !== name.toLowerCase()) continue;
    return decodeHtml(tag.match(/\bcontent=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean));
  }
  return '';
}

function canonicalUrl(html, fallback) {
  const tag = String(html || '').match(/<link\b[^>]*rel=(?:"canonical"|'canonical')[^>]*>/i)?.[0]
    || String(html || '').match(/<link\b[^>]*href=(?:"[^"]*"|'[^']*')[^>]*rel=(?:"canonical"|'canonical')[^>]*>/i)?.[0];
  return decodeHtml(tag?.match(/\bhref=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean)) || fallback;
}

function typeIncludes(value, expected) {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => String(type || '').toLowerCase() === expected.toLowerCase());
}

function localParts(isoDate) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SPORZA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(isoDate))
    .map((part) => [part.type, part.value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function explicitChannels(text) {
  const channels = [];
  const add = (channel) => { if (!channels.includes(channel)) channels.push(channel); };
  if (/\bVRT\s*1\b/i.test(text)) add('VRT 1');
  if (/\b(?:VRT\s*)?Canvas\b/i.test(text)) add('VRT Canvas');
  if (/\bVRT\s*MAX\b/i.test(text)) add('VRT MAX');
  if (/\bKetnet\b/i.test(text)) add('Ketnet');
  if (/\b(?:op|via)\s+Sporza(?:\.be)?\b/i.test(text)) add('Sporza');
  return channels;
}

function textDeclaresTime(text, localTime) {
  const [hour, minute] = localTime.split(':');
  const hourPattern = hour.startsWith('0') ? `0?${hour.slice(1)}` : hour;
  const clock = minute === '00'
    ? `${hourPattern}(?:[.:]00\\s*)?(?:u(?:ur)?)`
    : `${hourPattern}[.:]${minute}\\s*(?:u(?:ur)?)?`;
  return new RegExp(`\\b${clock}\\b`, 'i').test(text);
}

export function parseSporzaEditorialPage(html, identity, { pageUrl } = {}) {
  if (!identity?.externalEventId || !validDateKey(identity.dateKey)) {
    throw new Error('La identidad Sporza requiere matchId y dateKey');
  }
  const objects = jsonLdObjects(html);
  const candidates = [];
  for (const object of objects) {
    if (object.publication && typeIncludes(object.publication['@type'], 'BroadcastEvent')) {
      candidates.push({ event: object.publication, parent: object });
    }
    if (typeIncludes(object['@type'], 'BroadcastEvent')) candidates.push({ event: object, parent: object });
  }

  for (const { event, parent } of candidates) {
    if (!event.startDate || !Number.isFinite(Date.parse(event.startDate))) continue;
    const local = localParts(event.startDate);
    if (local.dateKey !== identity.dateKey) continue;
    const headline = stripHtml(parent.headline || parent.name || metaContent(html, 'twitter:title'));
    const editorialText = stripHtml([
      headline,
      parent.description,
      parent.articleBody,
      event.description,
      metaContent(html, 'description'),
      metaContent(html, 'twitter:description'),
    ].filter(Boolean).join(' '));
    if (SUMMARY_RE.test(editorialText)) continue;
    const channels = explicitChannels(editorialText);
    if (channels.length === 0 || !textDeclaresTime(editorialText, local.time)) continue;
    const observedCanonicalUrl = canonicalUrl(html, pageUrl || identity.editorialUrl);
    if (!hostIsOfficial(observedCanonicalUrl) || !hostIsOfficial(identity.editorialUrl)) continue;
    return {
      ...identity,
      startTimeUtc: new Date(event.startDate).toISOString(),
      localStartTime: local.time,
      timeZone: SPORZA_TIME_ZONE,
      sourceChannels: channels,
      country: 'BE',
      sourceUrl: identity.editorialUrl,
      broadcastUrl: identity.editorialUrl,
      evidence: {
        editorialStartDate: event.startDate,
        editorialChannels: channels,
        editorialText,
        observedCanonicalUrl,
      },
    };
  }
  return null;
}

async function responseText(response) {
  if (typeof response === 'string') return response;
  if (!response?.ok) throw new Error(`Sporza respondió HTTP ${response?.status ?? 'desconocido'}`);
  return response.text();
}

export async function collectSporza({ dateKey, fetcher = fetch } = {}) {
  const calendarUrl = sporzaScheduleUrl(dateKey);
  const calendarText = await responseText(await fetcher(calendarUrl));
  const identities = parseSporzaSchedule(calendarText, { sourceUrl: calendarUrl });
  const observations = [];
  for (const identity of identities) {
    const response = await fetcher(identity.editorialUrl);
    const html = await responseText(response);
    const observation = parseSporzaEditorialPage(html, identity, {
      pageUrl: response?.url || identity.editorialUrl,
    });
    if (observation) observations.push(observation);
  }
  return observations;
}
