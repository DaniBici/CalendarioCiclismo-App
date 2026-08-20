#!/usr/bin/env node
// chronorace-results-fetch.mjs — parsea un dossier de resultados ChronoRace (PDF)
// y emite el MISMO JSON intermedio que uci-results-fetch.mjs / tissot-results-fetch.mjs
// para que lo cargue uci-results-upsert.mjs (skill cc-resultados-pdf, escenario A).
//
// Estrategia híbrida (la marca de agua "PROVISOIRE" intercala caracteres sueltos):
//   - clasificaciones de 1 columna (etapa, puntos) → pdftotext -layout (línea completa)
//   - clasificaciones de 2 columnas (gc, jóvenes, equipos) → pdftotext -bbox (separar por x)
//
// Uso automático:
//   node chronorace-results-fetch.mjs --event-id <eventId> --race-id <id> \
//        --competition-id <id> --stage <N> --out <dir> [--include-final]
// Uso local:
//   node chronorace-results-fetch.mjs --pdf dossier.pdf --race-id <id> \
//        --stage <N> --date <YYYY-MM-DD> [--race-type IRR] [--final] > out.json
//
// NO commitear al repo salvo que se pida.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
let PDF = arg('--pdf');
const EVENT_ID = arg('--event-id');
const LINK_COMPETITION_ID = arg('--competition-id');
const RACE_ID = arg('--race-id');
const STAGE = arg('--stage') != null ? parseInt(arg('--stage'), 10) : null;
let DATE = arg('--date');
const RACE_TYPE = arg('--race-type', 'IRR');
const IS_FINAL = args.includes('--final');
const INCLUDE_FINAL = args.includes('--include-final');
const OUT = arg('--out');
const SUGGEST = args.includes('--suggest-id');
const STARTLIST = arg('--startlist'); // JSON { "<minDorsal>": "<teamName canónico>" } para nombres de equipo no truncados
if ((!PDF && !EVENT_ID) || !RACE_ID || STAGE == null) { console.error('Faltan args: --pdf o --event-id --race-id --stage'); process.exit(1); }
const TEAM_BY_DORSAL = STARTLIST ? JSON.parse(fs.readFileSync(STARTLIST, 'utf8')) : null;

let downloadDir = null;
if (!PDF) {
  const listingUrl = `https://prod.chronorace.be/classements/listerapports.aspx?eventId=${encodeURIComponent(EVENT_ID)}`;
  const response = await fetch(listingUrl, { headers: { 'user-agent': 'calendariociclismo.app results sync' } });
  if (!response.ok) throw new Error(`ChronoRace listing HTTP ${response.status}`);
  const html = await response.text();
  const reports = [...html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ url: new URL(m[1], listingUrl).href, label: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .map((r) => ({ ...r, stage: /^E(\d+)$/i.test(r.label) ? Number(r.label.slice(1)) : null }))
    .filter((r) => r.stage != null);
  const report = reports.find((r) => r.stage === STAGE);
  if (!report) {
    const empty = { competitionId: LINK_COMPETITION_ID != null ? Number(LINK_COMPETITION_ID) : 0, disciplineId: 10, source: 'pdf', stages: [] };
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${empty.competitionId}.json`), JSON.stringify(empty, null, 2)); }
    process.exit(0);
  }
  downloadDir = mkdtempSync(join('/tmp', 'chronorace-'));
  const pdfResponse = await fetch(report.url, { headers: { 'user-agent': 'calendariociclismo.app results sync' } });
  if (!pdfResponse.ok) throw new Error(`ChronoRace PDF HTTP ${pdfResponse.status}: ${report.url}`);
  PDF = join(downloadDir, `E${STAGE}.pdf`);
  writeFileSync(PDF, Buffer.from(await pdfResponse.arrayBuffer()));
}

// ---------- IDs sintéticos (FNV-1a 32-bit, salt pdf:) ----------
function fnv1a(s) { let h = 0x811c9dc5; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h; }
const ID_BASE = fnv1a(`pdf:${RACE_ID}`) % 200000;
const CLASS_IDX = { 'stage|stage': 1, 'gc|stage': 2, 'points|overall': 3, 'kom|overall': 4, 'youth|overall': 5, 'teams|overall': 6 };
const slotOf = () => (IS_FINAL ? 99 : STAGE);
const synthEventId = (kind, scope, slot = slotOf()) => -((ID_BASE * 10000 + slot * 100 + CLASS_IDX[`${kind}|${scope}`]) & 0x7fffffff);
const synthRaceId = (slot = slotOf()) => -((ID_BASE * 10000 + slot * 100) & 0x7fffffff);
const COMPETITION_ID = LINK_COMPETITION_ID != null ? Number(LINK_COMPETITION_ID) : -(ID_BASE & 0x7fffffff);
if (SUGGEST) console.error(`ID_BASE=${ID_BASE} competitionId=${COMPETITION_ID} uciRaceId=${synthRaceId()}`);

// ---------- helpers texto ----------
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const cleanName = (s) => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
function normTime(s) {
  if (!s) return null; s = s.trim();
  let m = s.match(/^(\d+):(\d{2}):(\d{2})$/); if (m) return `${+m[1]}:${m[2]}:${m[3]}`;
  m = s.match(/^(\d+)h(\d{2})'(\d{2})/); if (m) return `${+m[1]}:${m[2]}:${m[3]}`;
  m = s.match(/^(\d+)'(\d{2})''?$/); if (m) return `0:${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}
const timeToSec = (t) => { const m = t && t.match(/^(\d+):(\d{2}):(\d{2})$/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };
function secToGap(sec) {
  if (sec == null) return null;
  if (sec <= 0) return '+00';
  const h = Math.floor(sec / 3600), mn = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `+${h}:${String(mn).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (mn) return `+${mn}:${String(s).padStart(2, '0')}`;
  return `+${String(s).padStart(2, '0')}`; // <1 min: segundos a 2 dígitos (+27, +00)
}
const ISO = { BEL: 'be', NED: 'nl', FRA: 'fr', GER: 'de', ITA: 'it', ESP: 'es', POR: 'pt', GBR: 'gb', DEN: 'dk', NOR: 'no', SWE: 'se', SUI: 'ch', POL: 'pl', LAT: 'lv', LTU: 'lt', SVK: 'sk', CZE: 'cz', AUT: 'at', USA: 'us', CAN: 'ca', NZL: 'nz', ERI: 'er', LUX: 'lu', IRL: 'ie', RUS: 'ru', AUS: 'au', CYP: 'cy', COL: 'co' };

// ---------- pdftotext wrappers ----------
function layout(from, to) { return execFileSync('pdftotext', ['-layout', '-f', String(from), '-l', String(to), PDF, '-'], { encoding: 'utf8' }); }
function bboxPages() {
  const html = execFileSync('pdftotext', ['-bbox', PDF, '-'], { encoding: 'utf8' });
  return html.split('<page').slice(1).map((blk) => {
    const ws = []; const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g; let m;
    while ((m = re.exec(blk))) ws.push({ x: +m[1], y: +m[2], t: decode(m[5]) });
    return ws;
  });
}
function rowsOf(words, ytol = 2.2) {
  const rows = [];
  for (const w of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let r = rows.find((r) => Math.abs(r.y - w.y) <= ytol);
    if (!r) { r = { y: w.y, words: [] }; rows.push(r); }
    r.words.push(w);
  }
  rows.forEach((r) => r.words.sort((a, b) => a.x - b.x));
  return rows.sort((a, b) => a.y - b.y);
}
const PAGES = bboxPages();
if (!DATE) {
  const m = layout(1, 1).match(/\b(\d{2})[\/-](\d{2})[\/-](20\d{2})\b/);
  if (m) DATE = `${m[3]}-${m[2]}-${m[1]}`;
}
if (!DATE) throw new Error('No se pudo determinar --date desde el PDF');
const pageText = (i) => PAGES[i].map((w) => w.t).join(' ');
const findPages = (re) => PAGES.map((_, i) => i).filter((i) => re.test(pageText(i)));

// ---------- ETAPA (1 col, -layout) ----------
function parseStage(p0, p1) {
  const text = layout(p0 + 1, p1 + 1); // -layout es 1-indexado por página física
  const reRow = /^\s*(\d+)\.\s+(\d+)\s+(\d{9,11})\s+(.+?)\s+([A-Z]{3})\s+(.+?)\s+(\d+:\d{2}:\d{2})/;
  const reIrm = /^\s*(DNF|DNS|OTL|DSQ)\s+(\d+)\s+(\d{9,11})\s+(.+?)\s+([A-Z]{3})\s/;
  const rows = [], irm = [];
  for (const l of text.split('\n')) {
    let m = l.match(reRow);
    if (m) { rows.push({ rank: +m[1], bib: +m[2], name: cleanName(m[4]), time: normTime(m[7]) }); continue; }
    m = l.match(reIrm);
    if (m) irm.push({ bib: +m[2], name: cleanName(m[4]), irm: m[1] });
  }
  rows.sort((a, b) => a.rank - b.rank);
  const w0 = timeToSec(rows[0].time);
  const out = rows.map((r) => r.rank === 1
    ? { rank: 1, rankText: '1', bib: String(r.bib), riderDisplay: r.name, timeText: r.time }
    : { rank: r.rank, rankText: String(r.rank), bib: String(r.bib), riderDisplay: r.name, gapText: secToGap(timeToSec(r.time) - w0) });
  for (const ir of irm) out.push({ rank: null, rankText: ir.irm, bib: String(ir.bib), riderDisplay: ir.name, irm: ir.irm });
  return out;
}

// ---------- PUNTOS (1 col, -layout, sub "General") ----------
function parsePoints(p0, p1) {
  const lines = layout(p0 + 1, p1 + 1).split('\n');
  // Arrancar en la sub-tabla ACUMULADA, saltando la "Etape" (puntos del día) y las
  // penalizaciones. ChronoRace rotula esa sub-tabla de varias formas según la plantilla:
  //   "Points - General" · "Punten ... General"  (libros antiguos)
  //   "Général" / "General" a secas, como título de sección  (libros 2026, p. ej. Baloise)
  // Buscamos la ÚLTIMA aparición de un marcador "Général/General" para quedarnos con la
  // acumulada aunque también exista una sección "... Etape" más arriba.
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Points\s*-\s*Gen[ée]ral|Punten.*Gen[ée]ral|^\s*Gén[ée]ral\s*$|^\s*General\s*$/i.test(lines[i])) start = i;
  }
  const region = start >= 0 ? lines.slice(start + 1) : lines;
  // formato -layout: "rank. bib NOMBRE... ISO TCO puntos"
  const re = /^\s*(\d{1,3})\.\s+(\d{1,3})\s+(.+?)\s+([A-Z]{3})\s+([A-Z]{2,4})\s+(-?\d+)\s*$/;
  const seen = new Map();
  for (const l of region) {
    const m = l.match(re);
    if (m) { const rank = +m[1]; if (!seen.has(rank)) seen.set(rank, { bib: +m[2], rank, name: cleanName(m[3]), pts: +m[6] }); }
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank).map((r) => ({
    rank: r.rank, rankText: String(r.rank), bib: String(r.bib), riderDisplay: r.name,
    points: r.pts, resultValue: String(r.pts), timeText: String(r.pts),
  }));
}

// ---------- 2 COLUMNAS por TIEMPO (gc, jóvenes) ----------
function parseTwoCol(idxs, { leadingBib }) {
  const XSPLIT = 300;
  const entries = [];
  for (const i of idxs) {
    for (const r of rowsOf(PAGES[i], 3)) { // ytol=3: ChronoRace pone los bibs en una mini-columna con y propia
      for (const half of [r.words.filter((w) => w.x < XSPLIT), r.words.filter((w) => w.x >= XSPLIT)]) {
        const e = extractEntry(half.map((w) => w.t), leadingBib);
        if (e) entries.push(e);
      }
    }
  }
  // dedup por rank; descartar el "1." del título (sin bib ni nombre con ISO)
  const seen = new Map();
  for (const e of entries) if (e.bib != null && e.name && !seen.has(e.rank)) seen.set(e.rank, e);
  const ranked = [...seen.values()].sort((a, b) => a.rank - b.rank);
  let w0 = null, lastGap = 0; const out = [];
  for (const e of ranked) {
    if (e.rank === 1) { w0 = timeToSec(e.time); out.push({ rank: 1, rankText: '1', bib: String(e.bib), riderDisplay: e.name, timeText: normTime(e.time) }); lastGap = 0; continue; }
    let g = e.gap != null ? timeToSec(e.gap) : null;
    if (g == null) g = lastGap; else lastGap = g;
    out.push({ rank: e.rank, rankText: String(e.rank), bib: String(e.bib), riderDisplay: e.name, gapText: secToGap(g) });
  }
  return out;
}
function extractEntry(txts, leadingBib) {
  const ri = txts.findIndex((t) => /^\d{1,3}\.$/.test(t));
  if (ri < 0) return null;
  const rank = parseInt(txts[ri], 10);
  // bib: token numérico más cercano al rank, mirando ANTES y DESPUÉS (ChronoRace a
  // veces coloca el bib justo a la izquierda del rank — y los dos bibs de las dos
  // columnas se funden al inicio de la fila). Preferimos el inmediatamente anterior.
  let bib = null;
  for (let k = ri - 1; k >= 0; k--) if (/^\d{1,3}$/.test(txts[k])) { bib = +txts[k]; break; }
  if (bib == null) for (let k = ri + 1; k < txts.length; k++) if (/^\d{1,3}$/.test(txts[k])) { bib = +txts[k]; break; }
  const after = txts.slice(ri + 1);
  const isoIdx = after.findIndex((t) => /^[A-Z]{3}$/.test(t) && ISO[t]);
  const nameToks = after.slice(0, isoIdx < 0 ? after.length : isoIdx).filter((t) => !/^\d{1,3}$/.test(t) && !/^\d+:\d{2}:\d{2}$/.test(t) && t.length > 1);
  const timeTok = txts.filter((t) => /^\d+:\d{2}:\d{2}$/.test(t)).pop() || null;
  return { rank, bib, name: cleanName(nameToks.join(' ')), time: rank === 1 ? timeTok : null, gap: rank === 1 ? null : timeTok };
}

// ---------- Orden de firma: TCO → primer dorsal (nombres NO truncados) ----------
// "Volgorde ploegen handtekening": "  1.  MOV  MOVISTAR TEAM  ESP  61-66  11:25:00"
function parseSignOrder() {
  const idxs = findPages(/Volgorde ploegen handtekening|Ordre signature des équipes/);
  const map = {}; // TCO -> minDorsal
  for (const i of idxs) {
    const text = layout(i + 1, i + 1);
    for (const l of text.split('\n')) {
      const m = l.match(/^\s*\d{1,2}\.\s+([A-Z]{2,4})\s+.+?\s+[A-Z]{3}\s+(\d{1,3})-\d{1,3}\s+\d{2}:\d{2}/);
      if (m) map[m[1]] = +m[2];
    }
  }
  return map;
}
const TCO_MIN_DORSAL = parseSignOrder();
// nombre canónico de equipo a partir del TCO (vía orden de firma → startlist)
function canonTeamName(tco, fallback) {
  if (TEAM_BY_DORSAL && tco && TCO_MIN_DORSAL[tco] != null) {
    const nm = TEAM_BY_DORSAL[String(TCO_MIN_DORSAL[tco])];
    if (nm) return nm;
  }
  return fallback;
}

// ---------- EQUIPOS (2 col, col "Général") ----------
function parseTeams(idxs) {
  const XSPLIT = 300;
  // Extrae las filas de una región [yLo, yHi) de una página.
  function extractRegion(allRows, yLo, yHi) {
    const map = new Map();
    for (const r of allRows) {
      if (r.y < yLo || r.y >= yHi) continue;
      for (const half of [r.words.filter((w) => w.x < XSPLIT), r.words.filter((w) => w.x >= XSPLIT)]) {
        const txts = half.map((w) => w.t);
        const ri = txts.findIndex((t) => /^\d{1,2}\.$/.test(t));
        if (ri < 0) continue;
        const rank = parseInt(txts[ri], 10);
        const timeTok = txts.filter((t) => /^\d+:\d{2}:\d{2}$/.test(t)).pop() || null;
        let rest = txts.slice(ri + 1).filter((t) => !/^\d+:\d{2}:\d{2}$/.test(t));
        let tco = null;
        if (rest[0] && /^[A-Z]{2,4}$/.test(rest[0])) { tco = rest[0]; rest = rest.slice(1); } // código TCO
        const fallback = cleanName(rest.join(' ')).replace(/\s+[A-Z-]+$/, '');
        const name = canonTeamName(tco, fallback); // nombre canónico de la startlist (no truncado)
        if (name && !map.has(rank)) map.set(rank, { rank, name, time: timeTok });
      }
    }
    return map;
  }
  // Las páginas traen dos tablas: "Etape" (arriba) y "Général" (abajo del 2º header
  // "Pl. TCO Ploeg"). Tomamos la Général y completamos huecos (truncado por
  // paginación) desde la Etape — en E1 ambas coinciden; en etapas posteriores la
  // Général ya viene completa y la Etape no aporta nada nuevo.
  const etape = new Map(), general = new Map();
  for (const i of idxs) {
    const allRows = rowsOf(PAGES[i], 3);
    const headerYs = allRows.filter((r) => /Pl\.\s+TCO\s+Ploeg/.test(r.words.map((w) => w.t).join(' '))).map((r) => r.y).sort((a, b) => a - b);
    const splitY = headerYs.length >= 2 ? headerYs[1] : (headerYs[0] || 100) + 1e9;
    for (const [k, v] of extractRegion(allRows, (headerYs[0] || 100) + 1, splitY)) if (!etape.has(k)) etape.set(k, v);
    for (const [k, v] of extractRegion(allRows, splitY + 1, 1e9)) if (!general.has(k)) general.set(k, v);
  }
  const seen = general.size ? general : etape;
  for (const [k, v] of etape) if (!seen.has(k)) seen.set(k, v); // completar huecos
  const ranked = [...seen.values()].sort((a, b) => a.rank - b.rank);
  let w0 = null; const out = [];
  for (const e of ranked) {
    if (e.rank === 1) { w0 = timeToSec(e.time); out.push({ rank: 1, rankText: '1', bib: null, riderDisplay: e.name, timeText: normTime(e.time) }); }
    else out.push({ rank: e.rank, rankText: String(e.rank), bib: null, riderDisplay: e.name, gapText: secToGap(e.time ? timeToSec(e.time) : 0) });
  }
  return out;
}

// ---------- ensamblar ----------
const classObj = (kind, scope, name, rows, isTeam = false, slot = slotOf()) => ({
  eventId: synthEventId(kind, scope, slot), classKind: kind, scope, eventName: name, isTeamEvent: isTeam,
  winnerName: (rows.find((r) => r.rank === 1) || {}).riderDisplay || null, rowCount: rows.length, rows,
});

const stageP = findPages(/Classement de l'étape|Dag uitslag/);
const gcP = findPages(/Général au temps/);
const ptsP = findPages(/Classements aux points/);
const youthP = findPages(/Général des jeunes/);
const teamsP = findPages(/Classement par équipe|Ploegen Uitslag/);

const classifications = [];
if (stageP.length) classifications.push(classObj('stage', 'stage', "Classement de l'étape", parseStage(stageP[0], stageP[stageP.length - 1])));
if (gcP.length) classifications.push(classObj('gc', 'stage', 'Général au temps', parseTwoCol(gcP, { leadingBib: false })));
if (ptsP.length) { const r = parsePoints(ptsP[0], ptsP[ptsP.length - 1]); if (r.length) classifications.push(classObj('points', 'overall', 'Classement aux points', r)); }
if (youthP.length) classifications.push(classObj('youth', 'overall', 'Général des jeunes', parseTwoCol(youthP, { leadingBib: true })));
if (teamsP.length) { const r = parseTeams(teamsP); if (r.length) classifications.push(classObj('teams', 'overall', 'Classement par équipe', r, true)); }

const stages = [{ uciRaceId: synthRaceId(), stageNumber: IS_FINAL ? null : STAGE, stageName: IS_FINAL ? 'Final Classification' : `Etapa ${STAGE}`, isFinalClassification: IS_FINAL, dateKey: DATE, raceType: RACE_TYPE, classifications }];
if (INCLUDE_FINAL && classifications.length) {
  const finalClassifications = classifications.filter((c) => c.classKind !== 'stage').map((c) => ({
    ...c, eventId: synthEventId(c.classKind, c.scope, 99),
  }));
  stages.push({ uciRaceId: synthRaceId(99), stageNumber: null, stageName: 'Final Classification', isFinalClassification: true, dateKey: DATE, raceType: RACE_TYPE, classifications: finalClassifications });
}
const out = {
  competitionId: COMPETITION_ID, disciplineId: 10, source: 'pdf',
  stages,
};
if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(out, null, 2)); }
process.stdout.write(JSON.stringify(out, null, 2));
console.error(`\n[chronorace] ${classifications.length} clasificaciones: ` + classifications.map((c) => `${c.classKind}/${c.scope}=${c.rowCount}`).join(' '));
if (downloadDir) rmSync(downloadDir, { recursive: true, force: true });
