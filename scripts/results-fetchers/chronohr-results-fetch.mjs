#!/usr/bin/env node
/**
 * Resultados HTML de CH:RO:NO (chrono.hr).
 *
 * La portada de una carrera descubre las jornadas publicadas; cada jornada
 * enlaza su propia portada y esta, a su vez, las clasificaciones disponibles.
 * No se presuponen prefijos de archivo: cambian entre carreras y en jornadas
 * dobles el número de archivo no coincide con el número deportivo de etapa.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1aCodeUnits as fnv1a } from './pdf-results-ids.mjs';

const PUBLIC_BASE = 'https://chrono.hr/races';
const RAW_BASE = 'https://chrono.hr/races-raw';
const USER_AGENT = 'calendariociclismo.app results sync (+https://calendariociclismo.app)';
const IRM_CODES = new Set(['DNF', 'DNS', 'OTL', 'DSQ', 'DQ', 'ABD', 'HD']);

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const index = argv.indexOf(name); return index < 0 ? fallback : argv[index + 1]; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const INCLUDE_FINAL = has('--final');
const FIXTURE = arg('--fixture');
const OUT = arg('--out', '.');
const log = (message) => process.stderr.write(`${message}\n`);

const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const normalized = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function parseCode(value) {
  const code = clean(value);
  if (!/^20\d{6}_[a-z0-9._-]+$/.test(code)) {
    throw new Error('--code debe tener el formato YYYYMMDD_slug de chrono.hr');
  }
  return code;
}

const negativeId = (value, modulo) => -((fnv1a(value) % modulo) + 1);
export const suggestCompetitionId = (code) => negativeId(`chronohr:competition:${parseCode(code)}`, 200000);
export const synthRaceId = (code, stageNumber, sectorIndex = 0) =>
  negativeId(`chronohr:race:${parseCode(code)}:${stageNumber}:${sectorIndex}`, 2000000000);
export const synthEventId = (code, stageNumber, sectorIndex, classKind, isFinal = false) =>
  negativeId(`chronohr:event:${parseCode(code)}:${isFinal ? 'final' : stageNumber}:${sectorIndex}:${classKind}`, 2000000000);

const decodeEntity = (entity) => {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  if (entity[0] === '#') {
    const hex = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : `&${entity};`;
  }
  return named[entity.toLowerCase()] ?? `&${entity};`;
};

export const htmlText = (html) => clean(String(html ?? '')
  .replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => decodeEntity(entity)));

function attrValue(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value == null ? null : value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => decodeEntity(entity));
}

export function rowsFromHtml(html) {
  const rows = [];
  // Varios índices históricos omiten `</tr>` en la cabecera. Separar por cada
  // apertura evita que esa fila absorba la primera jornada publicada.
  const fragments = String(html ?? '').split(/<tr\b[^>]*>/i).slice(1);
  for (const fragmentWithTail of fragments) {
    const rowFragment = fragmentWithTail.split(/<\/tr>/i, 1)[0];
    const cells = [];
    for (const cellMatch of rowFragment.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
      const fragment = cellMatch[1];
      const links = [...fragment.matchAll(/<a\b[^>]*>/gi)]
        .map((match) => attrValue(match[0], 'href')).filter(Boolean);
      cells.push({ text: htmlText(fragment), links });
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function parseStageLabel(value) {
  const text = normalized(value).replace(/[–—]/g, '-');
  if (/\bprologue\b|\bprolog\b/.test(text)) return { stageNumber: 0, sectorIndex: 0 };
  const match = text.match(/(?:\bstage\s*)?(\d+)\s*(?:st|nd|rd|th)?(?:\s*-\s*([a-z]))?/i);
  if (!match) return null;
  return {
    stageNumber: Number(match[1]),
    sectorIndex: match[2] ? match[2].toLowerCase().charCodeAt(0) - 97 : 0,
  };
}

function absoluteUrl(href, code, raw = false) {
  const base = `${raw ? RAW_BASE : PUBLIC_BASE}/${parseCode(code)}/`;
  const url = new URL(href, base);
  if (raw) url.pathname = url.pathname.replace(/^\/races\//, '/races-raw/');
  return url.href;
}

export function stagesFromIndexHtml(html, code) {
  const stages = [];
  for (const cells of rowsFromHtml(html)) {
    const stageLink = cells.flatMap((cell) => cell.links).find((href) => /\.php(?:[?#]|$)/i.test(href));
    if (!stageLink) continue;
    const parsed = parseStageLabel(cells[0]?.text);
    if (!parsed) continue;
    const pdfLink = cells.flatMap((cell) => cell.links).find((href) => /\.pdf(?:[?#]|$)/i.test(href));
    stages.push({
      ...parsed,
      stageLabel: cells[0].text,
      indexUrl: absoluteUrl(stageLink, code, true),
      sourcePdfUrl: pdfLink ? absoluteUrl(pdfLink, code, false) : null,
    });
  }
  return stages.sort((a, b) => a.stageNumber - b.stageNumber || a.sectorIndex - b.sectorIndex);
}

function kindFromLink(label, href) {
  const text = normalized(`${label} ${basename(new URL(href, 'https://chrono.hr/').pathname)}`);
  if (/communique|communique/.test(text)) return null;
  if (/team/.test(text)) return { classKind: 'teams', scope: 'overall', isTeamEvent: true };
  if (/u\s*23|u\s*21|youth|young/.test(text)) return { classKind: 'youth', scope: 'overall', isTeamEvent: false };
  if (/\bkom\b|mountain|sprint classification/.test(text)) return { classKind: 'kom', scope: 'overall', isTeamEvent: false };
  if (/points?/.test(text)) return { classKind: 'points', scope: 'overall', isTeamEvent: false };
  if (/stage results?|stage\d+\.html?/.test(text)) return { classKind: 'stage', scope: 'stage', isTeamEvent: false };
  if (/general|\bgc\d*\.html?/.test(text)) return { classKind: 'gc', scope: 'stage', isTeamEvent: false };
  return null;
}

export function classificationLinksFromStageHtml(html, code) {
  const found = new Map();
  // Las portadas de jornada publican los enlaces como una lista de `<a><br>`,
  // no dentro de una tabla. El texto tras el icono identifica el cuadro.
  for (const match of String(html ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attrValue(`<a ${match[1]}>`, 'href');
    if (!href || !/\.html?(?:[?#]|$)/i.test(href)) continue;
    const url = absoluteUrl(href, code, true);
    const kind = kindFromLink(htmlText(match[2]), url);
    if (kind && !found.has(kind.classKind)) found.set(kind.classKind, { ...kind, url });
  }
  return [...found.values()];
}

function headerKey(value) {
  // Los HTML exportados por Excel incluyen NBSP/caracteres de relleno en
  // cabeceras como `Rk` y `Bib`; algunos quedan como U+FFFD al decodificar la
  // respuesta declarada en windows-1252. Las etiquetas válidas solo necesitan
  // letras, números y los signos de la columna +/-.
  const text = normalized(value).replace(/[^a-z0-9+\/-]/g, '');
  if (/^(pl|rk|rank|pos|place)$/.test(text)) return 'rank';
  if (/^(bib|no|nr)$/.test(text)) return 'bib';
  if (/^name$/.test(text)) return 'name';
  if (/^(nat|nation|country)$/.test(text)) return 'nation';
  if (/^team$/.test(text)) return 'team';
  if (/^time$/.test(text)) return 'time';
  if (/^(gap|\+\/-)$/.test(text)) return 'gap';
  if (/^(pts|points)$/.test(text)) return 'points';
  return null;
}

function classifyTitle(title, fallback) {
  const text = normalized(title);
  if (/team classification/.test(text)) return { classKind: 'teams', scope: 'overall', isTeamEvent: true };
  if (/u\s*23|u\s*21|youth|young/.test(text)) return { classKind: 'youth', scope: 'overall', isTeamEvent: false };
  if (/\bkom\b|mountain/.test(text)) return { classKind: 'kom', scope: 'overall', isTeamEvent: false };
  if (/points? classification/.test(text)) return { classKind: 'points', scope: 'overall', isTeamEvent: false };
  if (/general individual/.test(text)) return { classKind: 'gc', scope: 'stage', isTeamEvent: false };
  if (/individual classification|prologue/.test(text)) return { classKind: 'stage', scope: 'stage', isTeamEvent: false };
  return fallback;
}

export function normalizeTime(value) {
  const raw = clean(value).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?::\d{2}){1,2}(?:\.\d+)?$/.test(raw)) return null;
  const parts = raw.split(':');
  return parts.length === 3 ? `${Number(parts[0])}:${parts[1]}:${parts[2]}` : `${Number(parts[0])}:${parts[1]}`;
}

export function normalizeGap(value) {
  const raw = clean(value).replace(/\s/g, '').replace(/^\+/, '');
  if (!/^\d+(?::\d{2}){0,2}(?:\.\d+)?$/.test(raw)) return null;
  const parts = raw.split(':');
  while (parts.length > 1 && Number(parts[0]) === 0) parts.shift();
  if (parts.length === 1) return `+${Number(parts[0])}`;
  return `+${Number(parts[0])}:${parts.slice(1).join(':')}`;
}

// Excel exporta los tiempos repetidos como `''` seguido de espaciado de
// presentación. Con la codificación declarada por CH:RO:NO (windows-1252),
// fetch() puede dejar ese espaciado como caracteres de reemplazo; el `''` al
// principio sigue siendo la señal fiable del ditto.
const quoteValue = (value) => {
  const text = clean(value);
  return text.startsWith("''") || /^(?:"|”|same)$/i.test(text);
};
const irmValue = (value) => {
  const code = clean(value).toUpperCase().replace(/\.$/, '');
  if (!IRM_CODES.has(code)) return null;
  return code === 'DQ' ? 'DSQ' : code === 'HD' ? 'OTL' : code;
};

const eventName = (kind, isFinal = false) => {
  if (isFinal) return {
    gc: 'Final General Classification', points: 'Final Points Classification',
    kom: 'Final KOM Classification', youth: 'Final Youth Classification',
    teams: 'Final Team Classification',
  }[kind] || 'Final Classification';
  return {
    stage: 'Stage Classification', gc: 'General Classification',
    points: 'Points Classification', kom: 'KOM Classification',
    youth: 'Youth Classification', teams: 'Team Classification',
  }[kind] || 'Classification';
};

export function classificationFromHtml(code, stage, link, html) {
  const tableRows = rowsFromHtml(html);
  const headerIndex = tableRows.findIndex((cells) => {
    const keys = cells.map((cell) => headerKey(cell.text));
    return keys.includes('rank') && (keys.includes('bib') || keys.includes('team'));
  });
  if (headerIndex < 0) return null;
  const title = tableRows.slice(0, headerIndex).flat().map((cell) => cell.text).filter(Boolean).join(' ');
  const classificationType = classifyTitle(title, link);
  const header = new Map();
  tableRows[headerIndex].forEach((cell, index) => {
    const key = headerKey(cell.text);
    if (key && !header.has(key)) header.set(key, index);
  });
  const valueAt = (cells, key) => cells[header.get(key)]?.text ?? '';
  const rows = [];
  let previousGap = '+0';
  let previousTime = null;
  for (const cells of tableRows.slice(headerIndex + 1)) {
    const rankRaw = valueAt(cells, 'rank');
    const irm = irmValue(rankRaw);
    const rank = /^\d+$/.test(clean(rankRaw)) && Number(rankRaw) > 0 ? Number(rankRaw) : null;
    if (!rank && !irm) continue;
    const isTeam = classificationType.isTeamEvent;
    const bibRaw = valueAt(cells, 'bib').replace(/^#/, '');
    const bib = /^\d+$/.test(bibRaw) ? bibRaw : null;
    const riderDisplay = clean(valueAt(cells, isTeam ? 'team' : 'name'));
    const teamName = clean(valueAt(cells, 'team')) || null;
    if ((!isTeam && (!bib || !riderDisplay)) || (isTeam && !riderDisplay)) continue;
    const base = {
      rank, rankText: rank ? String(rank) : irm, bib: isTeam ? null : bib,
      riderDisplay, teamName, resultValue: null, timeText: null, gapText: null,
      points: null, irm,
    };
    if (irm) { rows.push(base); continue; }
    if (classificationType.classKind === 'points' || classificationType.classKind === 'kom') {
      const pointsRaw = clean(valueAt(cells, 'points')).replace(',', '.');
      if (!/^-?\d+(?:\.\d+)?$/.test(pointsRaw)) continue;
      const points = Number(pointsRaw);
      rows.push({ ...base, resultValue: String(points), points });
      continue;
    }
    const sourceTime = valueAt(cells, 'time');
    const sourceGap = valueAt(cells, 'gap');
    if (rank === 1) {
      const timeText = normalizeTime(sourceTime);
      if (!timeText) continue;
      previousTime = timeText;
      previousGap = '+0';
      rows.push({ ...base, resultValue: timeText, timeText });
      continue;
    }
    let gapText;
    if (quoteValue(sourceGap) || quoteValue(sourceTime)) gapText = previousGap;
    else gapText = normalizeGap(sourceGap) || normalizeGap(sourceTime);
    if (!gapText && previousTime && normalizeTime(sourceTime)) {
      const seconds = (value) => value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
      const difference = seconds(normalizeTime(sourceTime)) - seconds(previousTime);
      if (difference >= 0) gapText = normalizeGap(String(difference));
    }
    if (!gapText) continue;
    previousGap = gapText;
    rows.push({ ...base, resultValue: gapText, gapText });
  }
  if (!rows.some((row) => row.rank === 1 && !row.irm)) return null;
  const kind = classificationType.classKind;
  return {
    eventId: synthEventId(code, stage.stageNumber, stage.sectorIndex, kind),
    classKind: kind,
    scope: classificationType.scope,
    eventName: eventName(kind),
    isTeamEvent: classificationType.isTeamEvent,
    winnerName: rows.find((row) => row.rank === 1)?.riderDisplay || null,
    rowCount: rows.length,
    sourcePdfUrl: stage.sourcePdfUrl,
    rows,
  };
}

export function finalClassificationStage(code, stage) {
  const classifications = stage.classifications
    .filter((classification) => classification.classKind !== 'stage')
    .map((classification) => ({
      ...classification,
      eventId: synthEventId(code, stage.stageNumber, stage.sectorIndex, classification.classKind, true),
      scope: 'stage',
      eventName: eventName(classification.classKind, true),
    }));
  if (!classifications.length) return null;
  return {
    uciRaceId: synthRaceId(code, stage.stageNumber, stage.sectorIndex),
    stageNumber: null,
    dateKey: null,
    raceType: 'IRR',
    isFinalClassification: true,
    eventName: 'Final Classification',
    sourcePdfUrl: stage.sourcePdfUrl,
    classifications,
  };
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.text();
}

function fixtureReader(path) {
  if (!path) return null;
  const fixture = JSON.parse(readFileSync(resolve(path), 'utf8'));
  return async (url) => {
    if (url === `${RAW_BASE}/${fixture.code || parseCode(CODE)}`) return fixture.indexHtml;
    const value = fixture.pages?.[url]
      ?? fixture.pages?.[new URL(url).pathname]
      ?? fixture.pages?.[basename(new URL(url).pathname)];
    if (value == null) throw new Error(`La fixture no contiene ${url}`);
    return value;
  };
}

export async function fetchCompetition({ code, competitionId, onlyStage = null, totalStages = null, includeFinal = false, readHtml = fetchHtml }) {
  const parsedCode = parseCode(code);
  const indexHtml = await readHtml(`${RAW_BASE}/${parsedCode}`);
  const publishedStages = stagesFromIndexHtml(indexHtml, parsedCode)
    .filter((stage) => onlyStage == null || stage.stageNumber === onlyStage);
  const stages = [];
  for (const published of publishedStages) {
    const stageIndex = await readHtml(published.indexUrl);
    const links = classificationLinksFromStageHtml(stageIndex, parsedCode);
    const classifications = [];
    for (const link of links) {
      const html = await readHtml(link.url);
      const classification = classificationFromHtml(parsedCode, published, link, html);
      if (classification) classifications.push(classification);
    }
    if (!classifications.length) continue;
    stages.push({
      uciRaceId: synthRaceId(parsedCode, published.stageNumber, published.sectorIndex),
      stageNumber: published.stageNumber,
      sectorIndex: published.sectorIndex,
      dateKey: null,
      raceType: 'IRR',
      isFinalClassification: false,
      eventName: published.stageLabel,
      sourcePdfUrl: published.sourcePdfUrl,
      classifications,
    });
  }
  if (includeFinal && Number.isInteger(totalStages)) {
    const lastStage = [...stages].reverse().find((stage) => stage.stageNumber === totalStages);
    if (lastStage?.classifications.some((classification) => classification.classKind === 'stage')) {
      const final = finalClassificationStage(parsedCode, lastStage);
      if (final) stages.push(final);
    }
  }
  return {
    competitionId,
    disciplineId: 10,
    source: 'chronohr',
    chronoHrCode: parsedCode,
    fetchedAt: new Date().toISOString(),
    stages,
  };
}

async function main() {
  const code = parseCode(CODE);
  if (has('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(code)}\n`);
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  if (ONLY_STAGE != null && (!Number.isInteger(ONLY_STAGE) || ONLY_STAGE < 0)) throw new Error('--stage debe ser un entero no negativo');
  if (INCLUDE_FINAL && (!Number.isInteger(TOTAL_STAGES) || TOTAL_STAGES < 1)) throw new Error('--final requiere --total-stages');
  const output = await fetchCompetition({
    code,
    competitionId: COMPETITION_ID,
    onlyStage: ONLY_STAGE,
    totalStages: TOTAL_STAGES,
    includeFinal: INCLUDE_FINAL,
    readHtml: fixtureReader(FIXTURE) || fetchHtml,
  });
  mkdirSync(OUT, { recursive: true });
  const destination = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(destination, JSON.stringify(output, null, 2));
  log(`chrono.hr ${code}: ${output.stages.length} jornadas → ${destination}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { log(`FATAL: ${error.message}`); process.exit(1); });
}
