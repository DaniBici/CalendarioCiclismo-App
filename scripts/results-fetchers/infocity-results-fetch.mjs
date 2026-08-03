#!/usr/bin/env node
/**
 * infocity-results-fetch.mjs — resultados del cronometraje InfoCity del Tour de
 * Pologne. El endpoint público devuelve JavaScript que asigna HTML a `cnt`, no
 * JSON; este adaptador lo normaliza al contrato de uci-results-upsert.mjs.
 *
 * `--code` es `race:test:ced-etapa-1` (por ejemplo, 21:21:141 en el TdP 2026).
 * El `ced` de las etapas sucesivas es correlativo. El sitio deja los resultados
 * sin publicar como una tabla vacía / mensaje "waiting for new data": en ese
 * caso se emite una salida sin filas y el cron mantiene el link en pending.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const FIXTURE = arg('--fixture');
const BASE = 'https://tdp.infocity.pl/updatefields.asp';
const log = (s) => process.stderr.write(`${s}\n`);

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const suggestCompetitionId = (code) => -(fnv1a(`infocity:${code}`) % 200000);

export function parseCode(code) {
  const parts = String(code || '').split(':').map((v) => Number(v));
  if (parts.length !== 3 || parts.some((v) => !Number.isInteger(v) || v < 1)) {
    throw new Error('--code debe ser race:test:ced-etapa-1 (p. ej. 21:21:141)');
  }
  return { race: parts[0], test: parts[1], firstCed: parts[2] };
}

const CLASS_IDX = {
  'stage/stage': 0, 'gc/stage': 1,
  'points/overall': 2, 'kom/overall': 3, 'teams/overall': 5,
  'points/stage': 6, 'kom/stage': 7, 'teams/stage': 9,
};
const synthEventId = (code, stage, kind, scope) => -((-suggestCompetitionId(code)) * 10000 + stage * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 99));
const FINAL_SLOT = 9999;

const clean = (v) => String(v ?? '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
  .replace(/&#(?:39|x27);/gi, "'").replace(/&quot;/gi, '"').replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function decodeJsString(value = '') {
  return String(value).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\\'"nrt])/g, (_, token) => {
    if (token === 'n') return '\n'; if (token === 'r') return '\r'; if (token === 't') return '\t';
    if (token.startsWith('u')) return String.fromCharCode(parseInt(token.slice(1), 16));
    if (token.startsWith('x')) return String.fromCharCode(parseInt(token.slice(1), 16));
    return token;
  });
}

export function htmlFromResponse(script) {
  const match = String(script).match(/\bcnt\s*=\s*'((?:\\.|[^'])*)'\s*;/s);
  return match ? decodeJsString(match[1]) : '';
}

const irmOf = (v) => {
  const t = clean(v).toUpperCase();
  if (/\bDNS\b/.test(t)) return 'DNS';
  if (/\bDSQ\b|\bDQ\b/.test(t)) return 'DSQ';
  if (/\bDNF\b/.test(t)) return 'DNF';
  if (/\bOTL\b/.test(t)) return 'OTL';
  return null;
};
const timeOf = (v) => {
  const m = clean(v).match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return m ? `${Number(m[1])}:${m[2]}:${m[3]}` : null;
};
const gapOf = (v) => {
  const t = clean(v).replace(/^[+]?0+(?=\d)/, '+');
  return /^\+\d+(?::\d{2}){0,2}$/.test(t) ? t : null;
};

/** Extrae el contenido de cada celda y omite la cabecera de la tabla. */
export function tableRows(html) {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
    const cells = [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1]));
    return cells;
  }).filter((cells) => cells.length > 1);
}

export function rowsFromHtml(html, { isTeamEvent = false, isPoints = false } = {}) {
  const rows = [];
  for (const cells of tableRows(html)) {
    const rankCell = cells[0];
    const irm = irmOf(rankCell) || irmOf(cells.at(-1));
    const rankMatch = rankCell.match(/^(\d+)(?:\.|\s|$)/);
    // Los encabezados suelen ser "Miejsce" / "Zawodnik"; no son filas de resultado.
    if (!rankMatch && !irm) continue;
    const rank = rankMatch ? Number(rankMatch[1]) : null;
    const riderDisplay = clean(cells[1]);
    const bib = isTeamEvent ? null : (clean(cells[2]).match(/^\d+$/) ? clean(cells[2]) : null);
    const teamName = isTeamEvent ? riderDisplay : (clean(cells[3]) || null);
    const metric = clean(cells.at(-1));
    if ((!rank && !irm) || !riderDisplay) continue;
    if (irm) {
      rows.push({ rank: null, rankText: irm, bib, riderDisplay, teamName, resultValue: null, timeText: null, gapText: null, points: null, irm });
      continue;
    }
    const timeText = isPoints ? null : timeOf(metric);
    const gapText = isPoints ? null : (!timeText ? gapOf(metric) : null);
    const points = isPoints && /^-?\d+(?:[.,]\d+)?$/.test(metric) ? Number(metric.replace(',', '.')) : null;
    rows.push({ rank, rankText: String(rank), bib, riderDisplay, teamName,
      resultValue: metric || null, timeText, gapText, points, irm: null });
  }
  return rows;
}

const QUERIES = [
  { typ: 'ETAP', kl: 'I', classKind: 'stage', scope: 'stage', eventName: 'Stage Classification' },
  { typ: 'GENE', kl: 'I', classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification' },
  { typ: 'GENE', kl: 'P', classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification', isPoints: true },
  { typ: 'GENE', kl: 'G', classKind: 'kom', scope: 'overall', eventName: 'Overall Mountains Classification', isPoints: true },
  { typ: 'GENE', kl: 'D2', classKind: 'teams', scope: 'overall', eventName: 'Overall Teams Classification', isTeamEvent: true },
];

export function endpoint({ race, test, ced }, query) {
  const ed = query.typ === 'GENE' ? ced - 1 : ced;
  return `${BASE}?typ=${query.typ}&race=${race}&test=${test}&ced=${ced}&ed=${ed}&kl=${query.kl}&refill=0&lng=EN&lu=&rnd=1`;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.text();
}

async function main() {
  if (!CODE) throw new Error('Uso: --code <race:test:ced-etapa-1> --competition-id <id>');
  if (has('--suggest-id')) { process.stdout.write(`${suggestCompetitionId(CODE)}\n`); return; }
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  const config = parseCode(CODE);
  const stagesToFetch = ONLY_STAGE == null
    ? Array.from({ length: TOTAL_STAGES || 1 }, (_, i) => i + 1)
    : [ONLY_STAGE];
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  const stages = [];
  for (const stageNumber of stagesToFetch) {
    const ced = config.firstCed + stageNumber - 1;
    const classifications = [];
    for (const query of QUERIES) {
      const script = fixture?.[`${stageNumber}:${query.typ}:${query.kl}`]
        ?? await fetchText(endpoint({ ...config, ced }, query));
      const rows = rowsFromHtml(htmlFromResponse(script), query);
      if (!rows.some((row) => row.rank === 1)) continue;
      classifications.push({ eventId: synthEventId(CODE, stageNumber, query.classKind, query.scope),
        classKind: query.classKind, scope: query.scope, eventName: query.eventName,
        winnerName: rows.find((row) => row.rank === 1)?.riderDisplay || null, rowCount: rows.length, rows });
    }
    if (classifications.length) stages.push({ stageNumber, eventName: `Stage ${stageNumber}`, classifications });
  }
  if (TOTAL_STAGES != null && stagesToFetch.includes(TOTAL_STAGES)) {
    const last = stages.find((stage) => stage.stageNumber === TOTAL_STAGES);
    if (last) stages.push({ stageNumber: null, isFinalClassification: true, eventName: 'Final Classification',
      classifications: last.classifications.filter((c) => c.classKind !== 'stage').map((c) => ({ ...c,
        scope: 'stage', eventId: synthEventId(CODE, FINAL_SLOT, c.classKind, 'stage') })) });
  }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'infocity', infocityCode: CODE, stages };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => { log(`FATAL: ${error.message}`); process.exit(1); });
}
