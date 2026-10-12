#!/usr/bin/env node
// Sincronizador de emisiones de ciclocross (`cx_broadcasts`).
//
// Fuentes oficiales:
// - HBO Max (catálogo de ciclismo, eventos `Cyclo-cross`): `Eurosport (HBO Max)`
//   en `EUROPA` y su pareja `TNT Sports (HBO Max)` en `UK_IE`, con la misma
//   hora y el hub de ciclismo, como en carretera.
// - Sporza (esquema de livestreams y calendario): `Sporza` en `BE`, con la ruta
//   estable `~matchId` y la hora de emisión declarada.
//
// Por defecto solo planifica (modo sombra). `--apply-sources=` concede escritura
// por fuente. Nunca elimina filas.
import { fileURLToPath } from 'node:url';
import { HBO_SOURCE_URL, dateKeyInZone } from './broadcasts-sync-core.mjs';
import { SPORZA_LIVESTREAM_URL, sporzaScheduleUrl } from './sporza-collector.mjs';
import {
  CX_SOURCES, CX_TIME_ZONE, HBO_CX_SOURCE, SPORZA_CX_SOURCE,
  addDays, desiredRows, joinSporzaCx, matchCxRace, parseHboCyclocrossCatalog,
  parseSporzaCxLivestreams, parseSporzaCxSchedule, planCxRace,
} from './cx-broadcasts-core.mjs';

const USER_AGENT = 'CalendarioCiclismo/broadcasts-sync (+https://calendariociclismo.app)';
const WINDOW_BEFORE_DAYS = 1;
const WINDOW_AFTER_DAYS = 8;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${response.status} al consultar ${url}`);
  return response.text();
}

// ---------------------------------------------------------------------------
// Colectores
// ---------------------------------------------------------------------------

function withinWindow(dateKey, fromKey, toKey) {
  return dateKey >= fromKey && dateKey <= toKey;
}

export async function collectHboCx({ fetcher = fetchText } = {}) {
  const { events, catalogEventCount } = parseHboCyclocrossCatalog(await fetcher(HBO_SOURCE_URL));
  if (catalogEventCount === 0) {
    throw new Error('El catálogo de HBO Max no contiene eventos: contrato de página modificado o catálogo vacío');
  }
  return { events, diagnostics: [] };
}

export async function collectSporzaCx({ fetcher = fetchText, todayKey } = {}) {
  const { events: livestreams, rowCount } = parseSporzaCxLivestreams(
    await fetcher(SPORZA_LIVESTREAM_URL), { todayKey },
  );
  if (rowCount === 0) {
    throw new Error('El esquema de livestreams de Sporza no contiene filas: contrato de página modificado');
  }
  const [fromKey, toKey] = [addDays(todayKey, -WINDOW_BEFORE_DAYS), addDays(todayKey, WINDOW_AFTER_DAYS)];
  const inWindow = livestreams.filter((event) => withinWindow(event.dateKey, fromKey, toKey));
  const matchesByDate = new Map();
  for (const dateKey of new Set(inWindow.map((event) => event.dateKey))) {
    matchesByDate.set(dateKey, parseSporzaCxSchedule(await fetcher(sporzaScheduleUrl(dateKey))));
  }
  return joinSporzaCx(inWindow, matchesByDate);
}

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------

export async function loadCxRaces(db, fromKey, toKey) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r."nameEn", r.venue, r."dateKey"::text AS "dateKey",
            r."endDateKey"::text AS "endDateKey", r."isCancelled",
            t.name AS "tournamentName", t."nameEn" AS "tournamentNameEn",
            coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'category', c.category, 'dateKey', c."dateKey"::text, 'isCancelled', c."isCancelled"))
                      FROM public.cx_race_categories c WHERE c."raceId" = r.id), '[]'::jsonb) AS categories
       FROM public.cx_races r
       LEFT JOIN public.cx_tournaments t ON t.id = r."tournamentId"
      WHERE r."dateKey" <= $2::date AND coalesce(r."endDateKey", r."dateKey") >= $1::date`,
    [fromKey, toKey],
  );
  return rows;
}

const BROADCAST_COLUMNS = `id, "raceId", category, channel, "startTimeUtc", url, note, country,
  "sortOrder", "showInRevive", "isSporza"`;

async function loadBroadcasts(db, raceIds) {
  if (raceIds.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT ${BROADCAST_COLUMNS} FROM public.cx_broadcasts WHERE "raceId" = ANY($1::text[])`,
    [raceIds],
  );
  const byRace = new Map();
  for (const row of rows) {
    if (!byRace.has(row.raceId)) byRace.set(row.raceId, []);
    byRace.get(row.raceId).push({
      ...row,
      startTimeUtc: row.startTimeUtc ? new Date(row.startTimeUtc).toISOString() : null,
    });
  }
  return byRace;
}

// Aplica el plan en una transacción: relee las filas de la carrera tras
// bloquearlas y vuelve a planificar, de modo que una edición concurrente desde
// el panel no se pisa. Las actualizaciones comparan enlace y hora previos.
export async function applyCxRacePlan(db, { raceId, entries, sources }) {
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['cc_cx_broadcasts_sync']);
    await db.query(
      'SELECT id FROM public.cx_broadcasts WHERE "raceId" = $1 FOR UPDATE',
      [raceId],
    );
    const { rows: fresh } = await db.query(
      `SELECT ${BROADCAST_COLUMNS} FROM public.cx_broadcasts WHERE "raceId" = $1`,
      [raceId],
    );
    const plan = planCxRace({ raceId, rows: fresh, entries });
    for (const row of plan.inserts) {
      await db.query(
        `INSERT INTO public.cx_broadcasts
           (id, "raceId", category, channel, "startTimeUtc", url, note, country, "sortOrder", "showInRevive", "isSporza")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [row.id, raceId, row.category, row.channel, row.startTimeUtc, row.url, row.note,
          row.country, row.sortOrder, row.showInRevive, row.isSporza],
      );
    }
    const applied = [];
    for (const update of plan.updates) {
      const assignments = [];
      const values = [];
      for (const [column, value] of Object.entries(update.set)) {
        values.push(value);
        assignments.push(`"${column}" = $${values.length}`);
      }
      values.push(update.id);
      const idParam = values.length;
      const guards = [];
      for (const column of ['url', 'startTimeUtc']) {
        if (!(column in update.before)) continue;
        values.push(update.before[column]);
        guards.push(column === 'startTimeUtc'
          ? `"startTimeUtc" IS NOT DISTINCT FROM $${values.length}::timestamptz`
          : `${column} = $${values.length}`);
      }
      const result = await db.query(
        `UPDATE public.cx_broadcasts SET ${assignments.join(', ')}
          WHERE id = $${idParam}${guards.length ? ` AND ${guards.join(' AND ')}` : ''}`,
        values,
      );
      if (result.rowCount !== 1) throw new Error(`Conflicto optimista en la fila ${update.id}`);
      applied.push(update);
    }
    if (plan.inserts.length || applied.length) {
      await db.query(
        `INSERT INTO private.cx_change_log (operation, "raceId", before, after, evidence)
         VALUES ('sync_broadcasts', $1, $2::jsonb, $3::jsonb, $4::jsonb)`,
        [
          raceId,
          JSON.stringify(applied.map((update) => ({ id: update.id, ...update.before }))),
          JSON.stringify([
            ...plan.inserts,
            ...applied.map((update) => ({ id: update.id, ...update.set })),
          ]),
          JSON.stringify({
            sources,
            events: entries.map((entry) => ({
              source: entry.event.source, id: entry.event.externalEventId, category: entry.event.category,
            })),
          }),
        ],
      );
    }
    await db.query('COMMIT');
    return plan;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Pasada
// ---------------------------------------------------------------------------

const SOURCE_URLS = {
  [HBO_CX_SOURCE]: HBO_SOURCE_URL,
  [SPORZA_CX_SOURCE]: SPORZA_LIVESTREAM_URL,
};

export async function runCxBroadcasts({
  client,
  applySources = new Set(),
  sources = CX_SOURCES,
  collectors = {},
  now = new Date(),
} = {}) {
  const todayKey = dateKeyInZone(now, CX_TIME_ZONE);
  const fromKey = addDays(todayKey, -WINDOW_BEFORE_DAYS);
  const toKey = addDays(todayKey, WINDOW_AFTER_DAYS);
  const report = [];
  const failures = [];
  const events = [];

  const collect = {
    [HBO_CX_SOURCE]: collectors[HBO_CX_SOURCE] || (() => collectHboCx()),
    [SPORZA_CX_SOURCE]: collectors[SPORZA_CX_SOURCE] || (() => collectSporzaCx({ todayKey })),
  };
  for (const source of sources) {
    try {
      const collected = await collect[source]();
      events.push(...collected.events.filter((event) => withinWindow(event.dateKey, fromKey, toKey)));
      report.push(...collected.diagnostics);
    } catch (error) {
      failures.push({ source, error });
      report.push({
        source, sourceUrl: SOURCE_URLS[source], action: 'source_failure', error: error.message,
      });
    }
  }

  const races = await loadCxRaces(client, fromKey, toKey);
  const entriesByRace = new Map();
  for (const event of events) {
    const base = {
      source: event.source, externalEventId: event.externalEventId,
      title: event.label || `${event.venueLabel} · ${event.competition}`, dateKey: event.dateKey,
      startTimeUtc: event.startTimeUtc, sourceUrl: event.sourceUrl,
    };
    if (!event.category) {
      report.push({ ...base, action: 'insufficient_broadcast_evidence',
        detail: `Categoría no reconocida en «${event.subtitle || event.competition}».` });
      continue;
    }
    const match = matchCxRace(event, races);
    if (match.status !== 'matched') {
      report.push({ ...base, action: match.status, category: event.category,
        detail: match.status === 'ambiguous'
          ? `Varias carreras coinciden con la sede «${event.venueLabel}».`
          : `Ninguna carrera CX del ${event.dateKey} coincide con la sede «${event.venueLabel}».`,
        candidates: match.candidates });
      continue;
    }
    const category = match.race.categories.find((item) => item.category === event.category);
    if (!category || category.isCancelled) {
      report.push({ ...base, action: 'unmatched', category: event.category, raceId: match.race.id,
        detail: !category
          ? `La carrera ${match.race.id} no tiene la categoría ${event.category}.`
          : `La categoría ${event.category} de la carrera ${match.race.id} está cancelada.` });
      continue;
    }
    if (!entriesByRace.has(match.race.id)) entriesByRace.set(match.race.id, []);
    entriesByRace.get(match.race.id).push({ event, desired: desiredRows(event), base, raceId: match.race.id });
  }

  const currentRows = await loadBroadcasts(client, [...entriesByRace.keys()]);
  for (const [raceId, entries] of entriesByRace) {
    const writable = entries.filter((entry) => applySources.has(entry.event.source));
    const shadow = entries.filter((entry) => !applySources.has(entry.event.source));
    const describe = (plan, applied) => plan.report.map((item) => {
      const entry = entries.find((candidate) => candidate.event.externalEventId === item.externalEventId
        && candidate.event.source === item.source);
      const action = item.action === 'insert' ? (applied ? 'applied_insert' : 'shadow_insert')
        : item.action === 'update' ? (applied ? 'applied_update' : 'shadow_update')
          : item.action;
      return { ...entry?.base, ...item, action, raceId };
    });
    try {
      if (shadow.length) {
        report.push(...describe(planCxRace({ raceId, rows: currentRows.get(raceId) || [], entries: shadow }), false));
      }
      if (writable.length) {
        const plan = await applyCxRacePlan(client, {
          raceId, entries: writable, sources: [...new Set(writable.map((entry) => entry.event.source))],
        });
        report.push(...describe(plan, true));
      }
    } catch (error) {
      for (const source of new Set(writable.map((entry) => entry.event.source))) {
        failures.push({ source, error });
      }
      for (const entry of writable) {
        report.push({ ...entry.base, raceId, action: 'apply_error', detail: error.message });
      }
    }
  }

  // Enlaces HBO Max gestionados que el catálogo vigente no reconoce: una prueba
  // que aún no ha empezado figura en el catálogo, de modo que un identificador
  // ausente indica un enlace erróneo o retirado.
  const hboFailed = failures.some((failure) => failure.source === HBO_CX_SOURCE);
  if (sources.includes(HBO_CX_SOURCE) && !hboFailed) {
    const catalogIds = new Set(events.filter((event) => event.source === HBO_CX_SOURCE)
      .map((event) => event.externalEventId));
    const upcoming = races.filter((race) => !race.isCancelled && race.dateKey >= todayKey && race.dateKey <= toKey);
    const rows = await loadBroadcasts(client, upcoming.map((race) => race.id));
    for (const race of upcoming) {
      for (const row of rows.get(race.id) || []) {
        const id = String(row.url || '').match(/^https:\/\/play\.hbomax\.com\/sport\/([0-9a-f-]{36})$/i)?.[1]?.toLowerCase();
        const notStarted = row.startTimeUtc ? Date.parse(row.startTimeUtc) > now.getTime() : race.dateKey > todayKey;
        if (!id || catalogIds.has(id) || !notStarted) continue;
        report.push({
          source: HBO_CX_SOURCE, externalEventId: id, raceId: race.id, category: row.category,
          title: `${race.name} (${row.category || 'global'})`, dateKey: race.dateKey,
          sourceUrl: row.url, action: 'unverified_link',
          detail: 'El identificador de HBO Max no figura en el catálogo vigente.',
        });
      }
    }
  }

  const mode = applySources.size === 0 ? 'shadow'
    : sources.every((source) => applySources.has(source)) ? 'apply' : 'mixed';
  return {
    mode,
    applySources: [...applySources].filter((source) => CX_SOURCES.includes(source)),
    degraded: failures.length > 0,
    failures: failures.length,
    observations: events.length,
    report,
  };
}

// Resumen por fuente con la forma que consume el monitor de Operaciones.
export function summarizeCxSource(source, report) {
  const rows = report.filter((row) => row.source === source);
  const count = (action) => rows.filter((row) => row.action === action).length;
  const errors = count('source_failure') + count('apply_error');
  const changed = count('applied_insert') + count('applied_update');
  const warningActions = [
    'unmatched', 'ambiguous', 'manual_lock', 'implausible_change',
    'insufficient_broadcast_evidence', 'unverified_link',
  ];
  const warnings = rows.filter((row) => warningActions.includes(row.action));
  const actions = rows.reduce((counts, row) => ({ ...counts, [row.action]: (counts[row.action] || 0) + 1 }), {});
  return {
    source,
    status: errors > 0 ? 'error' : warnings.length > 0 ? 'warning' : changed > 0 ? 'success' : 'noop',
    itemsFound: rows.filter((row) => !['source_failure', 'apply_error'].includes(row.action)).length,
    itemsMatched: rows.filter((row) => ['applied_insert', 'applied_update', 'unchanged', 'shadow_insert', 'shadow_update']
      .includes(row.action)).length,
    itemsChanged: changed,
    errors,
    summary: {
      actions,
      issues: [...rows.filter((row) => ['source_failure', 'apply_error'].includes(row.action)), ...warnings].slice(0, 8).map((row) => ({
        action: row.action, title: row.title || null, dateKey: row.dateKey || null,
        sourceUrl: row.sourceUrl || null, detail: row.detail || row.error || null,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// CLI: node scripts/broadcasts-sync/cx-broadcasts.mjs [--source=...] [--apply-sources=...]
// ---------------------------------------------------------------------------

async function main() {
  const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=')[1] || null;
  const sourceArg = arg('source');
  const applyArg = arg('apply-sources');
  const sources = sourceArg ? sourceArg.split(',').filter((source) => CX_SOURCES.includes(source)) : CX_SOURCES;
  if (sources.length === 0) throw new Error(`Fuente desconocida; opciones: ${CX_SOURCES.join(', ')}`);
  const applySources = new Set(process.argv.includes('--apply')
    ? sources
    : (applyArg || '').split(',').filter(Boolean));
  const connectionString = process.env.BROADCASTS_DATABASE_URL || process.env.DATABASE_URL
    || process.env.AGENT_DATABASE_URL;
  if (!connectionString) throw new Error('Falta BROADCASTS_DATABASE_URL');
  const { openAutomationClient } = await import('../automation-monitor.mjs');
  const client = await openAutomationClient(connectionString);
  try {
    const result = await runCxBroadcasts({ client, applySources, sources });
    console.log(JSON.stringify(result, null, 2));
    if (result.degraded) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`FATAL: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
