#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import {
  CARACOL_SOURCE_URL, CARACOL_VUELTA_INDEX_URL, HBO_SOURCE_URL, PARSER_VERSION, RTVE_SOURCE_URLS,
  RTVE_LIVES_URL, RTVE_VUELTA_SCHEDULE_URL, RTVE_VUELTA_VIDEOS_URL,
  contentHash, dateKeyInZone, fold,
  desiredBroadcasts, matchObservation, newBroadcastRow, normalizedObservation, parseHboCatalog,
  parseCaracolDailyArticle, parseCaracolGuide, parseCaracolVueltaArticleUrls,
  parseHboEventStart, parseRtvePlayLives, parseRtveStructuredGuide, rtveDisciplineKey, rtveRaceHintMatch,
  parseRtveVueltaScheduleArticle, parseRtveVueltaVideos, rtveVueltaExternalEventId,
} from './broadcasts-sync-core.mjs';
import {
  EITB_CHANNELS, EITB_SCHEDULE_BASE_URL, collectEitb as collectEitbSource,
} from './eitb.mjs';
import {
  ETBON_PAGE_URLS, collectEtbon, isEtbonMediaUrl, mergeEtbonWithLinear,
} from './etbon.mjs';
import {
  SPORZA_LIVESTREAM_URL, SPORZA_SCHEDULE_BASE_URL, collectSporza as collectSporzaSource,
  parseSporzaLivestreamSchedule,
} from './sporza-collector.mjs';
import {
  RTBF_CHANNELS, RTBF_SCHEDULE_BASE_URL, parseRtbfSchedules, rtbfPageInfo, rtbfScheduleUrl,
} from './rtbf.mjs';

import {
  collectRai, RAI_PROGRAM_URL, RAI_TRANSITION_NOTE, raiUrl, classifyRaiObservation, raiMediaRank, raiKeepsCurrent, withRaiTransition,
} from './rai.mjs';
export { collectRai } from './rai.mjs';
import { collectLequipe, LEQUIPE_GUIDE_URL } from './lequipe.mjs';
export { collectLequipe } from './lequipe.mjs';

const ROLLBACK_ID = process.argv.find((arg) => arg.startsWith('--rollback='))?.split('=')[1] || null;
const SOURCE_ARG = process.argv.find((arg) => arg.startsWith('--source='))?.split('=')[1] || 'all';
// Caracol queda fuera de la pasada por defecto: solo se ejecuta con --source=caracol.
export const SOURCES = SOURCE_ARG === 'all'
  ? new Set(['hbo_max', 'rtve', 'eitb', 'sporza', 'rtbf', 'rai', 'lequipe'])
  : new Set(SOURCE_ARG.split(','));
const APPLY_ARG = process.argv.find((arg) => arg.startsWith('--apply-sources='))?.split('=')[1] || null;
export const APPLY_SOURCES = APPLY_ARG
  ? new Set(APPLY_ARG.split(',').filter(Boolean))
  : process.argv.includes('--apply') ? new Set(SOURCES) : new Set();
const STABILITY_MS = Number(process.env.BROADCASTS_STABILITY_MINUTES || 10) * 60_000;
const MAX_CHANGE_MS = 3 * 60 * 60_000;
const USER_AGENT = 'CalendarioCiclismo/broadcasts-sync (+https://calendariociclismo.app)';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': USER_AGENT },
    redirect: 'follow', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} al consultar ${url}`);
  return response.text();
}

export async function collectHbo(fetcher = fetchHtml) {
  const today = dateKeyInZone();
  const minDate = new Date(`${today}T00:00:00Z`); minDate.setUTCDate(minDate.getUTCDate() - 1);
  const maxDate = new Date(`${today}T00:00:00Z`); maxDate.setUTCDate(maxDate.getUTCDate() + 8);
  const catalog = parseHboCatalog(await fetcher(HBO_SOURCE_URL)).filter((event) => {
    const date = new Date(`${event.dateKey}T00:00:00Z`);
    return date >= minDate && date <= maxDate;
  });
  const observations = [];
  for (const event of catalog) {
    const startTimeUtc = event.startTimeUtc || parseHboEventStart(await fetcher(event.sourceUrl));
    if (!startTimeUtc) continue;
    observations.push(normalizedObservation({ ...event, startTimeUtc }));
  }
  invariant(observations.length > 0, 'HBO Max no devolvió emisiones utilizables en la ventana -1/+8 días');
  return observations;
}

export async function collectRtve(fetcher = fetchHtml, now = new Date()) {
  const source = RTVE_SOURCE_URLS[0];
  const today = dateKeyInZone(now);
  const minDate = new Date(`${today}T00:00:00Z`); minDate.setUTCDate(minDate.getUTCDate() - 1);
  const maxDate = new Date(`${today}T00:00:00Z`); maxDate.setUTCDate(maxDate.getUTCDate() + 8);
  const [guideResult, scheduleResult, livesResult] = await Promise.allSettled([
    fetcher(source.url),
    fetcher(RTVE_VUELTA_SCHEDULE_URL),
    fetcher(RTVE_LIVES_URL),
  ]);
  const scheduleEvents = scheduleResult.status === 'fulfilled'
    ? parseRtveVueltaScheduleArticle(scheduleResult.value)
    : [];
  const livesByKey = new Map();
  const lives = livesResult.status === 'fulfilled' ? parseRtvePlayLives(livesResult.value) : [];
  const usedLives = new Set();
  for (const event of lives) {
    const key = `${event.dateKey}|${event.disciplineKey}`;
    if (!livesByKey.has(key)) livesByKey.set(key, []);
    livesByKey.get(key).push(event);
  }
  const scheduledVueltaStages = new Map(
    scheduleEvents.map((event) => [event.stageNumber, event.dateKey]),
  );
  const guideEvents = guideResult.status === 'fulfilled'
    ? parseRtveStructuredGuide(guideResult.value).filter((event) => {
      const isVuelta = /\b(?:la vuelta|vuelta a espana)\b/.test(fold(`${event.title} ${event.subtitle || ''}`));
      const scheduledDate = isVuelta ? scheduledVueltaStages.get(event.stageNumber) : null;
      return !scheduledDate || scheduledDate === event.dateKey;
    }).map((event) => {
      const isVuelta = /\b(?:la vuelta|vuelta a espana)\b/.test(fold(`${event.title} ${event.subtitle || ''}`));
      if (isVuelta || event.stageNumber != null) return event;
      const candidates = livesByKey.get(`${event.dateKey}|${rtveDisciplineKey(`${event.title} ${event.subtitle || ''}`)}`) || [];
      const live = candidates.find((candidate) => rtveRaceHintMatch(candidate.title, event.title));
      if (!live) return event;
      usedLives.add(live);
      return { ...event, startTimeUtc: live.startTimeUtc, broadcastUrl: live.broadcastUrl };
    })
    : [];
  // RTVE Play anuncia los eventos de un día antes de que la guía de
  // Teledeporte alcance esa fecha. Esos directos se observan por sí mismos y
  // convergen después con la guía mediante la identidad por jornada.
  const livesOnly = lives.filter((event) => !usedLives.has(event));
  const combined = new Map();
  for (const event of [...scheduleEvents, ...guideEvents, ...livesOnly]) {
    const isVuelta = /\b(?:la vuelta|vuelta a espana)\b/.test(fold(`${event.title} ${event.subtitle || ''}`));
    const identity = isVuelta ? 'la-vuelta' : event.externalEventId;
    const canonicalEvent = isVuelta && Number.isInteger(event.stageNumber)
      ? { ...event, externalEventId: rtveVueltaExternalEventId(event.dateKey, event.stageNumber) }
      : event;
    combined.set(`${identity}|${event.dateKey}|${event.stageNumber ?? 'one-day'}`, canonicalEvent);
  }
  const observations = [...combined.values()].filter((event) => {
      const date = new Date(`${event.dateKey}T00:00:00Z`);
      return date >= minDate && date <= maxDate;
    })
    .map(normalizedObservation);
  invariant(observations.length > 0, 'RTVE no devolvió emisiones de ciclismo en la ventana -1/+8 días');
  return observations;
}

// Jornadas de La Vuelta masculina en la ventana; el nombre de la carrera varía por edición.
export async function loadVueltaDateKeys(client, minDateKey, maxDateKey) {
  const { rows } = await client.query(
    `SELECT DISTINCT d."dateKey"
       FROM public.race_days d JOIN public.races r ON r.id = d."raceId"
      WHERE r.gender = 'male'
        AND r.name ~* '^la vuelta( ciclista a españa)?$'
        AND d."dateKey" BETWEEN $1 AND $2
        AND d."editorialStatus" = 'published'
        AND NOT COALESCE(d."isRestDay", false)
        AND NOT COALESCE(d."isCancelledDay", false)
      ORDER BY d."dateKey"`,
    [minDateKey, maxDateKey],
  );
  return rows.map((row) => row.dateKey);
}

// Caracol solo cubre La Vuelta. `options.raceDateKeys(min, max)` devuelve las
// jornadas del calendario en la ventana: sin ninguna, el vacío es un diagnóstico
// y no se consulta la fuente. Con La Vuelta en la ventana, un error HTTP de la
// guía o de la portada, o la ausencia de emisiones utilizables, es un fallo.
export async function collectCaracol(fetcher = fetchHtml, now = new Date(), options = {}) {
  const today = dateKeyInZone(now, 'America/Bogota');
  const minDate = new Date(`${today}T00:00:00Z`); minDate.setUTCDate(minDate.getUTCDate() - 1);
  const maxDate = new Date(`${today}T00:00:00Z`); maxDate.setUTCDate(maxDate.getUTCDate() + 8);
  const minKey = minDate.toISOString().slice(0, 10);
  const maxKey = maxDate.toISOString().slice(0, 10);
  if (options.raceDateKeys && !(await options.raceDateKeys(minKey, maxKey)).length) {
    options.diagnostics?.push({
      source: 'caracol', action: 'outside_race_window', sourceUrl: CARACOL_SOURCE_URL,
      detail: `La Vuelta no tiene jornadas entre ${minKey} y ${maxKey}`,
    });
    return [];
  }
  const [guideHtml, indexHtml] = await Promise.all([
    fetcher(CARACOL_SOURCE_URL),
    fetcher(CARACOL_VUELTA_INDEX_URL),
  ]);
  const events = parseCaracolGuide(guideHtml);
  const articleUrls = parseCaracolVueltaArticleUrls(indexHtml);
  const articleResults = await Promise.allSettled(articleUrls.map((url) => fetcher(url)));
  articleResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      events.push(...parseCaracolDailyArticle(result.value, articleUrls[index]));
    }
  });

  const bestByStage = new Map();
  for (const event of events) {
    const current = bestByStage.get(event.externalEventId);
    if (!current || (event.evidenceRank || 0) > (current.evidenceRank || 0)) {
      bestByStage.set(event.externalEventId, event);
    }
  }
  const observations = [...bestByStage.values()]
    .filter((event) => {
      const date = new Date(`${event.dateKey}T00:00:00Z`);
      return date >= minDate && date <= maxDate;
    })
    .map(normalizedObservation)
    .sort((a, b) => a.startTimeUtc.localeCompare(b.startTimeUtc));
  invariant(observations.length > 0, 'Caracol no devolvió emisiones utilizables en la ventana -1/+8 días');
  return observations;
}

export async function collectRtveVueltaReplays(candidates, fetcher = fetchHtml) {
  if (!candidates.length) return [];
  const videos = parseRtveVueltaVideos(await fetcher(RTVE_VUELTA_VIDEOS_URL));
  return candidates.flatMap((candidate) => videos
    .filter((video) => video.dateKey === candidate.dateKey
      && video.stageNumber === Number(candidate.stageNumber))
    .map((video) => normalizedObservation({ ...video, startTimeUtc: candidate.startTimeUtc })));
}

function dateWindow(now, before, after, timeZone) {
  const today = dateKeyInZone(now, timeZone);
  return Array.from({ length: before + after + 1 }, (_, index) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + index - before);
    return value.toISOString().slice(0, 10);
  });
}

// EITB combina dos fuentes oficiales. ETB On publica cada directo con su
// deep-link `/m/` y la hora real de inicio; es la única que habilita escritura.
// La parrilla de ETB1/ETB2 solo aporta el relevo a la señal lineal. Un evento
// lineal sin directo equivalente en ETB On permanece en sombra.
export async function collectEitb(now = new Date(), options = {}) {
  const dateKeys = options.dateKeys || dateWindow(now, 1, 6, 'Europe/Madrid');
  const etbon = await collectEtbon({
    fetcher: options.etbonFetcher || fetchHtml,
    dateKeys,
  });
  let linear = [];
  try {
    linear = await collectEitbSource({
      dateKeys,
      channels: options.channels || EITB_CHANNELS,
      todayKey: dateKeyInZone(now, 'Europe/Madrid'),
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    });
  } catch (error) {
    options.diagnostics?.push({
      source: 'eitb', action: 'linear_schedule_failure',
      sourceUrl: EITB_SCHEDULE_BASE_URL, detail: error.message,
    });
  }
  const { events, unpairedLinear } = mergeEtbonWithLinear(etbon, linear);
  return [
    ...events.map((event) => normalizedObservation({
      ...event,
      writeEligible: isEtbonMediaUrl(event.broadcastUrl),
      reviveCapable: isEtbonMediaUrl(event.broadcastUrl),
      insertSortOrder: -25,
    })),
    ...unpairedLinear.map((event) => normalizedObservation({
      ...event,
      writeEligible: event.isLive === true && isEtbonMediaUrl(event.broadcastUrl),
      reviveCapable: isEtbonMediaUrl(event.broadcastUrl),
      insertSortOrder: -25,
    })),
  ];
}

function canonicalSporzaChannel(channels) {
  if (channels.includes('VRT 1')) return 'Sporza (één)';
  if (channels.includes('VRT Canvas')) return 'Sporza (canvas)';
  if (channels.includes('Ketnet')) return 'Sporza (Ketnet)';
  if (channels.includes('VRT MAX') || channels.includes('Sporza')) return 'Sporza';
  return null;
}

export async function collectSporza(now = new Date(), options = {}) {
  const dateKeys = options.dateKeys || dateWindow(now, 1, 2, 'Europe/Brussels');
  const events = [];
  for (const dateKey of dateKeys) {
    events.push(...await collectSporzaSource({
      dateKey,
      fetcher: options.fetcher,
      diagnostics: options.diagnostics,
    }));
  }
  // El esquema de livestreams declara directos que la parrilla deportiva no lista.
  try {
    const livestreamHtml = options.livestreamHtml
      ?? await fetchHtml(SPORZA_LIVESTREAM_URL);
    events.push(...parseSporzaLivestreamSchedule(livestreamHtml, {
      todayKey: dateKeyInZone(now, 'Europe/Brussels'),
    }));
  } catch (error) {
    options.diagnostics?.push({
      source: 'sporza',
      action: 'livestream_failure',
      sourceUrl: SPORZA_LIVESTREAM_URL,
      detail: error.message,
    });
  }
  const unique = new Map();
  for (const event of events) {
    if (!unique.has(`${event.externalEventId}|${event.dateKey}`)) unique.set(`${event.externalEventId}|${event.dateKey}`, event);
  }
  return [...unique.values()]
    .map((event) => ({ ...event, channel: canonicalSporzaChannel(event.sourceChannels) }))
    .filter((event) => event.channel)
    .map((event) => normalizedObservation({ ...event, writeEligible: true, insertSortOrder: 10 }));
}

export async function collectRtbf(now = new Date(), options = {}) {
  const dateKeys = options.dateKeys || dateWindow(now, 7, 8, 'Europe/Brussels');
  const scheduledAfter = `${dateKeys[0]}T00:00:00.000Z`;
  const scheduledBefore = `${dateKeys.at(-1)}T23:59:59.999Z`;
  const fetcher = options.fetcher || fetchHtml;
  const payloads = [];
  for (const channel of RTBF_CHANNELS) {
    const first = await fetcher(rtbfScheduleUrl(channel.id, scheduledAfter, scheduledBefore));
    payloads.push(first);
    const { last } = rtbfPageInfo(first);
    for (let page = 2; page <= last; page += 1) {
      payloads.push(await fetcher(rtbfScheduleUrl(channel.id, scheduledAfter, scheduledBefore, page)));
    }
  }
  const allowedDates = new Set(dateKeys);
  return parseRtbfSchedules(payloads)
    .filter((event) => allowedDates.has(event.dateKey))
    .map((event) => normalizedObservation({ ...event, writeEligible: true }));
}

async function withClient(callback) {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString: process.env.BROADCASTS_DATABASE_URL || process.env.DATABASE_URL,
    ssl: (process.env.BROADCASTS_DATABASE_URL || process.env.DATABASE_URL)?.includes('localhost')
      ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try { return await callback(client); } finally { await client.end(); }
}

async function loadContext(client, observations) {
  const dates = [...new Set(observations.flatMap((observation) => {
    if (observation.source !== 'rai') return [observation.dateKey];
    return Array.from({ length: 15 }, (_, index) => {
      const d = new Date(`${observation.dateKey}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - index);
      return d.toISOString().slice(0, 10);
    });
  }))];
  if (!dates.length) return { raceDays: [], broadcasts: [], links: [] };
  const { rows: raceDays } = await client.query(
    `SELECT d.id AS "raceDayId", d."raceId", d."dateKey", d."stageNumber",
            d."neutralStartTimeUtc", d."estimatedFinishTimeUtc",
            r.name, r."nameEn", r.translations, r.gender, r."raceFormat"
      FROM public.race_days d JOIN public.races r ON r.id = d."raceId"
      WHERE d."dateKey" = ANY($1::text[])
        AND d."editorialStatus" = 'published'
        AND NOT COALESCE(d."isRestDay", false)
        AND NOT COALESCE(d."isCancelledDay", false)`,
    [dates],
  );
  const raceDayIds = raceDays.map((day) => day.raceDayId);
  const { rows: broadcasts } = await client.query(
    `SELECT id, "raceDayId", channel, country, "startTimeUtc", url, note, "sortOrder", "showInRevive", "automationLocked"
       FROM public.broadcasts WHERE "raceDayId" = ANY($1::text[])`,
    [raceDayIds],
  );
  const { rows: links } = await client.query(
    `SELECT * FROM private.broadcast_source_links
      WHERE source = ANY($1::text[]) AND external_event_id = ANY($2::text[])`,
    [[...new Set(observations.map((item) => item.source))], observations.map((item) => item.externalEventId)],
  );
  return { raceDays, broadcasts, links };
}

export async function loadRtveVueltaReplayCandidates(client, now = new Date()) {
  const year = Number(dateKeyInZone(now).slice(0, 4));
  const { rows } = await client.query(
    `SELECT d.id AS "raceDayId", d."dateKey", d."stageNumber",
            candidate."startTimeUtc"
       FROM public.race_days d
       JOIN public.races r ON r.id = d."raceId"
       JOIN LATERAL (
         SELECT b."startTimeUtc"
           FROM public.broadcasts b
          WHERE b."raceDayId" = d.id
            AND b."startTimeUtc" IS NOT NULL
            AND b.country = 'ES'
            AND b.channel IN ('RTVE', 'RTVE Play', 'Teledeporte', 'Teledeporte / RTVE Play',
              'RTVE Play / Teledeporte', 'TDP / RTVE Play', 'La 2 / RTVE Play', 'La 1 / RTVE Play')
          ORDER BY b."sortOrder", b.id
          LIMIT 1
       ) candidate ON true
      WHERE r.name = 'La Vuelta' AND r.year = $1
        AND d."editorialStatus" = 'published'
        AND NOT COALESCE(d."isRestDay", false)
        AND d."estimatedFinishTimeUtc" IS NOT NULL
        AND d."estimatedFinishTimeUtc" <= $2::timestamptz - interval '90 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM public.broadcasts locked
           WHERE locked."raceDayId" = d.id AND locked.country = 'ES'
             AND locked.channel IN ('RTVE', 'RTVE Play', 'Teledeporte', 'Teledeporte / RTVE Play',
               'RTVE Play / Teledeporte', 'TDP / RTVE Play', 'La 2 / RTVE Play', 'La 1 / RTVE Play')
             AND locked."automationLocked" = true
        )
      ORDER BY d."dateKey", d."stageNumber"`,
    [year, now.toISOString()],
  );
  return rows;
}

export function sameManagedState(current, applied) {
  if (!current || !applied) return false;
  return current.channel === applied.channel && current.country === applied.country
    && (current.startTimeUtc == null ? null : new Date(current.startTimeUtc).toISOString())
      === (applied.startTimeUtc == null ? null : new Date(applied.startTimeUtc).toISOString())
    && (current.url || null) === (applied.url || null)
    && (current.note || null) === (applied.note || null)
    && (applied.showInRevive == null
      || (current.showInRevive === true) === (applied.showInRevive === true));
}

function isOfficialObservation(observation) {
  try {
    const sourceHost = new URL(observation.sourceUrl).hostname;
    const broadcastHost = new URL(observation.broadcastUrl).hostname;
    if (observation.source === 'hbo_max') {
      return sourceHost === 'www.hbomax.com' && broadcastHost === 'play.hbomax.com';
    }
    if (observation.source === 'rtve') {
      return (sourceHost === 'www.rtve.es' || sourceHost === 'api.rtve.es') && broadcastHost.endsWith('.rtve.es');
    }
    if (observation.source === 'eitb') {
      return (sourceHost === 'www.eitb.eus' || sourceHost === 'etbon.eus')
        && isEtbonMediaUrl(observation.broadcastUrl);
    }
    if (observation.source === 'caracol') {
      const sourceOfficial = sourceHost === 'www.noticiascaracol.com' || sourceHost === 'noticiascaracol.com';
      const broadcastOfficial = broadcastHost === 'www.noticiascaracol.com' || broadcastHost === 'noticiascaracol.com';
      return sourceOfficial && broadcastOfficial;
    }
    if (observation.source === 'rai') {
      return !!raiUrl(observation.sourceUrl, '/') && !!raiUrl(observation.broadcastUrl,
        ['live', 'delayed', 'scheduled'].includes(observation.mediaKind) ? '/dirette/' : '/video/');
    }
    if (observation.source === 'rtbf') {
      return sourceHost === 'bff-service.rtbf.be' && broadcastHost === 'auvio.rtbf.be';
    }
    if (observation.source === 'lequipe') {
      return sourceHost === 'www.lequipe.fr' && broadcastHost === 'www.lequipe.fr';
    }
    return observation.source === 'sporza'
      && (sourceHost === 'sporza.be' || sourceHost.endsWith('.sporza.be'))
      && (broadcastHost === 'sporza.be' || broadcastHost.endsWith('.sporza.be'));
  } catch {
    return false;
  }
}

export function adoptionCandidate(observation, desired, dayRows) {
  if (!isOfficialObservation(observation)) return { status: 'invalid_source', rows: [] };
  if (observation.source === 'rai') {
    const rows = dayRows.filter((row) => row.country === 'IT'
      && /^(rai (sport|[123]|raiplay)|raiplay)( |$)/.test(fold(row.channel)));
    if (rows.some((row) => row.automationLocked)) return { status: 'manual_lock', rows };
    if (!rows.length) return { status: 'none', rows };
    if (rows.length !== 1 || !(raiUrl(rows[0].url, '/dirette/') || raiUrl(rows[0].url, '/video/'))) return { status: 'conflict', rows };
    return { status: 'adoptable', rows };
  }
  if (observation.source === 'rtve') {
    const canonical = new Set([
      'RTVE', 'RTVE Play', 'Teledeporte', 'Teledeporte / RTVE Play',
      'RTVE Play / Teledeporte', 'TDP / RTVE Play', 'La 2 / RTVE Play', 'La 1 / RTVE Play',
    ]);
    const rows = dayRows.filter((row) => {
      if (row.country !== 'ES' || !canonical.has(row.channel)) return false;
      try { return new URL(row.url).hostname.endsWith('.rtve.es'); } catch { return false; }
    });
    if (rows.some((row) => row.automationLocked === true)) return { status: 'manual_lock', rows };
    if (rows.length === 0) return { status: 'none', rows: [] };
    return rows.length === 1 ? { status: 'adoptable', rows } : { status: 'conflict', rows };
  }
  if (observation.source === 'caracol') {
    const canonical = new Set(['Caracol', 'Caracol TV', 'Caracol / Ditu', 'Caracol Sports / Ditu']);
    const rows = dayRows.filter((row) => {
      if (row.country !== 'LATAM' || !canonical.has(row.channel)) return false;
      try {
        const host = new URL(row.url).hostname;
        return host === 'www.noticiascaracol.com' || host === 'noticiascaracol.com';
      } catch { return false; }
    });
    if (rows.some((row) => row.automationLocked === true)) return { status: 'manual_lock', rows };
    if (rows.length === 0) return { status: 'none', rows: [] };
    return rows.length === 1 ? { status: 'adoptable', rows } : { status: 'conflict', rows };
  }
  if (observation.source === 'rtbf') {
    const canonical = new Set([
      'La Une', 'Tipik', 'RTBF Auvio', 'La Une / RTBF Auvio', 'Tipik / RTBF Auvio',
    ]);
    const rows = dayRows.filter((row) => {
      if (row.country !== 'BE' || !canonical.has(row.channel)) return false;
      try { return new URL(row.url).hostname === 'auvio.rtbf.be'; } catch { return false; }
    });
    if (rows.some((row) => row.automationLocked === true)) return { status: 'manual_lock', rows };
    if (rows.length === 0) return { status: 'none', rows: [] };
    return rows.length === 1 ? { status: 'adoptable', rows } : { status: 'conflict', rows };
  }
  if (observation.source === 'eitb') {
    // Una sola fila EITB por jornada. Un enlace ajeno a EITB, como un directo
    // de YouTube elegido por la redacción, no se sustituye automáticamente.
    const rows = dayRows.filter((row) => row.country === 'ES' && /^(?:eitb|etb ?[12]|etb on)\b/.test(fold(row.channel)));
    if (rows.some((row) => row.automationLocked === true)) return { status: 'manual_lock', rows };
    if (rows.length === 0) return { status: 'none', rows: [] };
    const official = (row) => {
      try { return ['etbon.eus', 'www.eitb.eus', 'eitb.eus'].includes(new URL(row.url).hostname); } catch { return false; }
    };
    return rows.length === 1 && official(rows[0]) ? { status: 'adoptable', rows } : { status: 'conflict', rows };
  }
  if (observation.source === 'lequipe') {
    const rows = dayRows.filter((row) => {
      if (row.country !== 'FR' || row.channel !== 'L\'Équipe TV') return false;
      try { return new URL(row.url).hostname === 'www.lequipe.fr'; } catch { return false; }
    });
    if (rows.some((row) => row.automationLocked === true)) return { status: 'manual_lock', rows };
    if (rows.length === 0) return { status: 'none', rows: [] };
    return rows.length === 1 ? { status: 'adoptable', rows } : { status: 'conflict', rows };
  }
  if (observation.source === 'sporza') {
    // El livestream solo declara «Sporza» y la parrilla puede declarar «Sporza (één)»:
    // una fila Sporza de otro canal en la jornada impide insertar una segunda.
    const family = dayRows.filter((row) => row.country === 'BE' && /^sporza\b/.test(fold(row.channel)));
    const exact = family.filter((row) => row.channel === desired[0].channel);
    if (family.some((row) => row.automationLocked === true)) return { status: 'manual_lock', rows: family };
    if (family.length === 0) return { status: 'none', rows: [] };
    if (exact.length === 1) return { status: 'adoptable', rows: exact };
    return { status: 'conflict', rows: family, detail: 'La jornada ya tiene una fila Sporza con otro canal' };
  }
  const groups = desired.map((item) => dayRows.filter(
    (row) => row.country === item.country && row.channel === item.channel,
  ));
  const matchingRows = groups.flat();
  if (matchingRows.some((row) => row.automationLocked === true)) {
    return { status: 'manual_lock', rows: matchingRows };
  }
  if (groups.every((rows) => rows.length === 0)) return { status: 'none', rows: [] };
  if (groups.every((rows) => rows.length === 1)
    && new Set(groups.map((rows) => rows[0].id)).size === groups.length) {
    return { status: 'adoptable', rows: groups.map((rows) => rows[0]) };
  }
  return { status: 'conflict', rows: groups.flat() };
}

async function stableObservation(client, observation) {
  const { rows } = await client.query(
    `SELECT observed_at FROM private.broadcast_source_observations
      WHERE source=$1 AND external_event_id=$2 AND source_hash=$3
        AND observed_at <= now() - ($4::bigint * interval '1 millisecond')
      ORDER BY observed_at DESC LIMIT 1`,
    [observation.source, observation.externalEventId, observation.sourceHash, STABILITY_MS],
  );
  return rows.length > 0;
}

async function recordObservation(client, observation, match, status, beforeState = null, afterState = null, error = null) {
  await client.query(
    `INSERT INTO private.broadcast_source_observations
      (source, external_event_id, source_url, parser_version, source_hash, normalized,
       match_evidence, status, before_state, after_state, error)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11)`,
    [observation.source, observation.externalEventId, observation.sourceUrl, PARSER_VERSION,
      observation.sourceHash, JSON.stringify(observation), JSON.stringify(match), status,
      beforeState && JSON.stringify(beforeState), afterState && JSON.stringify(afterState), error],
  );
}

export async function confirmTvStatus(client, raceDayId) {
  await client.query(
    `UPDATE public.race_days
        SET "tvStatus"='confirmed_time'
      WHERE id=$1 AND "tvStatus" IS DISTINCT FROM 'confirmed_time'`,
    [raceDayId],
  );
}

const MONTONERA_NOTE = 'La Montonera al terminar.';

export function withMontoneraNote(note, present) {
  const remainder = String(note || '')
    .replace(/(?:^|\s+)La Montonera al terminar\.(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!present) return remainder || null;
  return remainder ? `${remainder} ${MONTONERA_NOTE}` : MONTONERA_NOTE;
}

export function withRtbfTransitionNote(note, transition) {
  const remainder = String(note || '')
    // Se retira también el formato anterior «Pasa a La Une a las HH:MM.».
    .replace(/(?:^|\s+)(?:\d{2}:\d{2} > (?:La Une|Tipik)|Pasa a (?:La Une|Tipik) a las \d{2}:\d{2}\.)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!transition) return remainder || null;
  return remainder ? `${remainder} ${transition}` : transition;
}

export function withLinearTransitionNote(note, transition) {
  const remainder = String(note || '')
    .replace(/(?:^|\s+)Pasa a ETB ?[12] a las \d{2}:\d{2}\.(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!transition) return remainder || null;
  return remainder ? `${remainder} ${transition}` : transition;
}

// Una emisión ya iniciada conserva su hora: las fuentes corrigen el inicio
// real durante el directo o lo pierden al terminar, y eso no debe reescribir
// la fila.
const FROZEN_AFTER_START_SOURCES = new Set(['rtve', 'eitb']);

export function mergeManagedBroadcast(current, desired, source, now = new Date()) {
  const next = {
    ...current,
    ...desired,
    sortOrder: current.sortOrder,
    showInRevive: current.showInRevive === true || desired.showInRevive === true,
  };
  if (FROZEN_AFTER_START_SOURCES.has(source) && current.startTimeUtc
    && Date.parse(current.startTimeUtc) <= now.getTime()) {
    next.startTimeUtc = current.startTimeUtc;
  }
  delete next.insertSortOrder;
  delete next.hasMontonera;
  if (source === 'hbo_max') next.note = withMontoneraNote(current.note, desired.hasMontonera === true);
  if (source === 'rtve') {
    try {
      if (new URL(current.url).hostname.endsWith('.rtve.es')) next.url = current.url;
    } catch {}
  }
  if (source === 'rai') {
    const remainder = String(current.note || '')
      .replace(/(?:Resumen(?: de \d+ minutos)?\.|Repetición de la emisión\.|Diferido\.)/g, '')
      .replace(RAI_TRANSITION_NOTE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    next.note = [remainder, desired.note].filter(Boolean).join(' ') || null;
  }
  if (source === 'rtbf') next.note = withRtbfTransitionNote(current.note, desired.note);
  if (source === 'eitb') next.note = withLinearTransitionNote(current.note, desired.note);
  if (source === 'sporza' || source === 'caracol' || source === 'lequipe') next.note = current.note || null;
  return next;
}

function managedFields(observation) {
  const fields = ['startTimeUtc', 'url', 'channel', 'country', 'note', 'showInRevive'];
  if (observation.source === 'rtbf') fields.push('automationLocked');
  return fields;
}

export async function rollbackObservation(client, observationId) {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(
      `SELECT * FROM private.broadcast_source_observations WHERE id=$1 FOR UPDATE`, [observationId],
    );
    const action = rows[0];
    invariant(action, `No existe la observación ${observationId}`);
    invariant(action.status === 'applied_update', 'Solo se revierten actualizaciones; las altas nunca se autoborran');
    const before = Array.isArray(action.before_state) ? action.before_state : [];
    const after = Array.isArray(action.after_state) ? action.after_state : [];
    const ids = after.map((row) => row.id);
    const { rows: current } = await client.query(
      `SELECT id, "raceDayId", channel, country, "startTimeUtc", url, note, "sortOrder", "showInRevive"
         FROM public.broadcasts WHERE id = ANY($1::text[]) FOR UPDATE`, [ids],
    );
    invariant(
      current.length === after.length
        && current.every((row) => sameManagedState(row, after.find((item) => item.id === row.id))),
      'Rollback cancelado: las emisiones cambiaron después de la acción seleccionada',
    );
    for (const previous of before) {
      await client.query(
        `UPDATE public.broadcasts SET channel=$2,country=$3,"startTimeUtc"=$4,url=$5,note=$6,"sortOrder"=$7,
            "showInRevive"=COALESCE($8,"showInRevive") WHERE id=$1`,
        [previous.id, previous.channel, previous.country, previous.startTimeUtc,
          previous.url, previous.note || null, previous.sortOrder,
          previous.showInRevive == null ? null : previous.showInRevive === true],
      );
    }
    await client.query(
      `UPDATE private.broadcast_source_links
          SET last_applied=$3::jsonb, manual_lock=true,
              manual_lock_note=$4, updated_at=now()
        WHERE source=$1 AND external_event_id=$2`,
      [action.source, action.external_event_id, JSON.stringify(before), `Rollback de observación ${observationId}`],
    );
    await client.query(
      `INSERT INTO private.broadcast_source_observations
        (source,external_event_id,source_url,parser_version,source_hash,normalized,
         match_evidence,status,before_state,after_state)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'rollback',$8::jsonb,$9::jsonb)`,
      [action.source, action.external_event_id, action.source_url, PARSER_VERSION,
        action.source_hash, JSON.stringify(action.normalized), JSON.stringify({ rollbackOf: Number(observationId) }),
        JSON.stringify(current), JSON.stringify(before)],
    );
    await client.query('COMMIT');
    return { mode: 'rollback', observationId: Number(observationId), restored: before.map((row) => row.id) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function applyOne(client, observation, match, context) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`broadcast:${observation.source}:${observation.externalEventId}`]);
    const stable = await stableObservation(client, observation);
    const { rows: lockedLinks } = await client.query(
      `SELECT * FROM private.broadcast_source_links WHERE source=$1 AND external_event_id=$2 FOR UPDATE`,
      [observation.source, observation.externalEventId],
    );
    let link = lockedLinks[0] || null;
    if (!stable) {
      await recordObservation(client, observation, match, 'pending_stability');
      await client.query('COMMIT');
      return 'pending_stability';
    }
    if (link?.manual_lock) {
      await recordObservation(client, observation, match, 'manual_lock');
      await client.query('COMMIT');
      return 'manual_lock';
    }

    const desired = desiredBroadcasts(observation);
    const dayRows = context.broadcasts.filter((row) => row.raceDayId === match.raceDayId);
    if (!link) {
      const adoption = adoptionCandidate(observation, desired, dayRows);
      if (adoption.status === 'manual_lock') {
        await recordObservation(client, observation, match, 'manual_lock', adoption.rows, desired);
        await client.query('COMMIT');
        return 'manual_lock';
      }
      if (adoption.status === 'conflict' || adoption.status === 'invalid_source') {
        await recordObservation(client, observation, match, 'manual_conflict', adoption.rows, desired,
          adoption.status === 'invalid_source' ? 'Host de fuente no autorizado' : adoption.detail || null);
        await client.query('COMMIT');
        return 'manual_conflict';
      }
      if (adoption.status === 'adoptable') {
        const adopted = adoption.rows;
        const adoptedIds = adopted.map((row) => row.id);
        const { rows: conflictingLinks } = await client.query(
          `SELECT source,external_event_id,race_day_id,primary_broadcast_id,mirror_broadcast_id
             FROM private.broadcast_source_links
            WHERE primary_broadcast_id = ANY($1::text[])
               OR mirror_broadcast_id = ANY($1::text[])
            ORDER BY id
            FOR UPDATE`,
          [adoptedIds],
        );
        if (conflictingLinks.length > 0) {
          const identities = conflictingLinks
            .map((item) => `${item.source}:${item.external_event_id}`)
            .join(', ');
          await recordObservation(client, observation, match, 'manual_conflict', adopted, desired,
            `Emisión ya vinculada a ${identities}`);
          await client.query('COMMIT');
          return 'manual_conflict';
        }
        const { rows: createdLinks } = await client.query(
          `INSERT INTO private.broadcast_source_links
            (source,external_event_id,race_day_id,primary_broadcast_id,mirror_broadcast_id,
             managed_fields,last_source_hash,last_applied,last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,now()) RETURNING *`,
          [observation.source, observation.externalEventId, match.raceDayId, adopted[0].id,
            adopted[1]?.id || null, JSON.stringify(managedFields(observation)),
            observation.sourceHash, JSON.stringify(adopted)],
        );
        link = createdLinks[0];
      }
      if (adoption.status === 'none') {
      const inserted = [];
      for (const item of desired) {
        const row = newBroadcastRow(match.raceDayId, item);
        await client.query(
          `INSERT INTO public.broadcasts
            (id,"raceDayId",channel,country,"startTimeUtc",url,note,"sortOrder","showInRevive",translations)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [row.id, row.raceDayId, row.channel, row.country, row.startTimeUtc, row.url,
            row.note, row.sortOrder, row.showInRevive, JSON.stringify(row.translations)],
        );
        if (observation.source === 'rtbf' && observation.finalizeReplay) {
          await client.query(
            `UPDATE public.broadcasts SET "automationLocked"=true WHERE id=$1`,
            [row.id],
          );
          row.automationLocked = true;
        }
        inserted.push(row);
      }
      await client.query(
        `INSERT INTO private.broadcast_source_links
          (source,external_event_id,race_day_id,primary_broadcast_id,mirror_broadcast_id,
           managed_fields,last_source_hash,last_applied,last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,now())`,
        [observation.source, observation.externalEventId, match.raceDayId, inserted[0].id,
          inserted[1]?.id || null, JSON.stringify(managedFields(observation)),
          observation.sourceHash, JSON.stringify(inserted)],
      );
      if (observation.source !== 'rai' || observation.mediaKind === 'live') await confirmTvStatus(client, match.raceDayId);
      await recordObservation(client, observation, match, 'applied_insert', null, inserted);
      await client.query('COMMIT');
      return 'applied_insert';
      }
    }

    const ids = [link.primary_broadcast_id, link.mirror_broadcast_id].filter(Boolean);
    const { rows: current } = await client.query(
      `SELECT id, "raceDayId", channel, country, "startTimeUtc", url, note, "sortOrder", "showInRevive", "automationLocked"
         FROM public.broadcasts WHERE id = ANY($1::text[]) FOR UPDATE`, [ids],
    );
    if (current.some((row) => row.automationLocked === true)) {
      await recordObservation(client, observation, match, 'manual_lock', current, desired);
      await client.query('COMMIT');
      return 'manual_lock';
    }
    const lastApplied = Array.isArray(link.last_applied) ? link.last_applied : [];
    if (current.length !== desired.length || !current.every((row) => sameManagedState(row, lastApplied.find((old) => old.id === row.id)))) {
      await recordObservation(client, observation, match, 'optimistic_conflict', current, desired);
      await client.query('COMMIT');
      return 'optimistic_conflict';
    }
    if (observation.source === 'rai' && raiKeepsCurrent(current, observation)) {
      await recordObservation(client, observation, match, 'unchanged', current, current, 'Se conserva el vídeo o directo de mayor prioridad');
      await client.query('COMMIT');
      return 'unchanged';
    }
    const startedRows = FROZEN_AFTER_START_SOURCES.has(observation.source)
      && current.every((row) => row.startTimeUtc && Date.parse(row.startTimeUtc) <= Date.now());
    if (!startedRows && current.some((row) => Math.abs(Date.parse(observation.startTimeUtc) - Date.parse(row.startTimeUtc)) > MAX_CHANGE_MS)) {
      await recordObservation(client, observation, match, 'implausible_change', current, desired);
      await client.query('COMMIT');
      return 'implausible_change';
    }
    const after = [];
    let changed = false;
    for (let index = 0; index < current.length; index += 1) {
      const old = current.find((row) => row.id === ids[index]);
      const next = {
        ...mergeManagedBroadcast(old, desired[index], observation.source),
        id: ids[index], raceDayId: match.raceDayId,
      };
      if (observation.source === 'rtbf' && observation.finalizeReplay) next.automationLocked = true;
      const lockChanged = old.automationLocked !== next.automationLocked;
      if (!sameManagedState(old, next) || lockChanged) {
        await client.query(
          `UPDATE public.broadcasts SET channel=$2,country=$3,"startTimeUtc"=$4,url=$5,note=$6,
              "sortOrder"=$7,"showInRevive"=$8,"automationLocked"=$9 WHERE id=$1`,
          [next.id, next.channel, next.country, next.startTimeUtc, next.url, next.note || null, next.sortOrder,
            next.showInRevive === true, next.automationLocked === true],
        );
        changed = true;
      }
      after.push(next);
    }
    await client.query(
      `UPDATE private.broadcast_source_links SET last_source_hash=$3,last_applied=$4::jsonb,
          last_seen_at=now(),updated_at=now()
        WHERE source=$1 AND external_event_id=$2`,
      [observation.source, observation.externalEventId, observation.sourceHash, JSON.stringify(after)],
    );
    if (observation.source !== 'rai' || observation.mediaKind === 'live') await confirmTvStatus(client, match.raceDayId);
    await recordObservation(client, observation, match, changed ? 'applied_update' : 'unchanged', current, after);
    await client.query('COMMIT');
    return changed ? 'applied_update' : 'unchanged';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function applyRtveVueltaReplay(client, observation, match, context) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`broadcast:rtve-replay:${match.raceDayId}`]);
    if (!isOfficialObservation(observation)) {
      await recordObservation(client, observation, match, 'manual_conflict', null, null,
        'Host de fuente o vídeo RTVE no autorizado');
      await client.query('COMMIT');
      return 'manual_conflict';
    }
    if (!await stableObservation(client, observation)) {
      await recordObservation(client, observation, match, 'pending_stability');
      await client.query('COMMIT');
      return 'pending_stability';
    }
    const canonical = new Set([
      'RTVE', 'RTVE Play', 'Teledeporte', 'Teledeporte / RTVE Play',
      'RTVE Play / Teledeporte', 'TDP / RTVE Play', 'La 2 / RTVE Play', 'La 1 / RTVE Play',
    ]);
    const candidateIds = context.broadcasts
      .filter((row) => row.raceDayId === match.raceDayId && row.country === 'ES' && canonical.has(row.channel))
      .map((row) => row.id);
    const { rows } = await client.query(
      `SELECT id, "raceDayId", channel, country, "startTimeUtc", url, note, "sortOrder",
              "showInRevive", "automationLocked"
         FROM public.broadcasts WHERE id = ANY($1::text[]) FOR UPDATE`,
      [candidateIds],
    );
    if (rows.some((row) => row.automationLocked === true)) {
      await recordObservation(client, observation, match, 'manual_lock', rows, null);
      await client.query('COMMIT');
      return 'manual_lock';
    }
    const officialRows = rows.filter((row) => {
      if (row.country !== 'ES' || !canonical.has(row.channel)) return false;
      try { return new URL(row.url).hostname.endsWith('.rtve.es'); } catch { return false; }
    });
    if (officialRows.length !== 1 || rows.length !== officialRows.length) {
      await recordObservation(client, observation, match, 'manual_conflict', rows, null,
        `Se esperaba una emisión RTVE oficial y se encontraron ${officialRows.length}`);
      await client.query('COMMIT');
      return 'manual_conflict';
    }
    const before = officialRows[0];
    const after = {
      ...before, channel: 'RTVE', url: observation.broadcastUrl,
      showInRevive: true, automationLocked: true,
    };
    await client.query(
      `UPDATE public.broadcasts
          SET channel='RTVE', url=$2, "showInRevive"=true, "automationLocked"=true
        WHERE id=$1`,
      [before.id, observation.broadcastUrl],
    );
    await recordObservation(client, observation, match, 'applied_update', [before], [after]);
    await client.query('COMMIT');
    return 'applied_update';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export function rtveOneDayExternalEventId(raceDayId) {
  return contentHash(`rtve|one-day|${raceDayId}`).slice(0, 32);
}

function isRtveVuelta(observation) {
  return /\b(?:la vuelta|vuelta a espana)\b/.test(fold(`${observation.title} ${observation.subtitle || ''}`));
}

// Ajustes que dependen de la jornada emparejada:
// - RTVE y EITB no escriben una emisión que empieza después de la llegada
//   estimada: es una reposición o un diferido.
// - Un evento RTVE de un día usa una identidad estable por jornada, común a la
//   guía de Teledeporte y a RTVE Play, para no duplicar vínculos cuando una
//   fuente aparece después de la otra.
export function scopedObservation(observation, match, raceDay) {
  if (!['rtve', 'eitb'].includes(observation.source)) return observation;
  let next = observation;
  if (observation.source === 'rtve' && observation.stageNumber == null && !isRtveVuelta(observation)
    && !observation.finalizeReplay) {
    const { sourceHash, ...event } = observation;
    next = normalizedObservation({ ...event, externalEventId: rtveOneDayExternalEventId(match.raceDayId) });
  }
  const finish = raceDay?.estimatedFinishTimeUtc ? Date.parse(raceDay.estimatedFinishTimeUtc) : NaN;
  if (Number.isFinite(finish) && next.startTimeUtc && Date.parse(next.startTimeUtc) >= finish) {
    next = { ...next, writeEligible: false, shadowReason: 'Emisión posterior a la llegada estimada' };
  }
  return next;
}

function rtvePreference(a, b) {
  const eligible = (item) => (item.observation.writeEligible === false ? 1 : 0);
  const generic = (item) => (String(item.observation.broadcastUrl || '').includes('/play/videos/directo/') ? 0 : 1);
  return eligible(a) - eligible(b) || generic(a) - generic(b)
    || String(a.observation.startTimeUtc || '').localeCompare(String(b.observation.startTimeUtc || ''));
}

// Tras compartir identidad, la guía y RTVE Play pueden describir la misma
// jornada. Se conserva el directo elegible con enlace específico de RTVE Play
// y, a igualdad, el que empieza antes.
export function preferredRtveOneDayObservations(items) {
  const best = new Map();
  for (const item of items) {
    if (item.observation.source !== 'rtve' || item.match.status !== 'matched') continue;
    const key = item.observation.externalEventId;
    const current = best.get(key);
    if (!current || rtvePreference(item, current) < 0) best.set(key, item);
  }
  return items.filter((item) => item.observation.source !== 'rtve' || item.match.status !== 'matched'
    || best.get(item.observation.externalEventId) === item);
}

export async function run({ client = null, collectors = {} } = {}) {
  if (ROLLBACK_ID) {
    invariant(client || process.env.BROADCASTS_DATABASE_URL || process.env.DATABASE_URL, 'Falta BROADCASTS_DATABASE_URL');
    return client ? rollbackObservation(client, ROLLBACK_ID)
      : withClient((db) => rollbackObservation(db, ROLLBACK_ID));
  }
  const observations = [];
  const failures = [];
  const diagnostics = [];
  if (SOURCES.has('hbo_max')) {
    try { observations.push(...await (collectors.hbo || collectHbo)()); }
    catch (error) { failures.push({ source: 'hbo_max', sourceUrl: HBO_SOURCE_URL, error }); }
  }
  if (SOURCES.has('rtve')) {
    try { observations.push(...await (collectors.rtve || collectRtve)()); }
    catch (error) { failures.push({ source: 'rtve', sourceUrl: RTVE_SOURCE_URLS[0].url, error }); }
  }
  if (SOURCES.has('eitb')) {
    try {
      observations.push(...await (collectors.eitb
        ? collectors.eitb()
        : collectEitb(new Date(), { diagnostics })));
    }
    catch (error) { failures.push({ source: 'eitb', sourceUrl: ETBON_PAGE_URLS[0], error }); }
  }
  if (SOURCES.has('sporza')) {
    try {
      observations.push(...await (collectors.sporza
        ? collectors.sporza()
        : collectSporza(new Date(), { diagnostics })));
    }
    catch (error) { failures.push({ source: 'sporza', sourceUrl: SPORZA_SCHEDULE_BASE_URL, error }); }
  }
  if (SOURCES.has('caracol')) {
    try {
      observations.push(...await (collectors.caracol
        ? collectors.caracol()
        : collectCaracol(fetchHtml, new Date(), {
          diagnostics,
          raceDateKeys: (min, max) => (client
            ? loadVueltaDateKeys(client, min, max)
            : withClient((db) => loadVueltaDateKeys(db, min, max))),
        })));
    }
    catch (error) { failures.push({ source: 'caracol', sourceUrl: CARACOL_SOURCE_URL, error }); }
  }
  if (SOURCES.has('rtbf')) {
    try { observations.push(...await (collectors.rtbf || collectRtbf)()); }
    catch (error) { failures.push({ source: 'rtbf', sourceUrl: RTBF_SCHEDULE_BASE_URL, error }); }
  }
  if (SOURCES.has('rai')) {
    try { observations.push(...await (collectors.rai ? collectors.rai() : collectRai(new Date(), { diagnostics }))); }
    catch (error) { failures.push({ source: 'rai', sourceUrl: RAI_PROGRAM_URL, error }); }
  }
  if (SOURCES.has('lequipe')) {
    try { observations.push(...await (collectors.lequipe ? collectors.lequipe() : collectLequipe(new Date(), { diagnostics }))); }
    catch (error) { failures.push({ source: 'lequipe', sourceUrl: LEQUIPE_GUIDE_URL, error }); }
  }
  invariant(observations.length > 0 || failures.length > 0 || diagnostics.length > 0,
    'Las fuentes seleccionadas no devolvieron observaciones');
  invariant(client || process.env.BROADCASTS_DATABASE_URL || process.env.DATABASE_URL, 'Falta BROADCASTS_DATABASE_URL');

  const execute = async (db) => {
    if (SOURCES.has('rtve')) {
      try {
        const candidates = await loadRtveVueltaReplayCandidates(db);
        observations.push(...await (collectors.rtveReplays || collectRtveVueltaReplays)(candidates));
      } catch (error) {
        failures.push({ source: 'rtve', sourceUrl: RTVE_VUELTA_VIDEOS_URL, error });
      }
    }
    const context = await loadContext(db, observations);
    const report = [...diagnostics];
    for (const failure of failures) {
      const normalized = { source: failure.source, failedAt: new Date().toISOString(), message: failure.error.message };
      await db.query(
        `INSERT INTO private.broadcast_source_observations
          (source,external_event_id,source_url,parser_version,source_hash,normalized,status,error)
         VALUES ($1,'__source__',$2,$3,$4,$5::jsonb,'source_failure',$6)`,
        [failure.source, failure.sourceUrl, PARSER_VERSION, contentHash(normalized),
          JSON.stringify(normalized), failure.error.stack || failure.error.message],
      );
      report.push({ source: failure.source, sourceUrl: failure.sourceUrl,
        action: 'source_failure', error: failure.error.message });
    }
    const scoped = observations.map((observation) => {
      let match = matchObservation(observation, context.raceDays);
      if (observation.source === 'rai' && match.status === 'unmatched') {
        // Las reposiciones se emiten también en días posteriores a la carrera.
        for (let offset = 1; offset <= 14 && match.status === 'unmatched'; offset += 1) {
          const d = new Date(`${observation.dateKey}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - offset);
          const candidate = { ...observation, dateKey: d.toISOString().slice(0, 10) };
          match = matchObservation(candidate, context.raceDays);
          if (match.status !== 'unmatched') observation = candidate;
        }
      }
      if (observation.source === 'rai' && match.status === 'matched') {
        observation = classifyRaiObservation(observation, context.raceDays.find((d) => d.raceDayId === match.raceDayId));
        observation = normalizedObservation({ ...observation,
          externalEventId: contentHash(`rai|${match.raceDayId}`).slice(0, 32) });
      }
      if (match.status === 'matched') {
        observation = scopedObservation(observation, match,
          context.raceDays.find((d) => d.raceDayId === match.raceDayId));
      }
      return { observation, match };
    });
    const prepared = preferredRtveOneDayObservations(scoped).sort((a, b) => {
      if (a.observation.source !== 'rai' || b.observation.source !== 'rai') return 0;
      return raiMediaRank(b.observation.mediaKind) - raiMediaRank(a.observation.mediaKind)
        || (a.observation.startTimeUtc || '').localeCompare(b.observation.startTimeUtc || '')
        || (b.observation.durationSeconds || 0) - (a.observation.durationSeconds || 0);
    });
    const raiSeen = new Set();
    const raiLive = new Map();
    for (const { observation, match } of prepared) {
      if (observation.source !== 'rai' || match.status !== 'matched' || observation.mediaKind !== 'live') continue;
      if (!raiLive.has(match.raceDayId)) raiLive.set(match.raceDayId, []);
      raiLive.get(match.raceDayId).push(observation);
    }
    for (const entry of prepared) {
      let { observation } = entry;
      const { match } = entry;
      if (observation.source === 'rai' && match.status === 'matched') {
        if (raiSeen.has(match.raceDayId)) continue;
        raiSeen.add(match.raceDayId);
        observation = withRaiTransition(observation, raiLive.get(match.raceDayId));
      }
      let action = match.status;
      if (APPLY_SOURCES.has(observation.source)) {
        if (match.status === 'matched' && observation.writeEligible !== false) {
          action = observation.source === 'rtve' && observation.finalizeReplay
            ? await applyRtveVueltaReplay(db, observation, match, context)
            : await applyOne(db, observation, match, context);
        } else if (match.status === 'matched') {
          action = 'shadow_matched';
          await recordObservation(db, observation, match, action, null, null,
            observation.shadowReason || 'Evidencia insuficiente para escritura');
        }
        else await recordObservation(db, observation, match, match.status);
      } else {
        action = match.status === 'matched' ? 'shadow_matched' : match.status;
        await recordObservation(db, observation, match, action);
      }
      report.push({ source: observation.source, externalEventId: observation.externalEventId,
        title: observation.title, dateKey: observation.dateKey, startTimeUtc: observation.startTimeUtc,
        sourceUrl: observation.sourceUrl, ...(observation.source === 'rai' ? { mediaKind: observation.mediaKind } : {}), match, action });
    }
    const mode = APPLY_SOURCES.size === 0 ? 'shadow'
      : [...SOURCES].every((source) => APPLY_SOURCES.has(source)) ? 'apply' : 'mixed';
    return { mode, applySources: [...APPLY_SOURCES], degraded: failures.length > 0,
      observations: observations.length, failures: failures.length, report };
  };
  return client ? execute(client) : withClient(execute);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.degraded) process.exitCode = 1;
  }).catch((error) => {
    console.error(`FATAL: ${error.stack || error.message}`); process.exitCode = 1;
  });
}
