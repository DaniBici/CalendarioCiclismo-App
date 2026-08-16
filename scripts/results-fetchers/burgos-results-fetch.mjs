#!/usr/bin/env node
/**
 * Vuelta a Burgos — resultados oficiales en PDF.
 *
 * Cada etapa publica una página estable /es/clasificaciones-N a-etapa/ (sin el
 * espacio) con dos enlaces: clasificación de etapa y clasificación general.
 * Los PDF son la fuente: no se infieren rutas de uploads ni se guardan URLs
 * efímeras. Del primero salen etapa; del segundo, general, puntos, montaña,
 * jóvenes y equipos. Esas son las seis pestañas públicas.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const has = (name) => argv.includes(name);
const YEAR = Number(arg('--year'));
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const FIXTURE = arg('--fixture');
const BASE = 'https://www.vueltaburgos.com';
const UA = 'calendariociclismo.app results sync (+https://calendariociclismo.app)';
const log = (message) => process.stderr.write(`${message}\n`);

export function fnv1a(value) { let h = 0x811c9dc5; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export const suggestCompetitionId = (year) => -(fnv1a(`burgos-pdf:${year}`) % 200000);
const classIndex = { 'stage/stage': 1, 'gc/stage': 2, 'points/overall': 3, 'kom/overall': 4, 'youth/overall': 5, 'teams/overall': 6 };
// La Vuelta ya tenía PDFs cargados manualmente: conservar la familia de IDs
// del puente existente evita duplicar clasificaciones al pasar al fetcher.
export const synthRaceId = (competitionId, stage) => -(Math.abs(competitionId) * 100 + stage);
export const synthEventId = (competitionId, stage, kind, scope) => {
  // La final reutiliza las clases acumuladas pero cambia scope a `stage`: su
  // índice conserva el de la clasificación original para que cada una tenga un
  // eventId propio (puntos/kom/jóvenes/equipos nunca pueden colisionar en 99).
  const index = classIndex[`${kind}/${scope}`] ?? classIndex[`${kind}/overall`] ?? 99;
  return -(Math.abs(competitionId) * 10000 + stage * 100 + index);
};

const clean = (v) => String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const deaccent = (v) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const ISO2 = { ARG: 'ar', AUS: 'au', AUT: 'at', BEL: 'be', BRA: 'br', CAN: 'ca', CHI: 'cl', COL: 'co', CZE: 'cz', DEN: 'dk', ECU: 'ec', ERI: 'er', ESP: 'es', FRA: 'fr', GBR: 'gb', GER: 'de', GUA: 'gt', IRL: 'ie', ITA: 'it', KAZ: 'kz', LUX: 'lu', NED: 'nl', NOR: 'no', NZL: 'nz', POL: 'pl', POR: 'pt', SLO: 'si', SUI: 'ch', URU: 'uy', USA: 'us' };
const IOC = Object.keys(ISO2).join('|');
const resultToken = '(?:a\\s+)?\\d+(?::\\d{2}){0,2}|m\\.t\\.';
// IOC opcional: algún listado omite el país (p. ej. Syrtsa, E4-2026), pero
// cuando aparece solo aceptamos un código IOC conocido; así XAT no se confunde
// con una nacionalidad y no se come la columna derecha de la misma línea.
const countryBeforeWrappedName = new RegExp(`(\\d+º\\s+(?:\\d+º\\s+)?\\d+\\s+(?:.+?\\s+)?)(${IOC})\\s+(.+?)\\s*([A-Z]{3})\\s+(${resultToken})(?:\\s+\\d+\")?`, 'g');
const rowPrefix = '^\\s*(\\d+)º\\s+(?:\\d+º\\s+)?(\\d+)\\s+';
const rowSuffix = `\\s+(${resultToken})(?:\\s+\\d+\"?)*\\s*$`;
const individualWithCountry = new RegExp(`${rowPrefix}(.+?)\\s+(${IOC})\\s+([A-Z]{2,4})${rowSuffix}`, 'i');
const individualWithoutCountry = new RegExp(`${rowPrefix}(.+?)\\s+([A-Z]{2,4})${rowSuffix}`, 'i');
// No separar el segundo puesto que aparece en jóvenes ("12º 47º 96"): el
// carácter anterior es º. Sí separar las dos columnas reales de la página.
const rowStart = /(?<!º)\s+(?=\d+º\s+(?:\d+º\s+)?\d+\s+)/;

export const pageUrl = (stage) => `${BASE}/es/clasificaciones-${stage}a-etapa/`;
export function pdfLinksFromHtml(html) {
  const links = {};
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = deaccent(m[2].replace(/<[^>]+>/g, ' '));
    const href = new URL(m[1], BASE).href;
    if (/CLASIFICACIONES? DE LA ETAPA/.test(label)) links.stage = href;
    if (/CLASIFICACION GENERAL/.test(label)) links.general = href;
  }
  return links;
}

const time = (value) => {
  const v = clean(value).replace(/^a\s+/i, '').replace(/^\+/, '').replace(/^m\.t\.$/i, '');
  const m = v.match(/^(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return m[3] ? `${Number(m[1])}:${m[2]}:${m[3]}` : `0:${Number(m[1])}:${m[2]}`;
};
const gap = (value, previous = null) => {
  const v = clean(value).replace(/^a\s+/i, '');
  if (/^m\.t\./i.test(v)) return previous;
  // El PDF de Burgos añade a veces la bonificación tras el gap ("a 3   6\"").
  // Solo el primer token es la diferencia oficial; lo posterior no forma parte
  // de la clasificación y no debe hacer desaparecer el gap.
  const duration = v.match(/^(\d+(?::\d{2}){0,2})\b/)?.[1];
  if (!duration) return null;
  if (/^\d+$/.test(duration)) return `+${Number(duration)}`;
  const t = time(duration); if (!t) return null;
  const [h, m, s] = t.split(':').map(Number);
  const seconds = h * 3600 + m * 60 + s;
  if (seconds < 60) return `+${seconds}`;
  return h ? `+${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `+${m}:${String(s).padStart(2, '0')}`;
};
const dateKey = (text) => {
  const m = String(text).match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
function sections(text, title) {
  const pages = String(text).split('\f');
  return pages.filter((page) => title.test(deaccent(page)));
}
export function individualRows(pages) {
  const rows = new Map(); let previousGap = null;
  for (const page of pages) {
    const lines = page.split(/\r?\n/);
    // pdftotext corta excepcionalmente una celda de la columna derecha justo
    // tras el IOC (E4/E5-2026). Reconstruimos solo ese corte y devolvemos el
    // IOC a su posición normal tras el nombre antes de parsear la fila.
    for (let i = 0; i + 1 < lines.length; i++) if (/\s[A-Z]{3}\s*$/.test(lines[i])) {
      const combined = `${lines[i]} ${lines[i + 1]}`.replace(countryBeforeWrappedName, '$1$3 $2 $4 $5');
      lines.splice(i, 2, combined);
    }
    for (const line of lines) {
    // Puesto, dorsal, nombre, IOC, código de equipo, tiempo/gap. El equipo no se
    // usa para resolver, pero su posición fija evita confundir apellidos con IOC.
    // Las páginas anchas llevan dos columnas. Las separamos antes de interpretar
    // país/equipo: de otro modo un IOC de la columna derecha puede tragarse la
    // fila izquierda (y su diferencia) cuando esta no publica nacionalidad.
    for (const chunk of line.split(rowStart)) {
      const withCountry = chunk.match(individualWithCountry);
      const m = withCountry ?? chunk.match(individualWithoutCountry);
      if (!m) continue;
      const [, rankText, bib, riderDisplay] = m;
      const ioc = withCountry ? m[4] : null;
      const teamName = withCountry ? m[5] : m[4];
      const result = withCountry ? m[6] : m[5];
      const rank = Number(rankText); if (rows.has(rank)) continue;
      const absolute = rank === 1 ? time(result) : null;
      const row = { rank, rankText: String(rank), bib, riderDisplay: clean(riderDisplay), teamName, isoCode2: ISO2[ioc] ?? null,
        resultValue: absolute, timeText: absolute, gapText: rank === 1 ? null : gap(result, previousGap), points: null, irm: null };
      if (rank === 1) previousGap = '+0';
      else if (row.gapText) previousGap = row.gapText;
      rows.set(rank, row);
    }
  }
  }
  return [...rows.values()].sort((a, b) => a.rank - b.rank);
}
function pointsRows(pages) {
  const rows = new Map();
  for (const page of pages) for (const line of page.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)º\s+(?:\d+º\s+)?(\d+)\s+(.+?)\s+([A-Z]{3})\s+.+?\s+(\d+)\s*$/);
    if (!m) continue;
    const [, rankText, bib, riderDisplay, ioc, pointText] = m; const rank = Number(rankText);
    if (rows.has(rank)) continue;
    const points = Number(pointText);
    rows.set(rank, { rank, rankText: String(rank), bib, riderDisplay: clean(riderDisplay), isoCode2: ISO2[ioc] ?? null, points, resultValue: String(points), timeText: String(points), gapText: null, irm: null });
  }
  return [...rows.values()].sort((a, b) => a.rank - b.rank);
}
function teamRows(pages) {
  const rows = new Map(); let previousGap = null;
  for (const page of pages) for (const line of page.split(/\r?\n/)) {
    // El nombre puede terminar en una palabra de 2–4 mayúsculas (MOVISTAR
    // TEAM, UAE TEAM EMIRATES XRG). El código del equipo es el que precede al
    // tiempo/gap, no simplemente el primer token que cumple ese patrón.
    const m = line.match(/^\s*(\d+)º\s+(.+?)\s+([A-Z]{2,4})\s+((?:a\s+)?\d+(?::\d{2}){0,2}|m\.t\.)\s*$/i);
    if (!m) continue;
    const [, rankText, team, teamCode, result] = m; const rank = Number(rankText);
    if (rows.has(rank)) continue;
    const absolute = rank === 1 ? time(result) : null;
    const row = { rank, rankText: String(rank), bib: null, riderDisplay: clean(team), teamName: clean(team), teamCode, resultValue: absolute, timeText: absolute, gapText: rank === 1 ? null : gap(result, previousGap), points: null, irm: null };
    if (rank === 1) previousGap = '+0';
    else if (row.gapText) previousGap = row.gapText;
    rows.set(rank, row);
  }
  return [...rows.values()].sort((a, b) => a.rank - b.rank);
}
function statusRows(pages) {
  const rows = []; let irm = null;
  for (const page of pages) for (const line of page.split(/\r?\n/)) {
    if (/^\s*NO SALIDOS\s*$/i.test(line)) { irm = 'DNS'; continue; }
    if (/^\s*(?:ABANDONOS|RETIRADOS)\s*$/i.test(line)) { irm = 'DNF'; continue; }
    if (!irm) continue;
    const m = line.match(new RegExp(`^\\s*(\\d+)\\s+(.+?)(?:\\s*)(${IOC})\\s+([A-Z]{2,4})\\s*$`));
    if (!m) continue;
    const [, bib, riderDisplay, ioc, teamName] = m;
    rows.push({ rank: null, rankText: irm, bib, riderDisplay: clean(riderDisplay), teamName, isoCode2: ISO2[ioc] ?? null, resultValue: null, timeText: null, gapText: null, points: null, irm });
  }
  return rows;
}
function validate(rows, label, teams = false) {
  const ranked = rows.filter((r) => r.rank != null);
  if (!ranked.length || ranked[0].rank !== 1 || ranked.some((r, i) => r.rank !== i + 1)) throw new Error(`${label}: rangos incompletos o sin ganador`);
  const ids = rows.map((r) => teams ? r.riderDisplay : r.bib);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}: filas duplicadas`);
  return rows;
}
function classification(competitionId, stage, kind, scope, eventName, rows, isTeamEvent = false) {
  const valid = validate(rows, eventName, isTeamEvent);
  return { eventId: synthEventId(competitionId, stage, kind, scope), classKind: kind, scope, eventName, isTeamEvent,
    winnerName: valid[0].riderDisplay, rowCount: valid.length, rows: valid };
}

export function parsePdfs(year, stageNumber, stageText, generalText, totalStages = null, competitionId = suggestCompetitionId(year)) {
  // La clasificación de etapa lleva además puntos/montaña/jóvenes DEL DÍA: se
  // excluyen por título; solo la tabla "ETAPA" exacta es publicable.
  const stagePages = sections(stageText, /\bETAPA\b/).filter((p) => !/\b(ETAPA JOVENES|PUNTOS ETAPA|ETAPA MONTANA|EQUIPOS)\b/.test(deaccent(p)));
  const classifications = [classification(competitionId, stageNumber, 'stage', 'stage', 'Stage Classification', [...individualRows(stagePages), ...statusRows(stagePages)])];
  const general = (title) => sections(generalText, title);
  const gc = general(/\bGENERAL\b/).filter((p) => !/\b(GENERAL POR PUNTOS|GENERAL MONTANA|GENERAL JOVENES|GENERAL EQUIPOS|GENERAL BURGALES|GENERAL ESPANOLES)\b/.test(deaccent(p)));
  const add = (kind, scope, name, rows, team = false) => { if (rows.length) classifications.push(classification(competitionId, stageNumber, kind, scope, name, rows, team)); };
  add('gc', 'stage', 'General Classification', individualRows(gc));
  add('points', 'overall', 'Overall Points Classification', pointsRows(general(/GENERAL POR PUNTOS/)));
  add('kom', 'overall', 'Overall Mountains Classification', pointsRows(general(/GENERAL MONTANA/)));
  add('youth', 'overall', 'Overall Youth Classification', individualRows(general(/GENERAL JOVENES/)));
  add('teams', 'overall', 'Overall Teams Classification', teamRows(general(/GENERAL EQUIPOS/)), true);
  const stage = { uciRaceId: synthRaceId(competitionId, stageNumber), stageNumber, dateKey: dateKey(stageText) ?? dateKey(generalText), eventName: `Stage ${stageNumber}`, classifications };
  const final = totalStages != null && stageNumber === totalStages
    ? { uciRaceId: synthRaceId(competitionId, 99), stageNumber: null, isFinalClassification: true, eventName: 'Final Classification', classifications: classifications.filter((c) => c.classKind !== 'stage').map((c) => ({ ...c, scope: 'stage', eventId: synthEventId(competitionId, 99, c.classKind, 'stage') })) }
    : null;
  return { stage, final };
}

async function fetchText(url) { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`); return r.text(); }
async function pdfText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  const dir = mkdtempSync(join(tmpdir(), 'burgos-pdf-')); const file = join(dir, 'result.pdf');
  try { writeFileSync(file, Buffer.from(await r.arrayBuffer())); return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
async function main() {
  if (!Number.isInteger(YEAR) || YEAR < 2000) throw new Error('Falta --year válido');
  if (has('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(YEAR)}\n`);
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  const stageNumbers = ONLY_STAGE != null ? [ONLY_STAGE] : Array.from({ length: TOTAL_STAGES || 0 }, (_, i) => i + 1);
  if (!stageNumbers.length) throw new Error('Usa --stage o --total-stages');
  const stages = [];
  for (const stageNumber of stageNumbers) try {
    const page = fixture?.pages?.[stageNumber] ?? await fetchText(pageUrl(stageNumber));
    const links = pdfLinksFromHtml(page); if (!links.stage || !links.general) { log(`  ∅ etapa ${stageNumber}: PDFs aún no publicados`); continue; }
    const stageText = fixture?.pdfTextByUrl?.[links.stage] ?? await pdfText(links.stage);
    const generalText = fixture?.pdfTextByUrl?.[links.general] ?? await pdfText(links.general);
    const parsed = parsePdfs(YEAR, stageNumber, stageText, generalText, TOTAL_STAGES, COMPETITION_ID); stages.push(parsed.stage); if (parsed.final) stages.push(parsed.final);
  } catch (error) { log(`  ⚠ etapa ${stageNumber}: ${error.message}`); }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'burgos', burgosYear: YEAR, fetchedAt: new Date().toISOString(), stages };
  mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((e) => { log(`FATAL: ${e.stack || e.message}`); process.exit(1); });
