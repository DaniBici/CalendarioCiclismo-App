#!/usr/bin/env node
/**
 * Resultados de Classificações.net → contrato intermedio de uci-results-upsert.
 *
 * El código es el slug de la prueba (p.ej. 86-volta-a-portugal-continente).
 * Descubre los ids de etapa y de clasificación en HTML; no se hardcodean.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const OUT = arg('--out', '.');
const COMPETITION_ID = Number(arg('--competition-id'));
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const FIXTURE = arg('--fixture');
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const BASE = 'https://www.classificacoes.net';
const log = (s) => process.stderr.write(`${s}\n`);

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const suggestCompetitionId = (code) => -(fnv1a(`classificacoes:${code}`) % 200000);
const CLASS_IDX = {
  'stage/stage': 0, 'gc/stage': 1,
  'points/overall': 2, 'kom/overall': 3, 'youth/overall': 4, 'teams/overall': 5,
  'points/stage': 6, 'kom/stage': 7, 'youth/stage': 8, 'teams/stage': 9,
};
const synthEventId = (code, stageNumber, classKind, scope, isFinal = false) => {
  const base = -suggestCompetitionId(code);
  const slot = isFinal ? 9999 : stageNumber;
  return -(base * 10000 + slot * 100 + (CLASS_IDX[`${classKind}/${scope}`] ?? 99));
};

export function stageNumber(text) {
  if (/pr[oó]logo/i.test(text)) return 0;
  const m = text.match(/(\d+)ª\s*Etapa/i);
  return m ? Number(m[1]) : null;
}

export function decodeHtml(s = '') {
  return s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#(?:39|x27);/gi, "'")
    .replace(/&quot;/gi, '"').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function stagesFromRaceHtml(html) {
  const stages = [];
  const re = /<tr[^>]*onclick="location\.href='([^']+\/(\d+))'"[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const m of html.matchAll(re)) {
    const text = decodeHtml(m[3]);
    const number = stageNumber(text);
    if (number != null) stages.push({ stageNumber: number, path: m[1], stageId: Number(m[2]), text });
  }
  return stages;
}

export function classificationsFromStageHtml(html) {
  const select = html.match(/<select[^>]+name="stageLinkUpa"[^>]*>([\s\S]*?)<\/select>/i)?.[1] || '';
  return [...select.matchAll(/<option[^>]+value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((m) => ({ path: decodeHtml(m[1]), label: decodeHtml(m[2]) }));
}

export function classify(label) {
  const l = label.toLowerCase();
  if (/classifica[cç][aã]o individual na etapa/.test(l)) return { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification' };
  if (/geral individual/.test(l)) return { classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification' };
  if (/geral pontos/.test(l)) return { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification' };
  if (/geral montanha/.test(l)) return { classKind: 'kom', scope: 'overall', eventName: 'Overall Mountain Classification' };
  if (/geral juventude/.test(l)) return { classKind: 'youth', scope: 'overall', eventName: 'Overall Youth Classification' };
  if (/geral equipas/.test(l)) return { classKind: 'teams', scope: 'overall', eventName: 'Overall Teams Classification', isTeamEvent: true };
  return null;
}

const clean = (v) => decodeHtml(String(v ?? '')).replace(/^---$/, '').trim();
const irmOf = (v) => /^(DNF|DNS|DSQ|DQ|OTL)$/i.test(clean(v)) ? clean(v).toUpperCase().replace('DQ', 'DSQ') : null;
const normTime = (v) => {
  const s = clean(v); const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return m ? `${Number(m[1])}:${m[2]}:${m[3]}` : null;
};
const normGap = (v) => {
  const s = clean(v).replace(/^a\s+/i, '+').replace(/^\+?0+(?=\d)/, '+');
  return /^(?:\+\d+(?::\d{2}){0,2}|m\.t\.)$/i.test(s) ? (s.toLowerCase() === 'm.t.' ? null : s) : null;
};

export function rowsFromPayload(payload, { isTeamEvent = false } = {}) {
  const data = Array.isArray(payload?.aaData) ? payload.aaData : Array.isArray(payload?.data) ? payload.data : [];
  return data.map((row) => Array.isArray(row) ? row : Object.values(row)).map((r) => {
    const rankText = clean(r[0]); const bib = clean(r[1]);
    const isCompact = r.length <= 5;
    const display = isTeamEvent ? clean(r[2]) : clean(isCompact ? r[2] : r[4]);
    const teamName = isTeamEvent ? display : clean(isCompact ? r[3] : r[6]) || null;
    const value = clean(isTeamEvent ? r[3] : (isCompact ? r[4] : r[7]));
    const gap = clean(isTeamEvent ? r[4] : r[8]);
    const irm = irmOf(rankText) || irmOf(value);
    if (irm) return { rank: null, rankText: irm, bib: bib || null, riderDisplay: display || 'Sin identificar', irm };
    const rank = /^\d+$/.test(rankText) ? Number(rankText) : null;
    if (!rank || !display) return null;
    const absolute = normTime(value);
    const points = !isTeamEvent && isCompact && /^-?\d+$/.test(value) ? Number(value) : null;
    const isGap = !absolute && /^a\s+/i.test(value);
    return {
      rank, rankText: String(rank), bib: isTeamEvent ? null : (bib || null), riderDisplay: display,
      teamName,
      // La fuente da tiempo absoluto a todos los clasificados: no mezclar gapText,
      // para que la web derive los m.t. y diferencias de forma consistente.
      resultValue: points == null ? (absolute || (isGap ? null : value || null)) : value,
      timeText: absolute,
      gapText: absolute ? null : normGap(isGap ? value : gap), points, irm: null,
    };
  }).filter(Boolean);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res;
}

async function main() {
  if (!CODE) throw new Error('Uso: --code <slug> --competition-id <id> [--out dir]');
  if (has('--suggest-id')) { process.stdout.write(String(suggestCompetitionId(CODE)) + '\n'); return; }
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Uso: --code <slug> --competition-id <id> [--out dir]');
  const fixture = FIXTURE ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
  const raceHtml = fixture?.raceHtml || await (await get(`${BASE}/modalidades/ciclismo/${CODE}`)).text();
  const available = stagesFromRaceHtml(raceHtml).filter((s) => ONLY_STAGE == null || s.stageNumber === ONLY_STAGE);
  const stages = [];
  for (const stage of available) {
    const html = fixture?.stageHtml?.[String(stage.stageNumber)] || await (await get(`${BASE}${stage.path}`)).text();
    const classifications = [];
    for (const option of classificationsFromStageHtml(html)) {
      const spec = classify(option.label); if (!spec) continue;
      const id = option.path.match(/\/results\/(\d+)$/)?.[1]; if (!id) continue;
      const payload = fixture?.results?.[id] || await (await get(`${BASE}/ajax/action/results/${id}`)).json();
      const rows = rowsFromPayload(payload, spec);
      if (!rows.some((r) => r.rank === 1)) continue;
      classifications.push({ eventId: synthEventId(CODE, stage.stageNumber, spec.classKind, spec.scope), ...spec, winnerName: rows.find((r) => r.rank === 1)?.riderDisplay || null, rowCount: rows.length, rows });
    }
    if (classifications.length) stages.push({ stageNumber: stage.stageNumber, eventName: stage.text, classifications });
  }
  if (TOTAL_STAGES != null && ONLY_STAGE === TOTAL_STAGES) {
    const last = stages.find((s) => s.stageNumber === TOTAL_STAGES);
    if (last) stages.push({
      stageNumber: null, isFinalClassification: true, eventName: 'Final Classification',
      classifications: last.classifications.filter((c) => c.classKind !== 'stage').map((c) => ({
        ...c, scope: 'stage', eventId: synthEventId(CODE, 9999, c.classKind, 'stage', true),
      })),
    });
  }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'classificacoes', classificacoesCode: CODE, stages };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
}
