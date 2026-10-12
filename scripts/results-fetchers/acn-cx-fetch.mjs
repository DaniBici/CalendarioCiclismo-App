#!/usr/bin/env node
/**
 * ACN Timing / Chronorace → documento de resultados CX (contrato de cx-results-upsert.mjs).
 *
 * ACN Timing (acn-timing.com, cronometrador Chronorace) publica las clasificaciones de
 * HG Cross y Exact Cross, entre otras. El visor es una SPA Vue que lee JSON público:
 *
 *   GET prod.chronorace.be/api/Event/view/<eventId>                  título, fecha, lugar
 *   GET prod.chronorace.be/Classements/ListeRapports.aspx?eventId=…  302 → …#/events/<id>/ctx/<ctx>/cms
 *   GET results.chronorace.be/api/results/generic/uci/<ctx>/dh?key=cms   árbol Cyclocross → CROME/CROWE/CROMJ/CROWJ → RESnn
 *   GET results.chronorace.be/api/results/table/search/<ctx>/<RESnn>?srch=&pageSize=1000   tabla completa
 *
 *   node scripts/results-fetchers/acn-cx-fetch.mjs --url <visor acn-timing o ListeRapports> \
 *     --race-id <cxRaceId> --season-key 2026-27 [--date 2026-10-11] [--only MJ,WJ] \
 *     [--map 'RES34=MJ,RES35=WJ'] [--out doc.json]
 *
 * El puesto, el estado y las vueltas perdidas vienen calculados por el cronometrador; el
 * documento los conserva sin reordenar. La nacionalidad procede de la bandera de la fila
 * (código de tres letras). No resuelve fichas ni equipos: conserva la grafía de la fuente.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { countryCode } from '../uci-catalog/countries.mjs';
import { cxNaturalRiderDisplay, splitCxDisplayName } from './cx-dataride-results.mjs';
import { irmOf } from './sts-results-fetch.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const EVENT_API = 'https://prod.chronorace.be/api/Event/view/';
const LISTING = 'https://prod.chronorace.be/Classements/ListeRapports.aspx';
const RESULTS_API = 'https://results.chronorace.be/api/results/';
const VIEWER = 'https://www.acn-timing.com/?lng=EN#/events/';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const STATES = new Set(['DNS', 'DNF', 'DSQ', 'OTL', 'ABD']);
const PARTICLES = new Set(['LE', 'LA', 'EL', 'AL', 'DE', 'DEL', 'DER', 'DEN', 'DI', 'DA', 'DU', 'DOS', 'DAS', 'VAN', 'VON', 'TER', 'TEN']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
  ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
  : ENTITIES[code.toLowerCase()] ?? match);
const clean = value => decode(String(value ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// «https://www.acn-timing.com/?lng=EN#/events/<id>/ctx/<ctx>/…» o «…ListeRapports.aspx?eventId=<id>».
export function acnTarget(url) {
  const text = String(url);
  const hash = /#\/events\/(\d+)(?:\/ctx\/([^/?#]+))?/.exec(text);
  if (hash) return { eventId: hash[1], ctx: hash[2] || null };
  const query = /[?&]eventId=(\d+)/i.exec(text);
  if (query) return { eventId: query[1], ctx: null };
  throw new Error(`URL de ACN Timing no reconocida: ${text}`);
}

// «37:21», «1:02:03» → segundos; otro texto → null.
export function acnSeconds(value) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(clean(value));
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
const hms = total => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const gapText = total => total >= 3600
  ? `+${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  : `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// «OSAER Emiel» → apellido/nombre. Una partícula sola en mayúsculas («LE Guilloux Lana»)
// absorbe la palabra siguiente como parte del apellido.
export function acnSplitName(display) {
  const tokens = clean(display).split(' ');
  let end = 0;
  while (end < tokens.length && /^\p{Lu}[\p{Lu}'’.-]*$/u.test(tokens[end])) end++;
  if (end && end < tokens.length - 1 && tokens.slice(0, end).every(token => PARTICLES.has(token))) {
    tokens[end] = tokens[end].toUpperCase();
  }
  return splitCxDisplayName(tokens.join(' '));
}

// Categoría CX a partir del grupo del árbol (`Name` = CROME, CROWJ…) y su clave RESnn.
export function acnCategories(tree, overrides = {}) {
  const found = []; const skipped = [];
  const walk = (node, group) => {
    for (const child of node.Childs || []) {
      if (child.Type === 'result') {
        const key = JSON.parse(child.Route || '{}').Params?.key;
        if (!key) continue;
        const category = overrides[key] || /^CRO(ME|WE|MU|WU|MJ|WJ)$/.exec(group?.Name || '')?.[1] || null;
        if (category) found.push({ category, key, groupId: child.Id, name: group?.DisplayName || null });
        else skipped.push({ key, name: group?.DisplayName || child.DisplayName, reason: 'Grupo fuera de las categorías CX individuales' });
      } else walk(child, child.Type === 'Folder' ? child : group);
    }
  };
  walk(tree, null);
  for (const { category } of found) if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
  return { found, skipped };
}

// `Version` de la tabla: marca de la última modificación de datos en ticks .NET (100 ns desde 0001-01-01).
export function acnVersionMs(version) {
  const ticks = BigInt(String(version ?? '0').replace(/\D/g, '') || '0');
  return Number((ticks - 621355968000000000n) / 10000n);
}

/** Filas de la tabla `table/search` → filas del contrato CX. */
export function parseAcnTable(table) {
  const columns = table?.TableDefinition?.Columns;
  const source = table?.Groups?.[0]?.SlaveRows;
  if (!Array.isArray(columns) || !Array.isArray(source)) throw new Error('Tabla ACN sin columnas o filas');
  const at = name => {
    const column = columns.find(item => item.Name === name);
    if (!column) throw new Error(`Columna ACN ausente: ${name}`);
    return column.FieldIdx;
  };
  const index = { pos: at('sR_Pos'), bib: at('sR_Nr'), name: at('Name / Team'), noc: at('dI_sC_#NOC'), laps: at('sC_Laps'), time: at('sR_Time') };
  const parsed = source.map((raw, sourceRow) => {
    const display = String(raw[index.name] ?? '');
    const sourceName = clean(/<b>([\s\S]*?)<\/b>/i.exec(display)?.[1]);
    const detail = clean(/<font[^>]*>([\s\S]*?)<\/font>/i.exec(display)?.[1]);
    const license = /^(\d{11})\s*-\s*(.*)$/.exec(detail);
    const [timeCell = '', gapCell = ''] = String(raw[index.time] ?? '').split(/<br\s*\/?>/i).map(clean);
    const flag = /([a-z]{3})\.png$/i.exec(String(raw[index.noc] ?? ''))?.[1] || null;
    const position = /^(\d+)\.?$/.exec(clean(raw[index.pos]));
    return { sourceRow, bib: clean(raw[index.bib]) || null, sourceName, teamName: (license ? license[2] : detail) || null,
      uciLicenseId: license?.[1] || null, noc: flag?.toUpperCase() || null, laps: Number(clean(raw[index.laps])) || null,
      rank: position ? Number(position[1]) : null, timeCell, gapCell };
  });
  const seconds = parsed.map(row => acnSeconds(row.timeCell));
  const winner = parsed.findIndex(row => row.rank === 1);
  if (winner < 0 || seconds[winner] == null) throw new Error('La clasificación ACN no tiene ganador con tiempo');
  const rows = parsed.map((row, position) => {
    const { firstName, lastName } = acnSplitName(row.sourceName);
    const base = { bib: row.bib, riderDisplay: cxNaturalRiderDisplay(firstName, lastName, row.sourceName), firstName, lastName,
      sourceName: row.sourceName, teamName: row.teamName, isoCode2: countryCode(row.noc)?.toUpperCase() || null, nationalityCode: row.noc,
      uciLicenseId: row.uciLicenseId, bonusSeconds: null, sourceSortOrder: row.sourceRow };
    const lap = /^-\s*(\d+)\s*LAP/i.exec(row.timeCell);
    if (lap) {
      if (row.rank == null) throw new Error(`Fila ${row.sourceRow + 1}: vuelta perdida sin puesto`);
      return { ...base, rank: row.rank, rankText: String(row.rank), irm: 'LAP', gapText: `-${lap[1]} LAP`, timeText: null, timeSeconds: null };
    }
    if (seconds[position] != null) {
      if (row.rank == null) throw new Error(`Fila ${row.sourceRow + 1}: tiempo sin puesto`);
      const delta = seconds[position] - seconds[winner];
      const expected = row.rank === 1 ? '-' : gapText(delta);
      if (delta < 0 || (row.gapCell && row.gapCell !== expected && !(row.rank === 1 && row.gapCell === '-'))) {
        throw new Error(`Fila ${row.sourceRow + 1}: diferencia ${row.gapCell || '∅'} no corresponde al tiempo ${row.timeCell}`);
      }
      return { ...base, rank: row.rank, rankText: String(row.rank), irm: null, timeText: hms(seconds[position]),
        timeSeconds: String(seconds[position]), gapText: row.rank === 1 ? null : expected };
    }
    const status = row.timeCell.toUpperCase();
    const irm = STATES.has(status) ? status : irmOf(row.timeCell);
    if (!irm) throw new Error(`Fila ${row.sourceRow + 1}: estado ACN no reconocido «${row.timeCell}»`);
    return { ...base, rank: null, rankText: irm, irm, gapText: null, timeText: null, timeSeconds: null };
  });
  const ranks = rows.filter(row => row.rank != null).map(row => row.rank).sort((a, b) => a - b);
  if (ranks.some((rank, position) => rank !== position + 1)) throw new Error('Puestos ACN no consecutivos');
  return rows;
}

export function buildAcnCxDocument({ event, ctx, tables, raceId, seasonKey, dateKey, sourceUrl, source = 'manual' }) {
  const categories = []; const skipped = [];
  for (const { category, key, groupId, name, table } of tables) {
    const count = table?.Groups?.[0]?.SlaveRows?.length || 0;
    if (!count) { skipped.push({ category, key, reason: 'Clasificación sin filas' }); continue; }
    const viewerUrl = `${VIEWER}${event.EventId}/ctx/${ctx}/generic/${groupId}/home/${key}`;
    categories.push({ category, dateKey, sourceKey: key, sourceGroup: name,
      evidence: { sourceUrl: viewerUrl, sourceVersion: String(table.Version ?? '') || null },
      sourceUpdatedAt: Number.isFinite(acnVersionMs(table.Version)) && table.Version ? new Date(acnVersionMs(table.Version)).toISOString() : null,
      rows: parseAcnTable(table) });
  }
  const eventId = String(event.EventId);
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl, timer: 'acn-timing', eventId, ctx, eventName: clean(event.Title) || null,
      location: clean(event.Location) || null, country: event.Country || null, ...(source === 'acn' ? { acn: { eventId, ctx } } : {}) },
    categories, skipped };
}

const getJson = async url => {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.json();
};

// El contexto (`ctx`) del evento solo aparece en la redirección del listado clásico.
export async function resolveAcnContext(eventId) {
  const response = await fetch(`${LISTING}?eventId=${encodeURIComponent(eventId)}`, { headers: { 'User-Agent': UA }, redirect: 'manual',
    signal: AbortSignal.timeout(30000) });
  const ctx = /\/ctx\/([^/?#]+)/.exec(response.headers.get('location') || '')?.[1];
  if (!ctx) throw new Error(`ACN no devolvió contexto para el evento ${eventId} (HTTP ${response.status})`);
  return ctx;
}

/** Evento, árbol de categorías y tablas de las categorías pedidas (`only`). */
export async function fetchAcnTables({ eventId, ctx, only = null, map = {}, date = null }) {
  const event = await getJson(`${EVENT_API}${encodeURIComponent(eventId)}`);
  if (String(event.EventId) !== String(eventId)) throw new Error('El evento ACN devuelto no corresponde al solicitado');
  const eventDate = String(event.StartDate || '').slice(0, 10);
  if (String(event.EndDate || '').slice(0, 10) !== eventDate) throw new Error('Evento ACN multidía: indicar categoría y fecha manualmente');
  if (date && date !== eventDate) throw new Error(`Fecha del evento ${eventDate} distinta de ${date}`);
  const tree = await getJson(`${RESULTS_API}generic/uci/${encodeURIComponent(ctx)}/dh?key=cms`);
  const { found, skipped } = acnCategories(tree, map);
  const wanted = only ? new Set(only) : null;
  const tables = [];
  for (const item of found) {
    if (wanted && !wanted.has(item.category)) continue;
    tables.push({ ...item, table: await getJson(`${RESULTS_API}table/search/${encodeURIComponent(ctx)}/${encodeURIComponent(item.key)}?srch=&pageSize=1000`) });
  }
  return { event, ctx, eventDate, tables, skipped };
}

export async function fetchAcnCx({ url, raceId, seasonKey, date, only = null, map = {}, source = 'manual' }) {
  const target = acnTarget(url);
  const ctx = target.ctx || await resolveAcnContext(target.eventId);
  const { event, eventDate, tables, skipped } = await fetchAcnTables({ eventId: target.eventId, ctx, only, map, date });
  const document = buildAcnCxDocument({ event, ctx, tables, raceId, seasonKey, dateKey: date || eventDate, sourceUrl: url, source });
  document.skipped.push(...skipped);
  return document;
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ['url', 'race-id', 'season-key']) if (!out[key]) throw new Error(`Falta --${key}`);
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  const map = options.map ? Object.fromEntries(options.map.split(',').map(pair => pair.split('=').map(clean))) : {};
  const document = await fetchAcnCx({ url: options.url, raceId: options['race-id'], seasonKey: options['season-key'], date: options.date,
    only: options.only ? options.only.split(',').map(clean) : null, map });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, rows: c.rows.length })), skipped: document.skipped }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
