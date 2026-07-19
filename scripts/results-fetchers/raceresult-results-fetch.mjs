#!/usr/bin/env node
/**
 * raceresult-results-fetch.mjs — FETCHER de resultados desde RACE|RESULT
 * (my.raceresult.com), la plataforma de cronometraje de muchas carreras nórdicas
 * y de Europa central (Tour of Slovenia, Tour of Norway, …). Expone una API JSON
 * PÚBLICA sin auth (config + list), accesible por curl/Node, que publica en vivo
 * durante la etapa y valida minutos tras meta.
 *
 * EMITE EXACTAMENTE EL MISMO JSON que uci-results-fetch.mjs → el upsert
 * (uci-results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source ('uci'|'tissot'|'pdf'|'matsport'|'sportstiming'|
 * 'manual_timing'|'raceresult', migración 108) vía uci-results-cron.mjs.
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
 *   (Las listas LIVE se ignoran aquí: usamos las de la pestaña "results", definitivas.
 *    Mientras la etapa está en vivo, "Stage Results" del día ya refleja el live.)
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
 *
 * Args:
 *   --event           eventId numérico de race|result (raceresultCode), p. ej. 402988.
 *   --competition-id  competitionId del puente race_uci_links (sintético NEGATIVO;
 *                     obligatorio: el JSON lo lleva para que el upsert NO recablee el
 *                     puente; también nombra el archivo de salida <id>.json).
 *                     Convención: -(fnv1a("raceresult:"+eventId)%200000) — lo imprime
 *                     este script con --suggest-id.
 *   --stage           (opcional) limitar a un nº de etapa.
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
// ≤199999 → eventId > -2^31 garantizado. Sin --event queda NaN: solo lo usa main(),
// que valida los args antes (ver checkArgs).
const ID_BASE = (EVENT && /^\d+$/.test(EVENT)) ? fnv1a(`raceresult:${EVENT}`) % 200000 : NaN;

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (!EVENT || !/^\d+$/.test(EVENT)) { log('FATAL: falta --event <eventId numérico de race|result, p.ej. 402988>'); process.exit(1); }
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
export function normAbsTime(v) {
  const t = clean(v);
  if (!t || t.startsWith('+')) return null;
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
export function normGap(v) {
  const t = clean(v);
  if (!t || !t.startsWith('+')) return null;
  const body = t.slice(1);
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
  const C = colsByWidth(width, spec.teamRows);
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
      const cell = r[C.value];
      const abs = normAbsTime(cell);   // tiempo absoluto si la celda lo es ("3h14'10''")
      const gap = normGap(cell);       // gap si la celda es "+M:SS"
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
  // Jóvenes = sub-clasificación de la GENERAL → su columna de valor es TIEMPO acumulado
  // (líder tiempo absoluto, resto gap), NO puntos. timed:true aunque comparta ancho (9
  // col) con Points/KOM: el flag decide cómo interpretar la col [8] (normAbsTime/normGap
  // vs normPoints). scope='stage' como la GC (es la general de jóvenes del día).
  { match: /Young Rider Classification/i,    classKind: 'youth',  scope: 'stage',   eventName: 'Stage Youth Classification',  timed: true, cumulative: true },
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
    `&listname=${encodeURIComponent(listName)}&page=${page}&contest=1` +
    `&r=all&l=0&fav=&openedGroups=%7B%7D&term=` +
    (selector != null ? `&selectorResult=${selector}` : '');
  return getJson(url);
}

let KEY = null;   // resuelto del config

// ── pipeline ────────────────────────────────────────────────────────────────
async function main() {
  checkArgs();
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher race|result — event=${EVENT} (puente sintético ${COMPETITION_ID}) · idBase=${ID_BASE}`);

  // 1) config → key, server, listas, EventOver.
  const cfg = await getJson(`${CONFIG_HOST}/${EVENT}/results/config?lang=en`);
  if (!cfg || !cfg.key) { log(`FATAL: race|result no devuelve config para event ${EVENT} (¿eventId correcto?)`); process.exit(1); }
  KEY = cfg.key;
  const server = cfg.server || 'my.raceresult.com';
  const eventOver = !!cfg.EventOver;
  const lists = ((cfg.Tab && cfg.Tab.Config && cfg.Tab.Config.Lists) || []).map((l) => l.Name);
  log(`  ${cfg.eventname || EVENT} · server=${server} · EventOver=${eventOver}`);
  log(`  listas: ${lists.length}`);

  // localizar el nombre real de cada lista que nos interesa
  const findList = (re) => lists.find((n) => re.test(n)) || null;
  const stageListName = findList(/Stage Results/i);
  if (!stageListName) { log('FATAL: no hay lista "Stage Results" en este evento'); process.exit(1); }

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
  const liveLists = ((liveCfg && liveCfg.Tab && liveCfg.Tab.Config && liveCfg.Tab.Config.Lists) || []).map((l) => l.Name);
  liveStageListName = liveLists.find((n) => /LIVE Stage Results/i.test(n))
    || liveLists.find((n) => /Stage Results/i.test(n))
    || '03-Online LIVE|LIVE Stage Results';

  const stages = [];
  let lastOveralls = null;          // generales acumuladas de la última etapa con datos

  for (const sel of stageSel) {
    const stageNumber = sel.n;
    if (ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;

    // Stage Results de esta etapa (lista "results", la oficial/definitiva).
    await sleep(DELAY);
    const stageData = await fetchList(server, stageListName, sel.id);
    let stageRows = mapRows(flattenData(stageData && stageData.data), LIST_MAP[0], 'stage', true);
    let provisional = false;
    // FALLBACK EN VIVO — SOLO en modo --stage N explícito. La lista "live/LIVE Stage
    // Results" NO tiene selector de etapa (devuelve SIEMPRE la etapa en curso, sea cual
    // sea el número que pidas) → si se usara en el modo "todas las etapas" replicaría la
    // clasificación de la etapa en vivo en TODAS las demás (bug real cazado el 17-jun:
    // 5 etapas con el mismo ganador). Por eso el fallback solo se activa cuando el caller
    // declara explícitamente QUÉ etapa quiere con --stage: ahí la responsabilidad de
    // pedir la etapa correcta (la que está en vivo) es de quien invoca, y el LIVE se
    // asigna a ESA etapa. El upsert es idempotente: cuando "results" publique la oficial,
    // el siguiente volcado la reemplaza. Mismo espíritu que Tissot/Matsport (parcial →
    // se corrige). En el modo sin --stage solo se leen las listas "results" oficiales
    // (con selector por etapa, nunca se replican).
    if (!stageRows.length && ONLY_STAGE != null && liveStageListName) {
      await sleep(DELAY);
      const liveData = await fetchList(server, liveStageListName, null, 'live');
      const liveRows = mapRows(flattenData(liveData && liveData.data), LIST_MAP[0], 'stage', true);
      if (liveRows.length) { stageRows = liveRows; provisional = true; }
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
    if (isLastWithData) {
      const overalls = [];
      for (const spec of LIST_MAP.slice(1)) {
        const ln = findList(spec.match);
        if (!ln) continue;
        await sleep(DELAY);
        const d = await fetchList(server, ln, null);
        const rows = mapRows(flattenData(d && d.data), spec, spec.classKind, spec.timed);
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

  const out = {
    competitionId: Number(COMPETITION_ID),
    disciplineId: 10,
    source: 'raceresult',
    raceresultEvent: EVENT,
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
