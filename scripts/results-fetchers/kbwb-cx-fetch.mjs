#!/usr/bin/env node
/**
 * KBWB (Belgian Cycling, ala flamenca Cycling Vlaanderen) → documento de
 * resultados CX (contrato de cx-results-upsert.mjs).
 *
 * Las pruebas de la federación en Flandes se publican en la API pública de
 * cycling.vlaanderen (`actions/cycling-api-module/api`): una prueba por
 * categoría con su clave (`races/<clave>.json`, la «Sleut» del PDF de la
 * federación) y las líneas de resultados que sube el jurado
 * (`race_results.json?race_id=<clave>`). La prueba se considera publicada
 * cuando `race_details.result` vale 1 y hay líneas.
 *
 *   node scripts/results-fetchers/kbwb-cx-fetch.mjs --list --date 2026-10-25
 *   node scripts/results-fetchers/kbwb-cx-fetch.mjs --map '14928=MJ,14927=ME' \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-10-25 [--out doc.json]
 *
 * `uci_code` (`BEL20080623`) aporta nacionalidad IOC y fecha de nacimiento. La
 * API no publica dorsal ni UCI ID. No resuelve fichas ni equipos: el documento
 * conserva la grafía de la fuente para la normalización posterior.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { countryCode } from '../uci-catalog/countries.mjs';
import { cxNaturalRiderDisplay, splitCxDisplayName } from './cx-dataride-results.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
export const KBWB_API = 'https://cycling.vlaanderen/actions/cycling-api-module/api';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const STATES = { did_not_finish: 'DNF', did_not_start: 'DNS', disqualified: 'DSQ' };
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const hms = total => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

export const kbwbDetailUrl = (dateKey, key) => `https://cycling.vlaanderen/competitie/uitslagen/detail?date=${dateKey}&key=${key}`;

// `BEL20080623` → nacionalidad IOC, ISO-2 y nacimiento; otro formato → nulos.
export function parseKbwbUciCode(value) {
  const match = /^([A-Z]{3})(\d{4})(\d{2})(\d{2})$/.exec(clean(value).toUpperCase());
  if (!match) return { noc: null, isoCode2: null, birthDate: null };
  const date = `${match[2]}-${match[3]}-${match[4]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return { noc: match[1], isoCode2: countryCode(match[1])?.toUpperCase() || null,
    birthDate: !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null };
}

function riderName(person) {
  const first = clean(person?.first_name); const last = clean(person?.last_name);
  const sourceName = clean(`${last} ${first}`);
  const split = splitCxDisplayName(sourceName);
  return { sourceName, firstName: split.firstName || first || null, lastName: split.lastName || last || null };
}

/** Líneas de `race_result_lines` → filas del contrato CX. */
export function parseKbwbLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Clasificación KBWB sin líneas');
  const sorted = lines.slice().sort((a, b) => Number(a.place) - Number(b.place));
  const winner = sorted.find(line => line.state === 'finished' && Number(line.place) === 1);
  const winnerSeconds = Number(winner?.chrono_in_seconds);
  if (!winner || !(winnerSeconds > 0) || Number(winner.number_of_laps)) throw new Error('La clasificación KBWB no tiene ganador con tiempo');
  const rows = sorted.map((line, sourceRow) => {
    const { sourceName, firstName, lastName } = riderName(line.person);
    const identity = parseKbwbUciCode(line.person?.uci_code);
    const base = { bib: null, riderDisplay: cxNaturalRiderDisplay(firstName, lastName, sourceName), firstName, lastName, sourceName,
      teamName: clean(line.team) || null, isoCode2: identity.isoCode2, nationalityCode: identity.noc, birthDate: identity.birthDate,
      bonusSeconds: null, sourceSortOrder: sourceRow };
    const place = Number(line.place);
    if (line.state === 'finished') {
      if (!Number.isSafeInteger(place) || place <= 0) throw new Error(`Fila ${sourceRow + 1}: llegada sin puesto`);
      const down = Number(line.number_of_laps) || 0;
      if (down > 0) return { ...base, rank: place, rankText: String(place), irm: 'LAP', gapText: `-${down} LAP`, timeText: null, timeSeconds: null };
      const time = Number(line.chrono_in_seconds);
      if (!(time > 0)) throw new Error(`Fila ${sourceRow + 1}: llegada sin tiempo ni vueltas perdidas`);
      if (time - winnerSeconds !== Number(line.deficit_chrono_in_seconds)) {
        throw new Error(`Fila ${sourceRow + 1}: diferencia ${line.deficit_chrono_in_seconds} s no corresponde al tiempo ${time} s`);
      }
      return { ...base, rank: place, rankText: String(place), irm: null, timeText: hms(time), timeSeconds: String(time),
        gapText: place === 1 ? null : gap(time - winnerSeconds) };
    }
    const irm = STATES[line.state];
    if (!irm) throw new Error(`Fila ${sourceRow + 1}: estado KBWB no reconocido «${line.state}»`);
    return { ...base, rank: null, rankText: irm, irm, gapText: null, timeText: null, timeSeconds: null };
  });
  const ranks = rows.filter(row => row.rank != null).map(row => row.rank);
  if (ranks.some((rank, position) => rank !== position + 1)) throw new Error('Puestos KBWB no consecutivos');
  return rows;
}

/**
 * `races`: `[{ key, category, details, results }]` con `details` = race_details y
 * `results` = race_results. Una prueba sin publicar (`result` distinto de 1 o
 * sin líneas) queda en `skipped`; una clasificación que no supera las
 * comprobaciones de puestos y tiempos, en `invalid`, sin afectar a las demás.
 */
export function buildKbwbCxDocument({ races, raceId, seasonKey, dateKey, source = 'manual' }) {
  const categories = []; const skipped = []; const invalid = [];
  for (const { key, category, details, results } of races) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    if (String(details?.id) !== String(key)) throw new Error(`La prueba KBWB ${key} devuelta no corresponde a la solicitada`);
    if (dateKey && details.date !== dateKey) throw new Error(`Prueba KBWB ${key} del ${details.date}, no del ${dateKey}`);
    const lines = (results || []).flatMap(item => item.race_result_lines || []);
    if (Number(details.result) !== 1 || !lines.length) { skipped.push({ key: String(key), category, reason: 'Resultados aún sin publicar en KBWB' }); continue; }
    if ((results || []).length > 1) throw new Error(`Prueba KBWB ${key} con varias clasificaciones`);
    const [meta] = results;
    let rows;
    try { rows = parseKbwbLines(lines); } catch (error) { invalid.push({ key: String(key), category, reason: error.message }); continue; }
    categories.push({ category, dateKey: dateKey || details.date, sourceKey: String(key), sourceGroup: clean(meta.name) || clean(details.description) || null,
      evidence: { sourceUrl: kbwbDetailUrl(details.date, key), sourceSubmittedAt: meta.submitted_at || null,
        ...(source === 'kbwb' ? { kbwb: { raceId: String(key) } } : {}) },
      rows });
  }
  const first = races[0]?.details;
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl: kbwbDetailUrl(first?.date || dateKey, races[0]?.key), timer: 'kbwb', eventName: clean(first?.city) || null,
      organizer: clean(first?.club_name) || null }, categories, skipped, invalid };
}

async function api(params) {
  const url = `${KBWB_API}?${new URLSearchParams(params)}`;
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return (await response.json()).data;
}
export const fetchKbwbDay = async dateKey => (await api({ method: 'races.json', from_date: dateKey, to_date: dateKey })).races || [];
export const fetchKbwbDetails = async key => (await api({ method: `races/${key}.json` })).race_details;
export const fetchKbwbResults = async key => (await api({ method: 'race_results.json', race_id: String(key) })).race_results || [];

/** Detalle y resultados de las pruebas de `map` ({clave: categoría}); solo pide resultados a las publicadas. */
export async function fetchKbwbRaces(map) {
  const races = [];
  for (const [key, category] of Object.entries(map)) {
    const details = await fetchKbwbDetails(key);
    races.push({ key, category, details, results: Number(details?.result) === 1 ? await fetchKbwbResults(key) : [] });
  }
  return races;
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--list') { out.list = true; continue; }
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[++index];
  }
  for (const key of out.list ? ['date'] : ['map', 'race-id', 'season-key', 'date']) if (!out[key]) throw new Error(`Falta --${key}`);
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.list) {
    for (const race of await fetchKbwbDay(options.date)) {
      process.stdout.write(`${race.id}\t${race.category}\t${race.result}\t${clean(race.city)}\t${clean(race.description)}\n`);
    }
    return;
  }
  const map = Object.fromEntries(options.map.split(',').map(pair => pair.split('=').map(clean)));
  const document = buildKbwbCxDocument({ races: await fetchKbwbRaces(map), raceId: options['race-id'], seasonKey: options['season-key'],
    dateKey: options.date });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, rows: c.rows.length })), skipped: document.skipped, invalid: document.invalid }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
