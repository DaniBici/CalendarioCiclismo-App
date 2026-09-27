#!/usr/bin/env node
/**
 * raceresult-results-fetch.mjs — FETCHER de resultados desde RACE|RESULT
 * (my.raceresult.com), la plataforma de cronometraje de muchas carreras nórdicas
 * y de Europa central (Tour of Slovenia, Tour of Norway, …). Expone una API JSON
 * PÚBLICA sin auth (config + list), accesible por curl/Node, que publica en vivo
 * durante la etapa y valida minutos tras meta.
 *
 * EMITE EXACTAMENTE EL MISMO JSON que dataride-results-fetch.mjs → el upsert
 * (results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source ('uci'|'tissot'|'pdf'|'matsport'|'sportstiming'|
 * 'manual_timing'|'raceresult', migración 108) vía results-cron.mjs.
 *
 * API RACE|RESULT (sin auth):
 *   GET /{eventId}/results/config?lang=en   → key + server + lista de "Lists"
 *       (qué clasificaciones hay) + contests + EventOver.
 *   GET https://{server}/{eventId}/results/list?key=KEY&listname=...&page=results
 *       &contest=1&s=SEL&r=all&l=0&fav=&openedGroups={}&term=
 *                                           → una lista (clasificación), con:
 *       · list.SelectorResults[]  = etapas disponibles ({ResultID, ShowAs:"Stage N"}).
 *         El parámetro &s=ResultID selecciona la etapa (Stage Results / LIVE).
 *       · DataFields[]            = expresiones de columna (su nº VARÍA por lista).
 *       · data                    = filas. ⚠ Puede ser una LISTA plana o un DICT
 *         anidado de grupos (data[grupo] o data[grupo][subgrupo] → lista de filas).
 *   ⚠ El `key` y el `server` (my3/my4/…) ROTAN entre ediciones → SIEMPRE resolverlos
 *     del /config; no hardcodear. El config se pide a my.raceresult.com (host fijo).
 *
 * CONTRATO DE FILA (array POSICIONAL; el nº de columnas depende de la lista — el
 * mapeo va por TIPO de lista, no por posición fija). Verificado contra Tour of
 * Norway 2025 (eventId 334313, EventOver) y Tour of Slovenia 2026 (402988):
 *   Stage Results (12 col):  [0]bibInterno [1]ID [2]rank|IRM("1."/"DNF") [3]nombre(*=sub23)
 *       [4]bandera(img) [5]DisplayBib=DORSAL [6]equipo [7]maillot(img) [8]bonif [9]tiempo
 *       (SOLO rank1, "2h53'29''") [10]gap(ITT) [11]color.
 *   General Classification (13 col): igual + 2 col extra al principio del bloque de
 *       texto → [2]rank [3]flecha(img) [4]Δpos [5]nombre [6]bandera [7]DORSAL [8]equipo
 *       [9]maillot [10]tiempo|gap("15h32'22''" rank1, "+28''" resto) [11]_ [12]color.
 *   Points / KOM / Young (9 col): [2]rank [3]nombre [4]bandera [5]DORSAL [6]equipo
 *       [7]maillot [8]puntos("84 pt").
 *   Team General Classification (7 col): [0]bibEquipo [2]rank [3]NOMBRE EQUIPO
 *       [4]sigla [5]maillot [6]tiempo|gap. (Filas de EQUIPO → bib NULL, teamRows.)
 *   One-day Stage Results (11 col, Philadelphia 2026): [2]rank [3]DORSAL
 *       [4]nombre [5]equipo [6]bandera [9]tiempo absoluto [10]gap.
 * El mapeo se hace localizando columnas por heurística robusta (ver pickCols) en vez
 * de índices mágicos, para tolerar variantes de plantilla entre carreras.
 *
 * RESOLUCIÓN: el corredor REAL se resuelve POR DORSAL (DisplayBib) contra la
 * startlist curada (RPC 082); el nombre de la fila es solo fallback de display
 * (formato race|result "Nombre APELLIDO" → se reordena a "APELLIDO Nombre" estilo
 * UCI por heurística de mayúsculas, pero da igual: no se casa por nombre salvo
 * carreras sin startlist). Filas de equipo (Team GC) → bib NULL.
 *
 * NORMALIZACIÓN:
 *   tiempo absoluto "2h53'29''" / "15h32'22''" → "2:53:29" / "15:32:22" (formato BD).
 *   gap "+28''" → "+28" · "+1'15''" → "+1:15" · "+3'25''" → "+3:25" (estilo UCI).
 *   puntos "84 pt"/"84 pts"/"84" → "84".  rank "1." → 1.
 *   IRM (col rank): DNF/DNS/DSQ/OTL/HD/NP/AB → códigos UCI (js/uci-irm.js).
 *
 * MAPEO lista → {classKind, scope}:
 *   Stage Results → stage/stage (por etapa, selector s=)
 *   General Classification → gc/stage   (acumulada del día; en la última etapa → FINAL)
 *   Points Classification → points/overall
 *   KOM Classification → kom/overall
 *   Young Rider Classification → youth/overall
 *   Team General Classification → teams/overall (teamRows)
 *   Las listas LIVE son el respaldo de la etapa en curso cuando --stage N la pide y
 *   Results todavía no ofrece filas. Además de la llegada, puntos y montaña LIVE
 *   aportan sus acumulados provisionales si el cabecero coincide con --date.
 *   Las listas de Results tienen prioridad en cuanto publican la jornada.
 *
 * ETAPAS: el selector SelectorResults da las etapas ("Stage 1".."Stage N"). Las
 * generales (GC/Points/KOM/Young/Team) son ACUMULADAS hasta la última etapa volcada;
 * se cuelgan de esa etapa. Cuando EventOver=true (carrera terminada), las generales
 * de la última etapa son las DEFINITIVAS → van SOLO a la pseudo-etapa "Final
 * Classification" (stageNumber NULL, isFinalClassification=true, scope='stage' — quirk
 * UCI migración 085), no colgando de la última etapa (evita el duplicado
 * "general del día E_última" ≈ "general final"). Mismo criterio que Matsport.
 *
 * IDs SINTÉTICOS: race|result no existe en DataRide → eventId/uciRaceId NEGATIVOS y
 *   deterministas (mismo esquema que Tissot/Matsport/PDF, salt propio "raceresult:"):
 *   fnv1a("raceresult:"+eventId)%200000 como base, eventId = -(base*10000+slot*100+idx).
 *   El competitionId del puente también es sintético negativo (-base), como en Matsport.
 *   ⚠ Al conmutar la fuente de una carrera ya volcada, la purga de gemelas del upsert
 *   (090) reemplaza los placeholders automáticamente.
 *
 * ⚠ CRI/CRE (ITT/TTT): el esquema de race|result tiene lógica isITT/TTT_StageID y hay
 *   una lista "LIVE Team Time Trial", pero NO se ha podido verificar el formato de fila
 *   de una crono (ni Norway 2025 ni Slovenia 2026 tienen). VALIDAR el layout antes de
 *   conmutar una carrera con CRI/CRE; de momento el fetcher trata toda etapa como en ruta
 *   (líder con tiempo absoluto, resto por gap), que es lo correcto para etapas en línea.
 *
 * Uso (desde la raíz del repo; fetch nativo, sin deps):
 *   node scripts/results-fetchers/raceresult-results-fetch.mjs --event 402988 --competition-id -123456
 *   node scripts/results-fetchers/raceresult-results-fetch.mjs --event 402988 --competition-id -123456 --stage 1
 *   node scripts/results-fetchers/raceresult-results-fetch.mjs --event 402988 --suggest-id
 *   node scripts/results-fetchers/raceresult-results-fetch.mjs --event 406938 --gender female --one-day --date 2026-08-30 --competition-id -123456
 *
 * Args:
 *   --event           eventId numérico de race|result (raceresultCode), p. ej. 402988.
 *   --competition-id  competitionId del puente race_uci_links (sintético NEGATIVO;
 *                     obligatorio: el JSON lo lleva para que el upsert NO recablee el
 *                     puente; también nombra el archivo de salida <id>.json).
 *                     Convención histórica: -(fnv1a("raceresult:"+eventId)%200000).
 *                     En eventos multiconcurso se añade ":contest:<id>" al salt. Este
 *                     script imprime el valor aplicable con --suggest-id.
 *   --stage           (opcional) limitar a un nº de etapa.
 *   --gender          male|female; selecciona el concurso en eventos multigénero
 *                     con perfil verificado, como Philadelphia 2026.
 *   --contest         id de concurso de race|result. Prevalece sobre el perfil.
 *   --one-day         modela la lista Stage Results como carrera de un día:
 *                     stageNumber=NULL, gc/stage y sin clasificaciones anexas.
 *   --required-laps   no emite la carrera de un día hasta que el live alcance ese
 *                     número de vueltas o muestre FINISH. El perfil puede fijarlo.
 *   --date            YYYY-MM-DD curado de la carrera de un día; se incluye en el JSON.
 *   --out             carpeta de salida (default _results_run/raceresult-<event> JUNTO A ESTE
 *                     script, no relativo al cwd). La ruta que imprime al terminar es la
 *                     real: leer esa, no reconstruirla a mano.
 *   --pretty          además vuelca el JSON a stdout.
 *   --delay           ms entre peticiones (default 150).
 *   --remap-bib F:S   reescribe el dorsal F del feed al S de la startlist (repetible).
 *                     Para cuando race|result numera distinto que la startlist UCI
 *                     (p. ej. --remap-bib 54:57 en Eslovenia: Wenzel va 54 en el feed
 *                     y 57 en la UCI). Sobrevive a cada re-volcado del cron.
 *   --suggest-id      imprime el competitionId sintético sugerido y sale.
 */
'use strict';

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const EVENT = getArg('event');                       // eventId race|result (402988)
const COMPETITION_ID = getArg('competition-id');     // sintético negativo (puente race_uci_links)
const ONLY_STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
const GENDER = getArg('gender');
const DATE_ARG = getArg('date');

// Excepciones editoriales verificadas por edición. Philadelphia comparte un eventId
// entre dos pruebas de un día y publica Stage Results vuelta a vuelta. Cada concurso
// necesita un ID sintético distinto y un gate de distancia antes de emitir resultados.
// Stuttgart (WCGP 2026) no tiene lista "Stage Results": su clasificación vive en la
// lista oficial del contest 4 con una plantilla de columnas propia (bib[0], rank[2],
// nombre[5], equipo[7], tiempo|gap[9]) → perfil con listPattern + cols.
export const RACERESULT_EVENT_PROFILES = {
  '406938': {
    oneDay: true,
    contests: {
      male: { contest: '1', requiredLaps: 10 },
      female: { contest: '2', requiredLaps: 5 },
    },
  },
  '415222': {
    oneDay: true,
    contests: {
      female: { contest: '4' },
    },
    listPattern: /Ergebnisliste OA/i,
    cols: { rank: 2, bib: 0, name: 5, team: 7, value: 9, gap: 9 },
  },
  '417778': {
    oneDay: true,
    // Ambas carreras masculinas comparten evento: el género no distingue concurso.
    dates: {
      '2026-09-11': { contest: '1', dateKey: '2026-09-11' },
      '2026-09-13': { contest: '2', dateKey: '2026-09-13' },
    },
    cols: { rank: 2, bib: 3, name: 5, team: 6, value: 9, gap: 10 },
  },
  // Gatineau 2026 (racetiming.ca → race|result). Concurso único ("Women") y sin
  // pestaña live: la lista de resultados publica la marca en meta ("M:Ss.kk") y su
  // propia columna de diferencia. La crono añade una lista de progreso con los
  // parciales completados de cada corredor; no se publica hasta que no queda nadie
  // en curso (habitualmente cuando Reusser, última en salir, ha terminado).
  '422048': {
    oneDay: true,
    contests: { female: { contest: '0' } },
    listPattern: /Results With 1 Splits/i,
    cols: { rank: 2, bib: 3, name: 4, team: 5, value: 6, gap: 7 },
    progress: { listPattern: /Live Results/i, fieldPattern: /Split_Count/i, lastStarter: /REUSSER/i },
  },
  // Tour de Gatineau 2026: prueba en línea del mismo cronometrador. El organizador
  // separa las columnas Tiempo/Gap y solo publica cuando existe llegada (meta); sin
  // señal de progreso propia. Plantilla verificada el 17-09-2026 (13 col):
  // [0]BIB [1]ID [2]rank [3]PrintedBib [4]NATION.UCINAME [5]DisplayName [6]Team
  // [7]QC [8]vueltas [9]Bunch(tiempo absoluto) [10]GapTime(diferencia; "-" el líder)
  // [11]AgeGroup [12]club. La nación ocupa la columna 4: dorsal, nombre y equipo van
  // un puesto más a la derecha que en la crono.
  '422781': {
    oneDay: true,
    contests: { female: { contest: '0' } },
    listPattern: /Overall Results with Category/i,
    cols: { rank: 2, bib: 3, name: 5, team: 6, value: 9, gap: 10 },
  },
};

export function eventProfile(event, gender, contestId = null, date = null) {
  const base = RACERESULT_EVENT_PROFILES[String(event)] || null;
  if (!base) return null;
  if (base.dates && date && !base.dates[date]) {
    throw new Error(`Fecha ${date} no configurada para el evento ${event}`);
  }
  const contests = [...Object.values(base.contests || {}), ...Object.values(base.dates || {})];
  const contest = contestId != null
    ? contests.find((item) => String(item.contest) === String(contestId)) || null
    : base.dates?.[date] || base.contests?.[String(gender || '').toLowerCase()] || null;
  if (contest?.dateKey && date && contest.dateKey !== date) {
    throw new Error(`El concurso ${contestId} no corresponde a la fecha ${date}`);
  }
  return contest ? { ...base, ...contest } : { ...base, contest: null, requiredLaps: null };
}

const PROFILE_BASE = RACERESULT_EVENT_PROFILES[String(EVENT)] || null;
const EXPLICIT_CONTEST = getArg('contest');
const PROFILE = eventProfile(EVENT, GENDER, EXPLICIT_CONTEST, DATE_ARG);
const CONTEST = String(EXPLICIT_CONTEST || PROFILE?.contest || '1');
const ONE_DAY = hasFlag('one-day') || !!PROFILE?.oneDay;
const REQUIRED_LAPS = Number.parseInt(getArg('required-laps', PROFILE?.requiredLaps ?? '0'), 10) || 0;
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `raceresult-${EVENT}`);
const PRETTY = hasFlag('pretty');
const DELAY = parseInt(getArg('delay') || '150', 10);

// Remapeo de dorsal feed→startlist. race|result a veces numera distinto que la startlist
// UCI (usa numeración correlativa sin huecos; la UCI salta números) → el resolve por
// dorsal casaría con OTRO corredor (o ninguno). Se reescribe el bib del feed AL de la
// startlist ANTES de emitir. Dos vías, fusionadas:
//   1) --remap-bib FEED:STARTLIST (repetible) — para volcados manuales puntuales.
//   2) BIB_REMAPS[eventId] — overrides PERSISTENTES por carrera, que el CRON aplica solo
//      (el cron no pasa flags) → la corrección sobrevive a cada volcado automático.
// Mantener BIB_REMAPS por edición; al cambiar de año el eventId cambia y deja de aplicar.
const BIB_REMAPS = {
  // (sin overrides) — race|result es el cronometrador OFICIAL: sus dorsales son la verdad
  // en carrera. Si la startlist UCI no casa, se corrige la startlist (no se remapea el
  // feed). El remap solo es para casos donde la startlist UCI sea la fuente buena y el
  // feed esté equivocado — no es el caso de Eslovenia 2026.
};
const REMAP = new Map([
  ...Object.entries(BIB_REMAPS[String(EVENT)] || {}),
  ...args.reduce((acc, a, i) => {
    if (a === '--remap-bib' && args[i + 1]) {
      const [from, to] = args[i + 1].split(':');
      if (from && to) acc.push([String(from).trim(), String(to).trim()]);
    }
    return acc;
  }, []),
]);

const CONFIG_HOST = 'https://my.raceresult.com';     // host fijo para /config (resuelve el server real)
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── IDs sintéticos (negativos, deterministas; salt "raceresult:") ───────────
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// Los eventos multiconcurso incorporan el contest al salt para que las fichas
// masculina y femenina no compartan competitionId/eventId. Los eventos históricos
// sin perfil conservan exactamente el salt anterior.
export function idBaseFor(event, contest = '1', contestScoped = false) {
  if (!event || !/^\d+$/.test(String(event))) return NaN;
  const salt = contestScoped
    ? `raceresult:${event}:contest:${contest}`
    : `raceresult:${event}`;
  return fnv1a(salt) % 200000;
}
const ID_BASE = idBaseFor(EVENT, CONTEST, !!(PROFILE_BASE || EXPLICIT_CONTEST));

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (!EVENT || !/^\d+$/.test(EVENT)) { log('FATAL: falta --event <eventId numérico de race|result, p.ej. 402988>'); process.exit(1); }
  if (PROFILE_BASE && !PROFILE?.contest) {
    log(`FATAL: el evento ${EVENT} requiere ${PROFILE_BASE.dates ? '--date YYYY-MM-DD' : '--gender male|female'} o un --contest curado`);
    process.exit(1);
  }
  if (DATE_ARG && !/^20\d{2}-\d{2}-\d{2}$/.test(DATE_ARG)) {
    log('FATAL: --date debe usar YYYY-MM-DD'); process.exit(1);
  }
  if (hasFlag('suggest-id')) {
    process.stdout.write(String(-ID_BASE) + '\n');
    process.exit(0);
  }
  if (!COMPETITION_ID || !/^-\d+$/.test(COMPETITION_ID)) {
    log(`FATAL: falta --competition-id <entero NEGATIVO sintético> (sugerido para ${EVENT}: ${-ID_BASE})`);
    process.exit(1);
  }
}

const FINAL_SLOT = 99;                              // pseudo-etapa "Final Classification"
// idx fijo por (classKind, scope) — mismo cuadro que Tissot/Matsport.
const CLASS_IDX = {
  'stage/stage': 1, 'gc/stage': 2,
  'points/overall': 3, 'kom/overall': 4, 'youth/overall': 5, 'teams/overall': 6,
  'points/stage': 7, 'kom/stage': 8, 'youth/stage': 9, 'teams/stage': 10,
  'other/stage': 11, 'other/overall': 12,
};
const synthRaceId = (slot) => -(ID_BASE * 10000 + slot * 100);
const synthEventId = (slot, kind, scope) => -(ID_BASE * 10000 + slot * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 12));

// ── normalización ───────────────────────────────────────────────────────────
// Exportadas para tests (js/__tests__/raceresultResultsFetch.test.js). El script sigue
// siendo ejecutable: main() solo corre si se invoca directamente (ver pie del fichero).
function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }
// race|result mete imágenes como "[img:...]" y a veces texto con marcadores → si una
// celda es solo una imagen, se trata como vacía para los campos de texto.
export function cellText(v) { const t = clean(v); return /^\[img:/i.test(t) ? '' : t; }

// status / IRM de race|result (col rank) → códigos IRM UCI (los que entiende js/uci-irm.js).
const IRM_MAP = { DNF: 'DNF', AB: 'DNF', ABD: 'DNF', DNS: 'DNS', NP: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', EX: 'DSQ', OTL: 'OTL', HD: 'OTL', OOT: 'OTL' };
// Estados TRANSITORIOS de la lista LIVE que NO son IRM ni puesto: el corredor cruzó
// pero su tiempo/posición aún se procesa. "PHOTO" = photo-finish pendiente. Se tratan
// como "sin clasificar todavía" (rank null, sin IRM) → no contaminan como abandono ni
// como puesto falso; el volcado en vivo se corrige cuando el feed los resuelve.
const TRANSIENT = new Set(['PHOTO', 'FINISH', 'FINISHED', 'PROV', 'PROVISIONAL', 'TBC', '?']);
export function parseRankCell(v) {
  // "1." → {rank:1}; "DNF"/"DNS"/… → {irm:'DNF'}; "PHOTO"/"" → {} (sin clasificar aún).
  const t = clean(v).replace(/\.$/, '');
  if (!t) return {};
  if (/^\d+$/.test(t)) return { rank: parseInt(t, 10) };
  const up = t.toUpperCase();
  if (TRANSIENT.has(up)) return {};
  return { irm: IRM_MAP[up] || up };
}

// tiempo absoluto race|result "2h53'29''" / "15h32'22''" / "53'29''" → "H:MM:SS" / "MM:SS".
// También admite el formato con centésimas "M:Ss.kk"/"H:MM:Ss.kk" (racetiming.ca): las
// centésimas se truncan sin redondear (regla de presentación de tiempos).
export function normAbsTime(v) {
  const t = clean(v);
  if (!t || t.startsWith('+')) return null;
  const noFrac = t.replace(/\.\d+$/, '');
  if (noFrac !== t && /^\d+(:\d{2}){1,2}$/.test(noFrac)) return noFrac;
  const m = /^(?:(\d+)h)?(\d{1,2})'(\d{2})''?$/.exec(t);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mm = m[2], ss = m[3];
    return h > 0 ? `${h}:${mm.padStart(2, '0')}:${ss}` : `${parseInt(mm, 10)}:${ss}`;
  }
  // ya en formato BD ("2:53:29") → tal cual
  return /^\d+(:\d{2}){1,2}$/.test(t) ? t : null;
}

// gap "+28''" → "+28" · "+1'15''" → "+1:15" · "+1h02'03''" → "+1:02:03".
// racetiming.ca publica la diferencia sin signo y con centésimas ("14.69", "1:01.49"):
// se normaliza a "+14"/"+1:01" truncando las centésimas. "−…" (pérdida) y "--" no son gap.
export function normGap(v) {
  const t = clean(v);
  if (!t || t === '--' || t.startsWith('-')) return null;
  const signed = t.startsWith('+');
  const body = signed ? t.slice(1) : t;
  const noFrac = body.replace(/\.\d+$/, '');
  const fractional = noFrac !== body;
  // Formato "M:Ss.kk" / "H:MM:Ss.kk" sin signo, SIEMPRE con centésimas en este
  // cronometrador. Se exige la fracción decimal para no confundir un tiempo absoluto
  // ("5:00:20") con una diferencia.
  if (fractional && /^\d+(:\d{2}){0,2}$/.test(noFrac)) {
    const parts = noFrac.split(':').map((n) => parseInt(n, 10));
    const pad = (n) => String(n).padStart(2, '0');
    if (parts.length === 1) return `+${parts[0]}`;
    if (parts.length === 2) return `+${parts[0]}:${pad(parts[1])}`;
    return `+${parts[0]}:${pad(parts[1])}:${pad(parts[2])}`;
  }
  if (!signed) return null;
  const m = /^(?:(\d+)h)?(?:(\d{1,2})')?(\d{1,2})''?$/.exec(body);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : null;
    const mm = m[2] != null ? parseInt(m[2], 10) : null;
    const ss = m[3];
    if (h != null) return `+${h}:${String(mm ?? 0).padStart(2, '0')}:${ss.padStart(2, '0')}`;
    if (mm != null) return `+${mm}:${ss.padStart(2, '0')}`;
    return `+${parseInt(ss, 10)}`;
  }
  // ya estilo "+1:15"
  return /^\+[\d:]+$/.test(t) ? t : null;
}

// "84 pt" / "84 pts" / "84" → "84"
export function normPoints(v) {
  const m = /^(\d+)\s*(pts?)?$/i.exec(clean(v));
  return m ? m[1] : null;
}

// Nombre race|result "James Matthew BRENNAN*" (nombre(s) + APELLIDO(S) en mayúsculas) →
// "APELLIDO(S) Nombre(s)" estilo UCI (solo display fallback; el asterisco sub23 se quita).
export function reorderName(v) {
  const t = cellText(v).replace(/\*+$/, '').trim();
  if (!t) return null;
  const comma = /^([^,]+),\s*(.+)$/.exec(t);
  if (comma) return clean(`${comma[1]} ${comma[2]}`);
  const toks = t.split(' ');
  const isUpper = (w) => /\p{Lu}/u.test(w) && !/\p{Ll}/u.test(w);
  // apellidos = bloque final de tokens en mayúsculas (absorbe partículas intercaladas)
  let i = toks.length - 1;
  const last = [];
  while (i >= 0 && (isUpper(toks[i]) || (/^(de|del|van|von|der|den|di|da|la|le)$/i.test(toks[i]) && last.length))) {
    last.unshift(toks[i]); i--;
  }
  if (!last.length) return t;                  // no hay mayúsculas claras → tal cual
  const first = toks.slice(0, i + 1).join(' ');
  return clean(`${last.join(' ')} ${first}`);
}

// ── localización de columnas por lista (robusta a variantes de plantilla) ───
// Recibe la PRIMERA fila con rank numérico (cabeza de clasificación) y devuelve los
// índices de {rank, name, bib, team, value}. Heurística:
//   · rank/IRM: primera celda que parsea como "N." o IRM.
//   · bib (DORSAL): última celda numérica corta ANTES del nombre — en race|result el
//     DisplayBib se repite tras el nombre. Tomamos la celda numérica que sigue a la
//     bandera (img) o, si no, la 2ª celda numérica de la fila.
//   · name: primera celda de texto larga no-imagen tras el rank.
//   · team: celda de texto tras el dorsal (mayúsculas, no imagen).
//   · value: última celda de texto con tiempo/gap/puntos.
// Para máxima fiabilidad usamos el mapa POSICIONAL conocido por nº de columnas (el
// layout de race|result es estable por tipo de lista), con la heurística de respaldo.
export function colsByWidth(width, teamRows) {
  if (teamRows) return { bib: 0, rank: 2, name: 3, team: 3, value: 6, teamRow: true };
  switch (width) {
    case 11: return { rank: 2, bib: 3, name: 4, team: 5, value: 9, gap: 10 };          // One-day Stage Results
    case 12: return { rank: 2, name: 3, bib: 5, team: 6, value: 9, gap: 10 };          // Stage Results
    case 13: return { rank: 2, name: 5, bib: 7, team: 8, value: 10 };                  // General Classification
    case 9:  return { rank: 2, name: 3, bib: 5, team: 6, value: 8 };                   // Points / KOM / Young
    case 7:  return { bib: 0, rank: 2, name: 3, team: 3, value: 6, teamRow: true };    // Team GC
    // LIVE Stage Results (pestaña live, 14 col): se usa como FALLBACK cuando la lista
    // "results/Stage Results" de la etapa en curso aún está vacía (race|result publica la
    // oficial minutos tras meta). Layout: [3]rank [5]DisplayBib [7]nombre [9]equipo
    // [10]timestamp interno "[…|-H:MM:Ss]" (se ignora) [11]tiempo del líder "3h14'10''".
    case 14: return { rank: 3, name: 7, bib: 5, team: 9, value: 11, gap: 11 };         // LIVE Stage Results
    default: return null;
  }
}

// ── filas ───────────────────────────────────────────────────────────────────
export function mapRows(rows, spec, kind, isTimed) {
  const out = [];
  if (!Array.isArray(rows) || !rows.length) return out;
  const width = rows[0].length;
  const C = spec.cols || colsByWidth(width, spec.teamRows);
  if (!C) { log(`    ⚠ ancho de fila inesperado (${width} col) en ${kind} — fila omitida`); return out; }

  // Tiempo absoluto del líder (rank 1) de esta clasificación. race|result deja la celda
  // de tiempo VACÍA para quienes llegan en el grupo del líder (m.t.) → para que el render
  // muestre "m.t." hay que darles el MISMO tiempo absoluto que el líder (igual que hace
  // la UCI/Tissot, que repiten el tiempo del grupo en cada corredor). Los rezagados (con
  // gap propio) conservan su gap.
  let leaderAbs = null;
  let curGroupGap = null;   // gap de la cabeza del grupo actual; null = grupo de cabeza (m.t.=ganador).
                            // Se actualiza en cada corte → los m.t. heredan el gap de SU grupo, no el del líder.

  for (const r of rows) {
    const { rank, irm } = parseRankCell(r[C.rank]);
    if (C.teamRow) {
      const teamName = cellText(r[C.name]) || (r[C.bib] != null ? `Team ${clean(r[C.bib])}` : null);
      if (irm) { out.push({ rank: null, rankText: irm, bib: null, riderDisplay: teamName, teamName, resultValue: null, timeText: null, gapText: null, points: null, irm }); continue; }
      const abs = rank === 1 ? normAbsTime(r[C.value]) : null;
      const gap = rank === 1 ? null : normGap(r[C.value]);
      out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib: null,
        riderDisplay: teamName, teamName,
        resultValue: rank === 1 ? abs : (gap || abs), timeText: rank === 1 ? abs : null,
        gapText: gap, points: null, irm: null });
      continue;
    }

    let bib = cellText(r[C.bib]) && /^\d+$/.test(cellText(r[C.bib])) ? cellText(r[C.bib]) : null;
    if (bib != null && REMAP.has(bib)) bib = REMAP.get(bib);   // dorsal feed → startlist (ver --remap-bib)
    const name = reorderName(r[C.name]);
    const team = cellText(r[C.team]) || null;
    if (irm) { out.push({ rank: null, rankText: irm, bib, riderDisplay: name, teamName: team, resultValue: null, timeText: null, gapText: null, points: null, irm }); continue; }

    if (isTimed) {
      const abs = normAbsTime(r[C.value]);   // tiempo absoluto si la celda lo es ("3h14'10''")
      // Algunas plantillas dejan el gap en la misma celda que el tiempo; solo se
      // acepta como diferencia si va firmada ("+…"), para no leer un tiempo absoluto
      // ("5:00:20", "26:41.47") como si fuera un gap. Las one-day separan tiempo y gap.
      const valueGap = clean(r[C.value]).startsWith('+') ? normGap(r[C.value]) : null;
      const gap = (C.gap != null ? normGap(r[C.gap]) : null) || valueGap;
      if (rank === 1) {
        // Líder: tiempo absoluto. Lo guardamos para propagarlo a los m.t. de abajo.
        leaderAbs = abs || leaderAbs;
        curGroupGap = null;            // el grupo de cabeza llega con el ganador (m.t. = ganador)
        out.push({ rank: 1, rankText: '1', bib, riderDisplay: name, teamName: team,
          resultValue: abs, timeText: abs, gapText: null, points: null, irm: null });
      } else if (gap) {
        // Rezagado con gap propio = CABEZA de un nuevo grupo. A partir de aquí, los que
        // vengan SIN gap propio NO llegaron con el ganador, sino EN ESTE grupo → m.t. de
        // este grupo (mismo gap), NO el tiempo del líder de carrera. (Regla Dani: no dar
        // el tiempo del 1er pelotón a quien viene tras un corte.)
        curGroupGap = gap;
        out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib,
          riderDisplay: name, teamName: team,
          resultValue: gap, timeText: null, gapText: gap, points: null, irm: null });
      } else if (curGroupGap == null) {
        // Sin gap propio y aún en el grupo de cabeza → m.t. del ganador. Se emite como
        // gapText '+0' (NO el tiempo absoluto): así TODA fila no-líder lleva gapText y el
        // render entra de forma uniforme por la rama de gaps. El render reconoce '+0"' y lo
        // rotula 'm.t.' (res-gap--same). Si se dejara timeText absoluto, al haber gaps en
        // los grupos rezagados `allTimed` es false → deriveGaps off → estas filas caerían en
        // el else y mostrarían el tiempo absoluto literal en vez de m.t. (bug cazado 19-jun).
        out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib,
          riderDisplay: name, teamName: team,
          resultValue: '+0', timeText: null, gapText: '+0', points: null, irm: null });
      } else {
        // Sin gap propio pero TRAS un corte → m.t. del grupo actual: hereda el gap de la
        // cabeza del grupo (NO el tiempo del ganador). El render lo agrupa con su grupo.
        out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib,
          riderDisplay: name, teamName: team,
          resultValue: curGroupGap, timeText: null, gapText: curGroupGap, points: null, irm: null });
      }
    } else {
      const pts = normPoints(r[C.value]);
      out.push({ rank: rank ?? null, rankText: rank != null ? String(rank) : null, bib,
        riderDisplay: name, teamName: team, resultValue: pts, timeText: null, gapText: null, points: null, irm: null });
    }
  }
  return out;
}

// ── extraer la lista plana de filas de la estructura `data` (lista o dict anidado) ──
export function flattenData(data) {
  if (Array.isArray(data)) return data.filter((r) => Array.isArray(r));
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) { for (const x of node) if (Array.isArray(x)) out.push(x); else if (x && typeof x === 'object') walk(x); return; }
    if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
  };
  walk(data);
  return out;
}

// ── filas de la lista LIVE (agrupada por punto de paso) ─────────────────────
// `data` de la pestaña live agrupa por punto de cronometraje: "#1_Finish",
// "#2_3 km to go", "#4_Start"… Para la clasificación de etapa solo valen los
// FINISHERS del grupo de meta más los abandonos explícitos (DNF/DNS/DSQ/OTL) de los
// demás grupos. Las filas de un parcial (sin puesto ni IRM) son corredores aún en
// ruta: volcarlas dejaría la clasificación provisional con filas sin puesto (Eslovaquia
// E2, 2026-09-17: 4 filas del paso de "3 km to go" se colaban junto a las 120 de meta).
export function liveStageResultRows(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return flattenData(data);
  // El live anida los puntos de paso en uno o más niveles (p. ej.
  // data["#1_Tour of Slovakia"]["#1_Finish"]). Se recogen todas las hojas-array con
  // filas, en cualquier profundidad.
  const leaves = [];
  const walk = (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        const rows = value.filter((row) => Array.isArray(row));
        if (rows.length) leaves.push({ key, rows });
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    }
  };
  walk(data);
  if (!leaves.length) return flattenData(data);
  // Grupo de meta: el llamado "#N_Finish"; si el proveedor lo nombra de otra forma, el
  // grupo más poblado (heurística de respaldo, nunca uno de paso con 4-5 filas).
  const finishLeaf = leaves.find(({ key }) => /(^|[_\s])finish$/i.test(key.trim()))
    || leaves.reduce((best, leaf) => (leaf.rows.length > best.rows.length ? leaf : best), leaves[0]);
  const out = [];
  for (const leaf of leaves) {
    if (leaf === finishLeaf) { out.push(...leaf.rows); continue; }
    const C = colsByWidth(leaf.rows[0].length, false);
    if (!C) continue;
    for (const row of leaf.rows) if (parseRankCell(row[C.rank]).irm) out.push(row);
  }
  return out;
}

export function completedLapFromTimingPoint(value) {
  const text = cellText(value);
  if (!text) return null;
  const after = /\b(?:lap|vuelta)\s*#?\s*0*(\d+)\b/i.exec(text);
  if (after) return Number(after[1]);
  const before = /\b0*(\d+)(?:st|nd|rd|th)?\s+(?:lap|vuelta)\b/i.exec(text);
  return before ? Number(before[1]) : null;
}

// Philadelphia publica Stage Results durante la carrera. El último punto de
// cronometraje de la lista live permite distinguir una vuelta parcial de la meta.
export function liveCompletionState(payload, requiredLaps = 0) {
  const rows = flattenData(payload?.data);
  const dataFields = Array.isArray(payload?.DataFields) ? payload.DataFields : [];
  const timingPointIndex = dataFields.findIndex((field) => /tpName\s*\(\s*TTLastID/i.test(String(field)));
  const timingPoints = timingPointIndex >= 0
    ? rows.map((row) => cellText(row[timingPointIndex])).filter(Boolean)
    : [];
  const hasFinish = timingPoints.some((value) => /\b(?:race\s+)?finish(?:ed)?\b/i.test(value));
  const laps = timingPoints.map(completedLapFromTimingPoint).filter((lap) => Number.isInteger(lap));
  const maxLap = laps.length ? Math.max(...laps) : 0;
  return {
    ready: hasFinish || (requiredLaps > 0 && maxLap >= requiredLaps),
    hasFinish,
    maxLap,
    rowCount: rows.length,
    timingPointIndex,
  };
}

// Listas sin pestaña live estándar (racetiming.ca): la propia lista de progreso
// publica los parciales completados de cada corredor ("2 / 2"). El volcado se
// habilita cuando ningún corredor sigue en curso y hay al menos un finalizado. Así
// una crono no se publica con la clasificación provisional de los primeros
// corredores ni con las filas a medias de quien aún no ha cruzado la meta (el
// último en salir suele ser el último en terminar, pero la condición real es que
// el trazado quede vacío: un DNS o un DNF sin marcar no bloquea).
export function progressCompletionState(payload, progress) {
  const rows = flattenData(payload?.data);
  const fields = Array.isArray(payload?.DataFields) ? payload.DataFields : [];
  const fieldIndex = fields.findIndex((field) => progress.fieldPattern.test(String(field)));
  if (fieldIndex < 0) return { ready: false, reason: 'missing-progress-field', fieldIndex, finished: 0, inProgress: 0, notStarted: 0, lastStarterFinished: null };
  let finished = 0, inProgress = 0, notStarted = 0, lastStarterFinished = null;
  for (const row of rows) {
    const match = /(\d+)\s*\/\s*(\d+)/.exec(cellText(row[fieldIndex]));
    const done = match ? Number(match[1]) : null;
    const total = match ? Number(match[2]) : 0;
    const isFinished = total > 0 && done >= total;
    if (isFinished) finished++;
    else if (done > 0) inProgress++;
    else if (done === 0) notStarted++;
    if (progress.lastStarter && row.some((cell) => progress.lastStarter.test(cellText(cell)))) {
      lastStarterFinished = isFinished;
    }
  }
  return {
    ready: finished > 0 && inProgress === 0,
    fieldIndex,
    finished,
    inProgress,
    notStarted,
    lastStarterFinished,
  };
}

// ── cliente HTTP ────────────────────────────────────────────────────────────
async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// listas de la pestaña "results" que nos interesan → {classKind, scope, eventName, timed, teamRows}
const LIST_MAP = [
  { match: /Stage Results/i,                 classKind: 'stage',  scope: 'stage',   eventName: 'Stage Classification',         timed: true, perStage: true },
  { match: /General Classification/i,        classKind: 'gc',     scope: 'stage',   eventName: 'Stage General Classification', timed: true, cumulative: true },
  { match: /Points Classification/i,         classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification', timed: false, cumulative: true },
  { match: /KOM Classification/i,            classKind: 'kom',    scope: 'overall', eventName: 'Overall Mountain Classification', timed: false, cumulative: true },
  // Jóvenes = sub-clasificación de la GENERAL → tiempo acumulado, no puntos.
  // scope='overall' la hace visible mediante keepForWeb (migración 092).
  { match: /Young Rider Classification/i,    classKind: 'youth',  scope: 'overall', eventName: 'Overall Youth Classification', timed: true, cumulative: true },
  { match: /Team General Classification/i,   classKind: 'teams',  scope: 'overall', eventName: 'Overall Teams Classification',  timed: true,  teamRows: true, cumulative: true },
];

function buildClassification(slot, spec, rows) {
  const winner = rows.find((r) => r.rank === 1);
  return {
    eventId: synthEventId(slot, spec.classKind, spec.scope),
    classKind: spec.classKind, scope: spec.scope,
    eventName: spec.eventName,
    isTeamEvent: !!spec.teamRows,
    winnerName: winner ? winner.riderDisplay : null,
    rowCount: rows.length,
    rows,
  };
}

async function fetchList(server, listName, selector, page = 'results') {
  // ⚠ El selector de etapa es &selectorResult=<ResultID> (NO &s=, que se IGNORA y
  // devuelve siempre la etapa por defecto — verificado contra Norway 2025: con &s=
  // las 4 etapas daban la misma clasificación). El valor sale de list.SelectorResults[].
  // `page` = 'results' (listas definitivas) o 'live' (fallback en vivo, sin selector).
  const url = `https://${server}/${EVENT}/${page}/list?key=${KEY}` +
    `&listname=${encodeURIComponent(listName)}&page=${page}&contest=${encodeURIComponent(CONTEST)}` +
    `&r=all&l=0&fav=&openedGroups=%7B%7D&term=` +
    (selector != null ? `&selectorResult=${selector}` : '');
  return getJson(url);
}

let KEY = null;   // resuelto del config

function listDefsForContest(config, contest) {
  const defs = (config?.Tab?.Config?.Lists || []).filter((item) => item?.Name);
  const exact = defs.filter((item) => String(item.Contest ?? '1') === String(contest));
  return exact.length ? exact : defs;
}

// Fechas publicadas en el cabecero de una lista (results o live), en formato
// "YYYY-MM-DD". La lista LIVE no tiene selector de etapa: la única forma de saber a
// qué jornada corresponde es su cabecero `#stage_date`.
export function listHeaderDates(payload) {
  const header = payload?.list?.ListHeaderText || '';
  return [...header.matchAll(/id=["']stage_date["'][^>]*>\s*<span>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/span>/g)]
    .map((match) => `${match[3]}-${match[2]}-${match[1]}`);
}

// ResultID del selector de una lista para una etapa concreta ("Stage 4" → 4). Las
// listas de generales exponen su propio selector por etapa; pedirlas SIN selector
// devuelve el acumulado de la ÚLTIMA etapa publicada, que no tiene por qué ser la que
// se está volcando. Devuelve null si la lista no ofrece esa etapa.
export function selectorForStage(selectorResults, stageNumber) {
  for (const entry of selectorResults || []) {
    const match = /(\d+)/.exec(entry?.ShowAs || '');
    if (match && parseInt(match[1], 10) === stageNumber) return entry.ResultID;
  }
  return null;
}

// Las listas LIVE de puntos y montaña son acumulados provisionales. Exigir fecha,
// columnas y filas completas evita atribuir a hoy una clasificación anterior.
export function liveOverallRows(payload, spec, expectedDate) {
  if (!expectedDate || !['points', 'kom'].includes(spec?.classKind)) return [];
  const dates = listHeaderDates(payload);
  if (!dates.length || dates.some((date) => date !== expectedDate)) return [];
  const fields = payload?.DataFields;
  if (!Array.isArray(fields) || !/DisplayBib/i.test(String(fields[3]))
      || !/DisplayName/i.test(String(fields[5]))
      || !/DisplayPoints/i.test(String(fields[8]))) return [];
  const raw = flattenData(payload?.data);
  if (!raw.length || raw.some((row) => row.length !== 9)) return [];
  // LIVE coloca dorsal/nombre/equipo en 3/5/7; Results usa 5/3/6.
  const liveSpec = { ...spec, cols: { rank: 2, bib: 3, name: 5, team: 7, value: 8 } };
  const rows = mapRows(raw, liveSpec, spec.classKind, false);
  if (!rows.some((row) => row.rank === 1)
      || rows.some((row) => row.rank == null || row.bib == null || row.resultValue == null)
      || new Set(rows.map((row) => row.bib)).size !== rows.length) return [];
  return rows;
}

export function validateDatedResult(payload, profile) {
  if (!profile?.dateKey) return;
  const dates = listHeaderDates(payload);
  if (!dates.length || dates.some((date) => date !== profile.dateKey)) {
    throw new Error(`La fecha de la clasificación no coincide con ${profile.dateKey}`);
  }
  const fields = payload?.DataFields || [];
  if (fields[profile.cols.bib] !== 'DisplayBib' || fields[profile.cols.name] !== 'DisplayNameAsterisk') {
    throw new Error('Columnas de dorsal/nombre incompatibles con el perfil de la carrera');
  }
}

// Valida que las columnas del perfil siguen existiendo con el mismo significado. Un
// cambio de plantilla de race|result desplaza las posiciones y un mapeo ciego daría
// un dorsal por un nombre. Se comprueba la posición de puesto, dorsal y nombre.
export function validateProfileColumns(payload, profile) {
  if (!profile?.cols) return;
  const fields = Array.isArray(payload?.DataFields) ? payload.DataFields : [];
  const at = (i) => String(fields[i] ?? '');
  if (!/WithStatus|Rank|StageRank|FinishRank/i.test(at(profile.cols.rank))) {
    throw new Error(`La columna de puesto (${profile.cols.rank}) no es un rank: "${at(profile.cols.rank)}"`);
  }
  if (!/PrintedBib|DisplayBib|^BIB$/i.test(at(profile.cols.bib))) {
    throw new Error(`La columna de dorsal (${profile.cols.bib}) no es un dorsal: "${at(profile.cols.bib)}"`);
  }
  if (!/DisplayName/i.test(at(profile.cols.name))) {
    throw new Error(`La columna de nombre (${profile.cols.name}) no es un nombre: "${at(profile.cols.name)}"`);
  }
}

function writeOutput(stages) {
  const out = {
    competitionId: Number(COMPETITION_ID),
    disciplineId: 10,
    source: 'raceresult',
    raceresultEvent: EVENT,
    raceresultContest: CONTEST,
    fetchedAt: new Date().toISOString(),
    stageCount: stages.length,
    stages,
  };

  const file = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`\n✅ ${stages.length} jornadas, ${stages.reduce((a, s) => a + s.classificationCount, 0)} clasificaciones → ${file}`);
  if (PRETTY) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ── pipeline ────────────────────────────────────────────────────────────────
async function main() {
  checkArgs();
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher race|result — event=${EVENT} · contest=${CONTEST} (puente sintético ${COMPETITION_ID}) · idBase=${ID_BASE}`);

  // 1) config → key, server, listas, EventOver.
  const cfg = await getJson(`${CONFIG_HOST}/${EVENT}/results/config?lang=en`);
  if (!cfg || !cfg.key) { log(`FATAL: race|result no devuelve config para event ${EVENT} (¿eventId correcto?)`); process.exit(1); }
  KEY = cfg.key;
  const server = cfg.server || 'my.raceresult.com';
  const eventOver = !!cfg.EventOver;
  const contestName = cfg.contests?.[CONTEST] || `contest ${CONTEST}`;
  const lists = listDefsForContest(cfg, CONTEST).map((item) => item.Name);
  log(`  ${cfg.eventname || EVENT} · ${contestName} · server=${server} · EventOver=${eventOver}`);
  log(`  listas: ${lists.length}`);

  // localizar el nombre real de cada lista que nos interesa
  const findList = (re) => lists.find((n) => re.test(n)) || null;
  // El perfil puede fijar la lista del cuadro de carrera (eventos sin "Stage Results").
  const stageListName = (PROFILE?.listPattern ? findList(PROFILE.listPattern) : null)
    || findList(/Stage Results/i);
  if (!stageListName) { log('FATAL: no hay lista "Stage Results" en este evento'); process.exit(1); }

  // En una one-day la lista Stage Results se actualiza vuelta a vuelta. La lista
  // live actúa como gate de distancia/meta y la de results aporta tiempos y gaps.
  // No se consultan ni emiten sprints, KOM/QOM ni parciales de puntos de paso.
  if (ONE_DAY) {
    // Gate propio por parciales (cronos de racetiming.ca): no se publica hasta que
    // el último en salir ha terminado. Se lee de la lista de progreso del mismo
    // evento; si el organizador la retira, se aborta en vez de publicar un parcial.
    let progressHandled = false;
    if (PROFILE?.progress) {
      const progressListName = findList(PROFILE.progress.listPattern);
      if (!progressListName) {
        log(`FATAL: no se encuentra la lista de progreso ${PROFILE.progress.listPattern} en el evento ${EVENT}`);
        process.exit(1);
      }
      await sleep(DELAY);
      const state = progressCompletionState(await fetchList(server, progressListName, null), PROFILE.progress);
      if (!state.ready) {
        log(`  pendiente: ${state.finished} finalizados, ${state.inProgress} en curso, ${state.notStarted} sin salir; no se publica ninguna clasificación`);
        writeOutput([]);
        return;
      }
      log(`  progreso completo: ${state.finished} finalizados (último en salir: ${state.lastStarterFinished === true ? 'sí' : state.lastStarterFinished === false ? 'no' : 'n/d'})`);
      progressHandled = true;
    }

    let completion = {
      ready: progressHandled || REQUIRED_LAPS === 0 || eventOver,
      hasFinish: progressHandled || eventOver,
      maxLap: 0,
      rowCount: 0,
      timingPointIndex: -1,
    };

    if (!completion.ready && REQUIRED_LAPS > 0) {
      await sleep(DELAY);
      const liveCfg = await getJson(`${CONFIG_HOST}/${EVENT}/live/config?lang=en`);
      if (liveCfg?.key) KEY = liveCfg.key;
      const liveListName = listDefsForContest(liveCfg, CONTEST)
        .map((item) => item.Name)
        .find((name) => /Most Recent Timing Point/i.test(name));
      if (liveListName) {
        await sleep(DELAY);
        completion = liveCompletionState(
          await fetchList(server, liveListName, null, 'live'),
          REQUIRED_LAPS,
        );
      }
    }

    const gateLabel = progressHandled
      ? 'progreso completo'
      : completion.hasFinish
        ? 'FINISH'
        : `${completion.maxLap}/${REQUIRED_LAPS} vueltas`;
    if (!completion.ready) {
      log(`  pendiente: ${gateLabel}; no se publica ninguna clasificación`);
      writeOutput([]);
      return;
    }
    log(`  gate de carrera completa: ${gateLabel}`);

    await sleep(DELAY);
    const result = await fetchList(server, stageListName, null);
    validateDatedResult(result, PROFILE);
    validateProfileColumns(result, PROFILE);
    const oneDaySpec = PROFILE?.cols ? { ...LIST_MAP[0], cols: PROFILE.cols } : LIST_MAP[0];
    const rows = mapRows(flattenData(result?.data), oneDaySpec, 'race', true);
    if (!rows.some((row) => row.rank === 1)) {
      log('  Stage Results sin ganador válido; no se publica ninguna clasificación');
      writeOutput([]);
      return;
    }

    const spec = {
      ...LIST_MAP[0],
      classKind: 'gc',
      scope: 'stage',
      eventName: 'Race Classification',
    };
    const classification = buildClassification(FINAL_SLOT, spec, rows);
    const stages = [{
      uciRaceId: synthRaceId(FINAL_SLOT),
      stageNumber: null,
      stageName: 'Race Classification',
      isFinalClassification: false,
      dateKey: DATE_ARG || PROFILE?.dateKey || null,
      raceType: null,
      startLocation: null,
      classificationCount: 1,
      classifications: [classification],
    }];
    log(`    one-day stage/gc ${String(rows.length).padStart(3)} filas (event ${classification.eventId})`);
    writeOutput(stages);
    return;
  }

  // 2) etapas disponibles (SelectorResults de Stage Results).
  await sleep(DELAY);
  const probe = await fetchList(server, stageListName, null);
  const selectors = (probe && probe.list && probe.list.SelectorResults) || [];
  // ShowAs "Stage N" → nº; ResultID = el valor de &s. Orden ascendente por nº.
  const stageSel = selectors
    .map((s) => ({ id: s.ResultID, n: (() => { const m = /(\d+)/.exec(s.ShowAs || ''); return m ? parseInt(m[1], 10) : null; })() }))
    .filter((s) => s.n != null)
    .sort((a, b) => a.n - b.n);
  if (!stageSel.length) { log('FATAL: SelectorResults vacío (no se detectan etapas)'); process.exit(1); }
  const lastStageNumber = stageSel[stageSel.length - 1].n;
  log(`  etapas detectadas: ${stageSel.map((s) => s.n).join(', ')} (última ${lastStageNumber})`);

  // Lista LIVE (pestaña "live") para el fallback en vivo: race|result publica la
  // clasificación oficial en "results/Stage Results" minutos TRAS meta, pero durante y
  // justo tras la etapa la clasificación (provisional) ya está en "live/LIVE Stage
  // Results". Cuando la de results venga vacía, caemos a esta. El config de results no
  // lista la pestaña live → pedimos su config aparte (best-effort; si falla, usamos el
  // nombre estándar). La lista LIVE NO tiene selector de etapa (solo la etapa en curso).
  let liveStageListName = null;
  await sleep(DELAY);
  const liveCfg = await getJson(`${CONFIG_HOST}/${EVENT}/live/config?lang=en`);
  const liveLists = listDefsForContest(liveCfg, CONTEST).map((item) => item.Name);
  liveStageListName = liveLists.find((n) => /LIVE Stage Results/i.test(n))
    || liveLists.find((n) => /Stage Results/i.test(n))
    || '03-Online LIVE|LIVE Stage Results';

  const stages = [];
  let lastOveralls = null;          // generales acumuladas de la última etapa con datos

  // Modo --stage N: se procesa SOLO esa etapa. Si N todavía no está en el selector de
  // "results" (race|result lo añade al publicar la oficial, minutos después de meta),
  // se entra igualmente por la lista LIVE. La lista LIVE no tiene selector y devuelve
  // SIEMPRE la etapa en curso → solo se usa aquí si su cabecera confirma la fecha de la
  // jornada pedida (--date). Sin --stage se leen solo las listas "results" oficiales.
  const selections = ONLY_STAGE != null
    ? [{ id: stageSel.find((sel) => sel.n === ONLY_STAGE)?.id ?? null, n: ONLY_STAGE }]
    : stageSel;

  for (const sel of selections) {
    const stageNumber = sel.n;
    const resultsSelector = sel.id;   // null = la etapa aún no está en el selector de results
    let stageRows = [];
    let provisional = false;

    if (resultsSelector != null) {
      // Stage Results de esta etapa (lista "results", la oficial/definitiva).
      await sleep(DELAY);
      const stageData = await fetchList(server, stageListName, resultsSelector);
      stageRows = mapRows(flattenData(stageData && stageData.data), LIST_MAP[0], 'stage', true);
    }
    // FALLBACK EN VIVO — SOLO en modo --stage N explícito. La lista "live/LIVE Stage
    // Results" NO tiene selector de etapa (devuelve SIEMPRE la etapa en curso, sea cual
    // sea el número que pidas) → si se usara en el modo "todas las etapas" replicaría la
    // clasificación de la etapa en vivo en TODAS las demás (bug real cazado el 17-jun:
    // 5 etapas con el mismo ganador). Por eso el fallback solo se activa cuando el caller
    // declara explícitamente QUÉ etapa quiere con --stage: ahí la responsabilidad de
    // pedir la etapa correcta (la que está en vivo) es de quien invoca, y el LIVE se
    // asigna a ESA etapa. Se exige además que la fecha del cabecero LIVE == --date para
    // no asignar la etapa en curso a una jornada equivocada. El upsert es idempotente:
    // cuando "results" publique la oficial, el siguiente volcado la reemplaza. Mismo
    // espíritu que Tissot/Matsport (parcial → se corrige).
    if (!stageRows.length && ONLY_STAGE != null && liveStageListName) {
      await sleep(DELAY);
      const liveData = await fetchList(server, liveStageListName, null, 'live');
      const liveDates = listHeaderDates(liveData);
      if (DATE_ARG && liveDates.length && liveDates.some((date) => date !== DATE_ARG)) {
        log(`    E${stageNumber} ⚠ lista LIVE de ${liveDates.join('/')} ≠ ${DATE_ARG} — no se usa (etapa equivocada)`);
      } else {
        const liveRows = mapRows(liveStageResultRows(liveData && liveData.data), LIST_MAP[0], 'stage', true);
        if (liveRows.length) { stageRows = liveRows; provisional = true; }
      }
    }
    if (!stageRows.length) { log(`  E${stageNumber} sin filas (no disputada / no publicada) — omitida`); continue; }

    // Las generales (GC/Points/KOM/Young/Team) son ACUMULADAS hasta la última etapa
    // DISPUTADA → cuelgan de la etapa de referencia. En modo "todas las etapas" esa es
    // la última detectada (lastStageNumber). En modo --stage N (volcado en vivo) la etapa
    // pedida ES la última disputada (las posteriores aún no existen) → adjuntar a ella.
    // Sin esto, con --stage 1 sobre una carrera de 5 etapas, las generales no se cargaban
    // (la 1 no era == lastStageNumber=5) y la web solo mostraba la clasificación de etapa.
    const isLastWithData = (ONLY_STAGE != null) ? (stageNumber === ONLY_STAGE) : (stageNumber === lastStageNumber);
    const classifications = [buildClassification(stageNumber, LIST_MAP[0], stageRows)];
    if (provisional) log(`    E${stageNumber} ⚠ clasificación de etapa PROVISIONAL (lista LIVE; results aún sin publicar)`);
    log(`    E${String(stageNumber).padEnd(2)} stage/stage    ${String(stageRows.length).padStart(3)} filas  (event ${classifications[0].eventId})`);

    // Generales ACUMULADAS (GC/Points/KOM/Young/Team): se piden una vez por etapa, pero
    // representan el acumulado HASTA esa etapa → solo tienen sentido colgando de la
    // etapa más reciente. Para no duplicar, solo las adjuntamos a la ÚLTIMA etapa con
    // datos. En etapas intermedias podríamos colgarlas, pero el upsert las trataría como
    // "del día" — mejor cargar solo la de etapa en intermedias y las generales en la última.
    // Solo puntos y montaña tienen lista LIVE acumulada; GC, jóvenes y equipos
    // esperan a que Results publique filas para esta etapa.
    if (isLastWithData && (resultsSelector != null || provisional)) {
      const overalls = [];
      for (const spec of LIST_MAP.slice(1)) {
        const ln = findList(spec.match);
        let rows = [];
        if (ln && resultsSelector != null) {
          await sleep(DELAY);
          let d = await fetchList(server, ln, null);
          // Cada lista de Results usa su propio selector de etapa. Sin selector se
          // conserva el comportamiento de las listas que solo tienen una jornada.
          const selectors = d?.list?.SelectorResults || [];
          if (selectors.length) {
            const selectorId = selectorForStage(selectors, stageNumber);
            if (selectorId != null) {
              await sleep(DELAY);
              d = await fetchList(server, ln, selectorId);
              rows = mapRows(flattenData(d?.data), spec, spec.classKind, spec.timed);
            }
          } else {
            rows = mapRows(flattenData(d?.data), spec, spec.classKind, spec.timed);
          }
        }
        if (!rows.length && ONLY_STAGE != null && !eventOver
            && (spec.classKind === 'points' || spec.classKind === 'kom')) {
          const pattern = spec.classKind === 'points' ? /LIVE Points Classification/i : /LIVE KOM Classification/i;
          const liveName = liveLists.find((name) => pattern.test(name));
          if (liveName) {
            await sleep(DELAY);
            rows = liveOverallRows(await fetchList(server, liveName, null, 'live'), spec, DATE_ARG);
            if (rows.length) log(`    E${stageNumber} ${spec.classKind}/overall LIVE provisional: ${rows.length} filas`);
          }
        }
        if (!rows.length) continue;
        overalls.push({ spec, rows });
      }
      lastOveralls = { stageNumber, overalls };
      // Si la carrera NO ha terminado, las generales SÍ cuelgan de la última etapa
      // (son las vigentes). Si ha terminado, irán SOLO a la pseudo-final (abajo).
      if (!eventOver) {
        for (const { spec, rows } of overalls) {
          classifications.push(buildClassification(stageNumber, spec, rows));
          log(`    E${String(stageNumber).padEnd(2)} ${(spec.scope + '/' + spec.classKind).padEnd(14)} ${String(rows.length).padStart(3)} filas  (vigente)`);
        }
      } else {
        for (const { spec, rows } of overalls)
          log(`    E${String(stageNumber).padEnd(2)} ${(spec.scope + '/' + spec.classKind).padEnd(14)} ${String(rows.length).padStart(3)} filas  → SOLO a FINAL (carrera terminada)`);
      }
    }

    stages.push({
      uciRaceId: synthRaceId(stageNumber),
      stageNumber,
      stageName: `Stage ${stageNumber}`,
      isFinalClassification: false,
      dateKey: null,                  // race|result no expone fecha de etapa fiable aquí
      raceType: null,                 // ITT/TTT no detectado (ver cabecera)
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
  }

  // Carrera terminada → pseudo-etapa "Final Classification" con las generales DEFINITIVAS
  // (quirk UCI: scope='stage' + isFinalClassification, migración 085). Mismo criterio que Matsport.
  if (eventOver && lastOveralls && lastOveralls.overalls.length && ONLY_STAGE == null) {
    const FINAL_NAMES = { gc: 'General Classification', points: 'Points Classification', kom: 'Mountain Classification', youth: 'Youth Classification', teams: 'Teams Classification' };
    const classifications = [];
    for (const { spec, rows } of lastOveralls.overalls) {
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
    log(`    FINAL (carrera terminada): ${classifications.length} clasificaciones desde la E${lastOveralls.stageNumber}`);
  }

  writeOutput(stages);
}

// Solo se ejecuta si se invoca como script; importarlo (tests) no dispara nada.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
