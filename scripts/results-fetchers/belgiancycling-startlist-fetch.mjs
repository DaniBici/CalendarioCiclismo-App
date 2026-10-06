#!/usr/bin/env node
/**
 * belgiancycling-startlist-fetch.mjs — lista de inscritos oficial de Belgian
 * Cycling (KBWB/RLVB).
 *
 * La URL estable `YYYY/CODE-D.pdf` contiene un marcador hasta que la federación
 * publica la lista "DEELNEMERSLIJST - LISTE DES PARTANTS": bloques de equipos en
 * cinco columnas, con una línea `PL/DS` de director por bloque y corredores
 * precedidos por su dorsal. Las columnas fluyen de forma independiente, así que
 * el parseo trabaja sobre las coordenadas de `pdftotext -bbox-layout`. Es un
 * port del extractor manual `scripts/data-preflight/startlist-belgiancycling-pdf.py`,
 * que sigue disponible para importaciones asistidas con nombres recortados.
 *
 * Salida: JSON crudo { raceId, code, sourceUrl, dateKey, expectedRiderCount,
 * teams: [{ teamName, riders: [{ dorsal, firstName, lastName }] }] } — el mismo
 * contrato de documento que consume `prepare_startlist_import`.
 *
 * Uso:
 *   node scripts/results-fetchers/belgiancycling-startlist-fetch.mjs \
 *     --code 2026279 --race-id <id> --date 2026-09-20 --out <dir>
 *
 * Códigos de salida: 0 volcado, 3 marcador (lista aún no publicada), 1 error.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BELGIAN_DATE, dateKeyOf, isPlaceholder, parseCode, resultPdfUrl } from './belgiancycling-results-fetch.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const CODE = arg('--code');
const RACE_ID = arg('--race-id');
const DATE = arg('--date');
const OUT = arg('--out', '.');
const FIXTURE = arg('--fixture');
const log = (message) => process.stderr.write(`${message}\n`);

export const startlistPdfUrl = (code) => resultPdfUrl(code).replace(/-U\.pdf$/, '-D.pdf');

const decodeEntities = (value) => String(value ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

export function wordList(xml) {
  const words = [];
  const pattern = /<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g;
  for (const match of String(xml).matchAll(pattern)) {
    words.push({ x: Number(match[1]), y: Number(match[2]), text: decodeEntities(match[3]) });
  }
  return words;
}

// Palabras por página: el número de columnas varía entre ediciones (Flandes
// imprime 5, Gooikse 4) y cada página mantiene su propia retícula.
export function pagesOfWords(xml) {
  return String(xml).split(/<page[\s>]/).slice(1)
    .map((chunk) => wordList(chunk));
}

const FOOTER_TOKENS = new Set(['Last', 'Update:', ';', 'Results', 'at', ':', 'www.results.belgiancycling.be']);
const isFooter = (text) => FOOTER_TOKENS.has(text)
  || /^\d{1,2}:\d{2}$/.test(text)
  || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text);

function columnAnchors(words) {
  const anchors = [];
  for (const word of words) {
    if (word.text !== 'PL/DS') continue;
    if (!anchors.some((x) => Math.abs(x - word.x) <= 1)) anchors.push(word.x);
  }
  anchors.sort((a, b) => a - b);
  return anchors;
}

function lineGroups(words) {
  // Clustering por proximidad vertical: una misma línea impresa puede repartir
  // sus palabras en más de un bucket de redondeo (Gooikse 2026) y el espaciado
  // entre líneas (~11 pt) manda más que una tolerancia fija pequeña.
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const clusters = [];
  for (const word of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(word.y - last.y) <= 5) last.words.push(word);
    else clusters.push({ y: word.y, words: [word] });
  }
  return clusters.map((cluster) => ({
    y: cluster.y,
    text: cluster.words.sort((a, b) => a.x - b.x).map((w) => w.text).join(' ').trim(),
  }));
}

export function splitName(name) {
  const parts = String(name).trim().split(/\s+/);
  let split = 0;
  while (split < parts.length && parts[split] === parts[split].toLocaleUpperCase('es')) split += 1;
  if (!(0 < split && split < parts.length)) throw new Error(`No se separa el nombre: ${name}`);
  return { lastName: parts.slice(0, split).join(' '), firstName: parts.slice(split).join(' ') };
}

function parseColumn(lines, withBibs) {
  const teams = [];
  let team = null;
  let rider = null;
  let skipped = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].text;
    const nextText = index + 1 < lines.length ? lines[index + 1].text : '';
    if (text.split(' ', 1)[0] === 'PL/DS') continue;
    if (nextText.startsWith('PL/DS')) {
      team = { teamName: text, riders: [] };
      teams.push(team);
      rider = null;
      continue;
    }
    if (/^\d+$/.test(text)) { rider = null; continue; }
    if (withBibs) {
      const numbered = text.match(/^(\d+)\s+(.+)$/);
      if (numbered && team) {
        rider = { dorsal: Number(numbered[1]), name: numbered[2].trim() };
        team.riders.push(rider);
        continue;
      }
      if (rider) rider.name += ` ${text}`;
      continue;
    }
    // Engagements: filas sin dorsal. Una línea de bloque solo es corredor si el
    // nombre se separa en apellido mayúsculo + nombre propio; el resto (pie de
    // página repetido, cabeceras) se descarta con recuento.
    if (!team) continue;
    try {
      const { lastName, firstName } = splitName(text);
      team.riders.push({ dorsal: 0, firstName, lastName });
      rider = null;
    } catch {
      rider = null;
      skipped += 1;
    }
  }
  for (const parsed of teams) {
    for (const row of parsed.riders) {
      if (row.firstName != null) continue;
      const { lastName, firstName } = splitName(row.name);
      delete row.name;
      row.firstName = firstName;
      row.lastName = lastName;
    }
  }
  return { teams, skipped };
}

export function parseStartlistXml(code, xml, expectedDate = null) {
  const parsedCode = parseCode(code);
  const words = wordList(xml);
  const text = words.map((w) => w.text).join('\n');
  // El marcador se busca en el texto plano: en bbox cada palabra es un nodo
  // separado y la frase de la federación puede repartirse en varias líneas.
  const flat = words.map((w) => w.text).join(' ');
  if (isPlaceholder(flat)) return null;
  // Engagements ≠ Partants: bajo la misma URL estable la federación publica
  // primero la lista de inscripciones (provisional, sin dorsales fiables) y
  // después la lista de Partants con dorsales. La provisional se ingesta como
  // tal (dorsal=0) y el Partants la sustituye; ninguna de las dos es un error.
  let withBibs;
  if (/DEELNEMERSLIJST\s*-\s*LISTE\s+DES\s+PARTANTS/i.test(text)) withBibs = true;
  else if (/\b(INSCHRIJVEN|INSCHRIJVINGEN|ENGAGEMENTS)\b/i.test(flat)) withBibs = false;
  else throw new Error('el PDF no es una lista de inscritos de Belgian Cycling');
  // Marca de versión de la federación («Last Update: dd/mm/yyyy HH:MM», hora
  // local de la federación). Es evidencia de la edición descargada; no se
  // convierte a UTC porque su uso es comparativo, no horario.
  const lastUpdateMatch = flat.match(/Last\s+Update:\s*;?\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})\s+(\d{1,2}:\d{2})/i);
  const lastUpdate = lastUpdateMatch
    ? { dateKey: dateKeyOf(lastUpdateMatch), time: lastUpdateMatch[4], zone: 'Europe/Brussels' }
    : null;
  const dateMatch = text.match(BELGIAN_DATE);
  if (!dateMatch) throw new Error('el PDF no contiene fecha');
  const dateKey = dateKeyOf(dateMatch);
  if (dateKey.slice(0, 4) !== parsedCode.slice(0, 4)) throw new Error(`el PDF es de ${dateKey.slice(0, 4)}, no de ${parsedCode.slice(0, 4)}`);
  // La fecha impresa puede llevar errata de un día (misma regla que el carril
  // de resultados): se avisa y se normaliza a la fecha de la carrera.
  let normalizedDate = dateKey;
  if (expectedDate && dateKey !== expectedDate) {
    const diffDays = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${expectedDate}T00:00:00Z`)) / 86400000);
    if (!Number.isFinite(diffDays) || Math.abs(diffDays) > 1) throw new Error(`el PDF es de ${dateKey}, no de ${expectedDate}`);
    log(`Belgian Cycling ${parsedCode}: la lista imprime ${dateKey}; se toma la fecha de la carrera ${expectedDate}`);
    normalizedDate = expectedDate;
  }
  // Recuento de participantes: obligatorio y vinculante en el Partants; en el
  // Engagements la federación puede no imprimirlo y entonces no se contrasta.
  const countMatch = text.match(/\b(\d+)\s+Deeln\.\/Part\./i)
    || (!withBibs ? text.match(/\b(\d+)\s+(?:Ingeschreven|Inschrijvingen|Engagés?)/i) : null);
  const expectedRiderCount = countMatch ? Number(countMatch[1]) : null;
  if (withBibs && !countMatch) throw new Error('el PDF no declara el recuento de participantes');

  const pages = pagesOfWords(xml);
  if (!pages.length) throw new Error('el PDF no contiene páginas legibles');
  const teams = [];
  let skipped = 0;
  for (const page of pages) {
    const pageVisible = page.filter((w) => !isFooter(w.text));
    const anchors = columnAnchors(pageVisible);
    if (!anchors.length) continue;
    const boundaries = anchors.slice(1);
    const columns = anchors.map(() => []);
    for (const word of pageVisible) {
      let column = 0;
      while (column < boundaries.length && word.x >= boundaries[column]) column += 1;
      columns[column].push(word);
    }
    for (const column of columns) {
      const parsed = parseColumn(lineGroups(column), withBibs);
      teams.push(...parsed.teams);
      skipped += parsed.skipped;
    }
  }
  const riders = teams.flatMap((team) => team.riders.map((r) => (withBibs ? r.dorsal : 0)));
  const bibs = withBibs ? riders : [];
  if (withBibs) {
    if (bibs.length !== expectedRiderCount) {
      throw new Error(`Se extrajeron ${bibs.length} corredores, pero el PDF declara ${expectedRiderCount}.`);
    }
    if (new Set(bibs).size !== bibs.length || bibs.some((bib) => bib <= 0)) {
      throw new Error('Hay dorsales duplicados o no positivos.');
    }
  } else {
    if (!riders.length) throw new Error('No se extrajo ningún corredor del Engagements.');
    if (expectedRiderCount != null && riders.length !== expectedRiderCount) {
      throw new Error(`Se extrajeron ${riders.length} inscritos, pero el PDF declara ${expectedRiderCount}.`);
    }
    if (skipped) log(`Belgian Cycling ${parsedCode}: ${skipped} líneas de bloque descartadas en el Engagements`);
  }
  if (!teams.length) throw new Error('No se extrajo ningún equipo.');
  const signature = `${withBibs ? 'P' : 'E'}|${normalizedDate}|${expectedRiderCount ?? '?'}|${lastUpdate ? `${lastUpdate.dateKey} ${lastUpdate.time}` : '?'}|${riders.length}`;
  return {
    code: parsedCode,
    dateKey: normalizedDate,
    lastUpdate,
    provisional: !withBibs,
    signature,
    sourceUrl: startlistPdfUrl(parsedCode),
    expectedRiderCount: withBibs ? expectedRiderCount : riders.length,
    teams,
  };
}

async function pdfToWords(code) {
  const url = startlistPdfUrl(code);
  const separator = url.includes('?') ? '&' : '?';
  const response = await fetch(`${url}${separator}_=${Date.now()}`, {
    headers: {
      'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const dir = mkdtempSync(join(tmpdir(), 'belgiancycling-sl-'));
  const file = join(dir, 'startlist.pdf');
  try {
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return execFileSync('pdftotext', ['-bbox-layout', file, '-'], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const code = parseCode(CODE);
  if (!RACE_ID) throw new Error('Falta --race-id');
  const xml = FIXTURE ? readFileSync(resolve(FIXTURE), 'utf8') : await pdfToWords(code);
  const parsed = parseStartlistXml(code, xml, DATE);
  if (!parsed) {
    log(`Belgian Cycling ${code}: lista de inscritos aún no publicada`);
    process.exitCode = 3;
    return;
  }
  const output = {
    raceId: RACE_ID,
    code: parsed.code,
    sourceUrl: parsed.sourceUrl,
    dateKey: parsed.dateKey,
    lastUpdate: parsed.lastUpdate,
    provisional: parsed.provisional,
    signature: parsed.signature,
    expectedRiderCount: parsed.expectedRiderCount,
    teams: parsed.teams,
  };
  const { mkdirSync } = await import('node:fs');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${RACE_ID}.json`), JSON.stringify(output, null, 2));
  log(`Belgian Cycling ${code}: ${output.teams.length} equipos, ${output.expectedRiderCount} inscritos (${parsed.dateKey}${parsed.lastUpdate ? `, fuente ${parsed.lastUpdate.dateKey} ${parsed.lastUpdate.time}` : ''})${parsed.provisional ? ' · ENGAGEMENTS provisional' : ''}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exit(1); });
