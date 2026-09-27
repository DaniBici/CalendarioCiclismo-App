import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Asociación editorial entre el live de la primera etapa y el dossier oficial.
export const COMPUTER_EVENTS = {
  '260903': { id: '260906', name: 'Sauerlandrundfahrt', year: 2026, raceTypes: { 1: 'ITT' },
    teamAliases: { 'National Team Germany': 'Germany' } },
};
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const TIME = '(\\d+:\\d{2}:\\d{2}(?:[,.]\\d+)?)';
const GAP = '(\\d+(?::\\d{2}){0,2}(?:[,.]\\d+)?)';
const absolute = (v) => clean(v).replace(/[,.]\d+$/, '');
const seconds = (v) => absolute(v).split(':').reduce((s, n) => s * 60 + Number(n), 0);
const gap = (v) => {
  const n = seconds(v);
  return n < 60 ? `+${n}` : n < 3600 ? `+${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
    : `+${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

export function computerPdfLinks(html, event) {
  const page = `https://www.computerauswertung.at/veranstaltung.php?V_ID=${event.id}&lang=de`;
  const found = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(match[1].replace(/&amp;/g, '&'), page);
    const label = clean(match[2].replace(/<[^>]*>/g, ' '));
    if (url.origin !== 'https://www.computerauswertung.at' || !url.pathname.startsWith(`/veranstaltungen/${event.year}/${event.id}/`) || !/\.pdf$/i.test(url.pathname)) continue;
    if (!/Ergebnis|Result/i.test(label)) continue;
    const number = label.match(/(\d+)\.\s*Etappe/i)?.[1] ?? label.match(/stage\s*(\d+)/i)?.[1];
    if (number) found.set(Number(number), url.href);
  }
  return found;
}

function heading(line) {
  if (/Teams['’]?\s+General Classification|Mannschafts-Gesamtklassement nach Zeit/i.test(line)) return 'teams';
  if (/Points General Classification|Einzel-Gesamtklassement nach Punkten/i.test(line)) return 'points';
  if (/Mountain General Classification|Berg-Gesamtklassement/i.test(line)) return 'kom';
  if (/Youth General Classification|Young Rider.*General Classification/i.test(line)) return 'youth';
  if (/Individual General Classification|Einzel-Gesamtklassement nach Zeit/i.test(line)) return 'gc';
  if (/Stage Classification on time|^Etappenklassement nach Zeit/i.test(line)) return 'stage';
  if (/Classification|klassement|Konvoi-Nummern|Convoy Numbers|Communiqu|Ehrenliste|Liste der|Startliste|Start List|Team Presentation/i.test(line)) return 'ignore';
  return null;
}

function timeRow(rank, bib, time, sourceGap, leaderTime) {
  const preciseSeconds = (v) => clean(v).replace(',', '.').split(':').reduce((s, n) => s * 60 + Number(n), 0);
  const difference = leaderTime ? preciseSeconds(time) - preciseSeconds(leaderTime) : NaN;
  if (rank !== 1 && !sourceGap && (!Number.isFinite(difference) || difference < 0)) throw new Error('PDF: diferencia no verificable');
  const value = rank === 1 ? absolute(time) : sourceGap ? gap(sourceGap) : gap(String(Math.floor(difference + 1e-7)));
  return { rank, rankText: String(rank), ...(bib ? { bib: String(bib) } : {}), resultValue: value,
    timeText: rank === 1 ? value : null, gapText: rank === 1 ? null : value, points: null, irm: null };
}

function validateRows(kind, rows) {
  if (!rows.length || rows.filter((r) => r.rank === 1 && !r.irm).length !== 1) throw new Error(`PDF: ${kind} sin ganador único`);
  const bibs = new Set();
  let rank = 0;
  let lastValue = kind === 'points' || kind === 'kom' ? Infinity : 0;
  for (const row of rows) {
    if (kind !== 'teams') {
      if (!/^\d+$/.test(row.bib) || Number(row.bib) < 1 || bibs.has(row.bib)) throw new Error(`PDF: dorsal inválido/duplicado en ${kind}`);
      bibs.add(row.bib);
    }
    if (row.irm) continue;
    if (row.rank !== ++rank) throw new Error(`PDF: puestos incompletos en ${kind}`);
    const value = row.points ?? (row.rank === 1 ? 0 : seconds(row.gapText.slice(1)));
    if ((row.points != null && value > lastValue) || (row.points == null && value < lastValue)) throw new Error(`PDF: valores no monótonos en ${kind}`);
    lastValue = value;
  }
}

export function parseComputerPdf(text, { event, stageNumber, expectedDate }) {
  const lines = String(text).split(/\r?\n/);
  const firstPage = String(text).split('\f')[0];
  if (!firstPage.includes(event.name)) throw new Error('PDF: carrera distinta');
  const firstStage = firstPage.match(/(\d+)\.\s*Etappe\s*\/\s*stage\s*(\d+)/i);
  if (!firstStage || Number(firstStage[1]) !== stageNumber || Number(firstStage[2]) !== stageNumber) throw new Error('PDF: etapa distinta');
  const date = firstPage.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(20\d{2})/i);
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const dateKey = date ? `${date[3]}-${String(months.indexOf(date[1].toLowerCase()) + 1).padStart(2, '0')}-${date[2].padStart(2, '0')}` : null;
  if (!dateKey || Number(date[3]) !== event.year || (expectedDate && dateKey !== expectedDate)) throw new Error('PDF: fecha o año distinto');
  const tables = new Map();
  const leaderTimes = new Map();
  let kind = 'ignore';
  let starters = null;
  let dns = 0;
  for (const raw of lines) {
    const line = raw.replace(/\f/g, '').trim();
    const next = heading(line);
    if (next) { kind = next; if (kind !== 'ignore' && !tables.has(kind)) tables.set(kind, []); continue; }
    if (kind === 'ignore') continue;
    if (kind === 'stage') {
      const total = line.match(/Number of starters\/Anzahl der Starter:\s*(\d+)/i);
      if (total) starters = Number(total[1]);
      const notStarted = line.match(/Did not start\/Nicht am Start:\s*(\d+)/i);
      if (notStarted) dns = Number(notStarted[1]);
    }
    const rows = tables.get(kind);
    const irm = line.match(/^(DNS|DNF|DSQ|OTL)\s+(\d+)\s+/);
    if (irm && kind !== 'teams') { rows.push({ bib: irm[2], rank: null, rankText: irm[1], irm: irm[1], resultValue: null, timeText: null, gapText: null, points: null }); continue; }
    if (!/^\d+\.\s+/.test(line) || /\d+\.\s*Etappe/i.test(line)) continue;
    let row;
    if (kind === 'teams') {
      const m = line.match(new RegExp(`^(\\d+)\\.\\s+([A-Z0-9]{2,4})\\s+(.+?)\\s+${TIME}(?:\\s+\\+\\s*${GAP})?\\s*$`));
      if (m) {
        if (Number(m[1]) === 1) leaderTimes.set(kind, m[4]);
        const name = event.teamAliases?.[clean(m[3])] ?? clean(m[3]);
        row = { ...timeRow(Number(m[1]), null, m[4], m[5], leaderTimes.get(kind)), riderDisplay: name, teamName: name };
      }
    } else if (kind === 'points' || kind === 'kom') {
      const m = line.match(/^(\d+)\.\s+(\d+)\s+.+?\s+(\d+)\s*$/);
      if (m) row = { rank: Number(m[1]), rankText: m[1], bib: m[2], resultValue: m[3], points: Number(m[3]), timeText: null, gapText: null, irm: null };
    } else {
      const m = line.match(new RegExp(`^(\\d+)\\.\\s+(\\d+)\\s+.+?\\s+${TIME}(?:\\s+\\+\\s*${GAP})?\\s*$`));
      if (m) {
        if (Number(m[1]) === 1) leaderTimes.set(kind, m[3]);
        row = timeRow(Number(m[1]), m[2], m[3], m[4], leaderTimes.get(kind));
      }
    }
    if (!row) throw new Error(`PDF: fila no interpretada en ${kind}: ${line.slice(0, 100)}`);
    rows.push(row);
  }
  const main = tables.get('stage');
  if (!main?.length) throw new Error('PDF publicado sin clasificación de etapa interpretable');
  if (starters != null && main.length !== starters + dns) throw new Error(`PDF: se esperaban ${starters + dns} filas de etapa, obtenidas ${main.length}`);
  const classifications = [...tables].map(([classKind, rows]) => {
    validateRows(classKind, rows);
    return { classKind, scope: ['stage', 'gc'].includes(classKind) ? 'stage' : 'overall',
      eventName: `Official ${classKind} classification`, isTeamEvent: classKind === 'teams',
      rowCount: rows.length, expectedRowCount: classKind === 'stage' && starters != null ? starters + dns : rows.length, rows };
  });
  return { dateKey, classifications };
}

export async function readComputerPdf(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`PDF: HTTP ${response.status}`);
  const dir = mkdtempSync(join(tmpdir(), 'cc-computerauswertung-'));
  try {
    const path = join(dir, 'results.pdf');
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
