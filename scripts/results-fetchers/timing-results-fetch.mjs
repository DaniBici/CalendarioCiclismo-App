#!/usr/bin/env node
/** Resultados públicos de timing.ee.
 *
 * GET /_000/club/live_results_data.php?event=<id> expone todas las jornadas y
 * clasificaciones de una vuelta. El endpoint también publica filas históricas
 * sin casar durante la preparación del cronometraje; se excluyen cuando
 * db_match=0 para que la startlist oficial sea la autoridad.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1aCodeUnits as fnv1a } from './pdf-results-ids.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const COMPETITION_ID = Number(arg('--competition-id'));
const OUT = arg('--out', '.');
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const FIXTURE = arg('--fixture');
const BASE = 'https://timing.ee/_000/club';
const FINAL_SLOT = 'final';
export const RESULTS_SOURCE = 'timing.ee';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const IRM = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL', HD: 'OTL', ABD: 'DNF', AB: 'DNF' };

export function parseCode(value) {
  const code = clean(value);
  if (!/^\d+$/.test(code) || Number(code) < 1) throw new Error('--code debe ser el event numérico de timing.ee');
  return code;
}

export const suggestCompetitionId = (code) => -(fnv1a(`timing:${parseCode(code)}`) % 200000 || 1);
export const endpoint = (code) => `${BASE}/live_results_data.php?event=${parseCode(code)}`;
export const officialPdfUrl = (code, distanceId = null) => `${BASE}/official_results_pdf.php?event=${parseCode(code)}${distanceId ? `&distance_id=${encodeURIComponent(distanceId)}` : ''}`;
export const synthRaceId = (code, distanceId) => -(fnv1a(`timing:${parseCode(code)}:race:${distanceId}`) % 2000000000 || 1);
export const synthEventId = (code, distanceId, classKind, scope) => -(fnv1a(`timing:${parseCode(code)}:event:${distanceId}:${classKind}:${scope}`) % 2000000000 || 1);

export function parseStageIdentity(name, fallbackIndex = 0) {
  const value = clean(name);
  if (/\b(prologue|proloog|prologo|pr[oó]logo)\b/i.test(value)) return { stageNumber: 0, sectorIndex: null };
  let match = value.match(/\bstage\s*(\d+)\s*([a-z])?\b/i);
  if (!match) match = value.match(/\b(\d+)(?:st|nd|rd|th)\s+stage\b/i);
  if (!match) match = value.match(/\b(\d+)\.\s*etapp\b/i);
  if (!match) return { stageNumber: fallbackIndex + 1, sectorIndex: null };
  const letter = match[2] ? match[2].toUpperCase() : null;
  return { stageNumber: Number(match[1]), sectorIndex: letter ? letter.charCodeAt(0) - 65 : null };
}

export function parsePlace(value) {
  const raw = clean(value).toUpperCase().replace(/\.$/, '');
  if (/^\d+$/.test(raw) && Number(raw) > 0) return { rank: Number(raw), irm: null };
  if (raw) return { rank: null, irm: IRM[raw] || raw };
  return { rank: null, irm: null };
}

export function bibOf(row) {
  const value = clean(row?.bib).replace(/^\*/, '');
  return /^\d+$/.test(value) ? value : null;
}

export function normalizeTime(value) {
  const raw = clean(value).replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?::\d{2}){1,2}(?:\.\d+)?$/.test(raw)) return null;
  const parts = raw.split(':');
  return parts.length === 3 ? `${Number(parts[0])}:${parts[1]}:${parts[2]}` : raw;
}

export function normalizeGap(value) {
  const raw = clean(value).replace(/\s/g, '').replace(/^\+/, '');
  if (!raw || raw === '"' || !/^\d+(?::\d{2}){0,2}(?:\.\d+)?$/.test(raw)) return null;
  const parts = raw.split(':');
  while (parts.length > 1 && Number(parts[0]) === 0) parts.shift();
  return `+${parts.join(':')}`;
}

function authoritative(row) { return clean(row?.db_match) !== '0'; }
function numericRank(row, key) { return parsePlace(row?.[key]); }
function teamName(value) { return clean(value).replace(/^[A-Z0-9]{2,4}\s+(?=\S)/, ''); }

function secondsOf(value) {
  const time = normalizeTime(value);
  if (!time) return null;
  return time.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function teamKey(row) {
  const explicit = clean(row?.klubi_lyhend).toUpperCase();
  if (explicit) return explicit;
  const value = clean(row?.klubi);
  const prefixed = value.match(/^([A-Z0-9]{2,4})\s+(?=\S)/);
  return prefixed ? prefixed[1] : value.toLocaleLowerCase('en');
}

export function isTeamTimeTrial(group, teamClassification) {
  if (/\b(team\s+time\s+trial|ttt|cre)\b/i.test(clean(group?.distance_name))) return true;
  const stageWinner = (group?.rows || []).find((row) => authoritative(row) && parsePlace(row.koht).rank === 1);
  const teamWinner = (teamClassification?.rows || []).find((row) => authoritative(row) && parsePlace(row.arvestuse_koht).rank === 1);
  const stageSeconds = secondsOf(stageWinner?.aeg);
  const teamSeconds = secondsOf(teamWinner?.aeg);
  if (stageSeconds == null || teamSeconds == null || stageSeconds <= 0) return false;
  // En una CRE la clasificación por equipos usa el mismo crono que la etapa.
  // En línea suma los tiempos de varios corredores y ronda 3× el tiempo ganador.
  return teamSeconds / stageSeconds >= 0.9 && teamSeconds / stageSeconds <= 1.1;
}

function mapTttRows(sourceRows, teamClassification) {
  const membersByTeam = new Map();
  for (const row of sourceRows || []) {
    if (!authoritative(row) || !parsePlace(row.koht).rank) continue;
    const key = teamKey(row);
    if (!membersByTeam.has(key)) membersByTeam.set(key, []);
    membersByTeam.get(key).push(row);
  }
  const rows = [];
  for (const teamRow of teamClassification?.rows || []) {
    const rank = parsePlace(teamRow.arvestuse_koht).rank;
    if (!rank) continue;
    const display = teamName(teamRow.klubi);
    const members = membersByTeam.get(teamKey(teamRow)) || [];
    const absolute = normalizeTime(teamRow.aeg);
    if (!members.length) {
      rows.push({
        rank, rankText: String(rank), bib: null, riderDisplay: display, teamName: display,
        nationality: null, resultValue: absolute, timeText: absolute, gapText: null,
        points: null, irm: null,
      });
      continue;
    }
    members.forEach((member, index) => {
      const mapped = mapRows([member], { timed: true, stageTimes: true })[0];
      if (!mapped) return;
      rows.push(index === 0 ? {
        // timeText gobierna la fila colapsada y lleva el tiempo oficial del
        // equipo. resultValue conserva por separado el tiempo del corredor que
        // encabeza el bloque, que puede no coincidir con el tiempo computable.
        ...mapped, rank, rankText: String(rank), resultValue: mapped.timeText,
        timeText: absolute, gapText: null, irm: null,
      } : {
        // timing.ee sí cronometra a cada integrante. El puesto queda reservado
        // al líder del equipo, pero el tiempo individual se conserva para el
        // desplegable CRE de la web.
        ...mapped, rank: null, rankText: null, resultValue: mapped.timeText,
        gapText: null, points: null, irm: null,
      });
    });
  }
  return rows;
}

export function mapRows(sourceRows, { rankKey = 'koht', timed = false, stageTimes = false, points = false, teamRows = false } = {}) {
  const rows = [];
  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    if (!authoritative(row)) continue;
    const { rank, irm } = numericRank(row, rankKey);
    if (!rank && !irm) continue;
    const bib = teamRows ? null : bibOf(row);
    const riderDisplay = teamRows ? teamName(row.klubi) : (clean(row.nimi) || (bib ? `#${bib}` : 'N/A'));
    if (!riderDisplay) continue;
    const absolute = normalizeTime(row.aeg);
    const gap = normalizeGap(row.aeg_voi_kaotus);
    const pointValue = /^-?\d+$/.test(clean(row.punktid)) ? Number(row.punktid) : null;
    rows.push({
      rank, rankText: rank ? String(rank) : irm, bib, riderDisplay,
      teamName: teamRows ? riderDisplay : (clean(row.klubi) || null),
      nationality: teamRows ? null : (clean(row.country_code) || null),
      resultValue: points && pointValue != null ? String(pointValue) : (clean(row.aeg_voi_kaotus) || clean(row.aeg) || null),
      timeText: irm || !timed ? null : (stageTimes ? absolute : (rank === 1 ? absolute : null)),
      gapText: irm || !timed || stageTimes || rank === 1 ? null : gap,
      points: points ? pointValue : null,
      irm,
    });
  }
  return rows;
}

const TYPE_MAP = {
  overall_ranking: { classKind: 'gc', timed: true, eventName: 'Stage General Classification' },
  young: { classKind: 'youth', timed: true, eventName: 'Youth Classification' },
  team: { classKind: 'teams', timed: true, teamRows: true, eventName: 'Teams Classification' },
  activity_points: { classKind: 'points', points: true, eventName: 'Points Classification' },
  mountain_king: { classKind: 'kom', points: true, eventName: 'Mountain Classification' },
};

function classification(code, distanceId, spec, sourceRows, scope, final = false) {
  const rows = mapRows(sourceRows, { ...spec, rankKey: 'arvestuse_koht' });
  if (!rows.some((row) => row.rank === 1 && !row.irm)) return null;
  const finalNames = { gc: 'General Classification', points: 'Points Classification', kom: 'Mountain Classification', youth: 'Youth Classification', teams: 'Teams Classification' };
  const finalScope = final ? 'stage' : scope;
  const classKind = spec.classKind;
  return {
    eventId: synthEventId(code, final ? FINAL_SLOT : distanceId, classKind, finalScope),
    classKind, scope: finalScope,
    eventName: final ? finalNames[classKind] : `${scope === 'overall' ? 'Overall ' : ''}${spec.eventName}`,
    isTeamEvent: !!spec.teamRows,
    winnerName: rows.find((row) => row.rank === 1)?.riderDisplay || null,
    rowCount: rows.length,
    rows,
  };
}

export function stagesFromPayload(payload, { code, onlyStage = null, totalStages = null } = {}) {
  const eventCode = parseCode(code);
  const groups = (payload?.groups || []).filter((group) => clean(group?.distance_id) && clean(group.distance_id) !== 'overall');
  const identities = new Map(groups.map((group, index) => [clean(group.distance_id), parseStageIdentity(group.distance_name, index)]));
  const maxStage = totalStages == null ? null : Number(totalStages);
  const stages = [];
  let finalSource = null;

  for (const group of groups) {
    const distanceId = clean(group.distance_id);
    const identity = identities.get(distanceId);
    if (onlyStage != null && identity.stageNumber !== Number(onlyStage)) continue;
    const isLast = maxStage != null && identity.stageNumber === maxStage;
    const classifications = [];
    const teamStageSource = (payload?.classifications || []).find((item) =>
      clean(item.distance_id) === distanceId && item.type === 'team' && clean(item.scope) !== 'overall');
    const isTtt = isTeamTimeTrial(group, teamStageSource);
    const stageRows = isTtt
      ? mapTttRows(group.rows, teamStageSource)
      : mapRows(group.rows, { timed: true, stageTimes: true });
    if (stageRows.some((row) => row.rank === 1 && !row.irm)) {
      const winningTeam = isTtt
        ? teamName((teamStageSource?.rows || []).find((row) => parsePlace(row.arvestuse_koht).rank === 1)?.klubi)
        : null;
      classifications.push({
        eventId: synthEventId(eventCode, distanceId, 'stage', 'stage'), classKind: 'stage', scope: 'stage',
        eventName: 'Stage Classification', isTeamEvent: false,
        winnerName: winningTeam || stageRows.find((row) => row.rank === 1)?.riderDisplay || null,
        rowCount: stageRows.length, rows: stageRows,
      });
    }

    const cumulative = [];
    for (const item of payload?.classifications || []) {
      if (clean(item.distance_id) !== distanceId || !TYPE_MAP[item.type]) continue;
      const scope = clean(item.scope) === 'overall' ? 'overall' : 'stage';
      const built = classification(eventCode, distanceId, TYPE_MAP[item.type], item.rows, scope, false);
      if (!built) continue;
      if (scope === 'overall') cumulative.push({ item, spec: TYPE_MAP[item.type] });
      if (!(isLast && scope === 'overall')) classifications.push(built);
    }

    if (classifications.length) {
      stages.push({
        uciRaceId: synthRaceId(eventCode, distanceId),
        stageNumber: identity.stageNumber,
        sectorIndex: identity.sectorIndex,
        stageName: clean(group.distance_name) || `Stage ${identity.stageNumber}`,
        isFinalClassification: false,
        dateKey: clean(group.distance_date) || null,
        raceType: isTtt ? 'TTT' : (identity.stageNumber === 0 ? 'ITT' : null),
        startLocation: null,
        sourcePdfUrl: officialPdfUrl(eventCode, distanceId),
        classificationCount: classifications.length,
        classifications,
      });
    }
    if (isLast && cumulative.length) finalSource = { group, cumulative };
  }

  if (finalSource) {
    const classifications = finalSource.cumulative
      .map(({ item, spec }) => classification(eventCode, FINAL_SLOT, spec, item.rows, 'stage', true))
      .filter(Boolean);
    if (classifications.length) {
      stages.push({
        uciRaceId: synthRaceId(eventCode, FINAL_SLOT), stageNumber: null,
        stageName: 'Final Classification', isFinalClassification: true,
        dateKey: clean(finalSource.group.distance_date) || null, raceType: null, startLocation: null,
        sourcePdfUrl: officialPdfUrl(eventCode), classificationCount: classifications.length, classifications,
      });
    }
  }
  return stages;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.json();
}

async function main() {
  const code = parseCode(CODE);
  if (has('--suggest-id')) { process.stdout.write(`${suggestCompetitionId(code)}\n`); return; }
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Falta --competition-id (o usa --suggest-id)');
  const payload = FIXTURE ? JSON.parse(readFileSync(resolve(FIXTURE), 'utf8')) : await fetchJson(endpoint(code));
  if (!payload?.ok) throw new Error(`timing.ee devolvió ok=false para event=${code}`);
  const stages = stagesFromPayload(payload, { code, onlyStage: ONLY_STAGE, totalStages: TOTAL_STAGES });
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: RESULTS_SOURCE, timingCode: code, fetchedAt: new Date().toISOString(), stageCount: stages.length, stages };
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(file, JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`FATAL: ${error.stack || error.message}\n`); process.exit(1); });
}
