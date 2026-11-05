#!/usr/bin/env node
/**
 * Web del organizador Golazo (X2O Badkamers Trofee: koppenbergcross.be y otras)
 * → documento de resultados CX (contrato de cx-results-upsert.mjs).
 *
 * El plugin `glz-extensions` de WordPress pinta una página por categoría
 * (`/uitslagen-u19/`, `/uitslagen-u23/`, `/uitslagen-elite-mannen/`,
 * `/uitslagen-elite-vrouwen/`) con la tabla `standing uitslagen` y el comentario
 * `<!-- cache x2o AAAA-MM-DD HH:MM:SS -->` de su caché. Sin resultados, la
 * tabla falta y la página dice «No results available yet». No hay página de
 * juniors femeninas.
 *
 *   node scripts/results-fetchers/golazo-cx-fetch.mjs --map 'https://koppenbergcross.be/uitslagen-u19/=MJ' \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-11-01 [--out doc.json]
 *
 * Cada fila trae puesto, bandera (ISO-2 en el archivo, código IOC en `alt`),
 * «APELLIDO Nombre», equipo y tiempo con diferencia, o «-n LAP». La web no
 * publica dorsal, nacimiento, UCI ID ni el estado de los no clasificados: las
 * filas sin puesto ni vueltas quedan en `unclassified` y no entran en el
 * documento. Antes de la manga la tabla lista los inscritos sin puesto ni
 * tiempo (la primera fila con «-»). No resuelve fichas ni equipos: el
 * documento conserva la grafía de la fuente para la normalización posterior.
 *
 * La tabla se actualiza en directo durante la manga y no marca la
 * clasificación definitiva: `golazoObserve` y `golazoFinality` la deducen del
 * paso del líder por meta y de la estabilidad de la tabla (recogida del worker).
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cxDataRideSeconds } from '../../js/cx/time.js';
import { cxNaturalRiderDisplay, splitCxDisplayName } from './cx-dataride-results.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#039': "'" };
const decode = value => String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#039);/gi, (match, code) => {
  if (ENTITIES[code.toLowerCase()]) return ENTITIES[code.toLowerCase()];
  if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
  return match;
});
const clean = value => decode(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
const cell = (row, pattern) => clean(pattern.exec(row)?.[1]);

/** Fecha de la caché del plugin (`AAAA-MM-DD HH:MM:SS`, hora de Bruselas) o null. */
export const golazoCacheStamp = html => /<!--\s*cache x2o (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*-->/.exec(html)?.[1] || null;

/** HTML de una página de resultados → `{ rows, unclassified }` del contrato CX. */
export function parseGolazoResults(html) {
  const table = /<div class='standing uitslagen'><table>([\s\S]*?)<\/table>/.exec(html)?.[1];
  if (!table) throw new Error('Página Golazo sin tabla de resultados');
  const rows = []; const unclassified = [];
  let winnerSeconds = null;
  for (const [index, tr] of [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(match => match[1]).entries()) {
    const sourceName = cell(tr, /<td class="standing-row-info">\s*<h5>([\s\S]*?)<\/h5>/);
    if (!sourceName) throw new Error(`Fila ${index + 1}: sin corredor`);
    const split = splitCxDisplayName(sourceName);
    const flag = /countries\/([a-z]{2})\.png" alt="([a-z]{3})?"/.exec(tr);
    const base = { bib: null, riderDisplay: cxNaturalRiderDisplay(split.firstName, split.lastName, sourceName),
      firstName: split.firstName || null, lastName: split.lastName || null, sourceName,
      teamName: cell(tr, /<h6 class="standing-row-team">([\s\S]*?)<\/h6>/) || null,
      isoCode2: flag?.[1]?.toUpperCase() || null, nationalityCode: flag?.[2]?.toUpperCase() || null,
      bonusSeconds: null, sourceSortOrder: index };
    const posText = cell(tr, /<td class="standing-row-pos">([\s\S]*?)<\/td>/);
    const result = /<td class="standing-row-result">\s*<h5>([\s\S]*?)<\/h5>\s*<p>([\s\S]*?)<\/p>/.exec(tr);
    const timeText = clean(result?.[1]); const gapText = clean(result?.[2]);
    if (!posText) {
      if (timeText || gapText && gapText !== '-') throw new Error(`Fila ${index + 1}: resultado sin puesto`);
      unclassified.push({ sourceName, teamName: base.teamName, sourceSortOrder: index }); continue;
    }
    const rank = Number(posText);
    if (!Number.isSafeInteger(rank) || rank <= 0) throw new Error(`Fila ${index + 1}: puesto inválido «${posText}»`);
    const laps = /^-(\d+) LAP$/i.exec(gapText);
    if (laps && !timeText) { rows.push({ ...base, rank, rankText: String(rank), irm: 'LAP', gapText: `-${laps[1]} LAP`, timeText: null, timeSeconds: null }); continue; }
    const seconds = cxDataRideSeconds(timeText);
    if (!(Number(seconds) > 0)) throw new Error(`Fila ${index + 1}: llegada sin tiempo ni vueltas perdidas`);
    if (rank === 1) {
      if (gapText !== '-') throw new Error('El ganador Golazo trae diferencia');
      winnerSeconds = Number(seconds);
    } else if (winnerSeconds == null || gapText !== gap(Number(seconds) - winnerSeconds)) {
      throw new Error(`Fila ${index + 1}: diferencia «${gapText}» no corresponde al tiempo ${timeText}`);
    }
    rows.push({ ...base, rank, rankText: String(rank), irm: null, timeText, timeSeconds: String(seconds), gapText: rank === 1 ? null : gapText });
  }
  if (rows.some((row, position) => row.rank !== position + 1)) throw new Error('Puestos Golazo no consecutivos');
  return { rows, unclassified };
}

// Huella de la tabla leída, sin la marca de la caché: cambia con cualquier paso por meta.
const golazoDigest = (rows, unclassified) => createHash('sha1').update(JSON.stringify([
  rows.map(row => [row.rank, row.sourceName, row.teamName, row.isoCode2, row.timeText, row.gapText, row.irm]),
  unclassified.map(row => row.sourceName)])).digest('hex');

/** Página de resultados de una categoría (`uitslagen-u19`) dentro de la web del organizador. */
export const golazoPageUrl = (siteUrl, page) => new URL(`${page}/`, siteUrl).href;

/**
 * `pages`: `[{ url, category, html, page? }]`. Una página sin tabla, con «No
 * results available yet» o con los inscritos aún sin llegadas queda en
 * `skipped`; una que no supera las comprobaciones, en `invalid`. La caché debe
 * ser del día de la manga o posterior. Con `source='golazo'` (worker), cada
 * categoría acredita el enlace (`evidence.golazo` con `siteUrl` y la página) y
 * la marca de la caché queda fuera de la evidencia para que una tabla sin
 * cambios no reemplace la carga anterior.
 */
export function buildGolazoCxDocument({ pages, raceId, seasonKey, dateKey, source = 'manual', siteUrl = null }) {
  if (!['manual', 'golazo'].includes(source) || source === 'golazo' && !siteUrl) throw new Error('Fuente Golazo inválida');
  const categories = []; const skipped = []; const invalid = [];
  for (const { url, category, html, page } of pages) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    const stamp = golazoCacheStamp(html);
    if (!html.includes("class='standing uitslagen'")) { skipped.push({ url, category, reason: 'Resultados aún sin publicar en la web del organizador' }); continue; }
    if (!stamp || stamp.slice(0, 10) < dateKey) { invalid.push({ url, category, reason: `Caché Golazo ${stamp || 'ausente'} anterior al ${dateKey}` }); continue; }
    let parsed;
    try { parsed = parseGolazoResults(html); } catch (error) { invalid.push({ url, category, reason: error.message }); continue; }
    if (!parsed.rows.length) { skipped.push({ url, category, reason: 'Tabla del organizador sin llegadas' }); continue; }
    const evidence = { sourceUrl: url, unclassified: parsed.unclassified,
      ...(source === 'golazo' ? { golazo: { sourceUrl: siteUrl, page } } : { sourceGeneratedAt: stamp }) };
    categories.push({ category, dateKey, sourceGroup: clean(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]) || null,
      sourceGeneratedAt: stamp, sourceDigest: golazoDigest(parsed.rows, parsed.unclassified), evidence, rows: parsed.rows });
  }
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl: siteUrl || pages[0]?.url || null, timer: 'golazo' }, categories, skipped, invalid };
}

// Un paso del líder por meta suma una vuelta: entre 1 y 30 minutos.
const LAP_MIN_SECONDS = 60;
const LAP_MAX_SECONDS = 1800;
// La página se sirve con `max-age=180`: un paso por meta puede tardar 3 minutos en verse, y la
// tabla puede leerse igual con dos cachés durante ese plazo a mitad de manga o mientras aún
// llegan corredores (Koppenbergcross ME 2026: 3:24 con el líder en 46:13; 3:03 tras la meta).
export const GOLAZO_STABLE_MS = 3 * 60000;
const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Estado por categoría tras una lectura: tiempo del líder y del paso anterior
 * por meta, huella de la tabla, primera lectura con esa huella y su caché. Un
 * cambio del líder inferior a una vuelta (corrección) no cuenta como paso.
 */
export function golazoObserve(previous, manga, now) {
  const state = { ...(previous || {}) };
  const leader = Number(manga.rows.find(row => row.rank === 1 && !row.irm)?.timeSeconds);
  if (Number.isSafeInteger(leader) && leader > 0 && leader !== state.leaderSeconds) {
    const last = Number(state.leaderSeconds);
    if (!(last > 0) || leader < last - LAP_MIN_SECONDS) state.previousLeaderSeconds = null;
    else if (leader >= last + LAP_MIN_SECONDS) state.previousLeaderSeconds = last;
    state.leaderSeconds = leader;
  }
  if (manga.sourceDigest !== state.digest) {
    state.digest = manga.sourceDigest; state.digestAt = new Date(now).toISOString(); state.digestStamp = manga.sourceGeneratedAt;
  }
  return state;
}

/**
 * Clasificación definitiva a partir del estado de `golazoObserve`. Exige:
 * - dos pasos sucesivos del líder (la vuelta es su diferencia): una tabla que
 *   no se vio progresar (caché antigua, lectura tardía) no se publica;
 * - el líder en su último paso, con tiempo T ≥ `durationMinutes` − vuelta/2;
 * - la misma tabla con otra caché (`stamp`, la de esta lectura) que la de su
 *   primera lectura, durante media vuelta más GOLAZO_STABLE_MS si T alcanza la
 *   duración prevista (los demás corredores terminan al pasar por meta); por
 *   debajo, durante una vuelta completa más GOLAZO_STABLE_MS (sin nuevo paso
 *   del líder, la manga terminó).
 * Devuelve `{ final, reason }`; `reason` explica la espera.
 */
export function golazoFinality(state, { durationMinutes, now, stamp }) {
  const planned = Number(durationMinutes) * 60;
  if (!(planned > 0)) return { final: false, reason: 'Manga sin duración prevista; Golazo no acredita la meta' };
  const leader = Number(state?.leaderSeconds); const previous = Number(state?.previousLeaderSeconds);
  const lap = leader - previous;
  if (!(leader > 0) || !(previous > 0) || lap < LAP_MIN_SECONDS || lap > LAP_MAX_SECONDS) {
    return { final: false, reason: `Golazo: sin dos pasos sucesivos del líder por meta (líder en ${leader > 0 ? clock(leader) : '—'}); se espera al siguiente` };
  }
  if (leader < planned - lap / 2) {
    return { final: false, reason: `Golazo: líder en ${clock(leader)} con vueltas de ${clock(lap)}, antes de su último paso (duración prevista ${planned / 60} min)` };
  }
  const required = (leader >= planned ? lap * 500 : lap * 1000) + GOLAZO_STABLE_MS;
  const stable = new Date(now).getTime() - Date.parse(state.digestAt);
  if (!(stable >= required) || !stamp || stamp === state.digestStamp) {
    return { final: false, reason: `Golazo: tabla sin cambios durante ${Math.max(0, Math.floor(stable / 60000))} de ${Math.ceil(required / 60000)} min; se publica cuando se estabilice` };
  }
  return { final: true, reason: null, lapSeconds: lap, stableMs: stable };
}

async function fetchPage(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.text();
}

/** Recogida del worker: `map` {página: categoría} sobre la web del organizador (`siteUrl`). */
export async function fetchGolazoPages(siteUrl, map) {
  const pages = [];
  for (const [page, category] of Object.entries(map)) {
    const url = golazoPageUrl(siteUrl, page);
    pages.push({ url, page, category, html: await fetchPage(url) });
  }
  return pages;
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[++index];
  }
  for (const key of ['map', 'race-id', 'season-key', 'date']) if (!out[key]) throw new Error(`Falta --${key}`);
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  // La URL contiene «=» solo en la consulta; la categoría es lo que sigue al último.
  const map = options.map.split(',').map(pair => { const at = pair.lastIndexOf('='); return { url: pair.slice(0, at).trim(), category: pair.slice(at + 1).trim() }; });
  const pages = [];
  for (const page of map) pages.push({ ...page, html: await fetchPage(page.url) });
  const document = buildGolazoCxDocument({ pages, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, rows: c.rows.length,
    unclassified: c.evidence.unclassified.length })), skipped: document.skipped, invalid: document.invalid }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
