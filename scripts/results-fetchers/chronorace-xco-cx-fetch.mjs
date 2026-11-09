#!/usr/bin/env node
/**
 * Chronorace, visor UCI «xco» → documento de resultados CX (contrato de cx-results-upsert.mjs).
 *
 * Chronorace cronometra los Campeonatos de Europa UEC de ciclocross con su visor UCI
 * (`prod.chronorace.be/angular/results.html#/uci/event/<ctx>`), distinto del de ACN Timing
 * que lee acn-cx-fetch.mjs: el evento se identifica solo por el contexto (`20261107_uec`),
 * abarca varios días y el árbol no tiene tablas `result`, solo «Live Timing» y PDF.
 *
 *   GET results.chronorace.be/api/results/generic/uci/<ctx>/dh?key=cms   árbol CRO → CGnn (ME…WJ) → Live Timing / PDF
 *   GET prod.chronorace.be/api/results/xco/<ctx>/overview/<CAT>          estado de la manga, puestos y vueltas (ms)
 *   GET prod.chronorace.be/api/results/xco/<ctx>/registration/<CAT>      dorsal → nombre, país COI, UCI ID
 *
 *   node scripts/results-fetchers/chronorace-xco-cx-fetch.mjs --url <visor o ctx> \
 *     --race-id <cxRaceId> --season-key 2026-27 --timezone Europe/Amsterdam \
 *     [--date 2026-11-07] [--only WJ,MU] [--out doc.json]
 *
 * Solo emite las mangas con `Status=Finished` y `AllPassed`, con `officialReviewed` (Chronorace es el
 * cronometraje oficial del campeonato); las demás quedan en `skipped`.
 * La fecha civil de cada manga sale de `RaceStartDateTime` en `--timezone` (la zona de la
 * carrera); `--date` limita el documento a las mangas de ese día. El puesto y el estado son
 * los del cronometrador, sin reordenar: tiempos truncados al segundo, como el PDF oficial;
 * `R80` (retirado por la regla del 80 %) conserva su puesto como `-n LAP`, con n = vueltas de
 * la manga menos la vuelta en curso al retirarlo. El dorsal oficial es el del visor sin el
 * prefijo de millar de la categoría (1002 → 2). No resuelve fichas: conserva la grafía.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { countryCode } from '../uci-catalog/countries.mjs';
import { cxNaturalRiderDisplay } from './cx-dataride-results.mjs';
import { acnSplitName, clean } from './acn-cx-fetch.mjs';

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const TREE_API = 'https://results.chronorace.be/api/results/generic/uci/';
const XCO_API = 'https://prod.chronorace.be/api/results/xco/';
const VIEWER = 'https://prod.chronorace.be/angular/results.html#/uci/event/';
const XCO_ROUTE = 'uci.event.discipline.category.xco';
const CATEGORIES = new Set(['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ']);
const STATES = new Set(['DNF', 'DNS', 'DSQ', 'ABD', 'OTL']);

/** Contexto Chronorace desde la URL del visor UCI o el propio contexto (`20261107_uec`). */
export function chronoraceXcoContext(value) {
  const text = clean(value);
  const ctx = /#\/uci\/event\/([^/?#]+)/.exec(text)?.[1] || (/^\d{8}_[a-z0-9]+$/i.test(text) ? text : null);
  if (!ctx) throw new Error(`URL o contexto de Chronorace no reconocido: ${text}`);
  return ctx;
}

/** Mangas del árbol: nodo «Live Timing» con ruta xco y clave de categoría CX, más el PDF de resultados. */
export function chronoraceXcoCategories(tree) {
  const found = [];
  const walk = (node, path) => {
    for (const child of node?.Childs || []) {
      if (child.Type === 'Folder' && child.Route) {
        let route = null;
        try { route = JSON.parse(child.Route); } catch { /* ruta de otro tipo */ }
        const key = route?.Params?.key;
        if (route?.Route === XCO_ROUTE && CATEGORIES.has(key)) {
          if (found.some(item => item.category === key)) throw new Error(`Categoría ${key} repetida en el árbol de Chronorace`);
          const pdf = (node.Childs || []).find(item => item.Type === 'File' && /^individual results$/i.test(clean(item.Name)) && item.Link);
          found.push({ category: key, path: path.slice(0, 2), name: clean(node.DisplayName) || null, resultsPdfUrl: pdf?.Link || null });
        }
        continue;
      }
      walk(child, child.Type === 'Folder' ? [...path, child.Id] : path);
    }
  };
  walk(tree, []);
  return found;
}

const hms = total => `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const gapText = total => total >= 3600 ? `+${hms(total)}` : `+${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

/**
 * `overview` + `registration` de una manga terminada → `{ rows, renumbered }` del contrato CX.
 * El directo no renumera tras una descalificación (el PDF oficial sí): los huecos de puesto
 * solo se cierran si hay tantas descalificaciones como huecos y el líder sigue clasificado.
 */
export function parseChronoraceXco({ overview, registration }) {
  const source = overview?.OverviewData;
  const maxLaps = Number(overview?.MaxLaps);
  if (!Array.isArray(source) || !source.length || !registration || typeof registration !== 'object') throw new Error('Manga de Chronorace sin clasificación o sin inscritos');
  if (!Number.isInteger(maxLaps) || maxLaps <= 0) throw new Error('Manga de Chronorace sin número de vueltas');
  const prefixes = new Set(source.map(item => Math.floor(Number(item.Dossard) / 1000)));
  const stripPrefix = prefixes.size === 1 && !prefixes.has(0);
  const parsed = source.map((item, sourceRow) => {
    const label = `Fila ${sourceRow + 1}`;
    const rider = registration[String(item.Dossard)];
    if (!rider) throw new Error(`${label}: dorsal ${item.Dossard} sin inscripción`);
    const sourceName = clean(rider.Nom);
    const { firstName, lastName } = acnSplitName(sourceName);
    const noc = clean(rider.Pays).toUpperCase() || null;
    const license = clean(rider.RiderId);
    const base = { bib: String(stripPrefix ? Number(item.Dossard) % 1000 : item.Dossard), riderDisplay: cxNaturalRiderDisplay(firstName, lastName, sourceName),
      firstName, lastName, sourceName, teamName: clean(rider.Team) || null, isoCode2: countryCode(noc)?.toUpperCase() || null, nationalityCode: noc,
      uciLicenseId: /^\d{11}$/.test(license) ? license : null, bonusSeconds: null, sourceSortOrder: sourceRow };
    const status = clean(item.Status).toUpperCase();
    if (status === 'OK') {
      if (!Number.isInteger(item.Pos) || clean(item.StrPos) !== `${item.Pos}.`) throw new Error(`${label}: puesto ${item.StrPos} no corresponde a ${item.Pos}`);
      const finish = (item.LapDetails || []).find(lap => lap.LapNr === maxLaps);
      if (!Number.isFinite(finish?.TotalTime) || finish.TotalTime <= 0) throw new Error(`${label}: clasificado sin paso por meta en la vuelta ${maxLaps}`);
      return { label, base, status, sourceRank: item.Pos, seconds: Math.floor(finish.TotalTime / 1000), gapMs: finish.GapWithLeader };
    }
    if (status === 'R80') {
      const lapsDown = maxLaps - Number(item.CurrentSituation?.Lap);
      if (!Number.isInteger(item.Pos) || !Number.isInteger(lapsDown) || lapsDown <= 0 || lapsDown > maxLaps) {
        throw new Error(`${label}: retirado por el 80 % sin puesto o vuelta en curso`);
      }
      return { label, base, status, sourceRank: item.Pos, lapsDown };
    }
    if (STATES.has(status)) return { label, base, status };
    throw new Error(`${label}: estado de Chronorace no reconocido «${item.Status}»`);
  });

  const ranked = parsed.filter(item => item.sourceRank != null);
  if (ranked.some((item, position) => position && item.sourceRank <= ranked[position - 1].sourceRank)) throw new Error('Puestos de Chronorace repetidos o desordenados');
  const firstLapped = ranked.findIndex(item => item.status === 'R80');
  if (firstLapped >= 0 && ranked.slice(firstLapped).some(item => item.status !== 'R80')) throw new Error('Clasificado con tiempo detrás de un doblado');
  const gaps = ranked.length ? ranked[ranked.length - 1].sourceRank - ranked.length : 0;
  const disqualified = parsed.filter(item => item.status === 'DSQ').length;
  if (gaps && (gaps > disqualified || ranked[0].sourceRank !== 1)) throw new Error('Puestos de Chronorace no consecutivos sin descalificaciones que los expliquen');
  const leader = ranked[0]?.status === 'OK' ? ranked[0].seconds : null;
  if (ranked.length && leader == null) throw new Error('La clasificación de Chronorace no tiene ganador con tiempo');
  const renumbered = [];
  const rows = parsed.map(item => {
    if (item.sourceRank == null) return { ...item.base, rank: null, rankText: item.status, irm: item.status, gapText: null, timeText: null, timeSeconds: null };
    const rank = ranked.indexOf(item) + 1;
    if (rank !== item.sourceRank) renumbered.push({ bib: item.base.bib, sourceRank: item.sourceRank, rank });
    if (item.status === 'R80') return { ...item.base, rank, rankText: String(rank), irm: 'LAP', gapText: `-${item.lapsDown} LAP`, timeText: null, timeSeconds: null };
    const delta = item.seconds - leader;
    if (delta < 0 || (Number.isFinite(item.gapMs) && item.gapMs !== delta * 1000)) {
      throw new Error(`${item.label}: diferencia con el líder ${item.gapMs} ms no corresponde al tiempo ${hms(item.seconds)}`);
    }
    return { ...item.base, rank, rankText: String(rank), irm: null, timeText: hms(item.seconds), timeSeconds: String(item.seconds),
      gapText: rank === 1 ? null : gapText(delta) };
  });
  return { rows, renumbered };
}

const localDate = (iso, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** `source='chronorace_xco'` es la fuente del worker: la ingesta acredita `evidence.chronoraceXco` con el enlace. */
export function buildChronoraceXcoDocument({ ctx, eventName, mangas, raceId, seasonKey, timezone, date = null, sourceUrl, source = 'manual' }) {
  const categories = []; const skipped = [];
  for (const { category, path, name, resultsPdfUrl, overview, registration } of mangas) {
    if (!overview || !registration) { skipped.push({ category, reason: 'Chronorace aún no publica la manga' }); continue; }
    if (overview.Status !== 'Finished' || overview.AllPassed !== true) {
      skipped.push({ category, reason: `Manga sin terminar en Chronorace (${overview.Status || 'sin estado'})` }); continue;
    }
    if (!Number.isFinite(Date.parse(overview.RaceStartDateTime))) throw new Error(`${category}: manga sin hora de salida`);
    const dateKey = localDate(overview.RaceStartDateTime, timezone);
    if (date && dateKey !== date) { skipped.push({ category, reason: `Manga del ${dateKey}` }); continue; }
    const { rows, renumbered } = parseChronoraceXco({ overview, registration });
    const viewerUrl = `${VIEWER}${ctx}/${path.join('/')}/xco/${category}/ov`;
    // Chronorace es el cronometraje oficial del campeonato: la manga terminada es la clasificación oficial.
    categories.push({ category, dateKey, sourceKey: category, sourceGroup: name,
      evidence: { sourceUrl: viewerUrl, officialReviewed: true, officialReviewSourceUrl: viewerUrl, chronoraceXco: { ctx, category },
        raceStartDateTime: overview.RaceStartDateTime,
        ...(resultsPdfUrl ? { resultsPdfUrl } : {}),
        ...(renumbered.length ? { renumberedAfterDsq: { rows: renumbered.length, fromSourceRank: renumbered[0].sourceRank } } : {}) },
      sourceUpdatedAt: overview.GeneratedDateTime || null, rows });
  }
  return { schemaVersion: 1, source, disciplineId: 3, raceId, seasonKey, fetchedAt: new Date().toISOString(),
    evidence: { sourceUrl, timer: 'chronorace-xco', ctx, eventName: clean(eventName) || null }, categories, skipped };
}

const getJson = async url => {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return response.json();
};

/** `fetchJson` (URL → JSON o null con 204) se sustituye en las pruebas del worker. */
export async function fetchChronoraceXcoCx({ url, raceId, seasonKey, timezone, date = null, only = null, source = 'manual', fetchJson = getJson }) {
  const ctx = chronoraceXcoContext(url);
  const tree = await fetchJson(`${TREE_API}${encodeURIComponent(ctx)}/dh?key=cms`);
  const wanted = only ? new Set(only) : null;
  // El contexto aparece en Chronorace con las listas de salida: hasta entonces, las mangas
  // pedidas quedan pendientes, sin error (el worker consulta todo el día de carrera sin horario).
  if (!tree) {
    if (!wanted) throw new Error(`Chronorace no publica el contexto ${ctx}`);
    return buildChronoraceXcoDocument({ ctx, eventName: null, mangas: [...wanted].map(category => ({ category, path: [], name: null })),
      raceId, seasonKey, timezone, date, source, sourceUrl: `${VIEWER}${ctx}` });
  }
  const mangas = [];
  for (const item of chronoraceXcoCategories(tree)) {
    if (wanted && !wanted.has(item.category)) continue;
    const base = `${XCO_API}${encodeURIComponent(ctx)}`;
    const overview = await fetchJson(`${base}/overview/${item.category}`);
    const registration = overview ? await fetchJson(`${base}/registration/${item.category}`) : null;
    mangas.push({ ...item, overview, registration });
  }
  if (!mangas.length) throw new Error(`El contexto ${ctx} no tiene mangas CX con live timing${wanted ? ' entre las pedidas' : ''}`);
  return buildChronoraceXcoDocument({ ctx, eventName: tree.DisplayName, mangas, raceId, seasonKey, timezone, date, source,
    sourceUrl: `${VIEWER}${ctx}` });
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index].startsWith('--') || argv[index + 1] == null) throw new Error(`Argumento inválido: ${argv[index]}`);
    out[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ['url', 'race-id', 'season-key', 'timezone']) if (!out[key]) throw new Error(`Falta --${key}`);
  localDate(new Date().toISOString(), out.timezone);
  if (out.date && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) throw new Error('--date debe ser AAAA-MM-DD');
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));
  const document = await fetchChronoraceXcoCx({ url: options.url, raceId: options['race-id'], seasonKey: options['season-key'],
    timezone: options.timezone, date: options.date || null, only: options.only ? options.only.split(',').map(clean) : null });
  const json = JSON.stringify(document, null, 2);
  if (options.out) writeFileSync(options.out, json); else process.stdout.write(json + '\n');
  process.stderr.write(JSON.stringify({ categories: document.categories.map(c => ({ category: c.category, dateKey: c.dateKey, rows: c.rows.length })),
    skipped: document.skipped }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
