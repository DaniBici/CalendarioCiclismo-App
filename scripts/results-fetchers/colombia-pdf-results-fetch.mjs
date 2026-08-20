#!/usr/bin/env node
/**
 * Resultados de Clasificaciones del Ciclismo Colombiano.
 *
 * La página de cada prueba publica enlaces directos a un PDF por etapa. No hay
 * API: descubrimos esos enlaces en cada pasada y usamos `pdftotext -layout`, no
 * OCR, porque estos PDF tienen capa de texto y su geometría es el contrato.
 * Una tabla parcial o mal leída se descarta antes de llegar al upsert.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1]; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const FIXTURE = arg('--fixture');
const BASE = 'https://www.clasificacionesdelciclismocolombiano.com';
const log = (message) => process.stderr.write(`${message}\n`);

export function fnv1a(value) { let h = 0x811c9dc5; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export const suggestCompetitionId = (code) => -(fnv1a(`colombia-pdf:${code}`) % 200000);
export const synthRaceId = (code, stage) => -(Math.abs(suggestCompetitionId(code)) * 100 + stage);
const CLASS_INDEX = { stage: 0, gc: 1, points: 2, kom: 3, youth: 4, teams: 5 };
export const synthEventId = (code, stage, kind) => -(Math.abs(suggestCompetitionId(code)) * 10000 + stage * 100 + (CLASS_INDEX[kind] ?? 99));
const FINAL_SLOT = 99;

const clean = (value) => String(value ?? '').replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const words = new Map([['PROLOGO', 0], ['PRÓLOGO', 0], ['PRIMERA', 1], ['SEGUNDA', 2], ['TERCERA', 3], ['CUARTA', 4], ['QUINTA', 5], ['SEXTA', 6], ['SEPTIMA', 7], ['SÉPTIMA', 7], ['OCTAVA', 8], ['NOVENA', 9], ['DECIMA', 10], ['DÉCIMA', 10], ['UNDECIMA', 11], ['UNDÉCIMA', 11], ['DUODECIMA', 12], ['DUODÉCIMA', 12]]);

export function parseCode(value) {
  const code = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(code)) throw new Error('--code debe ser el slug de la carrera colombiana');
  return code.toLowerCase();
}

export function stageFromLabel(label) {
  const text = clean(label).toLocaleUpperCase('es');
  if (!/\b(CL[AÁ]S?IFICACI[OÓ]N|CLASIFICACION)\b/.test(text)) return null;
  const word = text.match(/\b(PROLOGO|PRÓLOGO|PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|D[ÉE]CIMA|UND[ÉE]CIMA|DUOD[ÉE]CIMA)\s+ETAPA\b/)?.[1];
  return word ? words.get(word) ?? null : null;
}

/** Solo enlaces PDF de clasificación de etapa; guía técnica y participantes quedan fuera. */
export function pdfLinksFromRaceHtml(html) {
  const links = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = clean(match[2]);
    const stageNumber = stageFromLabel(label) ?? stageFromLabel(match[1].replace(/[-_]/g, ' '));
    if (stageNumber == null) continue;
    const href = match[1].startsWith('http') ? match[1] : new URL(match[1], BASE).href;
    links.push({ href, label, stageNumber });
  }
  return [...new Map(links.map((link) => [link.stageNumber, link])).values()].sort((a, b) => a.stageNumber - b.stageNumber);
}

const timeText = (value) => {
  const match = clean(value).match(/^(\d{1,2}):(\d{2}):(\d{2})/);
  return match ? `${Number(match[1])}:${match[2]}:${match[3]}` : null;
};
const gapText = (value) => {
  // Bonificación adjunta a la diferencia: `15:39-06` → `15:39`.
  const text = clean(value).replace(/^a\s+/i, '').replace(/\s*(seg\.?|min\.?).*$/i, '').replace(/-\d{2}\s*$/, '').trim();
  const parts = text.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (parts) return `+${parts[3] ? `${Number(parts[1])}:${parts[2]}:${parts[3]}` : `${Number(parts[1])}:${parts[2]}`}`;
  return /^\d+$/.test(text) ? `+${Number(text)}` : null;
};
const dateKey = (text) => {
  const match = String(text).match(/Fecha\s*:\s*(\d{2})\/(\d{2})\/(\d{2,4})/i);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2]}-${match[1]}`;
};
const declaredCount = (text) => Number(String(text).match(/Corredores clasificados\s*:\s*(\d+)/i)?.[1] || 0) || null;
const countryCode = (nac) => ({ COL: 'co', CRC: 'cr', ECU: 'ec', ESP: 'es', GUA: 'gt', MEX: 'mx', BOL: 'bo', VEN: 've' }[nac] ?? null);

function individualRow(line, general = false) {
  const source = clean(line);
  // Vuelta a Colombia 2026: el cronometraje incluye UCI-ID y nacionalidad entre
  // dorsal y equipo. `mt.` significa mismo tiempo que el ganador del grupo.
  const uciLayout = source.match(/^(\d+)\.?-?\s*(\d+)\s+\d{11}\s+(.+?)\s+(SUB\s?23|ELITE|JUVENIL|PREJUVENIL|MASTER\s?[A-Z0-9]*)\s+([A-Z]{3})\s+(.+?)\s+(mt\.|\d{1,2}:\d{2}:\d{2})(?:\s+(.*))?$/i);
  if (uciLayout) {
    const [, rankText, bib, riderDisplay, , nac, teamName, value, tail = ''] = uciLayout;
    const sameTime = /^mt\.$/i.test(value);
    return {
      rank: Number(rankText), rankText, bib, riderDisplay: clean(riderDisplay), teamName: clean(teamName), isoCode2: countryCode(nac.toUpperCase()),
      resultValue: sameTime ? '+0' : value, timeText: sameTime ? null : timeText(value), gapText: sameTime ? '+0' : gapText(tail), points: null, irm: null,
    };
  }
  const prefix = general
    ? source.match(/^(\d+)\.-\s*(\d+)\s+(.+?)\s+(\d{1,2}:\d{2}:\d{2})(?:-\d+)?(?:\s+(.*))?$/i)
    : source.match(/^(\d+)\s+(\d+)\s+(.+?)\s+(\d{1,2}:\d{2}:\d{2})(?:\s+(.*))?$/i);
  if (!prefix) return null;
  const [, rankText, bib, beforeTime, absolute, tail = ''] = prefix;
  // Las hojas usan siempre la categoría en mayúsculas entre nombre y equipo.
  const category = beforeTime.match(/\s+(SUB\s?23|ELITE|JUVENIL|PREJUVENIL|MASTER\s?[A-Z0-9]*)\s+/i);
  if (!category) return null;
  const splitAt = category.index;
  const riderDisplay = clean(beforeTime.slice(0, splitAt));
  const teamName = clean(beforeTime.slice(splitAt + category[0].length));
  if (!riderDisplay || !teamName) return null;
  return { rank: Number(rankText), rankText, bib, riderDisplay, teamName, isoCode2: null, resultValue: absolute, timeText: timeText(absolute), gapText: general ? gapText(tail) : gapText(tail), points: null, irm: null };
}

// Las CRI omiten la categoría y añaden T.Inter; respetamos las columnas de
// `pdftotext -layout` para separar nombre/equipo y tomamos T.Final, no el paso.
export function cronoIndividualRow(line) {
  const raw = String(line);
  const match = raw.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s{2,}(.+?)\s+(?:(?:\d{2}|__):(?:\d{2}|__):(?:\d{2}|__):(?:\d{3}|___))\s+(\d{2}:\d{2}:\d{2})-\d+(?:\s+(.*))?\s*$/);
  if (!match) return null;
  const [, rankText, bib, riderDisplay, teamName, finalTime, tail = ''] = match;
  return { rank: Number(rankText), rankText, bib, riderDisplay: clean(riderDisplay), teamName: clean(teamName), isoCode2: null, resultValue: finalTime, timeText: timeText(finalTime), gapText: gapText(tail), points: null, irm: null };
}

function pointsRow(line) {
  const source = clean(line);
  const match = source.match(/^(\d+)\s+(\d+)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s+Pts\.?$/i);
  if (!match) return null;
  const [, rankText, bib, beforePoints, pointsText] = match;
  const category = beforePoints.match(/\s+(SUB\s?23|ELITE|JUVENIL|PREJUVENIL|MASTER\s?[A-Z0-9]*)\s+/i);
  if (!category) return null;
  const riderDisplay = clean(beforePoints.slice(0, category.index));
  const teamName = clean(beforePoints.slice(category.index + category[0].length));
  if (!riderDisplay || !teamName) return null;
  const points = Number(pointsText.replace(',', '.'));
  return { rank: Number(rankText), rankText, bib, riderDisplay, teamName, isoCode2: null, resultValue: String(points), timeText: String(points), gapText: null, points, irm: null };
}

// La clasificación colombiana abrevia patrocinadores y provincias por la anchura
// fija del PDF. Estas son las denominaciones completas de la startlist: conservarlas
// aquí permite que el upsert las enlace de forma estable (y que la web no muestre dos
// versiones del mismo equipo).
const colombiaTeamNames = new Map([
  ['ORGULLO PAISA', 'Orgullo Paisa'],
  ['HINO-ONE-LA RED-SUZUKI', 'Hino One La Red Suzuki'],
  ['TEAM MEDELLIN EPM', 'Medellín-EPM'],
  ['TEAM SISTECREDITO', 'Sistecrédito'],
  ['NU COLOMBIA', 'Nu Colombia'],
  ['GW ERCO SPORTFITNESS', 'GW Erco SportFitness'],
  ['7C ECONOMY HYUNDAI', '7C Economy Hyundai'],
  ['EBSA-EMP DE ENERGIA BOYAC', 'EBSA-Empresa de Energía de Boyacá'],
  ['PIO RICO CYCLING TEAM', 'Pío Rico Cycling Team'],
  ['BEST PC ECUADOR', 'Best PC Ecuador'],
  ['BOYACÁ ES PARA VIVIRLA', 'Boyacá es para Vivirla'],
  ['CHIA CIUDAD DE LA LUNA', 'Chía Ciudad de la Luna'],
  ['TEAM FUNRE VIMA MACHINE', 'Team FunRV Vima Machine'],
  ['FTB-CELUCAMBIO', 'FTB-Celucambio'],
  ['GOB PUTUMAYO-B.STRONGMAN', 'Gobernación Putumayo-Bicicletas Strongman'],
  ['AG NECTAR-C.MARCA-S.NATUR', 'AG Néctar-Cundinamarca-Somos Natural'],
  ['CANELS JAVA', "Canel's - Java"],
  ['4WD RENTACAR FACATATIVA', '4WD Rent a Car - Facatativa'],
  ['FUN.TOUR Y NATIVA-B.RANA', 'Fundecom Tour y Nativa'],
  ['FUERZAS ARMADAS', 'Fuerzas Armadas'],
  ['TEAM INDERHUILA', 'Team Inderhuila'],
  ['TOLIMA ES PASION', 'Tolima es Pasión'],
]);
export function normalizeColombiaTeamName(value) {
  const name = clean(value);
  return colombiaTeamNames.get(name.toLocaleUpperCase('es')) ?? name;
}

function teamRow(line) {
  const match = clean(line).match(/^(\d+)\s+(.+?)\s+(\d{1,2}:\d{2}:\d{2})(?:\s+(.*))?$/);
  if (!match) return null;
  const [, rankText, teamName, absolute, tail = ''] = match;
  const normalizedTeamName = normalizeColombiaTeamName(teamName);
  return { rank: Number(rankText), rankText, bib: null, riderDisplay: normalizedTeamName, teamName: normalizedTeamName, resultValue: absolute, timeText: timeText(absolute), gapText: gapText(tail), points: null, irm: null };
}

function sectionAfter(text, headerPattern, endPattern = /\n\s*(?:CLASIFICACI[OÓ]N|PASOS? DE |CORREDORES QUE |PORTADORES |FDO\b)/i) {
  const match = headerPattern.exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const end = rest.search(endPattern);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function parseRows(block, parser) { return String(block || '').split(/\r?\n/).map(parser).filter(Boolean); }
function seconds(value) {
  const match = String(value || '').match(/^(\d+):(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}
function secondsGap(value) {
  if (value == null || value < 0) return null;
  if (value < 60) return `+${value}`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours ? `+${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `+${minutes}:${String(secs).padStart(2, '0')}`;
}
// El render web espera el absoluto solo en la primera fila. En las demás usa el
// diferencial para imprimir +M'SS" y convierte +0 en m.t. para grupos contiguos.
// En estas hojas `mt.` no significa necesariamente mismo tiempo que el ganador:
// hereda el tiempo del primer corredor de su grupo.
function normalizeTimeRows(rows) {
  const winnerSeconds = seconds(rows[0]?.timeText);
  if (winnerSeconds == null) return rows;
  let groupGap = '+0';
  return rows.map((row, index) => {
    if (index === 0 || row.irm) return row;
    if (row.timeText == null && row.gapText === '+0') {
      return { ...row, resultValue: groupGap, gapText: groupGap };
    }
    const derivedGap = seconds(row.timeText) == null ? null : secondsGap(seconds(row.timeText) - winnerSeconds);
    const gap = row.gapText || derivedGap;
    if (!gap) return row;
    groupGap = gap;
    return { ...row, resultValue: gap, timeText: null, gapText: gap };
  });
}
function validateRows(rows, expected, label) {
  if (!rows.length || rows[0].rank !== 1 || rows.some((row, index) => row.rank !== index + 1)) throw new Error(`${label}: rangos incompletos o sin ganador`);
  const bibs = rows.map((row) => row.bib).filter(Boolean);
  if (new Set(bibs).size !== bibs.length) throw new Error(`${label}: dorsales duplicados`);
  if (expected != null && rows.length !== expected) throw new Error(`${label}: ${rows.length} filas extraídas, PDF declara ${expected}`);
  return rows;
}

function classification(code, stageNumber, kind, scope, eventName, rows, isTeamEvent = false) {
  if (!rows.length || rows[0].rank !== 1) return null;
  return { eventId: synthEventId(code, stageNumber, kind, scope), classKind: kind, scope, eventName, isTeamEvent,
    winnerName: rows[0].riderDisplay, rowCount: rows.length, rows };
}

export function parsePdfText(code, stageNumber, text, totalStages = null) {
  // El encabezado de etapa se repite en CADA página. Solo los bloques que ya no
  // son la llegada (equipos, puntos, general, montaña...) la pueden cerrar.
  const stageBlock = sectionAfter(text, /CLASIFICACION\s+(?:[A-ZÁÉÍÓÚ]+\s+)?ETAPA[^\n]*/i,
    /\n\s*(?:CLASIFICACION\s+(?:POR\s+EQUIPOS|POR\s+PUNTOS|GENERAL|.*MONTA[ÑN]A|.*(?:SUB\s?23|JOVENES))|PASOS? DE |CORREDORES QUE |PORTADORES |FDO\b)/i);
  if (!stageBlock) throw new Error(`etapa ${stageNumber}: falta la clasificación principal`);
  // Detectarlo por cada fila, no por el encabezado: algunos PDFs separan
  // `T.Inter` con espacios y otros lo repiten sólo en páginas posteriores.
  const stageParser = (line) => cronoIndividualRow(line) || individualRow(line);
  const stageRows = normalizeTimeRows(validateRows(parseRows(stageBlock, stageParser), declaredCount(stageBlock), `etapa ${stageNumber}`));
  const classifications = [classification(code, stageNumber, 'stage', 'stage', 'Stage Classification', stageRows)];

  const gcBlock = sectionAfter(text, /CLASIFICACION\s+GENERAL(?:\s+DESPUES[^\n]*)?/i,
    /\n\s*(?:CLASIFICACION\s+(?:POR\s+EQUIPOS|POR\s+PUNTOS|.*MONTA[ÑN]A|.*(?:SUB\s?23|JOVENES))|PASOS? DE |CORREDORES QUE |PORTADORES |FDO\b)/i);
  if (gcBlock) {
    const rows = parseRows(gcBlock, (line) => individualRow(line, true));
    if (rows.length) classifications.push(classification(code, stageNumber, 'gc', 'stage', 'General Classification', normalizeTimeRows(validateRows(rows, null, `general etapa ${stageNumber}`))));
  }
  const pointsBlock = sectionAfter(text, /CLASIFICACION\s+POR\s+PUNTOS[^\n]*/i);
  if (pointsBlock) {
    const rows = parseRows(pointsBlock, pointsRow);
    if (rows.length) classifications.push(classification(code, stageNumber, 'points', 'overall', 'Overall Points Classification', validateRows(rows, null, `puntos etapa ${stageNumber}`)));
  }
  const komBlock = sectionAfter(text, /CLASIFICACION\s+(?:GENERAL\s+)?(?:DE\s+)?MONTA[ÑN]A[^\n]*/i);
  if (komBlock) {
    const rows = parseRows(komBlock, pointsRow);
    if (rows.length) classifications.push(classification(code, stageNumber, 'kom', 'overall', 'Overall Mountains Classification', validateRows(rows, null, `montaña etapa ${stageNumber}`)));
  }
  const youthBlock = sectionAfter(text, /CLASIFICACION\s+(?:GENERAL\s+)?(?:SUB\s?23|JOVENES)[^\n]*/i);
  if (youthBlock) {
    const rows = parseRows(youthBlock, (line) => individualRow(line, true));
    if (rows.length) classifications.push(classification(code, stageNumber, 'youth', 'overall', 'Overall Youth Classification', normalizeTimeRows(validateRows(rows, null, `jóvenes etapa ${stageNumber}`))));
  }
  const teamsBlock = sectionAfter(text, /CLASIFICACION\s+POR\s+EQUIPOS[^\n]*/i);
  if (teamsBlock) {
    const rows = parseRows(teamsBlock, teamRow);
    if (rows.length) classifications.push(classification(code, stageNumber, 'teams', 'overall', 'Overall Teams Classification', normalizeTimeRows(validateRows(rows, null, `equipos etapa ${stageNumber}`)), true));
  }
  const stage = { uciRaceId: synthRaceId(code, stageNumber), stageNumber, dateKey: dateKey(text), eventName: `Stage ${stageNumber}`, classifications: classifications.filter(Boolean) };
  const final = totalStages != null && stageNumber === totalStages
    ? { uciRaceId: synthRaceId(code, FINAL_SLOT), stageNumber: null, isFinalClassification: true, eventName: 'Final Classification', classifications: stage.classifications.filter((item) => item.classKind !== 'stage').map((item) => ({ ...item, scope: 'stage', eventId: synthEventId(code, FINAL_SLOT, item.classKind, 'stage') })) }
    : null;
  return { stage, final };
}

export const raceUrl = (code) => `${BASE}/${code}`;
async function fetchText(url) { const response = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } }); if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`); return response.text(); }
async function pdfToLayoutText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const dir = mkdtempSync(join(tmpdir(), 'colombia-pdf-'));
  const file = join(dir, 'result.pdf');
  try { writeFileSync(file, Buffer.from(await response.arrayBuffer())); return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  const code = parseCode(CODE);
  if (has('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(code)}\n`);
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  const links = pdfLinksFromRaceHtml(fixture?.html ?? await fetchText(raceUrl(code)));
  const selected = links.filter((link) => ONLY_STAGE == null || link.stageNumber === ONLY_STAGE);
  const stages = [];
  for (const link of selected) {
    try {
      const text = fixture?.pdfTextByUrl?.[link.href] ?? await pdfToLayoutText(link.href);
      const parsed = parsePdfText(code, link.stageNumber, text, TOTAL_STAGES);
      stages.push(parsed.stage); if (parsed.final) stages.push(parsed.final);
    } catch (error) { log(`  ⚠ ${link.label || `etapa ${link.stageNumber}`}: ${error.message}`); }
  }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'colombia', colombiaCode: code, fetchedAt: new Date().toISOString(), stages };
  mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((error) => { log(`FATAL: ${error.stack || error.message}`); process.exit(1); });
