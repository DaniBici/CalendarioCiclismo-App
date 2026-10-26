#!/usr/bin/env node
/**
 * Resultados de carretera de ACN Timing (acn-timing.com, cronometrador Chronorace).
 *
 * Reutiliza el cliente del fetcher de ciclocross (acn-cx-fetch.mjs). `acnCode`
 * identifica una tabla de resultados de un evento: `<eventId>/<ctx>/<clave>`,
 * p. ej. 2156365640493136/20261021_cac/ITTRES1 (CRI Elite masculina de los
 * Campeonatos de África 2026). Un evento ACN agrupa varias pruebas de un día y
 * cada carrera propia enlaza su tabla.
 *
 * - CRI: columnas Pos, Nr, Start (milisegundos desde la medianoche local),
 *   Time (absoluto, con milésimas) y Gap. ACN marca DNF a todo corredor sin
 *   llegada, también al que aún no ha salido o sigue en carrera.
 * - Línea: Pos, Nr y «Time / Gap» (tiempo del ganador y diferencia del resto;
 *   la celda vacía repite la diferencia anterior).
 * - Relevo mixto: una fila por selección con sus dorsales en «Team / Riders» y
 *   tiempo y diferencia en «Time / Gap»; se emite como CRE (`raceType='TTT'`).
 *   ACN marca DNS a la selección que aún no ha salido, y una prueba en tandas
 *   deja la tabla sin cambios entre ellas: el estado de una selección sin ningún
 *   paso registrado es definitivo tras RELAY_IDLE_MS sin cambios.
 *
 * Un DNF es definitivo cuando la tabla lleva QUIET_MS sin cambios (`Version`)
 * y, en CRI, ha vencido el plazo de llegada desde su salida. La CRI se publica
 * solo terminada: sin ningún DNF provisional, todos los corredores con llegada
 * o estado. En línea, la llegada del ganador cierra la prueba; los DNF
 * provisionales se omiten y la lista de inscritos impide el cierre automático
 * hasta completarse. Una tabla no modificada desde
 * el día de la prueba, o cuyo ganador no puede haber llegado aún según su
 * salida (CRI) o la de la jornada (línea), conserva datos de otra sesión y no
 * emite filas.
 *
 *   node scripts/results-fetchers/acn-results-fetch.mjs --code <eventId>/<ctx>/<clave> \
 *     --race-id <id> --competition-id <negativo> --date 2026-10-21 --timezone Africa/Nairobi --out <dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1aCodeUnits as fnv1a } from './pdf-results-ids.mjs';
import { acnVersionMs, fetchAcnEvent, fetchAcnTable, fetchAcnTree } from './acn-cx-fetch.mjs';
import { zonedInstant } from './mikatiming-results-fetch.mjs';

export const RESULTS_SOURCE = 'acn';
const VIEWER = 'https://www.acn-timing.com/?lng=EN#/events/';
const IRM = { DNF: 'DNF', ABD: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL', HD: 'OTL' };
// Tabla sin cambios durante este plazo: los DNF dejan de ser corredores en carrera.
export const QUIET_MS = 20 * 60_000;
// Relevo: tabla sin cambios durante este plazo antes de dar por definitivo el
// estado de una selección sin pasos. Campeonatos de África 2026: 19 min sin
// cambios entre la última llegada de la primera tanda y la salida de la segunda.
export const RELAY_IDLE_MS = 40 * 60_000;
// Plazo de llegada en CRI desde la salida de cada corredor: vez y media el
// tiempo del ganador, y al menos su tiempo más este margen.
const ITT_WINDOW_RATIO = 1.5;
const ITT_MIN_MARGIN_MS = 15 * 60_000;
const log = value => process.stderr.write(`${value}\n`);
const clean = value => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * acnCode: `<eventId>/<ctx>/<clave>[/<categoría>]`. La categoría filtra una tabla
 * conjunta: `elite` excluye y `u23` conserva solo las filas marcadas con «*»
 * (inscripción sub-23).
 */
export function parseCode(value) {
  const match = clean(value).match(/^(\d{6,20})\/(\d{8}_[A-Za-z0-9_-]+)\/([A-Za-z0-9_]+)(?:\/(elite|u23))?$/);
  if (!match) throw new Error(`acnCode no válido: ${value} (formato <eventId>/<ctx>/<clave>[/elite|/u23])`);
  return { eventId: match[1], ctx: match[2], key: match[3], category: match[4] || null,
    code: `${match[1]}/${match[2]}/${match[3]}${match[4] ? `/${match[4]}` : ''}` };
}

const negativeId = (seed, modulo = 2_000_000_000) => -(fnv1a(seed) % modulo || 1);
export const suggestCompetitionId = code => negativeId(`acn:${parseCode(code).code}`, 200_000);
export const synthRaceId = code => negativeId(`acn:${parseCode(code).code}:race`);
export const synthEventId = (code, kind, scope) => negativeId(`acn:${parseCode(code).code}:event:${kind}:${scope}`);

// «47:27.169», «+1:06.793», «3:53:06», «0:00:05» → milisegundos; vacío o «-» → null.
export function acnMillis(value) {
  const text = clean(value).replace(/^\+/, '');
  if (!text || text === '-') return null;
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(text);
  if (!match || Number(match[3]) > 59 || (match[1] != null && Number(match[2]) > 59)) throw new Error(`tiempo ACN no reconocido: «${value}»`);
  const [, hours = '0', minutes, seconds, fraction = ''] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, '0'));
}

const pad = value => String(value).padStart(2, '0');
function timeText(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
// Diferencia truncada a segundos: «+00», «+05», «+1:06», «+1:02:03».
function gapText(ms) {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `+${pad(total)}`;
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return h ? `+${h}:${pad(m)}:${pad(s)}` : `+${m}:${pad(s)}`;
}

/** Índices de columna por nombre; CRI con Start y Time/Gap separados, línea con «Time / Gap». */
export function acnColumns(columns) {
  if (!Array.isArray(columns)) throw new Error('Tabla ACN sin columnas');
  const find = (pattern, required = true) => {
    const column = columns.find(item => pattern.test(String(item.Name)));
    if (!column && required) throw new Error(`Columna ACN ausente: ${pattern}`);
    return column ? column.FieldIdx : null;
  };
  const time = columns.find(item => /(^|_)Time( \/ Gap)?$/.test(String(item.Name)));
  if (!time) throw new Error('Columna ACN ausente: Time');
  return { pos: find(/(^|_)Pos$/), bib: find(/(^|_)Nr$/), name: find(/Name/, false), time: time.FieldIdx,
    combined: / \/ Gap$/.test(time.Name), gap: find(/(^|_)Gap$/, false), start: find(/(^|_)Start$/, false) };
}

/**
 * Filas de una tabla ACN → filas del contrato de results-upsert.
 * `startAt(ms)` convierte la salida (milisegundos desde la medianoche local) en
 * instante UTC; `now` y `version` deciden si un DNF es definitivo. Con
 * `category`, la clasificación se limita a esa categoría: puestos renumerados y
 * diferencias respecto a su primer clasificado.
 */
export function acnRows(table, { now = Date.now(), startAt = null, category = null } = {}) {
  const index = acnColumns(table?.TableDefinition?.Columns);
  const source = table?.Groups?.[0]?.SlaveRows;
  if (!Array.isArray(source)) throw new Error('Tabla ACN sin filas');
  if (category && index.name == null) throw new Error('Tabla ACN sin columna de nombre: no se puede filtrar la categoría');
  const parsed = source.map((raw, sourceRow) => {
    const posText = clean(raw[index.pos]).toUpperCase();
    const bib = Number(String(raw[index.bib] ?? '').replace(/\D/g, ''));
    if (!Number.isInteger(bib) || bib <= 0) throw new Error(`Fila ${sourceRow + 1}: dorsal ACN no válido «${raw[index.bib]}»`);
    const rank = /^(\d+)\.?$/.exec(posText);
    const [timeCell = ''] = String(raw[index.time] ?? '').split(/<br\s*\/?>/i).map(clean);
    const startMs = index.start == null || raw[index.start] == null || raw[index.start] === '' ? null : Number(raw[index.start]);
    // La inscripción sub-23 lleva «*» junto al nombre, dentro o fuera de la negrita.
    // ACN publica a veces fuera de carrera filas sin nombre (Campeonato de África
    // 2026, dorsal 29 OTL): su categoría queda sin determinar (`u23: null`).
    const [nameCell] = String(raw[index.name] ?? '').split(/<br\s*\/?>/i);
    const named = Boolean(clean(nameCell));
    if (category && !named && rank) throw new Error(`Dorsal ${bib}: clasificado sin nombre; no se puede filtrar la categoría`);
    return { sourceRow, bib: String(bib), rank: rank ? Number(rank[1]) : null, status: rank ? null : posText, timeCell,
      gapCell: index.gap == null ? '' : clean(raw[index.gap]), startMs: Number.isFinite(startMs) ? startMs : null,
      u23: named ? nameCell.includes('*') : null };
  });
  const inCategory = row => !category || (category === 'u23') === row.u23;
  const seen = new Set();
  for (const row of parsed) {
    if (seen.has(row.bib)) throw new Error(`Dorsal ${row.bib} repetido en la tabla ACN`);
    seen.add(row.bib);
  }
  const ranked = parsed.filter(row => row.rank != null);
  if (ranked.some((row, position) => row.rank !== position + 1)) throw new Error('Puestos ACN no consecutivos o fuera de orden');
  const timeTrial = !index.combined;
  if (!ranked.length) return { rows: [], pending: [], timeTrial, winnerMs: null, winnerFinishAt: null };

  // Tiempo de cada clasificado: absoluto en CRI; en línea, el del ganador y la diferencia del resto.
  let previous = 0;
  const elapsed = ranked.map((row, position) => {
    if (index.combined) {
      if (position === 0) {
        const winner = acnMillis(row.timeCell);
        if (winner == null) throw new Error('La clasificación ACN no tiene ganador con tiempo');
        return { row, gap: 0, absolute: winner };
      }
      const gap = row.timeCell ? acnMillis(row.timeCell) : previous;
      if (gap < previous) throw new Error(`Dorsal ${row.bib}: diferencia menor que la del puesto anterior`);
      previous = gap;
      return { row, gap };
    }
    const absolute = acnMillis(row.timeCell);
    if (absolute == null) throw new Error(`Dorsal ${row.bib}: clasificado sin tiempo`);
    return { row, absolute };
  });
  if (!index.combined) {
    const winner = elapsed[0].absolute;
    for (const item of elapsed) {
      item.gap = item.absolute - winner;
      if (item.gap < previous) throw new Error(`Dorsal ${item.row.bib}: tiempo menor que el del puesto anterior`);
      previous = item.gap;
      const published = acnMillis(item.row.gapCell);
      if (published != null && Math.abs(published - item.gap) > 1) {
        throw new Error(`Dorsal ${item.row.bib}: diferencia ${item.row.gapCell} no corresponde al tiempo ${item.row.timeCell}`);
      }
    }
  }
  // Tiempo y diferencia respecto al primer clasificado de la categoría.
  const kept = elapsed.filter(item => inCategory(item.row));
  const rows = kept.map(({ row, gap }, position) => {
    const rank = position + 1;
    const base = { rank, rankText: String(rank), bib: row.bib, points: null, irm: null };
    if (position === 0) { const text = timeText(elapsed[0].absolute + gap); return { ...base, resultValue: text, timeText: text, gapText: null }; }
    const text = gapText(gap - kept[0].gap);
    return { ...base, resultValue: text, timeText: null, gapText: text };
  });

  const version = acnVersionMs(table.Version);
  const quiet = Number.isFinite(version) && now - version >= QUIET_MS;
  const winnerMs = elapsed[0].absolute ?? 0;
  const window = Math.max(ITT_WINDOW_RATIO * winnerMs, winnerMs + ITT_MIN_MARGIN_MS);
  const pending = [];
  for (const row of parsed.filter(item => item.rank == null)) {
    if (category && row.u23 == null) { pending.push({ bib: row.bib, reason: 'fila sin nombre: categoría desconocida' }); continue; }
    if (!inCategory(row)) continue;
    const irm = IRM[row.status];
    if (!irm) { pending.push({ bib: row.bib, reason: `estado «${row.status || '∅'}»` }); continue; }
    if (irm === 'DNF') {
      if (!quiet) { pending.push({ bib: row.bib, reason: 'tabla en actualización' }); continue; }
      const start = row.startMs != null && startAt ? startAt(row.startMs) : null;
      if (start != null && now < start + window) { pending.push({ bib: row.bib, reason: 'en carrera o por salir' }); continue; }
    }
    rows.push({ rank: null, rankText: irm, bib: row.bib, resultValue: null, timeText: null, gapText: null, points: null, irm });
  }
  // Llegada del ganador en CRI: su salida más su tiempo.
  const winnerStart = ranked[0].startMs != null && startAt ? startAt(ranked[0].startMs) : null;
  return { rows, pending, timeTrial, winnerMs: elapsed[0].absolute,
    winnerFinishAt: winnerStart == null ? null : winnerStart + elapsed[0].absolute };
}

/** Tabla de relevo mixto: una fila por selección con sus corredores en «Team / Riders». */
export const acnIsRelay = table => (table?.TableDefinition?.Columns || []).some(column => /^Team \/ Riders$/.test(String(column.Name)));

/**
 * Relevo mixto: por selección, el primer dorsal con puesto (o estado) y tiempo
 * absoluto, y el resto de componentes detrás sin puesto ni tiempo, como los
 * relevos de Tissot y EvoData. «Time / Gap» lleva el tiempo de la selección y su
 * diferencia, que se contrasta. Una selección sin puesto sigue en carrera; un
 * DNF es provisional mientras la tabla cambia. Una selección con estado y sin
 * ningún paso (ninguna celda con cifras fuera de puesto y componentes) puede no
 * haber salido aún: su estado es provisional hasta RELAY_IDLE_MS sin cambios.
 */
export function acnRelayRows(table, { now = Date.now() } = {}) {
  const columns = table?.TableDefinition?.Columns || [];
  const find = pattern => {
    const column = columns.find(item => pattern.test(String(item.Name)));
    if (!column) throw new Error(`Columna ACN ausente: ${pattern}`);
    return column.FieldIdx;
  };
  const index = { pos: find(/(^|_)Pos$/), team: find(/^Team \/ Riders$/), time: find(/(^|_)Time \/ Gap$/) };
  const source = table?.Groups?.[0]?.SlaveRows;
  if (!Array.isArray(source)) throw new Error('Tabla ACN sin filas');
  const seen = new Set();
  const teams = source.map((raw, sourceRow) => {
    const html = String(raw[index.team] ?? '');
    const teamName = clean(/<b>([\s\S]*?)<\/b>/i.exec(html)?.[1]).replace(/\s*\([A-Z]{3}\)$/, '')
      .toLowerCase().replace(/(^|[\s-])\p{L}/gu, letter => letter.toUpperCase());
    const bibs = [...html.matchAll(/(?:^|>)\s*(\d+)\s+-\s+[^<]*?\(\w+\)/g)].map(match => match[1]);
    if (!teamName || !bibs.length) throw new Error(`Fila ${sourceRow + 1}: selección ACN sin nombre o sin corredores`);
    for (const bib of bibs) {
      if (seen.has(bib)) throw new Error(`Dorsal ${bib} repetido en el relevo ACN`);
      seen.add(bib);
    }
    const posText = clean(raw[index.pos]).toUpperCase();
    const rank = /^(\d+)\.?$/.exec(posText);
    const [timeCell = '', gapCell = ''] = String(raw[index.time] ?? '').split(/<br\s*\/?>/i).map(clean);
    const started = raw.some((cell, field) => field !== index.pos && field !== index.team && /\d/.test(clean(cell)));
    return { teamName, bibs: bibs.sort((a, b) => Number(a) - Number(b)), rank: rank ? Number(rank[1]) : null,
      status: rank ? null : posText, started, timeCell, gapCell };
  });
  const ranked = teams.filter(team => team.rank != null).sort((a, b) => a.rank - b.rank);
  if (ranked.some((team, position) => team.rank !== position + 1)) throw new Error('Puestos ACN del relevo no consecutivos');
  if (!ranked.length) return { rows: [], pending: [], relay: true, winnerMs: null, winnerFinishAt: null };
  const winner = acnMillis(ranked[0].timeCell);
  let previous = winner;
  const member = (team, bib) => ({ rank: null, rankText: null, bib, teamName: team.teamName, resultValue: null, timeText: null,
    gapText: null, points: null, irm: null });
  const rows = [];
  for (const team of ranked) {
    const absolute = acnMillis(team.timeCell);
    if (absolute == null || absolute < previous) throw new Error(`${team.teamName}: tiempo de relevo ausente o menor que el anterior`);
    previous = absolute;
    const published = team.rank === 1 ? null : acnMillis(team.gapCell);
    if (published != null && Math.abs(published - (absolute - winner)) > 1) {
      throw new Error(`${team.teamName}: diferencia ${team.gapCell} no corresponde al tiempo ${team.timeCell}`);
    }
    const text = timeText(absolute);
    rows.push({ rank: team.rank, rankText: String(team.rank), bib: team.bibs[0], teamName: team.teamName, resultValue: text,
      timeText: text, gapText: null, points: null, irm: null }, ...team.bibs.slice(1).map(bib => member(team, bib)));
  }
  const version = acnVersionMs(table.Version);
  const quiet = Number.isFinite(version) && now - version >= QUIET_MS;
  const idle = Number.isFinite(version) && now - version >= RELAY_IDLE_MS;
  const pending = [];
  for (const team of teams.filter(item => item.rank == null)) {
    const irm = IRM[team.status];
    if (!irm) { pending.push({ team: team.teamName, reason: 'en carrera' }); continue; }
    if (!team.started && !idle) { pending.push({ team: team.teamName, reason: 'sin salida registrada' }); continue; }
    if (irm === 'DNF' && !quiet) { pending.push({ team: team.teamName, reason: 'tabla en actualización' }); continue; }
    rows.push({ rank: null, rankText: irm, bib: team.bibs[0], teamName: team.teamName, resultValue: null, timeText: null,
      gapText: null, points: null, irm }, ...team.bibs.slice(1).map(bib => member(team, bib)));
  }
  return { rows, pending, relay: true, winnerMs: winner, winnerFinishAt: null };
}

/**
 * Una clasificación cuyo ganador no puede haber llegado todavía es de otra
 * sesión (ACN conserva en las tablas de línea datos de prueba anteriores).
 * En CRI decide la salida del ganador; en línea, la salida de la jornada.
 */
export function acnPlausible({ winnerMs, winnerFinishAt }, { now, startUtc = null }) {
  if (winnerFinishAt != null) return winnerFinishAt <= now + 60_000;
  if (startUtc == null || winnerMs == null) return true;
  return Date.parse(startUtc) + 0.9 * winnerMs <= now;
}

/** Grupo y nombre de la tabla `key` en el árbol del evento. */
export function acnTableNode(tree, key) {
  let found = null;
  const walk = (node, folder) => {
    for (const child of node?.Childs || []) {
      if (found) return;
      if (child.Type === 'result') {
        let params = {};
        try { params = JSON.parse(child.Route || '{}').Params || {}; } catch { /* ruta sin parámetros */ }
        if (params.key === key) found = { groupId: child.Id, name: clean(folder?.DisplayName) || null };
      } else walk(child, child.Type === 'Folder' ? child : folder);
    }
  };
  walk(tree, null);
  return found;
}

export async function fetchClassification(rawCode, { read, date, timeZone, startUtc = null, now = Date.now() }) {
  const { eventId, ctx, key, category, code } = parseCode(rawCode);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('falta --date de la jornada');
  if (!timeZone) throw new Error('falta --timezone de la jornada');
  const event = await read.event(eventId);
  if (String(event?.EventId) !== eventId) throw new Error(`ACN ${code}: el evento devuelto no corresponde`);
  const [first, last] = [String(event.StartDate || '').slice(0, 10), String(event.EndDate || event.StartDate || '').slice(0, 10)];
  if (date < first || date > last) throw new Error(`ACN ${code}: la jornada ${date} está fuera del evento (${first} – ${last})`);
  const node = acnTableNode(await read.tree(ctx), key);
  if (!node) throw new Error(`ACN ${code}: la clave ${key} no figura en el árbol del evento`);
  const sourceUrl = `${VIEWER}${eventId}/ctx/${ctx}/generic/${node.groupId}/home/${key}`;
  const empty = { sourceUrl, name: node.name, stages: [] };
  const dayStart = zonedInstant(date, '00:00:00', timeZone);
  if (now < dayStart) { log(`∅ ${code}: jornada futura (${date})`); return empty; }
  const table = await read.table(ctx, key);
  const version = acnVersionMs(table?.Version);
  if (!Number.isFinite(version) || version < dayStart) { log(`∅ ${code}: tabla sin cambios desde antes del ${date}`); return empty; }
  const relay = acnIsRelay(table);
  if (relay && category) throw new Error(`ACN ${code}: el relevo no admite filtro de categoría`);
  const parsed = relay ? acnRelayRows(table, { now }) : acnRows(table, { now, startAt: ms => dayStart + ms, category });
  const { rows, pending } = parsed;
  if (!rows.some(row => row.rank === 1)) { log(`∅ ${code}: sin clasificados`); return empty; }
  if (!acnPlausible(parsed, { now, startUtc })) { log(`∅ ${code}: el ganador no puede haber llegado todavía; datos de otra sesión`); return empty; }
  // Una CRI o un relevo no se publican mientras haya corredores o selecciones
  // por salir o en carrera: ACN clasifica a medida que llegan y el orden cambia
  // hasta el último.
  if ((parsed.timeTrial || relay) && pending.length) {
    log(`∅ ${code}: ${relay ? 'relevo' : 'CRI'} en curso (${pending.length} ${relay ? 'selecciones' : 'corredores'} sin llegada definitiva)`);
    return empty;
  }
  const finished = rows.filter(row => row.rank != null).length;
  log(`✓ ${code} (${node.name}): ${finished} clasificados, ${rows.filter(row => row.irm).length} fuera de carrera${pending.length ? `, ${pending.length} pendientes` : ''}`);
  return { sourceUrl, name: node.name, pending, stages: [{
    uciRaceId: synthRaceId(code), stageNumber: null, stageName: 'Final Classification', isFinalClassification: true,
    raceType: relay ? 'TTT' : null, dateKey: date, sourcePdfUrl: sourceUrl,
    classifications: [{ eventId: synthEventId(code, 'gc', 'stage'), classKind: 'gc', scope: 'stage',
      eventName: 'General Classification', isTeamEvent: false, rowCount: rows.length, rows,
      publication: { provider: RESULTS_SOURCE, format: 'progressive', sourceModifiedAt: new Date(version).toISOString() } }],
  }] };
}

/** Lector de ACN; con fixture `{ event, tree, tables: { <clave>: tabla } }`, sin red. */
export function acnReader(fixture = null) {
  if (!fixture) return { event: fetchAcnEvent, tree: fetchAcnTree, table: fetchAcnTable };
  return {
    event: async () => fixture.event,
    tree: async () => fixture.tree,
    table: async (ctx, key) => {
      if (!(key in (fixture.tables || {}))) throw new Error(`fixture sin la tabla ${key}`);
      return fixture.tables[key];
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback = null) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
  const code = parseCode(arg('--code')).code;
  if (argv.includes('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(code)}\n`);
  const competitionId = Number(arg('--competition-id'));
  if (!Number.isInteger(competitionId) || competitionId >= 0) throw new Error('falta --competition-id negativo (o usa --suggest-id)');
  // --fixture: JSON { "now": "<ISO>", "event": …, "tree": …, "tables": { "<clave>": … } } para pruebas sin red.
  const fixture = arg('--fixture') ? JSON.parse(readFileSync(resolve(arg('--fixture')), 'utf8')) : null;
  const result = await fetchClassification(code, { read: acnReader(fixture), date: arg('--date'), timeZone: arg('--timezone'),
    startUtc: arg('--start-utc') || arg('--neutral-start-utc'), now: fixture?.now ? Date.parse(fixture.now) : Date.now() });
  const raceId = arg('--race-id');
  const output = { ...(raceId ? { raceId } : {}), competitionId, disciplineId: 10, source: RESULTS_SOURCE, acnCode: code,
    sourceUrl: result.sourceUrl, fetchedAt: new Date().toISOString(), stages: result.stages };
  const out = arg('--out', '.');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${competitionId}.json`), JSON.stringify(output, null, 2));
  if (argv.includes('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { log(`FATAL: ${error.stack || error.message}`); process.exitCode = 1; });
}
