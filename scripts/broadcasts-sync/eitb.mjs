import { createHash } from 'node:crypto';

export const EITB_TIME_ZONE = 'Europe/Madrid';
export const EITB_SCHEDULE_BASE_URL =
  'https://www.eitb.eus/es/modulo/programacion/programacion_berria_3_col_ajax';

export const EITB_CHANNELS = Object.freeze([
  { channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1', channel: 'ETB1' },
  { channelId: 2, station: 'ETB-2', sourceChannel: 'ETB2', channel: 'ETB2' },
]);

// La parrilla contiene estas palabras en títulos y sinopsis ajenos al ciclismo
// (por ejemplo, "a la vuelta de la esquina"). Exigir la disciplina explícita.
const CYCLING_RE = /\b(?:txirrindularitza|ciclismo|cycling)\b/i;
const REPLAY_RE = /\b(?:errepikapena|errepikatua|laburpena|onena|diferituan|repetici[oó]n|redifusi[oó]n|resumen|diferido|highlights?|best of)\b/i;
const LIVE_RE = /\b(?:zuzenean|en directo|directo|live)\b/i;
const STAGE_PATTERNS = [
  /\b(?:etapa|stage|jardunaldia)\s*(\d{1,2})\b/i,
  /\b(\d{1,2})\.?\s*(?:etapa|stage|jardunaldia)\b/i,
];

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

function text(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function fold(value) {
  return text(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function parseStageNumber(value) {
  for (const pattern of STAGE_PATTERNS) {
    const match = String(value || '').match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function zonedTimeToUtc(dateKey, localTime, timeZone = EITB_TIME_ZONE) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  let candidate = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
    const delta = Date.UTC(year, month - 1, day, hour, minute) - represented;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate).toISOString();
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeHtml(match?.[1] ?? match?.[2] ?? '');
}

function classContent(body, className) {
  return body.match(new RegExp(
    `<[^>]+class=(?:"[^"]*\\b${className}\\b[^"]*"|'[^']*\\b${className}\\b[^']*')[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    'i',
  ))?.[1] || '';
}

export function buildEitbScheduleUrl({ channelId, station }, dateKey) {
  if (!Number.isInteger(channelId) || !station || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new TypeError('EITB requiere channelId, station y fecha YYYY-MM-DD válidos');
  }
  return `${EITB_SCHEDULE_BASE_URL}/canal/${channelId}/emisoras/${encodeURIComponent(station)}/fecha/${dateKey}`;
}

export function parseEitbSchedule(html, {
  dateKey,
  channelId,
  station,
  sourceChannel,
  channel = sourceChannel,
  timeZone = EITB_TIME_ZONE,
  sourceUrl = buildEitbScheduleUrl({ channelId, station }, dateKey),
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '') || !sourceChannel || !station) {
    throw new TypeError('El parser EITB requiere dateKey, station y sourceChannel');
  }

  if (!/<li\b[^>]*class=(?:"[^"]*\bexpandible\b[^"]*"|'[^']*\bexpandible\b[^']*')/i.test(String(html))) {
    throw new Error(`EITB no devolvió una parrilla reconocible para ${station} el ${dateKey}`);
  }

  const sectionMarkers = [...String(html).matchAll(
    /<div\b[^>]*id=(?:"(manyana|tarde|noche|madrugada)\d*"|'(manyana|tarde|noche|madrugada)\d*')[^>]*>/gi,
  )].map((match) => ({ index: match.index, section: match[1] || match[2] }));
  const items = [...String(html).matchAll(
    /<li\b[^>]*class=(?:"[^"]*\bexpandible\b[^"]*"|'[^']*\bexpandible\b[^']*')[^>]*>([\s\S]*?)<\/li>/gi,
  )];
  const events = [];

  for (const itemMatch of items) {
    const body = itemMatch[1];
    const localTime = text(classContent(body, 'hora')).match(/\b(\d{1,2}:\d{2})\b/)?.[1];
    const heading = body.match(/<h2\b[^>]*class=(?:"[^"]*\btitulo\b[^"]*"|'[^']*\btitulo\b[^']*')[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '';
    const subtitle = text(classContent(heading, 'titulo_emision'));
    const title = text(heading.replace(
      /<span\b[^>]*class=(?:"[^"]*\btitulo_emision\b[^"]*"|'[^']*\btitulo_emision\b[^']*')[^>]*>[\s\S]*?<\/span>/gi,
      '',
    )).replace(/\s+-\s*$/, '');
    const description = text(classContent(body, 'entradilla'));
    const evidenceText = [title, subtitle, description].filter(Boolean).join(' · ');
    if (!localTime || !title || !CYCLING_RE.test(evidenceText) || REPLAY_RE.test(evidenceText)) continue;

    const section = sectionMarkers.filter((marker) => marker.index < itemMatch.index).at(-1)?.section || null;
    const eventDateKey = section === 'madrugada' ? addDays(dateKey, 1) : dateKey;
    const hrefTag = heading.match(/<a\b[^>]*>/i)?.[0] || '';
    const href = attribute(hrefTag, 'href');
    const liveMatches = [...evidenceText.matchAll(new RegExp(LIVE_RE.source, 'gi'))].map((match) => match[0]);
    const stageNumber = parseStageNumber(evidenceText);
    const identity = `${eventDateKey}|${station}|${fold(title)}|${stageNumber ?? 'one-day'}`;

    events.push({
      source: 'eitb',
      externalEventId: hash(identity),
      dateKey: eventDateKey,
      title,
      subtitle: subtitle || description || null,
      stageNumber,
      startTimeUtc: zonedTimeToUtc(eventDateKey, localTime, timeZone),
      localStartTime: localTime,
      timeZone,
      sourceChannel,
      channel,
      country: 'ES',
      sourceUrl,
      broadcastUrl: href ? new URL(href, 'https://www.eitb.eus').href : null,
      isLive: liveMatches.length ? true : null,
      liveEvidence: liveMatches,
      evidence: {
        channelId,
        station,
        section,
        scheduleTitle: title,
        scheduleSubtitle: subtitle || null,
        scheduleDescription: description || null,
      },
    });
  }

  events.sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
  return [...new Map(events.map((event) => [event.externalEventId, event])).values()];
}

export async function collectEitb({
  fetcher = globalThis.fetch,
  dateKeys,
  channels = EITB_CHANNELS,
} = {}) {
  if (typeof fetcher !== 'function' || !Array.isArray(dateKeys) || !dateKeys.length) {
    throw new TypeError('collectEitb requiere fetcher y al menos una fecha');
  }
  const events = [];
  for (const dateKey of dateKeys) {
    for (const channelConfig of channels) {
      const sourceUrl = buildEitbScheduleUrl(channelConfig, dateKey);
      const response = await fetcher(sourceUrl, { headers: { accept: 'text/html' } });
      if (!response?.ok) {
        throw new Error(`EITB respondió ${response?.status ?? 'sin estado'} para ${sourceUrl}`);
      }
      events.push(...parseEitbSchedule(await response.text(), {
        ...channelConfig, dateKey, sourceUrl,
      }));
    }
  }
  return events;
}
