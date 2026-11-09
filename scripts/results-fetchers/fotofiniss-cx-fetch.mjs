#!/usr/bin/env node
/**
 * fotofiniss.lv (cronometrador letón: Campeonato de Letonia, Latvijas kauss…)
 * → documento de resultados CX (contrato de cx-results-upsert.mjs).
 *
 * El enlace de una carrera es la raíz `https://fotofiniss.lv/sacensibas/<evento>/rezultati`;
 * se lee la lista «Detalizēti rezultāti pa vecuma grupām» (`…/rezultati/pa-grupam-det`):
 * una tabla por grupo de edad («W18 (11 km)», «WE/U23/W19-39 (11 km)») con V
 * (puesto en la salida), Num (dorsal), VG (puesto en el grupo), Grupa,
 * Dalībnieks («Nombre APELLIDO» y el club en <small>), Apļi (vueltas), Laiks
 * (tiempo o estado), +/-, km/h y A1… (paso acumulado y tiempo de la vuelta).
 *
 *   node scripts/results-fetchers/fotofiniss-cx-fetch.mjs --url <evento fotofiniss> \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-11-07 \
 *     --map 'ME/U23/M19-39=ME,M18=MJ,WE/U23/W19-39=WE,W18=WJ' [--country LV] [--out doc.json]
 *
 * La tabla se publica en directo, sin marca de clasificación definitiva: cada
 * grupo lleva su huella (`sourceDigest`) y la vuelta más lenta leída
 * (`maxLapSeconds`) para que el worker publique solo la tabla que deja de
 * cambiar. Los puestos son los del grupo (VG); quien completa menos vueltas que
 * el ganador del grupo es `irm=LAP` con `gapText=-n LAP` y sin tiempo. Los
 * tiempos se truncan al segundo.
 *
 * La tabla no publica nacionalidad, licencia UCI ni nacimiento. `--country`
 * (en el worker, el país de un Campeonato Nacional, que solo admite licencias
 * de la federación) es solo el valor por defecto: la fila lo lleva marcado como
 * inferido y una coincidencia de nombre con una ficha verificada aporta su
 * nacionalidad. No resuelve fichas ni equipos: el documento conserva la grafía
 * de la fuente para la normalización posterior.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { personCase } from './cx-dataride-results.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const HEADER = ['V', 'NUM', 'VG', 'GRUPA', 'DALĪBNIEKS', 'APĻI', 'LAIKS', '+/-', 'KM/H'];
const STATES = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ' };
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
  ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
  : ENTITIES[code.toLowerCase()] ?? match);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const cellText = value => clean(decode(value.replace(/<[^>]+>/g, ' ')));
const hms = total => `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}` : Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const upper = token => /\p{Lu}/u.test(token) && !/\p{Ll}/u.test(token);

/** Rótulo del grupo normalizado (clave de `categoryKeys`): «W18», «WE/U23/W19-39». */
export const fotofinissLabel = value => clean(value).toUpperCase();

/** Cualquier URL del evento → raíz de resultados canónica, que es el `sourceUrl` del enlace. */
export function fotofinissResultsUrl(url) {
  const parsed = new URL(url);
  const match = /^\/sacensibas\/([a-z0-9][a-z0-9-]*)(?:\/.*)?$/.exec(parsed.pathname);
  if (parsed.protocol !== 'https:' || !['fotofiniss.lv', 'www.fotofiniss.lv'].includes(parsed.host) || !match) {
    throw new Error(`URL fotofiniss no reconocida: ${url}`);
  }
  return `https://fotofiniss.lv/sacensibas/${match[1]}/rezultati`;
}
export const fotofinissGroupsUrl = resultsUrl => `${resultsUrl}/pa-grupam-det`;

// «0:35:18.9», «35:18.9», «1:02:03» → segundos enteros (sin décimas); otro texto → null.
export function fotofinissSeconds(value) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?$/.exec(clean(value));
  return match ? Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/** «Leo Maikls KĀRLINS» → nombre y apellido; el apellido son los tokens finales en mayúsculas. */
export function fotofinissName(value) {
  const tokens = clean(value).split(' ').filter(Boolean);
  let index = tokens.length - 1;
  while (index > 1 && upper(tokens[index - 1])) index--;
  if (index < 1 || !upper(tokens[index])) index = tokens.length - 1;
  const first = tokens.slice(0, index).join(' '); const last = tokens.slice(index).join(' ');
  return { firstName: first ? (upper(first) ? personCase(first) : first) : null, lastName: last ? personCase(last) : null };
}

/** Lista por grupos → `[{ label, distance, rows }]` con las celdas de la fuente. */
export function parseFotofinissGroups(html) {
  const groups = [];
  for (const [, heading, table] of html.matchAll(/<h4>([^<]*)<\/h4>\s*(<table[^>]*id="dataListTable"[\s\S]*?<\/table>)/g)) {
    const title = clean(decode(heading));
    const match = /^(.*?)\s*\(([^()]*)\)$/.exec(title);
    const header = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, cell]) => cellText(cell).toUpperCase());
    if (JSON.stringify(header.slice(0, HEADER.length)) !== JSON.stringify(HEADER)
      || header.slice(HEADER.length).some((cell, index) => cell !== `A${index + 1}`)) {
      throw new Error(`Cabecera fotofiniss inesperada en «${title}»: ${header.join(' | ')}`);
    }
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell))
      .filter(cells => cells.length).map((cells, index) => {
        if (cells.length !== header.length) throw new Error(`«${title}», fila ${index + 1}: ${cells.length} columnas`);
        const [pos, bib, groupPos, group, person, laps, time, gapText] = cells.slice(0, 8).map((cell, column) => column === 4 ? cell : cellText(cell));
        const [, name = person, team = ''] = /^([\s\S]*?)(?:<br\s*\/?>\s*<small>([\s\S]*?)<\/small>)?\s*$/.exec(person) || [];
        const splits = cells.slice(HEADER.length).map(cell => {
          const [elapsed, lap] = cell.split(/<br\s*\/?>/).map(part => cellText(part).replace(/\s*\(\d+\)$/, ''));
          return elapsed ? { elapsed, lap: lap || null } : null;
        }).filter(Boolean);
        return { pos, bib, groupPos, group, name: cellText(name), team: cellText(team), laps, time, gap: gapText, splits };
      });
    groups.push({ label: fotofinissLabel(match ? match[1] : title), distance: match ? clean(match[2]) : null, rows });
  }
  if (!groups.length && !/<h4>Detalizēti rezultāti pa vecuma grupām<\/h4>/.test(html)) throw new Error('Página fotofiniss sin la lista por grupos de edad');
  return groups;
}

/**
 * Filas de un grupo → filas del contrato CX. Lanza si la clasificación no es
 * coherente: puestos no crecientes, vueltas que aumentan, tiempos que bajan
 * entre llegadas con las mismas vueltas o estado desconocido.
 */
export function parseFotofinissRows(sourceRows, { defaultCountry = null } = {}) {
  const rows = []; const warnings = [];
  let leaderLaps = null; let winnerSeconds = null; let lastPos = 0; let lastLaps = Infinity; let lastTime = 0; let maxLapSeconds = 0;
  for (const [sourceRow, item] of sourceRows.entries()) {
    const { firstName, lastName } = fotofinissName(item.name);
    if (!firstName || !lastName) throw new Error(`Fila ${sourceRow + 1}: nombre «${item.name}» sin apellido`);
    for (const split of item.splits) maxLapSeconds = Math.max(maxLapSeconds, fotofinissSeconds(split.lap) || 0);
    const base = { bib: /^\d+$/.test(item.bib) ? item.bib : null, riderDisplay: `${firstName} ${lastName}`, firstName, lastName,
      sourceName: item.name, teamName: item.team || null, isoCode2: defaultCountry, isoCode2Inferred: !!defaultCountry,
      bonusSeconds: null, sourceSortOrder: sourceRow };
    const state = STATES[item.time.toUpperCase()];
    if (state) { rows.push({ ...base, rank: null, rankText: state, irm: state, gapText: null, timeText: null, timeSeconds: null }); continue; }
    if (rows.some(row => row.irm && row.irm !== 'LAP')) throw new Error(`Fila ${sourceRow + 1}: clasificado tras un ${rows.find(row => row.irm).irm}`);
    const pos = /^\d+$/.test(item.groupPos) ? Number(item.groupPos) : null;
    const laps = /^\d+$/.test(item.laps) ? Number(item.laps) : null;
    const time = fotofinissSeconds(item.time);
    if (!pos || !laps || time == null || time <= 0) throw new Error(`Fila ${sourceRow + 1}: puesto «${item.groupPos}», vueltas «${item.laps}», tiempo «${item.time}» no reconocidos`);
    if (pos <= lastPos) throw new Error(`Fila ${sourceRow + 1}: puesto ${pos} no posterior a ${lastPos}`);
    if (laps > lastLaps) throw new Error(`Fila ${sourceRow + 1}: ${laps} vueltas tras ${lastLaps}`);
    if (pos !== lastPos + 1) warnings.push({ sourceRow, reason: `Puesto ${pos} tras ${lastPos}: se renumera dentro de la categoría` });
    lastPos = pos;
    if (laps < lastLaps) lastTime = 0;
    if (time < lastTime) throw new Error(`Fila ${sourceRow + 1}: tiempo ${item.time} inferior al anterior con las mismas vueltas`);
    lastLaps = laps; lastTime = time;
    const rank = rows.filter(row => row.rank != null).length + 1;
    if (rank === 1) { leaderLaps = laps; winnerSeconds = time; }
    if (laps < leaderLaps) {
      rows.push({ ...base, rank, rankText: String(rank), irm: 'LAP', gapText: `-${leaderLaps - laps} LAP`, timeText: null, timeSeconds: null, laps });
      continue;
    }
    rows.push({ ...base, rank, rankText: String(rank), irm: null, timeText: hms(time), timeSeconds: String(time),
      gapText: rank === 1 ? null : gap(time - winnerSeconds), laps });
  }
  return { rows, warnings, leaderLaps, maxLapSeconds: maxLapSeconds || null };
}

/** Huella de un grupo: cambia con cada paso por meta y con cualquier corrección. */
export const fotofinissDigest = sourceRows => createHash('sha1').update(JSON.stringify(sourceRows)).digest('hex');

/**
 * Grupos publicados → documento. `map`: `{ rótulo del grupo: categoría }`. Un
 * grupo ausente o sin filas queda en `skipped`; uno incoherente, en `invalid`,
 * sin afectar a los demás. Con `source: 'fotofiniss'` cada categoría acredita el
 * enlace (`evidence.fotofiniss`).
 */
export function buildFotofinissCxDocument({ resultsUrl, groups, map, raceId, seasonKey, dateKey, defaultCountry = null, source = 'manual' }) {
  const categories = []; const skipped = []; const invalid = []; const warnings = []; const seen = new Set();
  for (const [key, category] of Object.entries(map)) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    if (seen.has(category)) throw new Error(`Categoría ${category} asignada a varios grupos`);
    seen.add(category);
    const label = fotofinissLabel(key);
    const found = groups.filter(group => group.label === label);
    if (found.length > 1) { invalid.push({ category, reason: `Grupo «${label}» publicado ${found.length} veces` }); continue; }
    if (!found.length || !found[0].rows.length) { skipped.push({ category, reason: `Grupo «${label}» aún sin publicar en fotofiniss` }); continue; }
    let parsed;
    try { parsed = parseFotofinissRows(found[0].rows, { defaultCountry }); } catch (error) { invalid.push({ category, reason: `${label}: ${error.message}` }); continue; }
    warnings.push(...parsed.warnings.map(item => ({ category, ...item })));
    categories.push({ category, dateKey, sourceGroup: label, sourceDistance: found[0].distance, sourceDigest: fotofinissDigest(found[0].rows),
      maxLapSeconds: parsed.maxLapSeconds, leaderLaps: parsed.leaderLaps,
      evidence: { sourceUrl: fotofinissGroupsUrl(resultsUrl), ...(source === 'fotofiniss' ? { fotofiniss: { sourceUrl: resultsUrl, group: label } } : {}) },
      rows: parsed.rows });
  }
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl: resultsUrl, timer: 'fotofiniss.lv' }, categories, skipped, invalid, warnings };
}

/** Lista por grupos del evento. */
export async function fetchFotofinissGroups(url, { fetchImpl = fetch } = {}) {
  const resultsUrl = fotofinissResultsUrl(url);
  const response = await fetchImpl(fotofinissGroupsUrl(resultsUrl), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${fotofinissGroupsUrl(resultsUrl)}`);
  return { resultsUrl, groups: parseFotofinissGroups(await response.text()) };
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ['url', 'race-id', 'season-key', 'date', 'map']) if (!out[key]) throw new Error(`Falta --${key}`);
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  const map = Object.fromEntries(options.map.split(',').map(pair => pair.split('=').map(clean)));
  const fetched = await fetchFotofinissGroups(options.url);
  const document = buildFotofinissCxDocument({ ...fetched, map, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date,
    defaultCountry: options.country ? options.country.toUpperCase() : null });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, group: c.sourceGroup, rows: c.rows.length,
    maxLapSeconds: c.maxLapSeconds })), skipped: document.skipped, invalid: document.invalid }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
