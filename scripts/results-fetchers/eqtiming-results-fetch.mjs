#!/usr/bin/env node
/** Resultados públicos de EQ Timing (live.eqtiming.com).
 *
 * GET /api/Event/<eventId> devuelve la topología publicada; GET
 * /api/Result/Total/<eventId>/<raceId>?count=999&station=0 devuelve la tabla.
 * El organizador puede crear las etapas poco antes del directo, así que se
 * descubre la topología en cada ejecución. Sin un ganador, la salida queda
 * vacía y el cron conserva el enlace en pending.
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
const BASE = 'https://live.eqtiming.com/api';

export function fnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
export const suggestCompetitionId = (code) => -(fnv1a(`eqtiming:${code}`) % 200000);
export const synthRaceId = (code, stage) => -(Math.abs(suggestCompetitionId(code)) * 100 + stage);
export const synthEventId = (code, stage) => -(Math.abs(suggestCompetitionId(code)) * 10000 + stage);
export function parseCode(code) { const value = String(code || '').trim(); if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error('--code debe ser el eventId numérico de EQ Timing (p. ej. 83198)'); return value; }

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const first = (...values) => values.find((value) => clean(value) !== '');
const IRM = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL', HD: 'OTL', EX: 'DSQ' };
export function normalizeTime(value) { const text = clean(value).replace(/\s/g, ''); if (!/^\d+(?::\d{2}){1,2}$/.test(text)) return null; const parts = text.split(':'); return parts.length === 3 ? `${Number(parts[0])}:${parts[1]}:${parts[2]}` : text; }
export function normalizeGap(value) { const text = clean(value).replace(/\s/g, '').replace(/^\+?0+(?=\d)/, '+'); return /^\+\d+(?::\d{2}){0,2}$/.test(text) ? text : null; }

export function rowsFromResult(result) {
  const rows = [];
  for (const item of result?.Items || []) {
    const status = clean(first(item?.StatusTekst, item?.Tid?.StatusTekst)).toUpperCase();
    const irm = IRM[status] || null;
    const rankValue = first(item?.Plassering?.Total, item?.Plassering?.Klasse, item?.Rank, item?.Plassering);
    const rank = /^\d+$/.test(clean(rankValue)) && Number(rankValue) > 0 ? Number(rankValue) : null;
    const bibValue = first(item?.Deltaker?.Startnummer, item?.Startnummer, item?.Bib);
    const bib = /^\d+$/.test(clean(bibValue)) ? clean(bibValue) : null;
    const riderDisplay = clean(first(item?.Deltaker?.Utover?.NavnFormatert, item?.Deltaker?.Utover?.Navn, item?.Utover?.NavnFormatert, item?.Name));
    if ((!rank && !irm) || !riderDisplay) continue;
    const metric = first(item?.Tid?.Formatert, item?.Formatert, item?.Tid?.DisplayTid, item?.Time);
    rows.push({ rank, rankText: rank ? String(rank) : (irm || status || null), bib, riderDisplay,
      teamName: clean(first(item?.Deltaker?.Klubb?.Navn, item?.Deltaker?.KlubbNavn, item?.Team, item?.Club)) || null,
      nationality: clean(first(item?.Deltaker?.Utover?.Land?.ISO3, item?.Deltaker?.Utover?.Land?.ISO2, item?.Nation)) || null,
      resultValue: clean(metric) || null, timeText: irm ? null : normalizeTime(metric),
      gapText: irm ? null : normalizeGap(first(item?.Diff?.TotalFormatert, item?.Diff?.KlasseFormatert, item?.Gap)), points: null, irm });
  }
  return rows;
}
export function racesFromEvent(event) { return Object.values(event?.Etapper || {}).filter((race) => race?.UID && !race?.GjemFraLive).sort((a, b) => Number(a.Nummer || 0) - Number(b.Nummer || 0) || Number(a.UID) - Number(b.UID)); }
export function stageNumberFor(race, index) { const number = Number(race?.Nummer); return Number.isInteger(number) && number >= 1 ? number : index + 1; }
export const eventEndpoint = (code) => `${BASE}/Event/${code}`;
export const resultEndpoint = (code, raceId) => `${BASE}/Result/Total/${code}/${raceId}?count=999&station=0`;
async function fetchJson(url) { const response = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } }); if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`); return response.json(); }

async function main() {
  const code = parseCode(CODE);
  if (has('--suggest-id')) { process.stdout.write(`${suggestCompetitionId(code)}\n`); return; }
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  const fixture = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : null;
  const event = fixture?.event || await fetchJson(eventEndpoint(code));
  const stages = [];
  for (const [index, race] of racesFromEvent(event).entries()) {
    const stageNumber = stageNumberFor(race, index);
    if ((ONLY_STAGE != null && stageNumber !== ONLY_STAGE) || (TOTAL_STAGES != null && stageNumber > TOTAL_STAGES)) continue;
    const result = fixture?.results?.[String(race.UID)] || await fetchJson(resultEndpoint(code, race.UID));
    const rows = rowsFromResult(result);
    if (!rows.some((row) => row.rank === 1)) continue;
    stages.push({ uciRaceId: synthRaceId(code, stageNumber), stageNumber, eventName: clean(race.Navn) || `Stage ${stageNumber}`,
      classifications: [{ eventId: synthEventId(code, stageNumber), classKind: 'stage', scope: 'stage', eventName: 'Stage Classification', isTeamEvent: false, winnerName: rows.find((row) => row.rank === 1)?.riderDisplay || null, rowCount: rows.length, rows }] });
  }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'eqtiming', eqtimingCode: code, fetchedAt: new Date().toISOString(), stages };
  mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) main().catch((error) => { process.stderr.write(`FATAL: ${error.stack || error.message}\n`); process.exit(1); });
