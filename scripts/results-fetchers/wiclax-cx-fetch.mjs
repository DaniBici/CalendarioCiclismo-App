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

// «00h45'44» o «00h45'44,082» → segundos (con decimales); texto no horario → null.
export function wiclaxSeconds(value) {
  const match = /^(\d+)h(\d{2})'(\d{2})(?:[,.](\d+))?$/.exec(clean(value));
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
}
const hms = total => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const gap = total => `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

function statusOf(text) {
  const irm = irmOf(text);
  if (!irm) throw new Error(`Estado Wiclax no reconocido: «${text}»`);
  return irm;
}

export function parseWiclaxCx(xml, { map, raceId, seasonKey, dateKey, sourceUrl, sourceFileUrl }) {
  const event = elements(xml, 'Epreuve')[0] || {};
  if (event.dt1 && dateKey && event.dt1 !== dateKey) throw new Error(`Fecha del archivo ${event.dt1} distinta de ${dateKey}`);
  const stage = elements(xml, 'Etape')[0] || {};
  const courses = elements(firstBlock(xml, 'Parcours'), 'Pcs').map(course => course.nom);
  const finished = String(stage.finito ?? '').split(',');
  const entries = new Map(elements(firstBlock(xml, 'Engages'), 'E').map(entry => [entry.d, entry]));
  const results = new Map(elements(firstBlock(xml, 'Resultats'), 'R').map(result => [result.d, result]));
  const categories = []; const skipped = [];
  for (const [course, category] of Object.entries(map)) {
    if (!CATEGORIES.has(category)) throw new Error(`Categoría CX inválida: ${category}`);
    const index = courses.indexOf(course);
    if (index < 0) throw new Error(`Recorrido «${course}» ausente del archivo`);
    if (finished[index] !== '1') { skipped.push({ course, category, reason: 'Recorrido sin terminar en el cronometraje' }); continue; }
    const field = [...entries.values()].filter(entry => entry.p === course && results.has(entry.d))
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
        sourceName: clean(entry.n), teamName: clean(entry.c) || null, isoCode2: countryCode(entry.na)?.toUpperCase() || null,
        birthYear: /^\d{4}$/.test(entry.a || '') ? entry.a : null, uciLicenseId: /^\d{11}$/.test(entry.l2 || '') ? entry.l2 : null,
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
  return { schemaVersion: 1, source: 'manual', disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl, sourceFileUrl, timer: 'wiclax', eventName: clean(event.nom) || null }, categories, skipped };
}

// El visor G-Live recibe la ruta del archivo en `f`; se descarga el .clax directo.
export function wiclaxFileUrl(url) {
  const parsed = new URL(url);
  const file = parsed.searchParams.get('f');
  return file ? new URL(file, parsed.origin).href : parsed.href;
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
  const fileUrl = wiclaxFileUrl(options.url);
  const response = await fetch(fileUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${fileUrl}`);
  const xml = (await response.text()).replace(/^﻿/, '');
  const document = parseWiclaxCx(xml, { map, raceId: options['race-id'], seasonKey: options['season-key'], dateKey: options.date,
    sourceUrl: options.url, sourceFileUrl: fileUrl });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, rows: c.rows.length })), skipped: document.skipped }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
