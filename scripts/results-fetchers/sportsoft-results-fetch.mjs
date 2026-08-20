#!/usr/bin/env node
/** Fetcher de SportSoft Timing. Archivo y live comparten el mismo contrato de salida. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i < 0 ? d : argv[i + 1]; };
const has = (n) => argv.includes(n);
const CODE = arg('--code'), COMPETITION_ID = Number(arg('--competition-id')), OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const FIXTURE = arg('--fixture'), BASE = 'https://vysledky.sportsoft.cz/index.php', LIVE_BASE = 'https://live.sportsoft.cz';
const log = (m) => process.stderr.write(`${m}\n`);

export function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export const suggestCompetitionId = (code) => -(fnv1a(`sportsoft:${code}`) % 200000);
export const synthRaceId = (code, stage) => -(Math.abs(suggestCompetitionId(code)) * 100 + stage);
const CLASS_IDX = { 'stage/stage': 0, 'gc/stage': 1, 'points/overall': 2, 'kom/overall': 3, 'youth/overall': 4, 'teams/overall': 5 };
const eventId = (code, stage, kind, scope) => -((-suggestCompetitionId(code)) * 10000 + stage * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 99));
const FINAL_SLOT = 9999;

export const clean = (v) => String(v ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'")
  .replace(/\s+/g, ' ').trim();
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1] || null;
const integer = (v) => /^\d+$/.test(clean(v)) ? Number(clean(v)) : null;
// SportSoft usa 1000 como puesto técnico para corredores sin clasificación.
// No es un puesto válido en ninguna clasificación de la carrera.
const officialRank = (v) => {
  const rank = integer(v);
  return rank != null && rank > 0 && rank < 1000 ? rank : null;
};
const time = (v) => { const m = clean(v).match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/); return m ? `${Number(m[1])}:${m[2]}:${m[3]}` : null; };
const gap = (v) => { const t = clean(v).replace(/^0+(?=\d)/, '').replace(/\.0$/, ''); return /^\+\d+(?::\d{2}){0,2}$/.test(t) ? t : null; };
const irm = (...v) => { const t = v.map(clean).join(' ').toUpperCase(); return /\bDNS\b/.test(t) ? 'DNS' : /\bDSQ\b|\bDQ\b/.test(t) ? 'DSQ' : /\bOTL\b/.test(t) ? 'OTL' : /\bDNF\b/.test(t) ? 'DNF' : null; };

export function officialPdfLinksFromHtml(html) {
  const official = String(html).match(/<h5\b[^>]*>\s*Official Results\s*<\/h5>([\s\S]*?)(?=<h5\b|<div\s+class=["']race-selection|$)/i)?.[1] || '';
  const links = [];
  for (const match of official.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = clean(match[2]);
    const stage = label.match(/^stage\s+(\d+)$/i);
    if (stage) links.push({ stageNumber: Number(stage[1]), kind: 'stage', href: match[1] });
    else {
      const after = label.match(/^after\s+stage\s+(\d+)$/i);
      if (after) links.push({ stageNumber: Number(after[1]), kind: 'after-stage', href: match[1] });
    }
  }
  return links;
}

function pdfGap(value) {
  const m = clean(value).match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return gapFromTenths(seconds * 10);
}

// El listado de etapa de SportSoft deja vacías las columnas Time/Gap de cada
// corredor a mismo tiempo. Se conserva el último corte para representar cada
// grupo de llegada y se valida la secuencia íntegra de puestos antes de usarlo.
export function officialStageRowsFromPdfText(text) {
  let active = false, pendingRank = null, current = null;
  const rows = [];
  const flush = () => { if (current) rows.push(current); current = null; };
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = clean(rawLine);
    if (/OFFICIAL RESULTS LIST/i.test(line)) active = true;
    if (!active) continue;
    if (/POINTS CLASSIFICATION|MOUNTAINS CLASSIFICATION|U23 riders standing|STAGE TEAMS|Race configuration/i.test(line)) { flush(); active = false; continue; }
    const direct = line.match(/^(\d{1,3})\.\s+(\d{1,3})\s+/);
    const rankOnly = line.match(/^(\d{1,3})\.\s+\d{11}\b/);
    const continuation = pendingRank != null ? line.match(/^(\d{1,3})\s+\p{L}/u) : null;
    if (direct) {
      flush();
      current = { rank: Number(direct[1]), bib: String(direct[2]) };
      pendingRank = null;
    } else if (continuation) {
      current = { rank: pendingRank, bib: String(continuation[1]) };
      pendingRank = null;
    } else if (rankOnly) {
      flush();
      pendingRank = Number(rankOnly[1]);
      continue;
    }
    if (!current) continue;
    const values = line.match(/(\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s|$)/);
    if (values) { current.timeText = time(values[1]); current.gapText = pdfGap(values[2]); }
  }
  flush();
  if (!rows.length || rows[0].rank !== 1 || rows.some((row, index) => row.rank !== index + 1 || !row.bib)) throw new Error('PDF SportSoft: puestos o dorsales incompletos en la clasificación de etapa');
  return rows;
}

export function classificationFromOfficialStagePdf(code, stageNumber, pdfText, sourceRows) {
  const sourceByBib = new Map(sourceRows.map((row) => [clean(row.RaceNo), row]));
  let groupGap = '+0';
  const rows = officialStageRowsFromPdfText(pdfText).map((official) => {
    const source = sourceByBib.get(official.bib);
    if (!source) throw new Error(`PDF SportSoft: dorsal ${official.bib} ausente de la fuente live`);
    if (official.rank === 1 && !official.timeText) throw new Error('PDF SportSoft: el ganador no tiene tiempo oficial');
    if (official.gapText) groupGap = official.gapText;
    const sameOrGap = official.rank === 1 ? null : groupGap;
    return {
      rank: official.rank, rankText: String(official.rank), bib: official.bib,
      riderDisplay: clean(source.Name) || null, teamName: clean(source.Club) || null,
      resultValue: official.rank === 1 ? official.timeText : sameOrGap,
      timeText: official.rank === 1 ? official.timeText : null,
      gapText: sameOrGap, points: /^-?\d+(?:[.,]\d+)?$/.test(clean(source.SprintPoints)) ? Number(String(source.SprintPoints).replace(',', '.')) : null,
      irm: null,
    };
  });
  return { eventId: eventId(code, stageNumber, 'stage', 'stage'), classKind: 'stage', scope: 'stage', eventName: 'Stage Classification',
    isTeamEvent: false, winnerName: rows[0]?.riderDisplay || null, rowCount: rows.length, rows };
}

export function afterStagePages(text, heading) {
  const pages = String(text).split('\f');
  const start = pages.findIndex((page) => heading.test(page));
  if (start < 0) return [];
  const stop = /\b(?:POINTS|MOUNTAIN|U23|CZECH|GENERAL TEAMS)\b[\s\S]{0,80}\bAFTER Stage\b/i;
  const out = [];
  for (let i = start; i < pages.length && (i === start || !stop.test(pages[i])); i++) out.push(pages[i]);
  return out;
}
export function afterIndividualRows(pages, metric) {
  let pendingRank = null, current = null;
  const rows = [];
  const flush = () => { if (current) rows.push(current); current = null; };
  for (const page of pages) for (const rawLine of page.split(/\r?\n/)) {
    const line = clean(rawLine);
    const direct = line.match(/^(?:(\d{1,3})\.\s*(\d{1,3})|(\d{1,3})\s+(\d{1,3}))\s+\p{L}/u);
    const rankOnly = line.match(/^(\d{1,3})\.\s+\d{11}\b/);
    const continuation = pendingRank != null ? line.match(/^(\d{1,3})\s+\p{L}/u) : null;
    if (direct) { flush(); current = { rank: Number(direct[1] || direct[3]), bib: String(direct[2] || direct[4]) }; pendingRank = null; }
    else if (continuation) { current = { rank: pendingRank, bib: String(continuation[1]) }; pendingRank = null; }
    else if (rankOnly) { flush(); pendingRank = Number(rankOnly[1]); continue; }
    if (!current) continue;
    if (metric === 'time') {
      const values = line.match(/(\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s|$)/);
      if (values) { current.timeText = time(values[1]); current.gapText = pdfGap(values[2]); }
    } else {
      const value = line.match(/\s(\d+)\s*$/);
      if (value) current.points = Number(value[1]);
    }
  }
  flush();
  const invalid = rows.find((row, index) => row.rank !== index + 1 || !row.bib || (metric === 'time' ? !row.timeText || !row.gapText : row.points == null));
  if (!rows.length || rows[0].rank !== 1 || invalid) throw new Error(`PDF SportSoft: clasificación ${metric} incompleta${invalid ? ` en puesto ${invalid.rank} (${JSON.stringify(invalid)})` : ''}`);
  return rows;
}
function classificationFromAfterPdfRows(code, stageNumber, kind, sourceByBib, pdfRows) {
  const timeBased = kind === 'gc' || kind === 'youth';
  const rows = pdfRows.map((official) => {
    const source = sourceByBib.get(official.bib);
    if (!source) throw new Error(`PDF SportSoft: dorsal ${official.bib} ausente de la fuente live`);
    const first = official.rank === 1;
    return { rank: official.rank, rankText: String(official.rank), bib: official.bib, riderDisplay: clean(source.Name) || null, teamName: clean(source.Club) || null,
      resultValue: timeBased ? (first ? official.timeText : official.gapText) : String(official.points),
      timeText: timeBased ? (first ? official.timeText : null) : String(official.points),
      gapText: timeBased ? (first ? null : official.gapText) : null,
      points: timeBased ? null : official.points, irm: null };
  });
  const spec = { gc: ['stage', 'Stage General Classification'], points: ['overall', 'Overall Points Classification'], kom: ['overall', 'Overall Mountains Classification'], youth: ['overall', 'Overall Youth Classification'] }[kind];
  return { eventId: eventId(code, stageNumber, kind, spec[0]), classKind: kind, scope: spec[0], eventName: spec[1], isTeamEvent: false, winnerName: rows[0]?.riderDisplay || null, rowCount: rows.length, rows };
}
function teamsFromAfterStagePdf(code, stageNumber, text) {
  const page = afterStagePages(text, /GENERAL TEAMS[\s\S]{0,80}AFTER Stage/i).join('\n');
  const rows = [];
  for (const rawLine of page.split(/\r?\n/)) {
    const match = clean(rawLine).match(/^(\d{1,3})\.\s+(.+?)\s+(\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
    if (!match) continue;
    const rank = Number(match[1]), teamName = match[2], absolute = time(match[3]), groupGap = pdfGap(match[4]);
    rows.push({ rank, rankText: String(rank), bib: null, riderDisplay: teamName, teamName, resultValue: rank === 1 ? absolute : groupGap, timeText: rank === 1 ? absolute : null, gapText: rank === 1 ? null : groupGap, points: null, irm: null });
  }
  if (!rows.length || rows[0].rank !== 1 || rows.some((row, index) => row.rank !== index + 1)) throw new Error('PDF SportSoft: clasificación por equipos incompleta');
  return { eventId: eventId(code, stageNumber, 'teams', 'overall'), classKind: 'teams', scope: 'overall', eventName: 'Overall Team Classification', isTeamEvent: true, winnerName: rows[0]?.teamName || null, rowCount: rows.length, rows };
}
export function classificationsFromOfficialAfterStagePdf(code, stageNumber, pdfText, sourceRows) {
  const sourceByBib = new Map(sourceRows.map((row) => [clean(row.RaceNo), row]));
  return [
    classificationFromAfterPdfRows(code, stageNumber, 'gc', sourceByBib, afterIndividualRows(afterStagePages(pdfText, /GENERAL[\s\S]{0,80}AFTER Stage/i), 'time')),
    classificationFromAfterPdfRows(code, stageNumber, 'points', sourceByBib, afterIndividualRows(afterStagePages(pdfText, /POINTS[\s\S]{0,80}AFTER Stage/i), 'points')),
    classificationFromAfterPdfRows(code, stageNumber, 'kom', sourceByBib, afterIndividualRows(afterStagePages(pdfText, /MOUNTAIN[\s\S]{0,80}AFTER Stage/i), 'points')),
    classificationFromAfterPdfRows(code, stageNumber, 'youth', sourceByBib, afterIndividualRows(afterStagePages(pdfText, /U23[\s\S]{0,80}AFTER Stage/i), 'time')),
    teamsFromAfterStagePdf(code, stageNumber, pdfText),
  ];
}

/** Descubrimiento por etiqueta: ni el orden ni los competitionId son estables entre ediciones. */
export function competitionsFromRaceHtml(html) {
  const out = [];
  for (const m of String(html).matchAll(/<a\b([^>]*\bhref=["'][^"']*\/race\/(\d+)\/competition\/(\d+)[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    const label = clean(m[4]).replace(/\s+\d{2}\.\d{2}\.\d{4}$/, '');
    const stage = label.match(/^stage\s+(\d+)$/i);
    if (stage) out.push({ raceCode: m[2], competitionCode: m[3], stageNumber: Number(stage[1]), label });
    else if (/^prologue$/i.test(label)) out.push({ raceCode: m[2], competitionCode: m[3], stageNumber: 0, label: 'Prologue' });
    else if (/^general classification$/i.test(label)) out.push({ raceCode: m[2], competitionCode: m[3], stageNumber: null, label: 'GENERAL CLASSIFICATION' });
  }
  return [...new Map(out.map((x) => [`${x.competitionCode}:${x.stageNumber ?? 'gc'}`, x])).values()];
}

/** Mapea las celdas mediante los data-name de SportSoft, no mediante su posición visual. */
export function rowsFromCompetitionHtml(html) {
  const table = String(html).match(/<table\b[^>]*\bid=["']results-table["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] || '';
  const headers = [...table.matchAll(/<th\b([^>]*)>[\s\S]*?<\/th>/gi)].map((m) => attr(m[1], 'data-name'));
  const rows = [];
  for (const m of table.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    if (!attr(m[1], 'id')) continue;
    const cells = [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => clean(cell[1]));
    if (cells.length) rows.push(Object.fromEntries(headers.map((head, i) => [head, cells[i] ?? ''])));
  }
  return rows;
}

function result(row, rankKey, pointsKey = null, withTime = false) {
  const rankText = clean(row[rankKey]), code = irm(rankText, row.Time, row.Ovl_Behind), rank = officialRank(rankText);
  if (!rank && !code) return null;
  const value = pointsKey ? clean(row[pointsKey]) : clean(row.Time);
  return { rank: rank || null, rankText: rank ? String(rank) : code, bib: clean(row.RaceNo) || null, riderDisplay: clean(row.Name) || null,
    teamName: clean(row.Club) || null, resultValue: value || clean(row.Ovl_Behind) || null, timeText: withTime && !pointsKey ? time(row.Time) : null,
    gapText: withTime && !pointsKey ? gap(row.Ovl_Behind) : null, points: pointsKey && /^-?\d+(?:[.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : null, irm: code };
}
export function classificationFromPage(code, stageNumber, pageRows, spec) {
  const rows = pageRows.map((row) => result(row, spec.rankKey, spec.pointsKey, spec.withTime)).filter(Boolean)
    .filter((row) => row.rank != null || (spec.classKind === 'stage' && row.irm))
    .filter((row) => spec.classKind === 'stage' || !row.irm)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  return { eventId: eventId(code, stageNumber, spec.classKind, spec.scope), classKind: spec.classKind, scope: spec.scope, eventName: spec.eventName,
    isTeamEvent: false, winnerName: rows.find((r) => r.rank === 1)?.riderDisplay || null, rowCount: rows.length, rows };
}
const STAGE = { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification', rankKey: 'Ovl_Pos', withTime: true };
const GC = { classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification', rankKey: 'Ovl_Pos', withTime: true };
const SECONDARY = [
  { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification', rankKey: 'Sprint_Pos', pointsKey: 'Sprint_Points', livePointsKey: 'SprintPoints' },
  { classKind: 'kom', scope: 'overall', eventName: 'Overall Mountains Classification', rankKey: 'KOM_Pos', pointsKey: 'KOM_Points', livePointsKey: 'KOMPoints' },
  { classKind: 'youth', scope: 'overall', eventName: 'Overall Youth Classification', rankKey: 'SecCat_Pos', withTime: true },
];
export const raceUrl = (code) => `${BASE}/race/${code}`;
export const competitionUrl = (code, competition) => `${BASE}/race/${code}/competition/${competition}`;
async function fetchText(url) { const r = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } }); if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`); return r.text(); }
async function fetchJson(url) { const r = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } }); if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`); return r.json(); }
async function pdfToLayoutText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const dir = mkdtempSync(join(tmpdir(), 'sportsoft-pdf-')), file = join(dir, 'official-results.pdf');
  try {
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const liveRaceUrl = (code) => `${LIVE_BASE}/race/${code}`;
const liveCompetitionPageUrl = (code, competition) => `${LIVE_BASE}/race/${code}/competition/${competition}`;
const liveCompetitionUrl = (competition) => `${LIVE_BASE}/ajax/live/competition/${competition}/desktop`;

// SportSoft Live expone el paso de meta con décimas. La etapa se construye solo
// con esa lectura, agrupando corredores consecutivos separados por menos de 1 s.
// La general incorpora bonificaciones y no puede modificar tiempos ni cortes de
// etapa, tampoco en la primera jornada.
function tenths(value) {
  const m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d))?$/.exec(clean(value));
  return m ? ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 10 + Number(m[4] || 0)) : null;
}
function gapFromTenths(value) {
  const seconds = Math.round(value / 10);
  if (seconds < 60) return `+${seconds}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours
    ? `+${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `+${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}
function liveRow(row, { previousTenths, groupTenths, winnerTenths }) {
  // El endpoint automático mezcla clasificados en meta con corredores todavía
  // situados en el último punto intermedio. Sus puestos parciales vuelven a
  // empezar por 1 y, si se ingieren, duplican rangos de la clasificación final.
  // STD/RUN son estados activos; DNF/DNS/DSQ sí deben conservarse como IRM.
  if (/^(?:STD|RUN)$/i.test(clean(row.FinishStatus))) return null;
  const rank = officialRank(row.Ovl_Pos), code = irm(row.FinishStatus, row.Time, row.Ovl_Behind);
  if (!rank && !code) return null;
  const bib = clean(row.RaceNo) || null;
  const rawTenths = tenths(row.Time);
  const nextGroupTenths = rawTenths != null && previousTenths != null && rawTenths - previousTenths < 10
    ? groupTenths : rawTenths;
  const nextWinnerTenths = winnerTenths ?? nextGroupTenths;
  let timeText = null, gapText = null;
  if (rank === 1) {
    timeText = time(row.Time) || null;
  } else if (rawTenths != null && nextWinnerTenths != null && nextGroupTenths != null) {
    const gapTenths = nextGroupTenths - nextWinnerTenths;
    // El render identifica el grupo de cabeza por '+0' y lo presenta como m.t.
    // Los miembros de cualquier grupo posterior heredan el corte de su cabeza.
    gapText = gapTenths >= 10 ? gapFromTenths(gapTenths) : '+0';
  }
  return {
    row: { rank: rank || null, rankText: rank ? String(rank) : code, bib, riderDisplay: clean(row.Name) || null,
      teamName: clean(row.Club) || null, resultValue: rank === 1 ? (clean(row.Time) || clean(row.Ovl_Behind) || null) : (gapText || clean(row.Time) || clean(row.Ovl_Behind) || null),
      timeText, gapText, points: /^-?\d+(?:[.,]\d+)?$/.test(clean(row.SprintPoints)) ? Number(String(row.SprintPoints).replace(',', '.')) : null, irm: code },
    previousTenths: rawTenths ?? previousTenths, groupTenths: nextGroupTenths, winnerTenths: nextWinnerTenths,
  };
}
export function classificationFromLive(code, stageNumber, liveRows) {
  let previousTenths = null, groupTenths = null, winnerTenths = null;
  const rows = [];
  for (const source of liveRows) {
    const normalized = liveRow(source, { previousTenths, groupTenths, winnerTenths });
    if (!normalized) continue;
    rows.push(normalized.row);
    ({ previousTenths, groupTenths, winnerTenths } = normalized);
  }
  return { eventId: eventId(code, stageNumber, 'stage', 'stage'), classKind: 'stage', scope: 'stage', eventName: 'Stage Classification',
    isTeamEvent: false, winnerName: rows.find((r) => r.rank === 1)?.riderDisplay || null, rowCount: rows.length, rows };
}

// Live no expone Sprint_Pos/KOM_Pos: solo los puntos acumulados en la tabla de
// la general. Se ordenan por puntos y se usa la posición general como desempate
// disponible. El PDF oficial posterior, cuando existe, conserva prioridad.
export function classificationFromLivePoints(code, stageNumber, liveRows, spec) {
  const rows = liveRows.map((source, sourceIndex) => {
    if (/^(?:STD|RUN)$/i.test(clean(source.FinishStatus)) || irm(source.FinishStatus, source.Time, source.Ovl_Behind)) return null;
    const rawPoints = clean(source[spec.livePointsKey]);
    if (!/^\d+(?:[.,]\d+)?$/.test(rawPoints)) return null;
    const points = Number(rawPoints.replace(',', '.'));
    if (!(points > 0)) return null;
    return { source, sourceIndex, points, gcRank: integer(source.Ovl_Pos) ?? Number.MAX_SAFE_INTEGER };
  }).filter(Boolean).sort((a, b) => b.points - a.points || a.gcRank - b.gcRank || a.sourceIndex - b.sourceIndex)
    .map(({ source, points }, index) => {
      const rank = index + 1;
      return { rank, rankText: String(rank), bib: clean(source.RaceNo) || null, riderDisplay: clean(source.Name) || null,
        teamName: clean(source.Club) || null, resultValue: String(points), timeText: null, gapText: null, points, irm: null };
    });
  return { eventId: eventId(code, stageNumber, spec.classKind, 'overall'), classKind: spec.classKind, scope: 'overall', eventName: spec.eventName,
    isTeamEvent: false, winnerName: rows[0]?.riderDisplay || null, rowCount: rows.length, rows };
}

async function main() {
  if (!/^\d+$/.test(CODE || '')) throw new Error('Uso: --code <raceId numérico> --competition-id <id>');
  if (has('--suggest-id')) return void process.stdout.write(`${suggestCompetitionId(CODE)}\n`);
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  let live = false, raceHtml;
  if (fixture?.race) raceHtml = fixture.race;
  else {
    try {
      raceHtml = await fetchText(raceUrl(CODE));
      // El host histórico redirige la carrera en curso a la interfaz Live,
      // pero conserva su propio dominio en los enlaces HTML.
      live = /\/ajax\/live\/competition\//.test(raceHtml);
    }
    catch (archiveError) { raceHtml = await fetchText(liveRaceUrl(CODE)); live = true; }
  }
  let competitions = competitionsFromRaceHtml(raceHtml);
  // Durante la carrera el archivo puede responder 200 con una portada vacía;
  // en ese estado la fuente válida es Live, no un resultado vacío del fetcher.
  if (!live && !competitions.some((x) => x.stageNumber != null)) {
    raceHtml = await fetchText(liveRaceUrl(CODE));
    competitions = competitionsFromRaceHtml(raceHtml);
    live = true;
  }
  const gc = competitions.find((x) => x.stageNumber == null), selected = competitions.filter((x) => x.stageNumber != null && (ONLY_STAGE == null || x.stageNumber === ONLY_STAGE));
  if (!gc) throw new Error('SportSoft no expone GENERAL CLASSIFICATION en la portada de carrera');
  // El archivo y Live comparten las clasificaciones, pero los PDFs se conservan
  // únicamente en Live después de que el archivo vuelve a ser navegable.
  let officialPdfs = officialPdfLinksFromHtml(raceHtml);
  if (!officialPdfs.length && !fixture) {
    try { officialPdfs = officialPdfLinksFromHtml(await fetchText(liveRaceUrl(CODE))); }
    catch (error) { log(`  ⚠ PDFs oficiales SportSoft no disponibles (${error.message})`); }
  }
  // La portada hoy abre la general, pero pedimos explícitamente su competitionId:
  // el selector por defecto es un detalle de interfaz, no parte del contrato.
  const gcPayload = live ? await fetchJson(liveCompetitionUrl(gc.competitionCode)) : null;
  const gcHtml = live ? null : (fixture?.competitions?.[gc.competitionCode] ?? await fetchText(competitionUrl(CODE, gc.competitionCode)));
  const gcRows = live ? (gcPayload?.r || []) : rowsFromCompetitionHtml(gcHtml), stages = [];
  for (const item of selected) {
    const payload = live ? await fetchJson(liveCompetitionUrl(item.competitionCode)) : null;
    const html = live ? null : (fixture?.competitions?.[item.competitionCode] ?? await fetchText(competitionUrl(CODE, item.competitionCode)));
    const sourceRows = live ? (payload?.r || []) : rowsFromCompetitionHtml(html);
    const classifications = [];
    let stage = live
      ? classificationFromLive(CODE, item.stageNumber, payload?.r || [])
      : classificationFromPage(CODE, item.stageNumber, sourceRows, STAGE);
    let stageDocuments = officialPdfs;
    let stagePdf = stageDocuments.find((pdf) => pdf.kind === 'stage' && pdf.stageNumber === item.stageNumber);
    if (!stagePdf && !fixture) {
      try {
        stageDocuments = officialPdfLinksFromHtml(await fetchText(liveCompetitionPageUrl(CODE, item.competitionCode)));
        stagePdf = stageDocuments.find((pdf) => pdf.kind === 'stage' && pdf.stageNumber === item.stageNumber);
      } catch (error) { log(`  ⚠ etapa ${item.stageNumber}: no se pudo consultar el índice PDF (${error.message})`); }
    }
    if (stagePdf) {
      try {
        const text = fixture?.pdfTextByUrl?.[stagePdf.href] ?? await pdfToLayoutText(stagePdf.href);
        stage = classificationFromOfficialStagePdf(CODE, item.stageNumber, text, sourceRows);
        log(`  ✓ etapa ${item.stageNumber}: PDF oficial SportSoft (${stage.rows.length} filas)`);
      } catch (error) { log(`  ⚠ etapa ${item.stageNumber}: PDF oficial ignorado (${error.message})`); }
    }
    if (stage.rows.some((r) => r.rank === 1)) classifications.push(stage);
    const afterPdf = stageDocuments.find((pdf) => pdf.kind === 'after-stage' && pdf.stageNumber === item.stageNumber);
    if (afterPdf) {
      try {
        const text = fixture?.pdfTextByUrl?.[afterPdf.href] ?? await pdfToLayoutText(afterPdf.href);
        const official = classificationsFromOfficialAfterStagePdf(CODE, item.stageNumber, text, [...sourceRows, ...gcRows]);
        classifications.push(...official);
        log(`  ✓ acumuladas tras etapa ${item.stageNumber}: PDF oficial SportSoft (${official.map((c) => `${c.classKind}:${c.rows.length}`).join(', ')})`);
      } catch (error) { log(`  ⚠ acumuladas tras etapa ${item.stageNumber}: PDF oficial ignorado (${error.message})`); }
    }
    for (const spec of [GC, ...SECONDARY]) {
      if (classifications.some((c) => c.classKind === spec.classKind)) continue;
      const c = live && spec.livePointsKey
        ? classificationFromLivePoints(CODE, item.stageNumber, gcRows, spec)
        : classificationFromPage(CODE, item.stageNumber, gcRows, spec);
      if (c.rows.some((r) => r.rank === 1)) classifications.push(c);
    }
    if (classifications.length) stages.push({ uciRaceId: synthRaceId(CODE, item.stageNumber), stageNumber: item.stageNumber, eventName: `Stage ${item.stageNumber}`, classifications });
  }
  if (TOTAL_STAGES != null && selected.some((x) => x.stageNumber === TOTAL_STAGES)) { const last = stages.find((x) => x.stageNumber === TOTAL_STAGES); if (last) stages.push({ uciRaceId: synthRaceId(CODE, FINAL_SLOT), stageNumber: null, isFinalClassification: true, eventName: 'Final Classification', classifications: last.classifications.filter((x) => x.classKind !== 'stage').map((x) => ({ ...x, scope: 'stage', eventId: eventId(CODE, FINAL_SLOT, x.classKind, 'stage') })) }); }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'sportsoft', sportsoftCode: CODE, stages };
  mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2)); if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
