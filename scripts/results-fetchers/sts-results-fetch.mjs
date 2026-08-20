#!/usr/bin/env node
/**
 * sts-results-fetch.mjs — FETCHER de resultados desde STS / Wiclax
 * (stsport.fr), el cronometrador de muchas carreras francesas (La Route
 * d'Occitanie, clásicas y pruebas FFC, Andorra Clàssica, Tour du Piémont
 * Pyrénéen…). STS publica el LIVE con el motor **Wiclax**, que expone un
 * fichero de datos `.clax` (XML) PÚBLICO y SIN AUTH bajo
 * `https://www.stsport.fr/LIVE/<CARPETA>/<archivo>.clax`. Se actualiza EN
 * VIVO durante la etapa y valida minutos tras meta — antes que UCI DataRide
 * (que en estas carreras pequeñas tarda días o no llega).
 *
 * EMITE EXACTAMENTE EL MISMO JSON que uci-results-fetch.mjs → el upsert
 * (uci-results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source (migración 109) vía uci-results-cron.mjs.
 *
 * CONTRATO .clax (Wiclax — verificado contra La Route d'Occitanie 2025 y 2026;
 * detalle completo en STS-TIMING-API.md):
 *   <Epreuve ... etapeActive="N" formatLicence="Code UCI" fede="UCI" TZ="120">
 *     <Etapes>
 *       <Etape type="0|1" chrono="0|2" distance="…" ...>   ← 1 por etapa
 *         <Engages><E d="1" n="STAUNE-MITTET Johannes" c="DECATHLON…"
 *                     a="2002" x="M" l="596" l2="10019759082" na="NOR" /> …
 *         <Resultats><R d="1" t="04h31'03" m="40,29" g="-" /> …      ← ETAPA
 *         <General><R d="1" t="12h52'04" m="39,52" g="-" /> …        ← GC del día
 *         <ClassementsAnnexes>
 *           <Clt id="gpm"><Rush id="GN"><res dos="102" pts="28" /> …  ← MONTAÑA overall
 *           <Clt id="pts"><Rush id="GN"><res dos="37" pts="26" bonif="4"/> … ← PUNTOS overall
 *           <Clt id="JE" ><Rush id="GN"> …                            ← JÓVENES overall
 *
 *   Filas <R>: el RANK es POSICIONAL (1ª fila = ganador; sin atributo de puesto).
 *     d = dorsal · t = tiempo ("HHhMM'SS" o "HHhMM'SS,cc"; ITT sub-hora "00h15'28")
 *       · "Abandon" (con tr="4") → IRM DNF · m = km/h media · b = hora de paso
 *       · g = gap ("-" líder · "+0'04" · "+1'02,00" · "+0:36" · "+16:49"
 *               · "+1h00'15" · "+ 1 tour" lapped) · p0/pb0/tt/tc/mt = parciales (ignorados).
 *   Etapa CRI: type="1" → raceType='ITT' (la web aplica el
 *     truncado de CRI). CRE: type="2" → raceType='TTT'; Wiclax
 *     lista a los corredores agrupados por equipo y el fetcher deja el puesto
 *     y el tiempo solo en el primer corredor de cada equipo para que web/apps
 *     colapsen la tabla correctamente. type="0"/chrono="0" → etapa en ruta.
 *   Anexas <Clt id="gpm|pts|JE"> → <Rush id="GN"> = clasificación ACUMULADA
 *     (montaña/puntos/jóvenes); filas <res dos= pts= [bonif=]> en orden de puesto.
 *
 * FILAS: el display se reconstruye desde <Engages> por dorsal ("APELLIDO Nombre",
 *   ya en mayúsculas-apellido). El corredor REAL se resuelve POR DORSAL contra la
 *   startlist curada (RPC 082) — los ASCII de STS dan igual. STS lleva el código
 *   UCI (l2) pero el puente usa dorsal, como todas las fuentes.
 *
 * NORMALIZACIÓN (→ formato BD / web, igual que raceresult/matsport):
 *   tiempo absoluto "04h31'03" → "4:31:03" · "00h15'28,34" → "0:15:28" (sin centésimas).
 *   gap "+0'04"/"+0:04" → "+0:04" · "+1'02,00" → "+1:02" · "+16:49" → "+16:49"
 *       · "+1h00'15" → "+1:00:15" · "-" (líder) → null.
 *   ⚠ "+ N tour"/"+ N tours" (DOBLADO): Wiclax le da tiempo absoluto, pero de una
 *       distancia MENOR → NO comparable con el ganador. No se incluye: no es una
 *       clasificación final y tampoco se infiere OTL/FC. El estado oficial de fuera
 *       de control solo llega explícito en `t` ("Hors délai"/HD/OTL).
 *   puntos "28" → "28".  IRM: Abandon→DNF · "Non partant"/NP→DNS · "Hors délai"/HD→OTL
 *       · "Disqualifié"/DSQ/EX→DSQ (códigos de js/uci-irm.js).
 *
 * IDs SINTÉTICOS: STS no existe en DataRide → eventId/uciRaceId NEGATIVOS y
 *   deterministas (mismo esquema que Tissot/PDF/Matsport, salt propio "sts:"):
 *   fnv1a("sts:"+code)%200000 como base; el competitionId del puente es -base.
 *   ⚠ Al conmutar la fuente de una carrera ya volcada, la purga de gemelas del
 *   upsert (090) reemplaza los placeholders automáticamente.
 *
 * Solo se emiten etapas con <Resultats> publicado (la ventana de meta del cron lo
 * garantiza). La pseudo-etapa "Final Classification" (stageNumber NULL,
 * isFinalClassification, scope='stage', quirk UCI 085) se clona de la General +
 * anexas overall de la ÚLTIMA etapa cuando la carrera ha terminado.
 *
 * Uso (desde la raíz del repo; fetch nativo, sin deps):
 *   node scripts/results-fetchers/sts-results-fetch.mjs \
 *     --clax-url 'https://www.stsport.fr/LIVE/LAROUTEDOCCITANIE/2026-RDO.clax' \
 *     --code LAROUTEDOCCITANIE/2026-RDO --competition-id -12345
 *   (--stage N para limitar a una etapa; --suggest-id para el competitionId)
 *
 * Args:
 *   --clax-url        URL absoluta del .clax (obligatorio).
 *   --article-url     artículo STSport que publica los PDFs por etapa. Cuando el
 *                     PDF supera la validación de filas, su clasificación de etapa
 *                     tiene prioridad sobre el .clax; si no, se conserva el .clax.
 *   --skip-clax-points omite la clasificación `pts` del .clax para esta carrera.
 *   --code            identificador estable de la edición ("LAROUTEDOCCITANIE/2026-RDO");
 *                     semilla del competitionId sintético y de la salida. Por defecto
 *                     se deriva de la URL (path tras /LIVE/, sin extensión).
 *   --competition-id  competitionId del puente race_uci_links (sintético NEGATIVO;
 *                     obligatorio salvo --suggest-id). Lo imprime --suggest-id.
 *   --stage           (opcional) limitar a un nº de etapa.
 *   --one-day         fuerza el modelado de carrera de UN DÍA: la (única) etapa se
 *                     emite como clasificación principal con stageNumber=NULL
 *                     (classKind='gc', scope='stage') + anexas montaña/puntos con
 *                     stageNumber=NULL — igual que las one-day de otras fuentes
 *                     (Hageland, CN), para que la web la trate como prueba de un día
 *                     (raceDayId NULL ⇒ cabecera completa, sin pestaña "Etapa 1"/"F").
 *                     Se AUTODETECTA cuando el .clax trae 1 sola etapa y dt1===dt2.
 *   --out             carpeta de salida (default _results_run/sts-<code-aplanado> JUNTO A ESTE
 *                     script, no relativo al cwd). La ruta que imprime al terminar es la
 *                     real: leer esa, no reconstruirla a mano.
 *   --pretty          además vuelca el JSON a stdout.
 *   --suggest-id      imprime el competitionId sintético sugerido y sale.
 */
'use strict';

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const CLAX_URL = getArg('clax-url');
const ARTICLE_URL = getArg('article-url');
const SKIP_CLAX_POINTS = hasFlag('skip-clax-points');
const ONLY_STAGE = getArg('stage') != null ? parseInt(getArg('stage'), 10) : null;
const FORCE_ONE_DAY = hasFlag('one-day');
const PRETTY = hasFlag('pretty');
// --stage-offset: ajuste al nº de etapa que emitimos (Wiclax numera 1-based por
// orden de aparición, pero NUESTRAS race_days pueden empezar en 0 cuando hay
// prólogo). El upsert resuelve raceDayId por (raceId, stageNumber), así que el
// nº emitido DEBE casar con race_days.stageNumber. Ej.: race con prólogo
// (race_days 0,1,2) + .clax con 3 Etapes (1,2,3) → --stage-offset -1.
const STAGE_OFFSET = getArg('stage-offset') != null ? parseInt(getArg('stage-offset'), 10) : 0;

const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

// code = identificador estable de la edición. Por defecto: path tras /LIVE/ sin extensión.
export function deriveCode(url) {
  try {
    const u = new URL(url);
    const m = /\/LIVE\/(.+?)\.clax$/i.exec(u.pathname);
    if (m) return decodeURIComponent(m[1]);
    return decodeURIComponent(u.pathname.replace(/^\/+|\.clax$/gi, ''));
  } catch { return url; }
}
const CODE = getArg('code') || (CLAX_URL ? deriveCode(CLAX_URL) : null);
const COMPETITION_ID = getArg('competition-id');
const codeFlat = (CODE || 'sts').replace(/[^A-Za-z0-9]+/g, '-');
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `sts-${codeFlat}`);

// ── IDs sintéticos (negativos, deterministas; salt "sts:") ─────────────────
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// ≤199999 → eventId > -2^31 garantizado. Sin --clax-url/--code queda NaN: solo lo usa
// main(), que valida los args antes (importar el módulo desde un test no ejecuta nada).
const ID_BASE = CODE ? fnv1a(`sts:${CODE}`) % 200000 : NaN;

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests. --suggest-id sigue funcionando SIN --clax-url
// (basta --code), como antes.
function checkArgs() {
  if (!CLAX_URL && !hasFlag('suggest-id')) { log('FATAL: falta --clax-url <URL del .clax>'); process.exit(1); }
  if (hasFlag('suggest-id')) {
    process.stdout.write(String(-ID_BASE) + '\n');
    process.exit(0);
  }
  if (!COMPETITION_ID || !/^-\d+$/.test(COMPETITION_ID)) {
    log(`FATAL: falta --competition-id <entero NEGATIVO sintético> (sugerido para "${CODE}": ${-ID_BASE})`);
    process.exit(1);
  }
}

const FINAL_SLOT = 99;                               // pseudo-etapa "Final Classification"
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
export function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }

// IRM (estado francés de Wiclax) → códigos UCI (los que entiende js/uci-irm.js).
const IRM_MAP = {
  AB: 'DNF', ABD: 'DNF', ABANDON: 'DNF', DNF: 'DNF',
  NP: 'DNS', 'NON PARTANT': 'DNS', DNS: 'DNS',
  HD: 'OTL', 'HORS DELAI': 'OTL', OTL: 'OTL',
  DSQ: 'DSQ', DQ: 'DSQ', EX: 'DSQ', EXCLU: 'DSQ', DISQUALIFIE: 'DSQ',
};
export function irmOf(tValue) {
  // En el .clax el ESTADO viaja en el atributo t cuando no es un tiempo
  // ("Abandon", "Non partant", "Hors délai", "Disqualifié"…). Si t parece un
  // tiempo (HHhMM'…), no es IRM.
  const v = clean(tValue);
  if (!v || /^\d+\s*h/i.test(v)) return null;          // es un tiempo, no un estado
  const key = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return IRM_MAP[key] || null;                         // estado desconocido → null (se ignora, no rompe)
}

// tiempo absoluto Wiclax "04h31'03" / "00h15'28,34" / "12h52'04" → "H:MM:SS" (formato BD).
// (Se truncan las centésimas: la BD/web manejan segundos enteros; la CRI ya tiene su
// truncado propio en la web, isIttStage.)
export function absTime(tValue) {
  const v = clean(tValue);
  const m = /^(\d+)\s*h\s*(\d{1,2})\s*'\s*(\d{1,2})/.exec(v);   // HHhMM'SS(,cc)
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10), se = parseInt(m[3], 10);
  return `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}`;
}

// gap Wiclax → estilo UCI en BD ("+M:SS" / "+H:MM:SS"; sin unidades, separador ":").
//   "-" (líder) → null · "+0'04" → "+0:04" · "+1'02,00" → "+1:02"
//   "+0:36" → "+0:36" · "+16:49" → "+16:49" · "+1h00'15" → "+1:00:15"
//   "+ 1 tour" (lapped) → null (sin gap numérico; el tiempo absoluto va en resultValue).
export function normGap(gValue) {
  let v = clean(gValue);
  if (!v || v === '-' ) return null;
  if (!v.startsWith('+')) return null;
  v = v.slice(1).trim();
  if (/tour|lap/i.test(v)) return null;                // "+ 1 tour" → sin gap numérico
  // "1h00'15" → H:MM:SS
  let m = /^(\d+)\s*h\s*(\d{1,2})\s*'?\s*(\d{1,2})?/.exec(v);
  if (/h/i.test(v) && m) {
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10), se = parseInt(m[3] || '0', 10);
    return `+${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}`;
  }
  // "M'SS(,cc)" o "M:SS"  (también "MM:SS")
  m = /^(\d+)\s*[':]\s*(\d{1,2})/.exec(v);
  if (m) {
    const mi = parseInt(m[1], 10), se = parseInt(m[2], 10);
    return `+${mi}:${String(se).padStart(2, '0')}`;
  }
  // "SS" suelto (raro)
  m = /^(\d{1,2})(?:[.,]\d+)?$/.exec(v);
  if (m) return `+${parseInt(m[1], 10)}`;
  return null;
}

// ── parseo XML por regex (sin deps; el .clax es plano y bien formado) ────────
export function attrs(openTag) {
  const o = {};
  for (const m of openTag.matchAll(/(\w+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
}
// `chrono` no codifica de forma fiable la modalidad: Tour du Limousin E1 2026
// declara type="0" (ruta) con chrono="2". Cuando hay type explícito, manda
// siempre; chrono solo mantiene compatibilidad con ficheros antiguos sin type.
export function stageRaceType(stageAttrs = {}) {
  const stageType = String(stageAttrs.type ?? '');
  if (stageType === '2') return 'TTT';
  if (stageType === '1' || (!stageType && Number(stageAttrs.chrono) > 0)) return 'ITT';
  return null;
}
export function firstBlock(xml, tag) {
  // Devuelve el CONTENIDO del primer <tag>…</tag>, o '' si es self-closing/ausente.
  const re = new RegExp(`<${tag}\\b[^>]*?(/>|>)`, 's');
  const m = re.exec(xml);
  if (!m) return '';
  if (m[1] === '/>') return '';                        // <tag .../> vacío
  const start = m.index + m[0].length;
  const close = xml.indexOf(`</${tag}>`, start);
  return close === -1 ? '' : xml.slice(start, close);
}
export function allStages(xml) {
  // <Etape …>…</Etape> a tope: capturamos open-tag (attrs) + cuerpo.
  const out = [];
  const re = /<Etape\b([^>]*)>(.*?)<\/Etape>/gs;
  let m;
  while ((m = re.exec(xml))) out.push({ a: attrs('<Etape ' + m[1] + '>'), body: m[2] });
  return out;
}
// Cuerpo del <Rush id="<id>">…</Rush> dentro de un <Clt> ('' si self-closing/ausente).
// Robusto frente a atributos extra (nom="Général") y a la variante vacía
// <Rush id="GN" nom="…" />.
export function rushBody(cltBody, rushId) {
  const open = new RegExp(`<Rush\\b[^>]*\\bid="${rushId}"[^>]*?(/>|>)`, 's');
  const mm = open.exec(cltBody);
  if (!mm) return '';
  if (mm[1] === '/>') return '';
  const start = mm.index + mm[0].length;
  const close = cltBody.indexOf('</Rush>', start);
  return close === -1 ? cltBody.slice(start) : cltBody.slice(start, close);
}

// filas <R d= t= g=> de un bloque (Resultats o General), en orden de aparición.
//
// ENCODING (clave): emitimos el TIEMPO ABSOLUTO de CADA clasificado en timeText y
// NUNCA gapText. Wiclax da el tiempo total de todos los finishers (verificado:
// 127/127 en una etapa en ruta), y los corredores del MISMO grupo comparten el
// tiempo del cabeza de grupo (g="-"). Con timeText absoluto en todas y SIN gapText,
// la web entra en su "Caso A" (deriveGaps): deriva el gap = tiempo − ganador y pinta
// m.t. cuando el tiempo coincide con el de arriba — exactamente el comportamiento
// que queremos para metas en pelotón Y para la CRI (donde además trunca a segundos).
// Mezclar gapText con timeText rompería deriveGaps (la web exige !rows.some(gapText)).
export function parseResultRows(blockXml, riderByBib) {
  const rows = [];
  let rankCounter = 0;
  for (const m of blockXml.matchAll(/<R\b([^>]*)\/?>/g)) {
    const a = attrs('<R ' + m[1] + '>');
    const bib = a.d != null ? String(a.d) : null;
    const who = riderByBib.get(Number(a.d)) || {};
    const abs = absTime(a.t);
    // Estado explícito en t ("Abandon"/"Non partant"/…) → IRM directo.
    // Además: una fila con `tr` marcado (≠"0") que NO trae tiempo de meta legible ni
    // gap es un NO-FINISHER que Wiclax deja listado solo con sus parciales (p1/pb1);
    // no figura en la General del día. Se trata como DNF: así no se clasifica sin
    // tiempo (lo que rompería deriveGaps en la web y pintaría toda la etapa con
    // tiempos absolutos en vez de m.t.). `tr="4"` ya venía junto a t="Abandon";
    // `tr="1"` sin t/g es el mismo caso (corredor cortado). Verificado: GP Torres
    // Vedras 2026 E1, dorsal 174 (RIBEIRO Afonso).
    // DOBLADO ("+ 1 tour" / "+ 2 tours"): Wiclax SÍ le da tiempo absoluto, pero es el
    // tiempo de una distancia MENOR (ds/to menores que los del ganador) → NO es
    // comparable con el del vencedor. Clasificarlo con ese tiempo envenena la
    // clasificación ENTERA en la web: js/resultados.js activa `gapsDisguised` en
    // cuanto UNA fila rank>1 tiene timeText < ganador (el doblado, que rodó menos),
    // y entonces pinta el tiempo absoluto de TODAS las filas como si fuera un gap
    // ("+3:24:19"). Verificado en La Périgord Ladies 2026: 33 dobladas de 106 filas
    // → las 107 filas salían con gaps de ~3 h. Al no ser una clasificación final,
    // esta fila se descarta. OTL/FC solo puede salir de un estado explícito de `t`
    // (Hors délai/HD/OTL), nunca de que Wiclax la marque como doblada.
    const lapped = /tour|lap/i.test(clean(a.g) || '');
    const explicitIrm = irmOf(a.t);
    if (lapped && !explicitIrm) continue;
    const trMarked = a.tr != null && String(a.tr) !== '0';
    const irm = explicitIrm
      || (trMarked && !abs && !normGap(a.g) ? 'DNF' : null);
    if (irm) {
      rows.push({ rank: null, rankText: irm, bib, riderDisplay: who.display || null,
        teamName: who.teamName || null, resultValue: null, timeText: null, gapText: null,
        points: null, irm });
      continue;
    }
    // SIN TIEMPO ABSOLUTO → NO se clasifica. Una sola fila clasificada sin timeText
    // apaga deriveGaps en la etapa ENTERA: js/resultados.js:969-971 exige que TODAS
    // las filas con rank y sin irm tengan timeText parseable → la web pintaría
    // absolutos en vez de m.t. en todas, no solo en esta.
    // El guard `tr` de arriba cubre al no-finisher que Wiclax marca; este cubre al
    // que NO marca. Las filas dobladas ya se descartaron antes porque "1 tour" no es
    // una diferencia de tiempo ni una clasificación final.
    // ⚠ Tampoco vale caer al gap de Wiclax como resultValue: la fila quedaría
    // clasificada con timeText null → MISMO apagón de deriveGaps, solo que en
    // silencio. Sin tiempo de meta no hay resultado publicable: va como DNF (que es
    // lo que es: alguien que no completó la distancia del ganador) y NO consume
    // puesto, así que el rank posicional del resto no se descuadra.
    if (!abs) {
      rows.push({ rank: null, rankText: 'DNF', bib, riderDisplay: who.display || null,
        teamName: who.teamName || null, resultValue: null, timeText: null, gapText: null,
        points: null, irm: 'DNF' });
      continue;
    }
    rankCounter += 1;                                  // rank posicional (solo clasificados)
    const rank = rankCounter;
    rows.push({ rank, rankText: String(rank), bib,
      riderDisplay: who.display || null, teamName: who.teamName || null,
      resultValue: abs, timeText: abs, gapText: null,
      points: null, irm: null });
  }
  return rows;
}

// CRE/TTT Wiclax: <Resultats> lista corredores, no una fila sintética por equipo.
// Los primeros corredores de cada equipo comparten su tiempo de equipo y los que
// llegan descolgados pueden reaparecer más abajo con otro tiempo. El contrato que
// ya consumen web/apps (mismo que expandTeamTimeTrial de Tissot) es:
//   · primer corredor visto del equipo: rank + tiempo del EQUIPO;
//   · compañeros: rank/time null (siguen presentes para resolver y mostrar roster).
// Agrupamos por equipo globalmente, no solo por filas contiguas, para que un corredor
// descolgado no cree una segunda clasificación ficticia para el mismo equipo.
export function parseTttResultRows(blockXml, riderByBib) {
  const parsed = parseResultRows(blockXml, riderByBib);
  const seenTeams = new Set();
  let teamRank = 0;
  return parsed.map((row, index) => {
    if (row.irm) return row;
    const team = clean(row.teamName);
    const key = team ? team.toUpperCase() : `__row_${index}`;
    if (!seenTeams.has(key)) {
      seenTeams.add(key);
      teamRank += 1;
      return { ...row, rank: teamRank, rankText: String(teamRank) };
    }
    return {
      ...row,
      rank: null,
      rankText: null,
      resultValue: null,
      timeText: null,
      gapText: null,
    };
  });
}

// filas <res dos= pts=> (montaña/puntos) o <res dos= tps=> (jóvenes, TIEMPO — misma
// convención "HHhMM'SS" que <Resultats>/<General>) de una anexa (Rush id="GN").
// La clasificación de jóvenes es POR TIEMPO (mismo GC restringido a jóvenes), no por
// puntos: sin este caso, sus filas salían con resultValue/timeText null (sin tiempo).
export function parseAnnexeRows(rushXml, riderByBib) {
  const rows = [];
  let rank = 0;
  for (const m of rushXml.matchAll(/<res\b([^>]*)\/?>/g)) {
    const a = attrs('<res ' + m[1] + '>');
    const dos = Number(a.dos);
    // Las bonificaciones de llegada se añaden al mismo Rush de puntos, pero no
    // son una clasificación: llevan dorsal y bonif, sin pts ni tps. Publicarlas
    // creaba puestos con puntos null (Limousin E1 2026).
    if (!(dos > 0) || (a.pts == null && a.tps == null)) continue;
    rank += 1;
    const who = riderByBib.get(dos) || {};
    const abs = a.tps != null ? absTime(a.tps) : null;
    const points = a.pts != null ? Number(String(a.pts).replace(',', '.')) : null;
    rows.push({ rank, rankText: String(rank), bib: String(dos),
      riderDisplay: who.display || null, teamName: who.teamName || null,
      resultValue: abs || (a.pts != null ? String(a.pts) : null), timeText: abs, gapText: null,
      points, irm: null });
  }
  return rows;
}

// anexa por id → {classKind, eventName}
const ANNEXE_MAP = {
  gpm: { classKind: 'kom',    eventName: 'Overall Mountain Classification' },
  pts: { classKind: 'points', eventName: 'Overall Points Classification' },
  JE:  { classKind: 'youth',  eventName: 'Overall Youth Classification' },
  1:   { classKind: 'youth',  eventName: 'Overall Youth Classification' },
};

function buildClassification(slot, classKind, scope, eventName, rows, { teamEvent = false } = {}) {
  const winner = rows.find((r) => r.rank === 1);
  return {
    eventId: synthEventId(slot, classKind, scope),
    classKind, scope, eventName,
    isTeamEvent: !!teamEvent,
    winnerName: winner ? winner.riderDisplay : null,
    rowCount: rows.length,
    rows,
  };
}

// ── cliente ──────────────────────────────────────────────────────────────────
async function fetchClax(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) { log(`FATAL: ${url} → HTTP ${res.status}`); process.exit(1); }
  return await res.text();
}

// Los artículos STSport (SPIP) añaden un documento PDF por etapa al terminar.
// El texto visible está en el figcaption posterior al enlace, no dentro del <a>.
export function stagePdfLinksFromArticleHtml(html, articleUrl) {
  const links = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>[\s\S]{0,2400}?<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi)) {
    const label = clean(m[2].replace(/<[^>]+>/g, ' '));
    const source = `${label} ${decodeURIComponent(m[1]).replace(/[-_]/g, ' ')}`;
    const stage = source.match(/\b(\d{1,2})(?:er|ère|ere|e|ème|eme)?\s+(?:étape|etape|stage)\b/i)?.[1];
    if (!stage) continue;
    links.set(Number(stage), { stageNumber: Number(stage), label, href: new URL(m[1], articleUrl).href });
  }
  return [...links.values()].sort((a, b) => a.stageNumber - b.stageNumber);
}

async function pdfToLayoutText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
  const dir = mkdtempSync(join(tmpdir(), 'sts-results-pdf-'));
  const file = join(dir, 'stage.pdf');
  try {
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pdfGap = (value, previous) => {
  const text = clean(value);
  if (/^''$/.test(text)) return previous || '+0';
  const hms = text.match(/^à\s+(?:(\d+)h)?(?:(\d+)'\s*)?(?:(\d+)'')?$/i);
  if (!hms) return null;
  const hours = Number(hms[1] || 0), minutes = Number(hms[2] || 0), seconds = Number(hms[3] || 0);
  if (hours) return `+${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  if (minutes) return `+${minutes}:${String(seconds).padStart(2, '0')}`;
  return `+${seconds}`;
};

// El PDF STSport compone dos columnas por página. Se extraen por el par
// puesto+dorsal, que no aparece fuera de las tablas de clasificación.
function parsePdfIndividualRows(pdfText, riderByBib, heading, endHeading = null) {
  const rows = [];
  let previousGap = '+0';
  for (const originalPage of String(pdfText).split('\f').filter((p) =>
    heading.test(p) && /Nom Prénom\s+Eq\.\s+Temps/i.test(p))) {
    const page = endHeading ? originalPage.split(endHeading)[0] : originalPage;
    for (const line of page.split(/\r?\n/)) {
      const starts = [...line.matchAll(/(?:^|\s{2,})(\d+|DNS|DNF|AB|HD|DSQ)\s+(\d+)\s+/g)];
      for (let index = 0; index < starts.length; index += 1) {
        const current = starts[index];
        const next = starts[index + 1];
        const cell = line.slice(current.index, next ? next.index : undefined).trim();
        const [, rankText, bib] = current;
        const who = riderByBib.get(Number(bib)) || {};
        if (/^(DNS|DNF|AB|HD|DSQ)$/i.test(rankText)) {
          const irm = /^(DNS)$/i.test(rankText) ? 'DNS' : /^(HD)$/i.test(rankText) ? 'OTL' : /^(DSQ)$/i.test(rankText) ? 'DSQ' : 'DNF';
          rows.push({ rank: null, rankText: irm, bib, riderDisplay: who.display || null, teamName: who.teamName || null,
            resultValue: null, timeText: null, gapText: null, points: null, irm });
          continue;
        }
        const rank = Number(rankText);
        const absoluteMatch = cell.match(/(\d+)h(\d{2})'(\d{2})''/);
        const tail = cell.match(/(?:\d+h\d{2}'\d{2}''|à\s+(?:(?:\d+h)?(?:\d+')?\d*'')|'')\s*$/i)?.[0] || '';
        const absolute = absoluteMatch ? `${Number(absoluteMatch[1])}:${absoluteMatch[2]}:${absoluteMatch[3]}` : null;
        const gap = absolute ? null : pdfGap(tail, previousGap);
        // Algún nombre largo se parte a la línea siguiente y deja el valor de
        // tiempo allí. Se conserva el puesto/dorsal: se completará desde .clax
        // al aplicar el PDF, sin alterar el orden oficial del documento.
        if (rank !== 1 && !gap) {
          rows.push({ rank, rankText: String(rank), bib, riderDisplay: who.display || null, teamName: who.teamName || null,
            resultValue: null, timeText: null, gapText: null, points: null, irm: null });
          continue;
        }
        if (rank === 1 && !absolute) continue;
        if (gap) previousGap = gap;
        rows.push({ rank, rankText: String(rank), bib, riderDisplay: who.display || null, teamName: who.teamName || null,
          resultValue: absolute || gap, timeText: absolute, gapText: gap, points: null, irm: null });
      }
    }
  }
  const ranked = rows.filter((row) => row.rank != null).sort((a, b) => a.rank - b.rank);
  // Una DSQ puede dejar un salto deliberado de puesto (Limousin E1 2026:
  // 121, DSQ, 123). El PDF es la fuente oficial: se conserva su numeración,
  // validando únicamente inicio, orden y unicidad.
  if (!ranked.length || ranked[0].rank !== 1 || ranked.some((row, index) => index > 0 && row.rank <= ranked[index - 1].rank)) throw new Error('puestos no ordenados o duplicados');
  return [...ranked, ...rows.filter((row) => row.rank == null)];
}

export function parsePdfStageRows(pdfText, riderByBib) {
  return parsePdfIndividualRows(pdfText, riderByBib, /CLASSEMENT\s+ETAPE/i);
}

export function parsePdfYouthRows(pdfText, riderByBib) {
  return parsePdfIndividualRows(pdfText, riderByBib, /CLASSEMENT\s+G[ÉE]N[ÉE]RAL\s+DES\s+JEUNES/i, /CLASSEMENT\s+DU\s+COMBIN[ÉE]/i);
}

async function officialPdfRowsForStage(pdfLink, riderByBib, claxRows) {
  const claxByBib = new Map(claxRows.map((row) => [String(row.bib), row]));
  const pdfRows = parsePdfStageRows(await pdfToLayoutText(pdfLink.href), riderByBib).map((row) => {
    if (row.irm || row.timeText || row.gapText) return row;
    const fallback = claxByBib.get(String(row.bib));
    return fallback ? { ...row, resultValue: fallback.resultValue, timeText: fallback.timeText, gapText: fallback.gapText } : row;
  });
  const claxRanked = claxRows.filter((row) => row.rank != null).length;
  const pdfRanked = pdfRows.filter((row) => row.rank != null).length;
  if (pdfRanked < Math.max(1, Math.ceil(claxRanked * 0.9))) throw new Error(`${pdfRanked}/${claxRanked} filas clasificadas`);
  return pdfRows;
}

async function officialPdfYouthRows(pdfLink, riderByBib) {
  const rows = parsePdfYouthRows(await pdfToLayoutText(pdfLink.href), riderByBib);
  if (rows.some((row) => !row.irm && !row.resultValue)) throw new Error('tiempo o diferencia ausente');
  return rows;
}

// ── pipeline ──────────────────────────────────────────────────────────────────
async function main() {
  checkArgs();
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher STS/Wiclax — code="${CODE}" (puente sintético ${COMPETITION_ID}) · idBase=${ID_BASE}`);
  log(`  ${CLAX_URL}`);

  const xml = await fetchClax(CLAX_URL);
  const ep = attrs((/<Epreuve\b[^>]*>/.exec(xml) || ['', ''])[0]);
  log(`  ${clean(ep.nom)} · ${ep.dt1 || '?'} · etapeActive=${ep.etapeActive || '?'}`);
  const stagePdfs = new Map();
  if (ARTICLE_URL) {
    try {
      const response = await fetch(ARTICLE_URL, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`artículo HTTP ${response.status}`);
      for (const link of stagePdfLinksFromArticleHtml(await response.text(), ARTICLE_URL)) stagePdfs.set(link.stageNumber, link);
      log(`  PDF STSport: ${stagePdfs.size} etapa(s) publicada(s)`);
    } catch (error) {
      log(`  ⚠ PDF STSport no disponible (${error.message}); se usa .clax`);
    }
  }

  const stageBlocks = allStages(xml);
  if (!stageBlocks.length) { log('⚠️  0 etapas en el .clax'); }
  const lastIdx = stageBlocks.length - 1;

  // Carrera de UN DÍA: forzada por --one-day o autodetectada (1 sola etapa y la
  // Epreuve empieza y acaba el mismo día). La clasificación de meta se emite con
  // stageNumber=NULL (gc/stage) + anexas montaña/puntos NULL → la web la trata como
  // prueba de un día (raceDayId NULL, sin pestaña "Etapa 1"/"F"); espejo del modelo
  // Hageland/CN. Slot fijo FINAL_SLOT ⇒ eventIds estables y sin colisión con etapas.
  const ONE_DAY = FORCE_ONE_DAY ||
    (stageBlocks.length === 1 && clean(ep.dt1) && clean(ep.dt1) === clean(ep.dt2));

  const stages = [];
  let lastOveralls = null;   // {stageNumber, gcRows, annexes:[{classKind,eventName,rows}]}

  if (ONE_DAY && stageBlocks.length) {
    const stg = stageBlocks[0];
    const riderByBib = new Map();
    const engages = firstBlock(stg.body, 'Engages');
    for (const m of engages.matchAll(/<E\b([^>]*)\/?>/g)) {
      const a = attrs('<E ' + m[1] + '>');
      const d = Number(a.d);
      if (!(d > 0)) continue;
      riderByBib.set(d, { display: clean(a.n) || null, teamName: clean(a.c) || null });
    }
    const raceType = stageRaceType(stg.a);
    const isTtt = raceType === 'TTT';
    let stageRows = isTtt
      ? parseTttResultRows(firstBlock(stg.body, 'Resultats'), riderByBib)
      : parseResultRows(firstBlock(stg.body, 'Resultats'), riderByBib);
    if (stagePdfs.has(1) && stageRows.length) {
      try { stageRows = await officialPdfRowsForStage(stagePdfs.get(1), riderByBib, stageRows); log('  one-day: PDF STSport prioritario'); }
      catch (error) { log(`  ⚠ one-day PDF STSport ignorado (${error.message}); se usa .clax`); }
    }
    if (!stageRows.length) {
      log('  one-day sin <Resultats> publicado (no terminada) — 0 clasificaciones');
    } else {
      const annexesXml = firstBlock(stg.body, 'ClassementsAnnexes');
      const annexes = [];
      for (const cm of annexesXml.matchAll(/<Clt\s+id="([^"]+)">(.*?)<\/Clt>/gs)) {
        const spec = ANNEXE_MAP[cm[1]];
        if (!spec) continue;
        if (SKIP_CLAX_POINTS && spec.classKind === 'points') continue;
        const rows = parseAnnexeRows(rushBody(cm[2], 'GN'), riderByBib);
        if (rows.length) annexes.push({ classKind: spec.classKind, eventName: spec.eventName, rows });
      }
      // Clasificación principal = gc/stage (como las one-day de Hageland/CN) + anexas overall.
      const classifications = [buildClassification(FINAL_SLOT, 'gc', 'stage', 'Final Classification', stageRows)];
      for (const an of annexes)
        classifications.push(buildClassification(FINAL_SLOT, an.classKind, 'overall', an.eventName, an.rows));
      stages.push({
        uciRaceId: synthRaceId(FINAL_SLOT),
        stageNumber: null,
        stageName: 'Final Classification',
        isFinalClassification: false,   // one-day: NO es "general final de vuelta"; es la prueba en sí
        dateKey: clean(stg.a.dt1) || clean(ep.dt1) || null,
        raceType,
        startLocation: null,
        classificationCount: classifications.length,
        classifications,
      });
      classifications.forEach((c) =>
        log(`    one-day ${(c.scope + '/' + c.classKind).padEnd(14)} ${String(c.rowCount).padStart(3)} filas  (event ${c.eventId})`));
    }
  } else {
  let lastStageDone = false;

  for (const [idx, stg] of stageBlocks.entries()) {
    const stageNumber = idx + 1 + STAGE_OFFSET;         // Wiclax: orden 1-based + ajuste (prólogo → 0)
    if (ONLY_STAGE != null && stageNumber !== ONLY_STAGE) continue;

    // Índice dorsal → corredor de ESTA etapa (sus <Engages>).
    const riderByBib = new Map();
    const engages = firstBlock(stg.body, 'Engages');
    for (const m of engages.matchAll(/<E\b([^>]*)\/?>/g)) {
      const a = attrs('<E ' + m[1] + '>');
      const d = Number(a.d);
      if (!(d > 0)) continue;
      riderByBib.set(d, { display: clean(a.n) || null, teamName: clean(a.c) || null });
    }

    const raceType = stageRaceType(stg.a);
    const isTtt = raceType === 'TTT';
    const resultatsXml = firstBlock(stg.body, 'Resultats');
    let stageRows = isTtt
      ? parseTttResultRows(resultatsXml, riderByBib)
      : parseResultRows(resultatsXml, riderByBib);
    if (!stageRows.length) { log(`  E${stageNumber} sin <Resultats> publicado (no terminada) — omitida`); return; }
    const pdfStageNumber = idx + 1;
    const pdfLink = stagePdfs.get(pdfStageNumber);
    if (pdfLink) {
      try {
        stageRows = await officialPdfRowsForStage(pdfLink, riderByBib, stageRows);
        log(`  E${stageNumber}: PDF STSport prioritario`);
      } catch (error) {
        log(`  ⚠ E${stageNumber}: PDF STSport ignorado (${error.message}); se usa .clax`);
      }
    }

    const generalXml = firstBlock(stg.body, 'General');
    const gcRows = parseResultRows(generalXml, riderByBib);

    // anexas overall (montaña/puntos/jóvenes) — <Clt id> → <Rush id="GN">.
    const annexesXml = firstBlock(stg.body, 'ClassementsAnnexes');
    const annexes = [];
    for (const cm of annexesXml.matchAll(/<Clt\s+id="([^"]+)">(.*?)<\/Clt>/gs)) {
      const spec = ANNEXE_MAP[cm[1]];
      if (!spec) continue;
      if (SKIP_CLAX_POINTS && spec.classKind === 'points') continue;
      const rows = parseAnnexeRows(rushBody(cm[2], 'GN'), riderByBib);
      if (rows.length) annexes.push({ classKind: spec.classKind, eventName: spec.eventName, rows });
    }
    if (pdfLink) {
      try {
        const youthRows = await officialPdfYouthRows(pdfLink, riderByBib);
        const previousYouth = annexes.findIndex((an) => an.classKind === 'youth');
        if (previousYouth >= 0) annexes.splice(previousYouth, 1);
        annexes.push({ classKind: 'youth', eventName: 'Overall Youth Classification', rows: youthRows });
        log(`  E${stageNumber}: jóvenes desde PDF STSport prioritario`);
      } catch (error) {
        log(`  ⚠ E${stageNumber}: jóvenes PDF STSport ignorados (${error.message}); se usa .clax`);
      }
    }

    const isLast = idx === lastIdx;
    const classifications = [];
    // 1) clasificación de ETAPA (siempre).
    classifications.push(buildClassification(stageNumber, 'stage', 'stage', 'Stage Classification', stageRows));
    // 2) GC del día + anexas overall: en la ÚLTIMA etapa son las DEFINITIVAS → van
    //    SOLO a la pseudo-final (evita el duplicado "general del día E_última" ≈ "final").
    if (!isLast) {
      if (gcRows.length) classifications.push(buildClassification(stageNumber, 'gc', 'stage', 'Stage General Classification', gcRows));
      for (const an of annexes) classifications.push(buildClassification(stageNumber, an.classKind, 'overall', an.eventName, an.rows));
    } else {
      lastOveralls = { stageNumber, gcRows, annexes };
    }

    stages.push({
      uciRaceId: synthRaceId(stageNumber),
      stageNumber,
      stageName: `Stage ${stageNumber}`,
      isFinalClassification: false,
      dateKey: clean(stg.a.dt1) || clean(ep.dt1) || null,
      raceType,
      startLocation: null,
      classificationCount: classifications.length,
      classifications,
    });
    classifications.forEach((c) =>
      log(`    E${String(stageNumber).padEnd(2)} ${(c.scope + '/' + c.classKind).padEnd(14)} ${String(c.rowCount).padStart(3)} filas  (event ${c.eventId})`));
    if (isLast) lastStageDone = true;
  }

  // Carrera terminada → pseudo-etapa "Final Classification" (quirk UCI 085,
  // stageNumber NULL, scope='stage', isFinalClassification).
  if (lastStageDone && lastOveralls && ONLY_STAGE == null) {
    const classifications = [];
    if (lastOveralls.gcRows.length)
      classifications.push(buildClassification(FINAL_SLOT, 'gc', 'stage', 'General Classification', lastOveralls.gcRows));
    const FINAL_NAMES = { kom: 'Mountain Classification', points: 'Points Classification', youth: 'Youth Classification' };
    for (const an of lastOveralls.annexes)
      classifications.push(buildClassification(FINAL_SLOT, an.classKind, 'stage', FINAL_NAMES[an.classKind] || an.eventName, an.rows));
    if (classifications.length) {
      stages.push({
        uciRaceId: synthRaceId(FINAL_SLOT),
        stageNumber: null,
        stageName: 'Final Classification',
        isFinalClassification: true,
        dateKey: clean(ep.dt2) || clean(ep.dt1) || null,
        raceType: null,
        startLocation: null,
        classificationCount: classifications.length,
        classifications,
      });
      log(`    FINAL (carrera terminada): ${classifications.length} clasificaciones desde la E${lastOveralls.stageNumber}`);
    }
  }
  }

  const out = {
    competitionId: Number(COMPETITION_ID),
    disciplineId: 10,
    source: 'sts',
    stsCode: CODE,
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
  main().catch((e) => { log("FATAL: " + (e.stack || e.message)); process.exit(1); });
}
