#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import {
  HBO_SOURCE_URL, PARSER_VERSION, RTVE_SOURCE_URLS, RTVE_VUELTA_VIDEOS_URL, contentHash, dateKeyInZone,
  desiredBroadcasts, matchObservation, newBroadcastRow, normalizedObservation, parseHboCatalog,
  parseHboEventStart, parseRtveStructuredGuide, parseRtveVueltaVideos,
} from './broadcasts-sync-core.mjs';
import {
  EITB_CHANNELS, EITB_SCHEDULE_BASE_URL, collectEitb as collectEitbSource,
} from './eitb.mjs';
import {
  SPORZA_SCHEDULE_BASE_URL, collectSporza as collectSporzaSource,
} from './sporza-collector.mjs';

const ROLLBACK_ID = process.argv.find((arg) => arg.startsWith('--rollback='))?.split('=')[1] || null;
const SOURCE_ARG = process.argv.find((arg) => arg.startsWith('--source='))?.split('=')[1] || 'all';
const SOURCES = SOURCE_ARG === 'all' ? new Set(['hbo_max', 'rtve', 'eitb', 'sporza']) : new Set(SOURCE_ARG.split(','));
const APPLY_ARG = process.argv.find((arg) => arg.startsWith('--apply-sources='))?.split('=')[1] || null;
const APPLY_SOURCES = APPLY_ARG
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
  const observations = parseRtveStructuredGuide(await fetcher(source.url))
    .filter((event) => {
      const date = new Date(`${event.dateKey}T00:00:00Z`);
      return date >= minDate && date <= maxDate;
    })
    .map(normalizedObservation);
  invariant(observations.length > 0, 'RTVE no devolvió emisiones de ciclismo en la ventana -1/+8 días');
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

function isDirectEitbBroadcastUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'etbon.eus' && url.pathname.startsWith('/m/');
  } catch {
    return false;
  }
}

export async function collectEitb(now = new Date(), options = {}) {
  const events = await collectEitbSource({
    dateKeys: dateWindow(now, 1, 6, 'Europe/Madrid'),
    channels: EITB_CHANNELS,
    ...options,
  });
  return events.map((event) => normalizedObservation({
    ...event,
    writeEligible: event.isLive === true && isDirectEitbBroadcastUrl(event.broadcastUrl),
    reviveCapable: isDirectEitbBroadcastUrl(event.broadcastUrl),
    insertSortOrder: -25,
  }));
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
    events.push(...await collectSporzaSource({ dateKey, fetcher: options.fetcher }));
  }
  return events.map((event) => ({ ...event, channel: canonicalSporzaChannel(event.sourceChannels) }))
    .filter((event) => event.channel)
    .map((event) => normalizedObservation({ ...event, writeEligible: true, insertSortOrder: 10 }));
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
  const dates = [...new Set(observations.map((observation) => observation.dateKey))];
  if (!dates.length) return { raceDays: [], broadcasts: [], links: [] };
  const { rows: raceDays } = await client.query(
    `SELECT d.id AS "raceDayId", d."raceId", d."dateKey", d."stageNumber",
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
    && new Date(current.startTimeUtc).toISOString() === new Date(applied.startTimeUtc).toISOString()
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
      return sourceHost === 'www.rtve.es' && broadcastHost.endsWith('.rtve.es');
    }
    if (observation.source === 'eitb') {
      return sourceHost === 'www.eitb.eus'
        && (broadcastHost === 'www.eitb.eus' || broadcastHost === 'eitb.eus' || broadcastHost === 'etbon.eus');
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

export function mergeManagedBroadcast(current, desired, source) {
  const next = {
    ...current,
    ...desired,
    sortOrder: current.sortOrder,
    showInRevive: current.showInRevive === true || desired.showInRevive === true,
  };
  delete next.insertSortOrder;
  delete next.hasMontonera;
  if (source === 'hbo_max') next.note = withMontoneraNote(current.note, desired.hasMontonera === true);
  if (source === 'rtve') {
    try {
      if (new URL(current.url).hostname.endsWith('.rtve.es')) next.url = current.url;
    } catch {}
  }
  if (source === 'eitb' || source === 'sporza') next.note = current.note || null;
  return next;
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

async function applyOne(client, observation, match, context) {
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
          adoption.status === 'invalid_source' ? 'Host de fuente no autorizado' : null);
        await client.query('COMMIT');
        return 'manual_conflict';
      }
      if (adoption.status === 'adoptable') {
        const adopted = adoption.rows;
        const { rows: createdLinks } = await client.query(
          `INSERT INTO private.broadcast_source_links
            (source,external_event_id,race_day_id,primary_broadcast_id,mirror_broadcast_id,
             managed_fields,last_source_hash,last_applied,last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,now()) RETURNING *`,
          [observation.source, observation.externalEventId, match.raceDayId, adopted[0].id,
            adopted[1]?.id || null, JSON.stringify(['startTimeUtc', 'url', 'channel', 'country', 'note', 'showInRevive']),
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
        inserted.push(row);
      }
      await client.query(
        `INSERT INTO private.broadcast_source_links
          (source,external_event_id,race_day_id,primary_broadcast_id,mirror_broadcast_id,
           managed_fields,last_source_hash,last_applied,last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,now())`,
        [observation.source, observation.externalEventId, match.raceDayId, inserted[0].id,
          inserted[1]?.id || null, JSON.stringify(['startTimeUtc', 'url', 'channel', 'country', 'note', 'showInRevive']),
          observation.sourceHash, JSON.stringify(inserted)],
      );
      await confirmTvStatus(client, match.raceDayId);
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
    if (current.some((row) => Math.abs(Date.parse(observation.startTimeUtc) - Date.parse(row.startTimeUtc)) > MAX_CHANGE_MS)) {
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
      if (!sameManagedState(old, next)) {
        await client.query(
          `UPDATE public.broadcasts SET channel=$2,country=$3,"startTimeUtc"=$4,url=$5,note=$6,"sortOrder"=$7,"showInRevive"=$8 WHERE id=$1`,
          [next.id, next.channel, next.country, next.startTimeUtc, next.url, next.note || null, next.sortOrder,
            next.showInRevive === true],
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
    await confirmTvStatus(client, match.raceDayId);
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

export async function run({ client = null, collectors = {} } = {}) {
  if (ROLLBACK_ID) {
    invariant(client || process.env.BROADCASTS_DATABASE_URL || process.env.DATABASE_URL, 'Falta BROADCASTS_DATABASE_URL');
    return client ? rollbackObservation(client, ROLLBACK_ID)
      : withClient((db) => rollbackObservation(db, ROLLBACK_ID));
  }
  const observations = [];
  const failures = [];
  if (SOURCES.has('hbo_max')) {
    try { observations.push(...await (collectors.hbo || collectHbo)()); }
    catch (error) { failures.push({ source: 'hbo_max', sourceUrl: HBO_SOURCE_URL, error }); }
  }
  if (SOURCES.has('rtve')) {
    try { observations.push(...await (collectors.rtve || collectRtve)()); }
    catch (error) { failures.push({ source: 'rtve', sourceUrl: RTVE_SOURCE_URLS[0].url, error }); }
  }
  if (SOURCES.has('eitb')) {
    try { observations.push(...await (collectors.eitb || collectEitb)()); }
    catch (error) { failures.push({ source: 'eitb', sourceUrl: EITB_SCHEDULE_BASE_URL, error }); }
  }
  if (SOURCES.has('sporza')) {
    try { observations.push(...await (collectors.sporza || collectSporza)()); }
    catch (error) { failures.push({ source: 'sporza', sourceUrl: SPORZA_SCHEDULE_BASE_URL, error }); }
  }
  invariant(observations.length > 0 || failures.length > 0, 'Las fuentes seleccionadas no devolvieron observaciones');
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
    const report = [];
    for (const failure of failures) {
      const normalized = { source: failure.source, failedAt: new Date().toISOString(), message: failure.error.message };
      await db.query(
        `INSERT INTO private.broadcast_source_observations
          (source,external_event_id,source_url,parser_version,source_hash,normalized,status,error)
         VALUES ($1,'__source__',$2,$3,$4,$5::jsonb,'source_failure',$6)`,
        [failure.source, failure.sourceUrl, PARSER_VERSION, contentHash(normalized),
          JSON.stringify(normalized), failure.error.stack || failure.error.message],
      );
      report.push({ source: failure.source, action: 'source_failure', error: failure.error.message });
    }
    for (const observation of observations) {
      const match = matchObservation(observation, context.raceDays);
      let action = match.status;
      if (APPLY_SOURCES.has(observation.source)) {
        if (match.status === 'matched' && observation.writeEligible !== false) {
          action = observation.finalizeReplay
            ? await applyRtveVueltaReplay(db, observation, match, context)
            : await applyOne(db, observation, match, context);
        } else if (match.status === 'matched') {
          action = 'shadow_matched';
          await recordObservation(db, observation, match, action, null, null, 'Evidencia insuficiente para escritura');
        }
        else await recordObservation(db, observation, match, match.status);
      } else {
        action = match.status === 'matched' ? 'shadow_matched' : match.status;
        await recordObservation(db, observation, match, action);
      }
      report.push({ source: observation.source, externalEventId: observation.externalEventId,
        title: observation.title, dateKey: observation.dateKey, startTimeUtc: observation.startTimeUtc,
        match, action });
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
