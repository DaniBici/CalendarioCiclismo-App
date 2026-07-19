#!/usr/bin/env node
/**
 * livetiming-results-fetch.mjs — FETCHER de resultados desde LIVETIMING.AT
 * (livetiming.at), el cronometrador austriaco (LIDL Tour of Austria y otras
 * pruebas de Austria). Expone dos endpoints JSON PÚBLICOS SIN AUTH, accesibles
 * por curl/Node, que publican EN VIVO durante la etapa y validan minutos tras
 * meta — patrón calcado de tissot/matsport/raceresult/sts/domtel, AUTOMÁTICO en
 * el cron.
 *
 * EMITE EXACTAMENTE EL MISMO JSON que uci-results-fetch.mjs → el upsert
 * (uci-results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source ('uci'|'tissot'|'pdf'|'matsport'|'sportstiming'|
 * 'manual_timing'|'raceresult'|'sts'|'domtel'|'livetiming', migración 119) vía
 * uci-results-cron.mjs.
 *
 * MODELO DE V_ID (clave). En livetiming.at un `V_ID` identifica UN DÍA de
 * cronometraje, con formato AAMMDD (260708 = 2026-07-08). En una carrera por
 * etapas, CADA ETAPA es un V_ID DISTINTO (etapa 1 = 260708, etapa 2 = 260709…),
 * uno por día. Un mismo V_ID puede agrupar varias carreras (varias categorías el
 * mismo día, cada una un elemento de `Rennen`); para una vuelta profesional el
 * V_ID del día trae UN `Rennen` (la etapa élite, con has_Tour=1).
 *   → livetimingCode (migración 119) = el V_ID de la ETAPA 1 (base). Este fetcher
 *     DERIVA los V_ID de las etapas siguientes SUMANDO DÍAS a la fecha del base
 *     (260708 → 260709 → 260710…) hasta cubrir --total-stages etapas (el cron le
 *     pasa max(stageNumber) de race_days). Un día derivado que no exista, no tenga
 *     Rennen con has_Tour, o sea de otra carrera, se OMITE (no rompe la cadena:
 *     probamos todos los días del rango). Esto asume "una etapa por día natural";
 *     si una edición mete dos sectores el mismo día bajo V_IDs distintos, habría
 *     que enumerar los V_ID a mano (ver --vids).
 *
 * ENDPOINTS (sin auth):
 *   GET  live_links.php?V_ID=<vid>            → metadatos del día: `Rennen[]`
 *        (carreras del día: Name "1. Etappe …", Veranstaltung, Renndatum,
 *        has_Tour, isMZF=CRE, kategorien, TRennID), Gruppen, Points, Decoder.
 *   POST live_data_all.php  (body V_ID=<vid>&lynx=1&tour=1)
 *        → clasificaciones del día en JSON YA ESTRUCTURADO (objetos, no arrays
 *        posicionales como race|result):
 *          · FF     = clasificación de ETAPA (photofinish).      [stage/stage]
 *          · GC     = GENERAL acumulada del tour hasta el día.   [gc/stage]
 *          · PT     = puntos (general).                          [points/overall]
 *          · GP     = montaña / GPM (general).                   [kom/overall]
 *          · YU     = jóvenes (general, sub-clas. de la GC).     [youth/overall→stage]
 *          · CLASS  = sub-clasificaciones intermedias (sprints SP, KOM por puerto,
 *                     Punktewertung, Aktivster Fahrer, Sonderwertung) → NO van a BD
 *                     (igual que en las demás fuentes: los sprints/KOM parciales no
 *                     son clasificaciones publicables). Se IGNORA por completo.
 *        El `&tour=1` es lo que hace GC/PT/GP/YU acumuladas del tour (sin él serían
 *        del día). FF/CLASS son siempre de la etapa.
 *
 * CONTRATO DE FILA (objeto). Verificado contra el LIDL Tour of Austria 2026
 * (V_ID 260708, etapa 1 Graz→Gamlitz) y varias etapas 2025:
 *   FF:  {Place, BIB, Name:"APELLIDO Nombre", Team:"XXX"(3-letras, se ignora),
 *         Time:"4:21:02"(abs de CADA corredor), Gap:"+[0:00:11]" | "-"(m.t.)}
 *   GC:  {markTime, Place, BIB, Name(*=sub23), Nat., Team, Time:"4:20:52"(abs rank1)
 *         | "+0:15" | "+25:57"(gap resto)}
 *   PT/GP: {…, Points:"15"}
 *   YU:  como GC (Time = tiempo).
 *   IRM: `Place` = "DNF"/"DNS"/"DSQ"/"OTL" (Time/Gap "-" en FF) → códigos UCI.
 *   El `*` inicial del nombre (sub23) se quita; el nombre YA viene "APELLIDO
 *   Nombre" (orden UCI) → no hace falta reordenar.
 *
 * RESOLUCIÓN: el corredor REAL se resuelve POR DORSAL (BIB) contra la startlist
 * curada (RPC 082); el nombre de la fila es solo fallback de display. El código de
 * equipo de 3 letras de livetiming NO se usa (el equipo sale de la startlist).
 *
 * ENCODING DE TIEMPOS/m.t. (clave — como STS/Wiclax): en FF, livetiming da el
 * tiempo ABSOLUTO de CADA corredor (`Time`), no solo del líder → se emite ese
 * absoluto en `timeText` para TODA fila clasificada y NUNCA `gapText`. Así la web
 * entra en su Caso A (`deriveGaps`) y pinta m.t. sola; mezclar gapText lo rompería.
 * En GC/YU, en cambio, livetiming da absoluto SOLO al rank 1 y gap al resto → ahí
 * sí se emite timeText(rank1)/gapText(resto), como UCI/Tissot.
 *
 * MAPEO clave → {classKind, scope}:
 *   FF → stage/stage · GC → gc/stage · PT → points/overall · GP → kom/overall
 *   YU → youth/overall (con &tour=1 es la general de jóvenes del tour, acumulada como
 *        PT/GP; scope='overall' también la hace visible en web — keepForWeb, mig. 092).
 *
 * ETAPAS y FINAL: cada V_ID es una etapa. Las generales (GC/PT/GP/YU) que trae el
 * día son las ACUMULADAS hasta ESA etapa → se adjuntan a la etapa de su V_ID
 * (livetiming NO da históricos: cada día trae su propia acumulada, correcta). Si
 * la etapa es la ÚLTIMA (stageNumber == totalStages) y la carrera ha terminado
 * (--event-over o auto-detección por total), las generales de esa última etapa son
 * las DEFINITIVAS → van TAMBIÉN a la pseudo-etapa "Final Classification"
 * (stageNumber NULL, isFinalClassification=true, scope='stage', quirk UCI 085),
 * además de colgar de la última etapa. Mismo criterio que Matsport/race|result.
 *
 * IDs SINTÉTICOS: livetiming no existe en DataRide → eventId/uciRaceId NEGATIVOS y
 *   deterministas (mismo esquema que Tissot/Matsport/PDF, salt propio "livetiming:"
 *   sobre el V_ID BASE): fnv1a("livetiming:"+baseVid)%200000 como base,
 *   eventId = -(base*10000 + slot*100 + idx). El competitionId del puente también
 *   es sintético negativo (-base). --suggest-id lo imprime.
 *
 * ⚠ CRE/TTT (isMZF=1): no se ha podido verificar el formato de fila de una crono
 *   por equipos en esta fuente (el Tour of Austria 2026 etapa 1 es en ruta). El
 *   fetcher marca raceType='TTT' cuando el Rennen trae isMZF=1 (para que la web/app
 *   colapse por equipos), pero VALIDAR el layout de filas antes de conmutar una
 *   carrera con CRE. CRI (crono individual): livetiming no expone un flag claro; se
 *   trata como etapa en ruta (tiempo absoluto de cada corredor, correcto para CRI).
 *
 * Uso (desde la raíz del repo; fetch nativo, sin deps):
 *   node scripts/results-fetchers/livetiming-results-fetch.mjs --vid 260708 --competition-id -12345 --total-stages 5
 *   node scripts/results-fetchers/livetiming-results-fetch.mjs --vid 260708 --competition-id -12345 --stage 2
 *   node scripts/results-fetchers/livetiming-results-fetch.mjs --vid 260708 --suggest-id
 *   node scripts/results-fetchers/livetiming-results-fetch.mjs --vids 260708,260709,260710 --competition-id -12345
 *
 * Args:
 *   --vid             V_ID BASE (etapa 1) de livetiming.at (livetimingCode), AAMMDD.
 *   --vids            (alternativa a --vid) lista explícita de V_ID por etapa,
 *                     separados por coma. Útil si la numeración por fecha no se
 *                     cumple (sectores dobles, descansos con V_ID). El PRIMERO es
 *                     el base (ancla los IDs sintéticos).
 *   --competition-id  competitionId del puente race_uci_links (sintético NEGATIVO;
 *                     obligatorio; también nombra el archivo de salida <id>.json).
 *   --total-stages    nº de etapas a derivar por fecha desde --vid (default 21 si
 *                     no se da y se usa --vid; ignorado con --vids). El cron pasa
 *                     max(stageNumber) de race_days.
 *   --stage           (opcional) limitar a un nº de etapa concreto.
 *   --event-over      forzar generar la pseudo-etapa "Final Classification".
 *   --allow-provisional-generals
 *                     NO filtrar las generales por estado de confirmación (volcarlas
 *                     tal cual venga el feed). Por defecto DESACTIVADO: una general
 *                     (gc/points/kom/youth) solo se emite si TODAS sus filas están en
 *                     verde (markTime='bggrn' = confirmada por el jurado); mientras la
 *                     etapa está en curso las generales son provisionales (rojo/amarillo)
 *                     y se OMITEN para no publicar una general no oficial. La
 *                     clasificación de ETAPA (FF) no lleva markTime → nunca se filtra.
 *   --out             carpeta de salida (default _results_run/livetiming-<vid> JUNTO A ESTE
 *                     script, no relativo al cwd). La ruta que imprime al terminar es la
 *                     real: leer esa, no reconstruirla a mano.
 *   --pretty          además vuelca el JSON a stdout.
 *   --delay           ms entre peticiones (default 200).
 *   --suggest-id      imprime el competitionId sintético sugerido para --vid y sale.
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const VID = getArg('vid');                            // V_ID base (etapa 1), AAMMDD
const VIDS = getArg('vids');                          // lista explícita, alternativa a --vid
const COMPETITION_ID = getArg('competition-id');
const TOTAL_STAGES = getArg('total-stages') != null ? parseInt(getArg('total-stages'), 10) : null;
const ONLY_STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
const FORCE_OVER = hasFlag('event-over');
// Por defecto, una GENERAL (gc/points/kom/youth) solo se emite si está CONFIRMADA:
// livetiming marca cada fila con `markTime` (bggrn=verde/confirmada por el jurado ·
// bgyel=provisional · bgred=corredor aún en carrera). Con la etapa en curso las
// generales son provisionales (rojo/amarillo) y NO deben volcarse: pintarían una
// general no oficial. Se exige que TODAS las filas estén en verde. --allow-provisional-generals
// desactiva el filtro (volcado de la general tal cual venga, comportamiento antiguo).
const ALLOW_PROVISIONAL = hasFlag('allow-provisional-generals');
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `livetiming-${VID || (VIDS || '').split(',')[0]}`);
const PRETTY = hasFlag('pretty');
const DELAY = parseInt(getArg('delay') || '200', 10);

const HOST = 'https://livetiming.at';
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE_VID = VID || (VIDS ? VIDS.split(',')[0].trim() : null);

// ── IDs sintéticos (negativos, deterministas; salt "livetiming:" sobre el V_ID base) ──
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// ≤199999 → eventId > -2^31 garantizado. Sin --vid queda NaN: solo lo usa main(), que
// valida los args antes (importar el módulo desde un test no ejecuta nada).
const ID_BASE = BASE_VID ? fnv1a(`livetiming:${BASE_VID}`) % 200000 : NaN;

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (!BASE_VID || !/^\d{6,7}$/.test(BASE_VID)) { log('FATAL: falta --vid <V_ID AAMMDD, p.ej. 260708> (o --vids <lista>)'); process.exit(1); }
  if (hasFlag('suggest-id')) {
    process.stdout.write(String(-ID_BASE) + '\n');
    process.exit(0);
  }
  if (!COMPETITION_ID || !/^-\d+$/.test(COMPETITION_ID)) {
    log(`FATAL: falta --competition-id <entero NEGATIVO sintético> (sugerido para ${BASE_VID}: ${-ID_BASE})`);
    process.exit(1);
  }
}

const FINAL_SLOT = 99;
const CLASS_IDX = {
  'stage/stage': 1, 'gc/stage': 2,
  'points/overall': 3, 'kom/overall': 4, 'youth/stage': 5, 'teams/overall': 6,
  'points/stage': 7, 'kom/stage': 8, 'youth/overall': 9, 'teams/stage': 10,
  'other/stage': 11, 'other/overall': 12,
};
const synthRaceId = (slot) => -(ID_BASE * 10000 + slot * 100);
const synthEventId = (slot, kind, scope) => -(ID_BASE * 10000 + slot * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 12));

// ── normalización ───────────────────────────────────────────────────────────
// Exportadas para tests (js/__tests__/livetimingResultsFetch.test.js). El script sigue
// siendo ejecutable: main() solo corre si se invoca directamente (ver pie del fichero).
export function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

// IRM de livetiming (col Place) → códigos IRM UCI (js/uci-irm.js).
const IRM_MAP = { DNF: 'DNF', AB: 'DNF', ABD: 'DNF', DNS: 'DNS', NP: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', EX: 'DSQ', OTL: 'OTL', HD: 'OTL' };
export function parsePlace(v) {
  // "1" → {rank:1}; "DNF"/"DNS"/… → {irm:'DNF'}; vacío → {}.
  const t = clean(v).replace(/\.$/, '');
  if (!t) return {};
  if (/^\d+$/.test(t)) return { rank: parseInt(t, 10) };
  const up = t.toUpperCase();
  return { irm: IRM_MAP[up] || up };
}

// nombre livetiming "*ALVAREZ MARTINEZ Hector" → quita el asterisco sub23; ya viene
// en orden UCI "APELLIDO Nombre" → tal cual (solo display; el corredor va por dorsal).
// Fallback: si el feed trae el nombre VACÍO (visto en el Tour of Austria 2026 E1, dorsal
// 172) y hay dorsal, se emite "#<bib>" como display — riderDisplay es NOT NULL en BD y el
// resolve por dorsal (082) lo sobrescribe con el nombre real de la startlist curada.
export function cleanName(v, bib) {
  const t = clean(v).replace(/^\*+/, '').trim();
  if (t) return t;
  return bib ? `#${bib}` : 'N/A';
}

// tiempo absoluto "4:21:02" / "53:29" → tal cual (formato BD). "-" / vacío / "+…" → null.
export function normAbsTime(v) {
  const t = clean(v);
  if (!t || t === '-' || t.startsWith('+')) return null;
  return /^\d+(:\d{2}){1,2}$/.test(t) ? t : null;
}

// gap livetiming "+0:15" / "+25:57" / "+[0:00:11]" / "+1:01:21" → "+M:SS" / "+H:MM:SS"
// estilo UCI. Los corchetes de FF (`+[0:00:11]`) se retiran. "-" / vacío → null.
export function normGap(v) {
  let t = clean(v);
  if (!t || t === '-') return null;
  t = t.replace(/[[\]]/g, '');                 // quita corchetes de FF
  if (!t.startsWith('+')) return null;
  const body = t.slice(1).trim();
  if (/^\d+(:\d{2}){1,2}$/.test(body)) {
    // normaliza H:MM:SS → recorta ceros de cabeza superfluos manteniendo el patrón UCI.
    const parts = body.split(':').map((p) => parseInt(p, 10));
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return h > 0 ? `+${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                   : (m > 0 ? `+${m}:${String(s).padStart(2, '0')}` : `+${s}`);
    }
    const [m, s] = parts;
    return m > 0 ? `+${m}:${String(s).padStart(2, '0')}` : `+${s}`;
  }
  return null;
}

// "15" / "15 pt" → "15"
export function normPoints(v) {
  const m = /^(\d+)\s*(pts?)?$/i.exec(clean(v));
  return m ? m[1] : null;
}

export function bibOf(r) {
  const b = clean(r.BIB);
  return /^\d+$/.test(b) ? b : null;
}

// ── mapeo de filas por tipo de clasificación ────────────────────────────────
// FF (etapa): tiempo ABSOLUTO de cada corredor → timeText para TODOS, nunca gapText
// (Caso A deriveGaps de la web, como STS). Abandonos (Place=DNF/…) → irm.
export function mapStageRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const { rank, irm } = parsePlace(r.Place);
    const bib = bibOf(r);
    const name = cleanName(r.Name, bib);
    if (irm) { out.push({ rank: null, rankText: irm, bib, riderDisplay: name, teamName: null, resultValue: null, timeText: null, gapText: null, points: null, irm }); continue; }
    const abs = normAbsTime(r.Time);
    out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib,
      riderDisplay: name, teamName: null, resultValue: abs, timeText: abs, gapText: null, points: null, irm: null });
  }
  return out;
}

// GC / YU (tiempo): rank 1 lleva tiempo absoluto, el resto gap. Abandonos → irm.
// `markTime` (bggrn=confirmada/verde · bgyel=provisional · bgred=corredor aún en
// carrera) se propaga CRUDO para que el consumidor (watch) pueda exigir general
// CONFIRMADA (todas las filas verdes) antes de volcarla. El upsert ignora el campo.
export function mapTimeGeneralRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const { rank, irm } = parsePlace(r.Place);
    const bib = bibOf(r);
    const name = cleanName(r.Name, bib);
    if (irm) { out.push({ rank: null, rankText: irm, bib, riderDisplay: name, teamName: null, resultValue: null, timeText: null, gapText: null, points: null, irm, markTime: r.markTime ?? null }); continue; }
    const abs = rank === 1 ? normAbsTime(r.Time) : null;
    const gap = rank === 1 ? null : normGap(r.Time);
    out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib,
      riderDisplay: name, teamName: null,
      resultValue: rank === 1 ? abs : gap, timeText: rank === 1 ? abs : null, gapText: gap, points: null, irm: null, markTime: r.markTime ?? null });
  }
  return out;
}

// PT / GP (puntos). `markTime` propagado crudo (ver mapTimeGeneralRows).
export function mapPointsRows(rows) {
  const out = [];
  for (const r of rows || []) {
    const { rank, irm } = parsePlace(r.Place);
    const bib = bibOf(r);
    const name = cleanName(r.Name, bib);
    if (irm) { out.push({ rank: null, rankText: irm, bib, riderDisplay: name, teamName: null, resultValue: null, timeText: null, gapText: null, points: null, irm, markTime: r.markTime ?? null }); continue; }
    const pts = normPoints(r.Points);
    out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib,
      riderDisplay: name, teamName: null, resultValue: pts, timeText: null, gapText: null, points: null, irm: null, markTime: r.markTime ?? null });
  }
  return out;
}

// clave del JSON de datos → {classKind, scope, eventName, mapper}
const CLASS_SPEC = [
  { key: 'FF', classKind: 'stage',  scope: 'stage',   eventName: 'Stage Classification',          map: mapStageRows,       isStage: true },
  { key: 'GC', classKind: 'gc',     scope: 'stage',   eventName: 'Stage General Classification',   map: mapTimeGeneralRows },
  { key: 'PT', classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification',  map: mapPointsRows },
  { key: 'GP', classKind: 'kom',    scope: 'overall', eventName: 'Overall Mountain Classification', map: mapPointsRows },
  // YU con &tour=1 es la GENERAL de jóvenes del tour (acumulada), como PT/GP → scope
  // 'overall'. Además, keepForWeb (columna generada, mig. 092) exige classKind∈(stage,gc)
  // O scope='overall' O isFinalClassification: con scope='stage' la clas. de jóvenes
  // quedaría INVISIBLE en la web (keepForWeb=false); con 'overall' se muestra, coherente
  // con puntos/montaña.
  { key: 'YU', classKind: 'youth',  scope: 'overall', eventName: 'Overall Youth Classification',   map: mapTimeGeneralRows },
];

// Una general está CONFIRMADA cuando todas sus filas CLASIFICADAS (con puesto real)
// están en verde (markTime === 'bggrn'). Las filas de ABANDONO (irm: DNF/DNS/DSQ/OTL)
// se IGNORAN en la comprobación: livetiming las deja en rojo (bgred) de forma
// permanente porque no terminaron → exigirles verde haría que una general con cualquier
// abandono NUNCA se diera por confirmada (y toda etapa tiene abandonos). markTime
// ausente/otro en una fila clasificada (provisional o corredor aún en carrera) → NO
// confirmada. La clasificación de ETAPA (FF) no lleva markTime → nunca se filtra aquí.
const GENERAL_KINDS = new Set(['gc', 'points', 'kom', 'youth']);
export function isGeneralConfirmed(rows) {
  const classified = rows.filter((r) => !r.irm);   // excluye abandonos (siempre en rojo)
  return classified.length > 0 && classified.every((r) => r.markTime === 'bggrn');
}

function buildClassification(slot, spec, rows) {
  const winner = rows.find((r) => r.rank === 1);
  return {
    eventId: synthEventId(slot, spec.classKind, spec.scope),
    classKind: spec.classKind, scope: spec.scope,
    eventName: spec.eventName,
    isTeamEvent: false,
    winnerName: winner ? winner.riderDisplay : null,
    rowCount: rows.length,
    rows,
  };
}

// ── cliente HTTP ────────────────────────────────────────────────────────────
async function getJson(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(opts.headers || {}) }, ...opts });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function postData(vid) {
  return getJson(`${HOST}/live_data_all.php`, {
    method: 'POST',
    headers: { 'Content-type': 'application/x-www-form-urlencoded' },
    body: `V_ID=${vid}&lynx=1&tour=1`,
  });
}

// ── derivación de V_ID por fecha ────────────────────────────────────────────
// V_ID = AAMMDD (o A + AMMDD para 7 dígitos = 2 carreras el mismo día, sufijo 1).
// Derivamos el día natural sumando `n` días a la fecha del base. Solo soportamos el
// formato AAMMDD de 6 dígitos para la aritmética por fecha; con 7+ dígitos o
// numeración no-fecha, usar --vids explícito.
function vidPlusDays(baseVid, n) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(String(baseVid));
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const d = new Date(Date.UTC(2000 + parseInt(yy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  const y2 = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const m2 = String(d.getUTCMonth() + 1).padStart(2, '0');
  const d2 = String(d.getUTCDate()).padStart(2, '0');
  return `${y2}${m2}${d2}`;
}

// ── pipeline ────────────────────────────────────────────────────────────────
async function main() {
  checkArgs();
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher livetiming.at — vid base=${BASE_VID} (puente sintético ${COMPETITION_ID}) · idBase=${ID_BASE}`);

  // Lista de V_ID a probar: explícita (--vids) o derivada por fecha (--vid + --total-stages).
  let candidateVids;
  if (VIDS) {
    candidateVids = VIDS.split(',').map((v) => v.trim()).filter(Boolean).map((v, i) => ({ vid: v, dayIndex: i }));
  } else {
    const total = TOTAL_STAGES != null && TOTAL_STAGES > 0 ? TOTAL_STAGES : 21;
    // Probamos un rango de días generoso (total + margen para descansos intercalados),
    // pero solo aceptamos los que traigan una etapa de tour real. dayIndex = offset de días.
    candidateVids = [];
    for (let n = 0; n < total + 6; n++) {
      const v = vidPlusDays(BASE_VID, n);
      if (v) candidateVids.push({ vid: v, dayIndex: n });
    }
  }

  const stages = [];
  const seenStageNumbers = new Set();
  let maxStageWithData = 0;
  let lastStageOveralls = null;   // {stageNumber, overalls:[{spec,rows}]}

  for (const { vid } of candidateVids) {
    await sleep(DELAY);
    const links = await getJson(`${HOST}/live_links.php?V_ID=${vid}`);
    const rennenAll = (links && links.Rennen) || [];
    // Elegir la carrera de TOUR del día: has_Tour=1. Si el día tiene varias, tomamos la
    // primera con has_Tour (una vuelta pro trae una sola). Sin has_Tour → no es etapa de
    // esta vuelta (día de otra prueba / no existe) → se omite.
    const rennen = rennenAll.find((r) => Number(r.has_Tour) === 1) || null;
    if (!rennen) continue;

    // nº de etapa desde el nombre "1. Etappe …" / "Etappe 1" / "Prolog".
    const nameStr = clean(rennen.Name);
    let stageNumber = null;
    let mNum = /(\d+)\.\s*Etappe/i.exec(nameStr) || /Etappe\s*(\d+)/i.exec(nameStr) || /Stage\s*(\d+)/i.exec(nameStr);
    if (mNum) stageNumber = parseInt(mNum[1], 10);
    else if (/Prolog/i.test(nameStr)) stageNumber = 0;
    if (stageNumber == null) continue;                 // no se pudo determinar la etapa → omitir
    if (ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;
    if (seenStageNumbers.has(stageNumber)) continue;   // ya procesada (V_ID duplicado)
    seenStageNumbers.add(stageNumber);

    const isTTT = Number(rennen.isMZF) === 1;

    await sleep(DELAY);
    const data = await postData(vid);
    if (!data) { log(`  V_ID=${vid} (E${stageNumber}) — live_data_all sin respuesta, omitida`); continue; }

    const classifications = [];
    const overalls = [];
    let hasStageRows = false;
    for (const spec of CLASS_SPEC) {
      const rows = spec.map(data[spec.key]);
      if (!rows.length) continue;
      if (spec.isStage) hasStageRows = true;               // FF (clasificación de ETAPA) con filas
      // Generales provisionales (no todas verdes) se OMITEN salvo --allow-provisional-generals.
      if (GENERAL_KINDS.has(spec.classKind) && !ALLOW_PROVISIONAL && !isGeneralConfirmed(rows)) {
        log(`  V_ID=${vid} (E${stageNumber}) — ${spec.classKind} provisional (no confirmada / no verde), omitida`);
        continue;
      }
      classifications.push(buildClassification(stageNumber, spec, rows));
      if (!spec.isStage) overalls.push({ spec, rows });   // GC/PT/GP/YU = generales CONFIRMADAS acumuladas
    }
    if (!classifications.length) { log(`  V_ID=${vid} (E${stageNumber}) — sin clasificaciones (no disputada aún), omitida`); continue; }
    // GUARD "exigir FF": livetiming pre-monta el V_ID del día SIGUIENTE ya con las
    // generales acumuladas HEREDADAS de la etapa anterior (GC/PT/GP/YU pobladas) pero
    // SIN la clasificación de etapa (FF vacía), porque esa etapa aún no se ha corrido.
    // Sin este guard esas acumuladas se volcaban como si la etapa futura ya existiera
    // (cazado en el Tour of Austria 2026: la E3 se volcó ayer, durante la ventana de
    // meta de la E2, solo con GC/PT/GP/YU heredadas). Una etapa DISPUTADA siempre trae
    // FF (también CRI/CRE la producen); si falta FF, el día es un pre-montaje del
    // siguiente → se omite. El cierre de carrera no se ve afectado: la "Final
    // Classification" se genera aparte desde lastStageOveralls, que solo recoge etapas
    // que SÍ pasaron este guard (todas con FF real).
    if (!hasStageRows) { log(`  V_ID=${vid} (E${stageNumber}) — solo generales acumuladas heredadas, sin clasificación de etapa (FF), omitida (etapa no disputada)`); continue; }

    stages.push({
      uciRaceId: synthRaceId(stageNumber),
      stageNumber,
      stageName: nameStr || `Stage ${stageNumber}`,
      isFinalClassification: false,
      dateKey: null,                    // stageDate lo deriva la JORNADA (race_days.dateKey), no el fetcher
      raceType: isTTT ? 'TTT' : null,
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    if (stageNumber >= maxStageWithData) { maxStageWithData = stageNumber; lastStageOveralls = { stageNumber, overalls }; }
    log(`  V_ID=${vid}  E${String(stageNumber).padEnd(2)} ${isTTT ? '(CRE) ' : ''}${String(classifications.length)} clasificaciones  (${classifications.map((c) => c.classKind).join(',')})`);
  }

  if (!stages.length) { log('FATAL: no se detectó ninguna etapa de tour con datos'); process.exit(1); }

  // Carrera terminada → pseudo-etapa "Final Classification" con las generales
  // DEFINITIVAS de la ÚLTIMA etapa (scope='stage' + isFinalClassification, quirk 085).
  // `overalls` ya solo trae generales CONFIRMADAS (verde), así que la final nunca se
  // arma con generales provisionales; si la última etapa aún no tiene generales verdes,
  // `overalls` está vacío y la final no se genera (el siguiente run la arma al confirmar).
  // Se considera terminada si --event-over, o si la última etapa con datos == total de
  // etapas declarado (todas volcadas). Mismo criterio que Matsport/race|result.
  const eventOver = FORCE_OVER || (TOTAL_STAGES != null && maxStageWithData >= TOTAL_STAGES);
  if (eventOver && lastStageOveralls && lastStageOveralls.overalls.length && ONLY_STAGE == null) {
    const FINAL_NAMES = { gc: 'General Classification', points: 'Points Classification', kom: 'Mountain Classification', youth: 'Youth Classification' };
    const classifications = [];
    for (const { spec, rows } of lastStageOveralls.overalls) {
      classifications.push(buildClassification(
        FINAL_SLOT,
        { ...spec, scope: 'stage', eventName: FINAL_NAMES[spec.classKind] || spec.eventName },
        rows,
      ));
    }
    stages.push({
      uciRaceId: synthRaceId(FINAL_SLOT),
      stageNumber: null,
      stageName: 'Final Classification',
      isFinalClassification: true,
      dateKey: null,
      raceType: null,
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    log(`    FINAL (carrera terminada): ${classifications.length} clasificaciones desde la E${lastStageOveralls.stageNumber}`);
  }

  const out = {
    competitionId: Number(COMPETITION_ID),
    disciplineId: 10,
    source: 'livetiming',
    livetimingVid: BASE_VID,
    fetchedAt: new Date().toISOString(),
    stageCount: stages.length,
    stages,
  };

  const file = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`\n✅ ${stages.length} etapas, ${stages.reduce((a, s) => a + s.classificationCount, 0)} clasificaciones → ${file}`);
  if (PRETTY) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// Solo se ejecuta si se invoca como script; importarlo (tests) no dispara nada.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
