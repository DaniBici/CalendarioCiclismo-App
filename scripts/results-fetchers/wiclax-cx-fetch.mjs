#!/usr/bin/env node
/**
 * Wiclax (.clax) → documento de resultados CX (contrato de cx-results-upsert.mjs).
 *
 * Wiclax es el software de cronometraje de muchas pruebas españolas (Becrono y
 * otros). El visor G-Live (`g-live.html?f=/ruta/archivo.clax`) lee un XML con
 * inscritos (`<E>`), pasos y meta (`<R>`) y recorridos (`<Pcs>`). El archivo no
 * guarda puestos: se ordena por vueltas completadas y, a igualdad, por la hora
 * de último paso con decimales, igual que el visor y el `<Podiums>` del archivo.
 *
 *   node scripts/results-fetchers/wiclax-cx-fetch.mjs --url <g-live o .clax> \
 *     --race-id <cxRaceId> --season-key 2026-27 --date 2026-10-04 \
 *     --map 'ELITE-SUB23=ME,FEM ELITE-SUB23=WE,JUNIOR=MJ,FEM JUNIOR=WJ' [--out doc.json]
 *
 * Solo emite los recorridos que el archivo marca como terminados (`finito`);
 * los demás quedan en `skipped`. No resuelve fichas ni equipos: el documento
 * conserva la grafía de la fuente para la normalización posterior.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { countryCode } from '../uci-catalog/countries.mjs';
import { cxNaturalRiderDisplay, splitCxDisplayName } from './cx-dataride-results.mjs';
import { attrs, firstBlock, irmOf } from './sts-results-fetch.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => code[0] === '#'
  ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
  : ENTITIES[code] ?? match);
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const elements = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}\\s[^>]*>`, 'g'))]
  .map(([tagText]) => Object.fromEntries(Object.entries(attrs(tagText)).map(([key, value]) => [key, decode(value)])));

// Nacionalidad del inscrito: código IOC (`ESP`) o, en archivos de cronometradores
// españoles, gentilicio o nombre del país en castellano («Española», «Alemania»).
const foldText = value => clean(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const DEMONYMS = { espanola: 'ES', espanol: 'ES', francesa: 'FR', frances: 'FR', portuguesa: 'PT', portugues: 'PT',
  italiana: 'IT', italiano: 'IT', belga: 'BE', alemana: 'DE', aleman: 'DE', britanica: 'GB', britanico: 'GB',
  neerlandesa: 'NL', neerlandes: 'NL', holandesa: 'NL', holandes: 'NL', suiza: 'CH', suizo: 'CH', andorrana: 'AD',
  andorrano: 'AD', irlandesa: 'IE', irlandes: 'IE', estadounidense: 'US', colombiana: 'CO', colombiano: 'CO',
  mexicana: 'MX', mexicano: 'MX', argentina: 'AR', argentino: 'AR', venezolana: 'VE', venezolano: 'VE',
  ecuatoriana: 'EC', ecuatoriano: 'EC', chilena: 'CL', chileno: 'CL', checa: 'CZ', checo: 'CZ', polaca: 'PL', polaco: 'PL' };
const RETIRED_REGIONS = new Set(['AN', 'BU', 'CS', 'DD', 'FX', 'NT', 'SU', 'TP', 'YD', 'YU', 'ZR', 'EU', 'EZ', 'UN', 'QO', 'ZZ']);
// Nombres de país en inglés que `Intl.DisplayNames` no devuelve (Linia de Sosire, Timișoara 2026).
const ENGLISH_NAMES = { 'czech republic': 'CZ', macedonia: 'MK', 'united states of america': 'US', 'great britain': 'GB',
  turkey: 'TR', 'ivory coast': 'CI' };
const regionCodes = new Map();
function regionCode(locale, value) {
  if (!regionCodes.has(locale)) {
    const codes = new Map(); const names = new Intl.DisplayNames([locale], { type: 'region' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      // Códigos retirados (DD = RDA, YU, CS, SU…) comparten nombre con el país vigente.
      const code = String.fromCharCode(a, b); let name;
      if (RETIRED_REGIONS.has(code)) continue;
      try { name = names.of(code); } catch { continue; }
      if (name && name !== code && !codes.has(foldText(name))) codes.set(foldText(name), code);
    }
    regionCodes.set(locale, codes);
  }
  return regionCodes.get(locale).get(foldText(value)) || null;
}
export function wiclaxCountry(value) {
  const text = clean(value);
  if (!text) return null;
  if (/^[A-Z]{2}$/.test(text)) return text;
  return countryCode(text)?.toUpperCase() || DEMONYMS[foldText(text)] || regionCode('es', text) || regionCode('en', text)
    || ENGLISH_NAMES[foldText(text)] || null;
}

// «00h45'44» o «00h45'44,082» → segundos (con decimales); texto no horario → null.
export function wiclaxSeconds(value) {
  const match = /^(\d+)h(\d{2})'(\d{2})(?:[,.](\d+))?$/.exec(clean(value));
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
}
const hms = total => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

// El cronometraje rumano escribe el ID UCI en grupos («100 555 634 02»).
const licence = value => String(value ?? '').replace(/\s+/g, '');

function statusOf(text) {
  const irm = irmOf(text);
  if (!irm) throw new Error(`Estado Wiclax no reconocido: «${text}»`);
  return irm;
}

export function parseWiclaxCx(xml, { map, raceId, seasonKey, dateKey, sourceUrl, sourceFileUrl, source = 'manual' }) {
  const event = elements(xml, 'Epreuve')[0] || {};
  if (event.dt1 && dateKey && event.dt1 !== dateKey) throw new Error(`Fecha del archivo ${event.dt1} distinta de ${dateKey}`);
  const stage = elements(xml, 'Etape')[0] || {};
  const courses = elements(firstBlock(xml, 'Parcours'), 'Pcs').map(course => course.nom);
  const finished = String(stage.finito ?? '').split(',');
  const entries = new Map(elements(firstBlock(xml, 'Engages'), 'E').map(entry => [entry.d, entry]));
  const results = new Map(elements(firstBlock(xml, 'Resultats'), 'R').map(result => [result.d, result]));
  const categories = []; const skipped = [];
  // Varios recorridos asignados a una misma categoría (Elite y U23 con la misma salida, Timișoara 2026) forman
  // una sola clasificación conjunta; si alguno no ha terminado, la categoría espera a todos.
  const groups = new Map();
  for (const [course, category] of Object.entries(map)) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    if (!courses.includes(course)) throw new Error(`Recorrido «${course}» ausente del archivo`);
    groups.set(category, [...groups.get(category) || [], course]);
  }
  for (const [category, groupCourses] of groups) {
    const unfinished = groupCourses.filter(course => finished[courses.indexOf(course)] !== '1');
    if (unfinished.length) { for (const course of unfinished) skipped.push({ course, category, reason: 'Recorrido sin terminar en el cronometraje' }); continue; }
    const course = groupCourses.join(' + ');
    const field = [...entries.values()].filter(entry => groupCourses.includes(entry.p) && results.has(entry.d))
      .map(entry => ({ entry, result: results.get(entry.d) }));
    const finishers = field.filter(({ result }) => wiclaxSeconds(result.t) != null)
      .sort((a, b) => Number(b.result.to) - Number(a.result.to)
        || (wiclaxSeconds(a.result.b) ?? wiclaxSeconds(a.result.t)) - (wiclaxSeconds(b.result.b) ?? wiclaxSeconds(b.result.t)));
    if (!finishers.length) { skipped.push({ course, category, reason: 'Recorrido sin llegadas' }); continue; }
    const laps = Number(finishers[0].result.to);
    const winner = Math.trunc(wiclaxSeconds(finishers[0].result.t));
    const row = ({ entry, result }, extra) => {
      const { firstName, lastName } = splitCxDisplayName(entry.n);
      return { bib: clean(entry.d), riderDisplay: cxNaturalRiderDisplay(firstName, lastName, entry.n), firstName, lastName,
        sourceName: clean(entry.n), teamName: clean(entry.c) || null, isoCode2: wiclaxCountry(entry.na),
        birthYear: /^\d{4}$/.test(entry.a || '') ? entry.a : null, uciLicenseId: /^\d{11}$/.test(licence(entry.l2)) ? licence(entry.l2) : null,
        bonusSeconds: null, ...extra };
    };
    const rows = finishers.map((item, position) => {
      const down = laps - Number(item.result.to);
      if (down > 0) return row(item, { rank: position + 1, rankText: String(position + 1), irm: 'LAP', gapText: `-${down} LAP`, timeText: null, timeSeconds: null });
      const time = Math.trunc(wiclaxSeconds(item.result.t));
      return row(item, { rank: position + 1, rankText: String(position + 1), irm: null, timeText: hms(time), timeSeconds: String(time),
        gapText: position ? gap(time - winner) : null });
    });
    for (const item of field.filter(({ result }) => wiclaxSeconds(result.t) == null)) {
      const irm = statusOf(item.result.t);
      rows.push(row(item, { rank: null, rankText: irm, irm, gapText: null, timeText: null, timeSeconds: null }));
    }
    categories.push({ category, dateKey: dateKey || event.dt1, sourceCourse: course, rows });
  }
  // La recogida del worker (`source: 'wiclax'`) acredita el enlace de cx_race_timing_links con la URL configurada.
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl, sourceFileUrl, timer: 'wiclax', eventName: clean(event.nom) || null,
      ...(source === 'wiclax' ? { wiclax: { sourceUrl } } : {}) }, categories, skipped };
}

// El visor G-Live recibe la ruta del archivo en `f`; se descarga el .clax directo.
export function wiclaxFileUrl(url) {
  const parsed = new URL(url);
  const file = parsed.searchParams.get('f');
  return file ? new URL(file, parsed.origin).href : parsed.href;
}

export async function fetchWiclaxXml(url) {
  const fileUrl = wiclaxFileUrl(url);
  const response = await fetch(fileUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${fileUrl}`);
  return { fileUrl, xml: (await response.text()).replace(/^\uFEFF/, '') };
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
  const { fileUrl, xml } = await fetchWiclaxXml(options.url);
  const document = parseWiclaxCx(xml, { map, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date,
    sourceUrl: options.url, sourceFileUrl: fileUrl });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, rows: c.rows.length })), skipped: document.skipped }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
