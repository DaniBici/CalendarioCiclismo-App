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
export const synthRaceId = (code, stage) => -(Math.abs(suggestCompetitionId(code)) * 100 + stage);

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
  const t = clean(v);
  const colon = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (colon) return `${Number(colon[1])}:${colon[2]}:${colon[3]}`;
  const infocity = t.match(/^(\d{1,2})h\s*(\d{1,2})'\s*(\d{1,2})''$/);
  if (infocity) return `${Number(infocity[1])}:${infocity[2].padStart(2, '0')}:${infocity[3].padStart(2, '0')}`;
  const shortInfocity = t.match(/^(\d{1,2})'\s*(\d{1,2})''$/);
  return shortInfocity ? `0:${shortInfocity[1].padStart(2, '0')}:${shortInfocity[2].padStart(2, '0')}` : null;
};
const gapOf = (v) => {
  const t = clean(v);
  const infocity = t.match(/^\+\s*(?:(\d{1,2})h\s*)?(\d{1,2})'\s*(\d{1,2})''$/);
  if (infocity) {
    const hours = Number(infocity[1] || 0);
    const minutes = Number(infocity[2]);
    const seconds = infocity[3].padStart(2, '0');
    return hours ? `+${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `+${minutes}:${seconds}`;
  }
  const canonical = t.replace(/^[+]?0+(?=\d)/, '+');
  return /^\+\d+(?::\d{2}){0,2}$/.test(canonical) ? canonical : null;
};

/** Extrae el contenido de cada celda y omite la cabecera de la tabla. */
export function tableRows(html) {
  return [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
    const cells = [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1]));
    return cells;
  }).filter((cells) => cells.length > 1);
}

/**
 * InfoCity normalmente construye la tabla en el navegador en vez de asignar HTML
 * a `cnt`: `ra[0] = Array(pos, rider, bib, team, bonus, time, ..., penalty)`.
 * No evaluamos JavaScript de una fuente externa; solo leemos sus argumentos string.
 */
export function infoCityArrayRows(script, { isTeamEvent = false, isPoints = false, useAbsoluteTime = false } = {}) {
  const rows = [];
  // En las CRI InfoCity elimina la columna de bonificación: el tiempo pasa de
  // la posición 5 a la 4 y después vienen penalización y tiempo intermedio.
  const isIndividualTimeTrial = /\bINDIVIDUAL TIME TRIAL\b/i.test(String(script));
  for (const match of String(script).matchAll(/\bra\s*\[\s*\d+\s*\]\s*=\s*Array\s*\(([\s\S]*?)\)\s*;/g)) {
    const values = [];
    const source = match[1];
    let i = 0;
    while (i < source.length) {
      while (i < source.length && /[\s,]/.test(source[i])) i++;
      if (i >= source.length) break;
      const quote = source[i];
      if (quote !== "'" && quote !== '"') break;
      i++;
      let value = '';
      while (i < source.length) {
        if (source[i] === '\\' && i + 1 < source.length) { value += source.slice(i, i + 2); i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        value += source[i++];
      }
      values.push(clean(decodeJsString(value)));
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source[i] === ',') i++;
    }
    if (isTeamEvent && values.length >= 4) {
      // Equipos: posición, equipo, código, tiempo absoluto, pérdida.
      rows.push([values[0], values[1], '', '', values[3], values[4]]);
    } else if (useAbsoluteTime && values.length >= 5) {
      // General: col. 4 = tiempo absoluto, col. 5 = pérdida.
      rows.push([values[0], values[1], values[2], values[3], values[4], values[5]]);
    } else if (isPoints && values.length >= 5) {
      // Puntos: el valor está en la col. 4.
      rows.push([values[0], values[1], values[2], values[3], values[4]]);
    } else if (isIndividualTimeTrial && values.length >= 5) {
      // CRI: tiempo/pérdida en col. 4; col. 5 = penalización, col. 6 = intermedio.
      rows.push([values[0], values[1], values[2], values[3], values[4]]);
    } else if (values.length >= 6) {
      // Etapa: bonus en col. 4, tiempo/pérdida en col. 5 y penalización después.
      rows.push([values[0], values[1], values[2], values[3], values[5]]);
    }
  }
  return rows;
}

export function rowsFromCells(cellsRows, { isTeamEvent = false, isPoints = false, useAbsoluteTime = false } = {}) {
  const rows = [];
  for (const cells of cellsRows) {
    const rankCell = cells[0];
    const irm = cells.map(irmOf).find(Boolean) || null;
    const rankMatch = rankCell.match(/^(\d+)(?:\.|\s|$)/);
    // Los encabezados suelen ser "Miejsce" / "Zawodnik"; no son filas de resultado.
    if (!rankMatch && !irm) continue;
    const rank = rankMatch ? Number(rankMatch[1]) : null;
    const riderDisplay = clean(cells[1]);
    const bib = isTeamEvent ? null : (clean(cells[2]).match(/^\d+$/) ? clean(cells[2]) : null);
    const teamName = isTeamEvent ? riderDisplay : (clean(cells[3]) || null);
    const hasSeparateGap = !isPoints && (isTeamEvent || useAbsoluteTime) && cells.length >= 6;
    const metric = clean(hasSeparateGap ? cells.at(-2) : cells.at(-1));
    const gapMetric = clean(hasSeparateGap ? cells.at(-1) : cells.at(-1));
    if ((!rank && !irm) || !riderDisplay) continue;
    if (irm) {
      rows.push({ rank: null, rankText: irm, bib, riderDisplay, teamName, resultValue: null, timeText: null, gapText: null, points: null, irm });
      continue;
    }
    const timeText = isPoints ? null : timeOf(metric);
    const gapText = isPoints ? null : (hasSeparateGap ? gapOf(gapMetric) : (!timeText ? gapOf(metric) : null));
    const points = isPoints && /^-?\d+(?:[.,]\d+)?$/.test(metric) ? Number(metric.replace(',', '.')) : null;
    rows.push({ rank, rankText: String(rank), bib, riderDisplay, teamName,
      resultValue: metric || null, timeText, gapText, points, irm: null });
  }
  return rows;
}

export function rowsFromHtml(html, options = {}) {
  return rowsFromCells(tableRows(html), options);
}

export function rowsFromResponse(script, options = {}) {
  const htmlRows = rowsFromHtml(htmlFromResponse(script), options);
  return htmlRows.length ? htmlRows : rowsFromCells(infoCityArrayRows(script, options), options);
}

export function classificationFromRows(code, stageNumber, query, rows) {
  return {
    eventId: synthEventId(code, stageNumber, query.classKind, query.scope),
    classKind: query.classKind,
    scope: query.scope,
    eventName: query.eventName,
    isTeamEvent: !!query.isTeamEvent,
    winnerName: rows.find((row) => row.rank === 1)?.riderDisplay || null,
    rowCount: rows.length,
    rows,
  };
}

const QUERIES = [
  { typ: 'ETAP', kl: 'I', classKind: 'stage', scope: 'stage', eventName: 'Stage Classification' },
  { typ: 'GENE', kl: 'I', classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification', useAbsoluteTime: true },
  { typ: 'GENE', kl: 'P', classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification', isPoints: true },
  { typ: 'GENE', kl: 'G', classKind: 'kom', scope: 'overall', eventName: 'Overall Mountains Classification', isPoints: true },
  { typ: 'GENE', kl: 'D2', classKind: 'teams', scope: 'overall', eventName: 'Overall Teams Classification', isTeamEvent: true },
];

export function endpoint({ race, test, ced }, query) {
  // En InfoCity `ed` identifica el checkpoint de la clasificación. Usar el CED
  // de la propia etapa también para GENE: `ced - 1` devolvía las generales al
  // cierre del día anterior (TdP 2026 E3: 8:09:28 en vez de 12:21:09).
  return `${BASE}?typ=${query.typ}&race=${race}&test=${test}&ced=${ced}&ed=${ced}&kl=${query.kl}&refill=0&lng=EN&lu=&rnd=1`;
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
      const rows = rowsFromResponse(script, query);
      if (!rows.some((row) => row.rank === 1)) continue;
      classifications.push(classificationFromRows(CODE, stageNumber, query, rows));
    }
    if (classifications.length) stages.push({
      uciRaceId: synthRaceId(CODE, stageNumber),
      stageNumber,
      eventName: `Stage ${stageNumber}`,
      classifications,
    });
  }
  if (TOTAL_STAGES != null && stagesToFetch.includes(TOTAL_STAGES)) {
    const last = stages.find((stage) => stage.stageNumber === TOTAL_STAGES);
    if (last) stages.push({ uciRaceId: synthRaceId(CODE, FINAL_SLOT), stageNumber: null, isFinalClassification: true, eventName: 'Final Classification',
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
