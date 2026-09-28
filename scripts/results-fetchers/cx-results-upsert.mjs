#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cxDateInSeason } from '../../js/cx/season.js';
import { cxDataRideSeconds, cxNaturalRiderDisplay, splitCxDisplayName } from './cx-dataride-results.mjs';

import {resolveCxResultIdentity} from '../../js/cx/result-identity.js';
export {resolveCxResultIdentity} from '../../js/cx/result-identity.js';

const CATEGORIES = ['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ'];
const STATES = new Set(['DNS', 'DNF', 'LAP', 'DSQ', 'OTL', 'ABD']);
const text = value => value == null || String(value).trim() === '' ? null : String(value).trim();
function httpUrl(value, optional = false) {
  if (!value && optional) return null;
  const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Fuente http/https requerida');
  return parsed.href;
}
function seconds(value) {
  const source = text(value); if (!source) return null;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Segundos no representables sin pérdida');
  const parsed = /^\d+$/.test(source) ? BigInt(source) : cxDataRideSeconds(source);
  if (parsed == null || BigInt(parsed) > 9223372036854775807n) throw new Error('Segundos inválidos');
  return String(parsed);
}
function points(value, fallback = null) {
  const source = text(value); if (!source) return fallback;
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('Puntos no representables sin pérdida');
  if (!/^-?\d+(\.\d{1,12})?$/.test(source)) throw new Error('Puntos inválidos'); return source;
}
function birthDate(value) {
  const source = text(value);
  if (!source || !/^\d{4}-\d{2}-\d{2}$/.test(source)) return null;
  const parsed = new Date(`${source}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== source) return null;
  return source >= '1900-01-01' && source <= new Date().toISOString().slice(0, 10) ? source : null;
}


/** Preparación sin efectos. context procede del catálogo CX, nunca de carretera. */
export function prepareCxResults(document, context, { status = 'provisional', category = null, officialUciResults = false } = {}) {
  if (document?.schemaVersion !== 1 || document.disciplineId !== 3 || !['dataride', 'pdf', 'manual'].includes(document.source)
    || !Array.isArray(document.categories) || !['pending', 'provisional', 'official'].includes(status)
    || category != null && !CATEGORIES.includes(category)
    || officialUciResults && (document.source !== 'dataride' || status !== 'official')) throw new Error('Contrato CX, categoría, fuente o estado inválidos');
  const race = context?.race;
  if (!race || !Array.isArray(context.categories) || !context.riders
    || race.editorialStatus !== 'published' || race.isCancelled || !cxDateInSeason(race.seasonKey, race.dateKey)
    || !cxDateInSeason(race.seasonKey, race.endDateKey || race.dateKey)) throw new Error('Carrera CX no disponible en agosto–febrero');
  const dataride = document.source === 'dataride';
  const link = context.link;
  if(dataride&&document.seasonKey!=null&&document.seasonKey!==race.seasonKey)throw new Error('Edición DataRide CX distinta de la carrera propia');
  if (dataride && (!link || link.raceId !== race.id || link.disciplineId !== 3 || !Number.isSafeInteger(link.seasonId) || link.seasonId<=0 || link.competitionId !== document.competitionId
    || document.seasonId != null && link.seasonId !== document.seasonId)) throw new Error('Correspondencia DataRide no verificada en cx_race_uci_links');
  if (!dataride && (document.raceId !== race.id || document.seasonKey !== race.seasonKey)) throw new Error('Documento manual de otra carrera/temporada');
  const prepared = { raceId: race.id, seasonKey: race.seasonKey, source: document.source, status, imports: [], skipped: [], warnings: [] };
  const seen = new Set();
  for (const source of document.categories) {
    if (!CATEGORIES.includes(source.category) || seen.has(source.category)) throw new Error('Categoría no reconocida o duplicada');
    seen.add(source.category); if (category && source.category !== category) continue;
    const manga = context.categories.find(item => item.category === source.category && item.raceId === race.id);
    if (!manga) { prepared.skipped.push({ category: source.category, reason: 'Manga no presente en el calendario propio' }); continue; }
    if (manga.isCancelled) { prepared.skipped.push({ category: source.category, reason: 'Manga cancelada' }); continue; }
    if (manga.resultsLockedAt) { prepared.skipped.push({ category: source.category, reason: 'Resultados bloqueados por revisión administrativa' }); continue; }
    const dateKey = manga.dateKey || race.dateKey;
    if (!cxDateInSeason(race.seasonKey, dateKey) || dateKey < race.dateKey || dateKey > (race.endDateKey || race.dateKey)
      || source.dateKey !== dateKey || !Array.isArray(source.rows)) throw new Error('Fecha civil de manga o filas sin correspondencia');
    if (dataride && (link.uciRaceId > 0 && link.uciRaceId !== source.uciRaceId || !Number.isSafeInteger(source.uciRaceId) || source.uciRaceId <= 0)) {
      throw new Error('Race ID de DataRide no corresponde al enlace verificado');
    }
    if (dataride && source.publicationHint === 'not_published') { prepared.skipped.push({ category: source.category, reason: 'DataRide todavía no publica puestos/estados' }); continue; }
    const evidence = { fetchedAt: document.fetchedAt, ...document.evidence, ...source.evidence, inputSource: document.source, seasonKey: race.seasonKey, dateKey,
      sourceUrl: httpUrl(source.evidence?.sourceUrl || document.evidence?.sourceUrl) };
    if (officialUciResults) {
      evidence.officialReviewed = true;
      evidence.officialReviewSourceUrl = evidence.sourceUrl;
    }
    if (status === 'official' && (evidence.officialReviewed !== true || !evidence.officialReviewSourceUrl)) throw new Error('Oficialización sin revisión explícita y fuente oficial');
    if (evidence.officialReviewSourceUrl) evidence.officialReviewSourceUrl = httpUrl(evidence.officialReviewSourceUrl);
    for (const key of ['bonusSourceUrl', 'adjustmentSourceUrl', 'categoryClassificationSourceUrl']) if (evidence[key]) evidence[key] = httpUrl(evidence[key]);
    if (dataride) evidence.dataRide = { disciplineId: 3, competitionId: document.competitionId, seasonId: link.seasonId,
      uciRaceId: source.uciRaceId, eventId: source.eventId };
    const riders = context.riders[source.category.startsWith('M') ? 'men' : 'women'];
    if (!Array.isArray(riders)) throw new Error('Catálogo CX del género incompleto');
    const rows = []; const identities = new Set(); const bibs = new Set(); const ranks = new Set();
    for (let index = 0; index < source.rows.length; index++) {
      const raw = source.rows[index];
      if (raw.sourceConflict) throw new Error(`Fila ${index + 1}: ${raw.sourceConflict}`);
      const firstName = text(raw.firstName);
      const lastName = text(raw.lastName);
      const parsedDisplay = firstName && lastName ? { firstName, lastName } : splitCxDisplayName(raw.riderDisplay);
      const canonicalFirstName = firstName || parsedDisplay.firstName;
      const canonicalLastName = lastName || parsedDisplay.lastName;
      const row = { rank: text(raw.rank) == null ? null : Number(raw.rank), rankText: text(raw.rankText), bib: text(raw.bib),
        riderDisplay: cxNaturalRiderDisplay(canonicalFirstName, canonicalLastName, raw.riderDisplay),
        firstName: canonicalFirstName, lastName: canonicalLastName,
        globalRiderId: text(raw.globalRiderId), teamName: text(raw.teamName), isoCode2: text(raw.isoCode2 || raw.countryCode)?.toUpperCase() || null,
        timeText: text(raw.timeText), gapText: text(raw.gapText), timeSeconds: seconds(raw.timeSeconds), bonusSeconds: seconds(raw.bonusSeconds),
        bonusPoints: points(raw.bonusPoints, '0'), points: dataride ? null : points(raw.points),
        birthDate: birthDate(raw.birthDate), irm: text(raw.irm)?.toUpperCase() || null };
      if (row.rank == null && !row.irm && dataride && status === 'provisional') {
        prepared.warnings.push({ category: source.category, sourceRow: index, reason: 'Fila todavía sin puesto/estado; no importada' }); continue;
      }
      if (!row.riderDisplay || row.rank != null && (!Number.isSafeInteger(row.rank) || row.rank <= 0 || ranks.has(row.rank))
        || row.irm && !STATES.has(row.irm) || !row.rank && !row.irm || row.irm && row.irm !== 'LAP' && row.rank != null
        || row.isoCode2 && !/^[A-Z]{2}$/.test(row.isoCode2)) throw new Error(`Fila ${index + 1}: nombre, puesto, estado o país inválidos`);
      if (row.rank != null) ranks.add(row.rank);
      if (row.bonusSeconds != null && BigInt(row.bonusSeconds) > 2147483647n) throw new Error('Bono en segundos fuera del rango INTEGER');
      if (row.bonusSeconds != null && !evidence.bonusSourceUrl || Number(row.bonusPoints) !== 0 && (!evidence.adjustmentSourceUrl || !text(evidence.adjustmentReason))) throw new Error('Bono/ajuste sin evidencia oficial');
      const resolved = resolveCxResultIdentity(row, riders); row.globalRiderId = resolved.id;
      if (resolved.id && identities.has(resolved.id) || row.bib && bibs.has(row.bib)) throw new Error('Ficha CX o dorsal duplicados');
      if (resolved.id) identities.add(resolved.id); if (row.bib) bibs.add(row.bib);
      if (resolved.reason !== 'verified_name' && resolved.reason !== 'explicit') prepared.warnings.push({ category: source.category, sourceRow: index,
        riderDisplay: row.riderDisplay, reason: resolved.reason, candidates: resolved.candidates });
      // El tiempo de un retirado es parcial aunque la fuente incluya una cifra.
      if (row.irm && row.timeSeconds != null) throw new Error('Un IRM no aporta tiempo real de meta; conservar solo el texto original');
      rows.push(row);
    }
    if (!rows.length && status !== 'pending') { prepared.skipped.push({ category: source.category, reason: 'No hay resultados publicables' }); continue; }
    evidence.sourceResultIds = source.rows.filter(row => row.rank || row.irm).map(row => row.sourceResultId).filter(Boolean);
    evidence.identityEvidence = rows.filter(row => row.globalRiderId).map(row => {
      const rider = riders.find(rider => rider.id === row.globalRiderId);
      return Object.fromEntries(['id', 'firstName', 'lastName', 'nationality', 'birthDate', 'verified'].map(key => [key, rider[key] ?? null]));
    });
    prepared.imports.push({ category: source.category, rows, evidence });
  }
  if (category && !seen.has(category)) throw new Error('Categoría solicitada ausente en el documento');
  return prepared;
}

const sqlString = value => `'${String(value).replace(/'/g, "''")}'`;
export function emitCxResultsSql(prepared) {
  return ['BEGIN;', ...prepared.imports.map(manga => `SELECT public.cx_ingest_results(${sqlString(prepared.raceId)},${sqlString(manga.category)},` +
    `${sqlString(JSON.stringify(manga.rows))}::jsonb,${sqlString(prepared.status)},${sqlString(JSON.stringify(manga.evidence))}::jsonb);`), 'COMMIT;', ''].join('\n');
}
export async function applyCxResults(client, prepared) {
  const result = [];
  await client.query('BEGIN');
  try {
    for (const manga of prepared.imports) {
      const { rows: [{ imported }] } = await client.query('SELECT public.cx_ingest_results($1,$2,$3::jsonb,$4,$5::jsonb) AS imported',
        [prepared.raceId, manga.category, JSON.stringify(manga.rows), prepared.status, JSON.stringify(manga.evidence)]);
      result.push(imported);
    }
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function loadCxResultsContext(client, raceId) {
  const { rows } = await client.query(`SELECT jsonb_build_object('race',to_jsonb(r),
    'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('resultsLastFetchAt',s."lastFetchAt") ORDER BY c.category),'[]')
      FROM public.cx_race_categories c LEFT JOIN private.cx_results_fetch_state s ON s."raceId"=c."raceId" AND s.category=c.category
      WHERE c."raceId"=r.id),
    'link',(SELECT to_jsonb(l) FROM public.cx_race_uci_links l WHERE l."raceId"=r.id),
    'riders',jsonb_build_object('men',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM
      (SELECT id,"firstName","lastName","otherNames",nationality,"birthDate","birthDatePrecision",verified FROM public.cx_riders_men) m),
    'women',(SELECT coalesce(jsonb_agg(to_jsonb(w)),'[]') FROM
      (SELECT id,"firstName","lastName","otherNames",nationality,"birthDate","birthDatePrecision",verified FROM public.cx_riders_women) w))) AS context
    FROM public.cx_races r WHERE r.id=$1`, [raceId]);
  const context = rows[0]?.context;
  if (!context) throw new Error('Carrera CX no encontrada'); return context;
}
function options(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--apply') args.apply = true;
    else if (['--input', '--context', '--race-id', '--status', '--category', '--emit-sql'].includes(flag)) {
      const value = argv[++index]; if (!value || value.startsWith('--')) throw new Error(`Falta valor de ${flag}`); args[flag.slice(2)] = value;
    } else throw new Error(`Opción desconocida: ${flag}`);
  }
  if (!args.input || !args['race-id'] || args.apply && (args['emit-sql'] || args.context)) throw new Error('Usar --input/--race-id; --context es solo para preparar SQL sin aplicar');
  return args;
}
async function main() {
  const args = options(process.argv.slice(2)); const document = JSON.parse(await readFile(args.input, 'utf8'));
  let context; let client;
  try {
    if (args.context) context = JSON.parse(await readFile(args.context, 'utf8'));
    if (args.apply || !context) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requerido por el runtime; el agente usa --context obtenido por MCP');
      const { default: pg } = await import('pg'); client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
      context ??= await loadCxResultsContext(client, args['race-id']);
    }
    if (context.race?.id !== args['race-id']) throw new Error('El contexto pertenece a otra carrera CX');
    const prepared = prepareCxResults(document, context, { status: args.status || 'provisional', category: args.category || null });
    if (args.apply) process.stdout.write(JSON.stringify({ ...prepared, applied: await applyCxResults(client, prepared) }, null, 2) + '\n');
    else {
      const sql = emitCxResultsSql(prepared); if (args['emit-sql']) await writeFile(args['emit-sql'], sql); else process.stdout.write(sql);
      process.stderr.write(JSON.stringify({ imports: prepared.imports.map(manga => ({ category: manga.category, rows: manga.rows.length })), skipped: prepared.skipped, warnings: prepared.warnings }) + '\n');
    }
  } finally { if (client) await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
