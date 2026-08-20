#!/usr/bin/env node
/**
 * uci-results-upsert.mjs — Carga el JSON del FETCHER de resultados UCI
 * (uci-results-fetch.mjs) en las tablas race_uci_* (migración 081).
 *
 * Fase 2 del plan (PLAN-resultados-web.md §1–2). Dos modos de salida desde el MISMO plan:
 *   · --emit-sql  (default) → escribe SQL idempotente revisable (aplicable vía MCP/psql).
 *   · --apply               → escribe directo a Postgres vía `pg` con DATABASE_URL (.env),
 *                             statements PARAMETRIZADOS dentro de una transacción. Es la vía
 *                             del cron (fase 6) y la que usamos para el upsert real.
 *
 * QUÉ HACE
 *   Dado el JSON de una competición (salida del fetcher) + el raceId NUESTRO de esa carrera:
 *     1. UPSERT race_uci_links   — el puente carrera↔competición (1 fila).
 *     2. UPSERT race_uci_stages  — 1 fila por (etapa × clasificación). Mapea cada etapa UCI a
 *        NUESTRA race_days por (raceId, stageNumber) [resuelto en SQL, sin hardcodear ids].
 *     3. REEMPLAZA race_uci_results de cada clasificación (DELETE por stageRef + INSERT) →
 *        re-sync idempotente: re-correr deja la clasificación tal cual la UCI ahora mismo.
 *        Las filas guardan SOLO dorsal + dato (rank/time/gap/points/irm) + riderDisplay
 *        (fallback). El corredor NO se duplica en la fila.
 *     4. ENLAZA globalRiderId por DORSAL contra la startlist curada (RPC resolve_uci_results,
 *        migración 082), en la misma transacción. bib→startlist_riders.dorsal→globalRiderId.
 *        Lo que no case (carrera sin startlist) queda NULL y se muestra por riderDisplay.
 *     5. [Fase 6, solo con --gender] Si tras (4) quedan filas sin enlazar (carrera SIN
 *        startlist), ENLAZA por NOMBRE desde el propio resultado UCI y CREA la ficha que
 *        falte con nombre+nacionalidad+fecha (RPC resolve_uci_results_by_name, migración 083),
 *        en la misma transacción. El nombre se parte de DisplayName ("APELLIDO Nombre").
 *
 * MAPEO etapa UCI → NUESTRA race_days
 *   Por stageNumber (la "Stage N" de DataRide ↔ race_days.stageNumber). La pseudo-etapa
 *   "Final Classification" (stageNumber NULL) NO tiene jornada propia nuestra → raceDayId NULL
 *   (sus generales son las "finales"; se identifican por isFinalClassification).
 *
 * IDEMPOTENCIA
 *   - links:   ON CONFLICT (raceId) DO UPDATE (refresca competitionId/seasonId/lastSyncedAt).
 *   - stages:  ON CONFLICT (eventId) DO UPDATE (eventId es estable y UNIQUE).
 *   - results: se borran por stageRef y se reinsertan (no hay clave natural por fila fiable).
 *
 * BLOQUEO MANUAL (migración 087): una clasificación con race_uci_stages."lockedAt"
 *   NOT NULL fue corregida a mano desde el panel (editor de jornada → pestaña
 *   Resultados) → NO se toca: ni el UPDATE de su cabecera ni el DELETE+INSERT de
 *   sus filas (las guardas van EN EL SQL, así protegen igual en --apply y en el
 *   SQL emitido). resolve_uci_results sí sigue corriendo sobre ellas: solo
 *   re-resuelve globalRiderId por dorsal (la startlist es la verdad del corredor),
 *   nunca los datos de clasificación.
 *
 * Uso (desde la raíz del repo; fetch nativo; `pg` instalado con `npm i --no-save pg`):
 *   # 1) fetch de la etapa (o la competición entera) → JSON
 *   node scripts/results-fetchers/uci-results-fetch.mjs --competition 76394 --stage 2
 *   # 2a) JSON → SQL revisable
 *   node scripts/results-fetchers/uci-results-upsert.mjs --in <json> --race-id <id> --emit-sql out.sql
 *   # 2b) JSON → escribir directo a Postgres
 *   node scripts/results-fetchers/uci-results-upsert.mjs --in <json> --race-id <id> --apply
 *
 * Args:
 *   --in        Ruta del JSON del fetcher (obligatorio).
 *   --race-id   raceId NUESTRO (de la tabla races) al que pertenece esta competición (obligatorio).
 *   --uci-race-id  race.Id de DataRide de la PRUEBA concreta dentro de la competición (CN:
 *               una prueba del país por ficha). Se guarda en race_uci_links.uciRaceId (110).
 *               Default 0 = competición entera (todo lo no-CN).
 *   --season    seasonId UCI (default 464 = 2026). Solo metadato del link.
 *   --source    fuente del fetcher (uci, tissot, colombia, etc.): fija race_uci_links.source
 *               (090). Sin el flag no se
 *               toca. 'pdf' = volcado manual desde PDF (skill cc-resultados-pdf) → el cron
 *               salta la carrera (su competitionId es sintético negativo, sin fetcher).
 *   --gender    'male'|'female' (de races.gender). Habilita el enlace por NOMBRE + creación de
 *               fichas (Fase 6) para las filas que el dorsal no resolvió. Sin esto, solo dorsal.
 *   --seed-startlist  (Fase 6) Siembra startlist_teams/riders desde el volcado UCI (nombre bonito +
 *               bandera + equipo en la web). Activar SOLO en carreras sin startlist curada
 *               (la RPC BORRA y resiembra la startlist de la carrera → pisaría una del panel).
 *   --apply     Aplica a Postgres (DATABASE_URL del .env). Sin esto → modo SQL.
 *   --emit-sql  Ruta de salida del SQL (default <in dir>/upsert.sql). '-' = stdout. (Modo SQL.)
 *   --status    syncStatus a fijar en el link (default 'ok').
 *   --skip-existing  (solo --apply) NO re-vuelca las clasificaciones ya presentes
 *               (mismo eventId, rowCount>0): se omiten ENTERAS del plan. La UCI publica
 *               resultados completos y definitivos → re-volcarlos cada 30 min re-procesa
 *               toda la carrera en balde; las correcciones se hacen a mano (panel). Las
 *               NUEVAS (etapa del día, o secundarias publicadas después) sí entran.
 *   --skip-existing-after-min N  (con --skip-existing) solo omite las volcadas hace
 *               más de N min (reloj = race_uci_links.lastSyncedAt). Para Tissot, que
 *               llega parcial y se corrige en la 1ª hora tras meta → re-vuelca lo
 *               reciente, omite lo asentado. Sin este flag, omite cualquier existente.
 *   --only-stage N  Procesa SOLO la etapa cuyo stageNumber == N (prólogo = 0). El resto
 *               de etapas del JSON se descartan del plan (ni purga, ni cabecera, ni filas).
 *               Lo usa el volcado manual "Volcar esta etapa" del panel: el fetcher siempre
 *               trae la carrera entera, pero solo queremos re-escribir la etapa elegida
 *               (no las 15 anteriores del Tour). La pseudo-etapa "Final Classification"
 *               (stageNumber null) NO entra con este filtro.
 *   --include-final  Con --only-stage N, incluye también la pseudo-etapa final. Uso
 *               interno del cron automático cuando N es la última etapa; no se pasa
 *               desde el volcado manual de una jornada.
 */
'use strict';

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const IN = getArg('in');
const RACE_ID = getArg('race-id');
// --uci-race-id: race.Id de DataRide de la PRUEBA concreta dentro de la competición, para
// los Campeonatos Nacionales (cada prueba del país es una ficha y enlaza a su race.Id, no a
// la competición entera). Se persiste en race_uci_links.uciRaceId (migración 110). Default 0
// = competición ENTERA (todo lo no-CN: vueltas, clásicas…), la semántica de siempre.
const UCI_RACE_ID = parseInt(getArg('uci-race-id') || '0', 10);
const SEASON = parseInt(getArg('season') || '464', 10);
const STATUS = getArg('status') || 'ok';
// 'uci'|'tissot'|'pdf'|'matsport'|'sportstiming'|'manual_timing'|'raceresult'|'sts'|
// 'domtel'|'livetiming'|'classificacoes'|'infocity'|'burgos': fija
// race_uci_links.source en el upsert del link. Sin el flag, el source NO se toca
// (INSERT usa el default 'uci'; UPDATE lo conserva). 'pdf' = volcado manual desde
// PDF (skill cc-resultados-pdf) → el cron salta la carrera. 'sportstiming'/'manual_timing'
// = volcado local (lectura de HTML/JSON). 'raceresult' = API JSON pública de my.raceresult.com
// (raceresult-results-fetch.mjs), AUTOMÁTICA en el cron (migración 108). 'sts' = .clax
// XML público de stsport.fr/Wiclax (sts-results-fetch.mjs), AUTOMÁTICA (migración 109).
const SOURCE = getArg('source');
const CLASSIFICACOES_CODE = getArg('classificacoes-code');
const INFOCITY_CODE = getArg('infocity-code');
const SPORTSOFT_CODE = getArg('sportsoft-code');
const EQTIMING_CODE = getArg('eqtiming-code');
const ASO_URL = getArg('aso-url');
const COLOMBIA_CODE = getArg('colombia-code');
if (SOURCE && !['uci', 'tissot', 'pdf', 'matsport', 'sportstiming', 'manual_timing', 'raceresult', 'sts', 'domtel', 'livetiming', 'classificacoes', 'infocity', 'sportsoft', 'eqtiming', 'ASO', 'colombia', 'burgos'].includes(SOURCE)) {
  log(`FATAL: --source debe ser uci|tissot|pdf|matsport|sportstiming|manual_timing|raceresult|sts|domtel|livetiming|classificacoes|infocity|sportsoft|eqtiming|ASO|colombia|burgos (recibido "${SOURCE}")`); process.exit(1);
}
const GENDER = getArg('gender'); // 'male'|'female': habilita el enlace por NOMBRE (Fase 6) para carreras sin startlist
const SEED_STARTLIST = hasFlag('seed-startlist'); // Fase 6: sembrar startlist_teams/riders desde el volcado UCI (solo carreras sin startlist curada)
// --fill-dnf-from-startlist: para cada clasificación de ETAPA volcada, marca como
// DNF (por diferencia) los dorsales de la startlist curada que NO aparezcan en la
// orden de llegada. OPT-IN, pensado para fuentes que NO publican los abandonos
// (manual_timing: ArriviHLData solo trae los clasificados). NO usar con fuentes cuyo
// feed sí trae los IRM (UCI/Tissot) ni en carreras sin startlist curada (no habría
// con qué comparar). Solo toca la clasificación de etapa (classKind='stage'); no
// inventa abandonos en generales/secundarias. Verificado en E3 Giro Next Gen: la
// diferencia startlist−clasificados dio exactamente los 12 Ritirati del pie oficial.
const FILL_DNF = hasFlag('fill-dnf-from-startlist');
// --irm-override DORSAL:CODIGO (repetible): fuerza el IRM de un dorsal en la
// clasificación de ETAPA. Pensado para corregir un abandono derivado por
// --fill-dnf-from-startlist cuyo motivo real no es DNF genérico (p. ej. un
// NO SALIDA → DNS, o fuera de control → OTL). SOBREVIVE al re-volcado porque se
// pasa en cada invocación del bucle (como --remap-bib/--inject de sportstiming).
// Se aplica DESPUÉS de derivar los DNF, así que pisa el DNF genérico de ese dorsal.
const IRM_OVERRIDES = new Map(args.reduce((acc, a, i) => {
  if (a === '--irm-override' && args[i + 1]) {
    const [bib, code] = args[i + 1].split(':');
    if (bib && code) acc.push([String(bib).trim(), String(code).trim().toUpperCase()]);
  }
  return acc;
}, []));
const APPLY = hasFlag('apply');
// ── No re-volcar clasificaciones ya presentes (optimización del cron del día) ──
// Una clasificación de la UCI ya volcada (mismo eventId, rowCount>0) es completa y
// definitiva: re-volcarla cada 30 min re-procesa toda la historia de la carrera sin
// aportar nada (las sanciones/descalificaciones se corrigen a mano desde el panel).
// Con --skip-existing esas clasificaciones se OMITEN por completo del plan (ni purga
// sintética, ni UPSERT de cabecera, ni DELETE+INSERT de filas) → en la etapa 15 las
// 14 anteriores cuestan 1 SELECT en vez de re-volcarse. Las clasificaciones NUEVAS
// (etapa del día, o secundarias que la UCI publica después bajo otro eventId) sí
// entran. Tissot llega parcial y se corrige en la 1ª hora tras meta → para esa fuente
// el cron pasa --skip-existing-after-min 60: una clasificación se omite solo si ya
// lleva >N min volcada (lastSyncedAt de su cabecera). Solo aplica en modo --apply
// (el modo SQL emite el plan completo, revisable). El volcado manual --race-id NO
// pasa estos flags → siempre re-vuelca todo (para forzar correcciones).
const SKIP_EXISTING = hasFlag('skip-existing');
const SKIP_EXISTING_AFTER_MIN = (() => {
  const v = getArg('skip-existing-after-min');
  return v == null ? null : parseInt(v, 10);
})();
// --only-stage N: restringe el plan a la etapa stageNumber==N (ver doc arriba). null =
// sin restricción (comportamiento normal: todas las etapas del JSON). El volcado manual
// por etapa del panel lo pasa para que re-escribir la etapa 16 no re-vuelque la 1-15.
const ONLY_STAGE = (() => {
  const v = getArg('only-stage');
  return v == null ? null : parseInt(v, 10);
})();
// --include-final: junto a --only-stage N conserva también la pseudo-etapa
// Final Classification (stageNumber null). Lo usa exclusivamente el cron automático
// cuando N es la última etapa: permite publicar la etapa y la general final en el mismo
// volcado sin re-procesar las etapas anteriores. El volcado manual "esta etapa" no lo
// pasa, por lo que mantiene su aislamiento estricto.
const INCLUDE_FINAL = hasFlag('include-final');
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

// Los obligatorios se validan en main() (dentro del guard de CLI): importado desde
// los tests no hay argv y buildPlan recibe sus datos por parámetro.

// Perezoso: al importar desde los tests no hay --in, y dirname(null) reventaría.
const OUT_SQL = getArg('emit-sql') || (IN ? join(dirname(IN), 'upsert.sql') : null);

// ── normalización de valores ────────────────────────────────────────────────
const s = (v) => (v == null || v === '' ? null : String(v));
const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export function shouldIncludeStage(stageNumber, isFinalClassification, onlyStage = ONLY_STAGE, includeFinal = INCLUDE_FINAL) {
  if (onlyStage == null) return true;
  if (stageNumber === onlyStage) return true;
  return includeFinal && stageNumber == null && !!isFinalClassification;
}

// DataRide representa algunas carreras de un día solo con la pseudo-etapa
// "Final Classification". En ese caso no existe una clasificación de etapa que
// pueda confirmar la llegada dentro del mismo payload: el ganador de la final es
// la confirmación disponible y debe poder sustituir un resultado sintético.
export function shouldPublishFinalClassification(hasStageWinnerInPayload, hasIncludedNonFinalStage) {
  return hasStageWinnerInPayload || !hasIncludedNonFinalStage;
}
// Como n() pero REDONDEA a entero: para columnas INTEGER. La UCI a veces manda
// PointPcR con decimales (p. ej. "1.17", ranking points PCS) en clasificaciones
// que NO mostramos (Stage Classification) → la columna integer `points` peta.
// Redondear es inocuo: 0 decimales en clasificaciones keepForWeb (verificado).
const nInt = (v) => { const x = n(v); return x == null ? null : Math.round(x); };

// ── Saneo del "ganador espurio" de la UCI (rank 1 + abandono + sin tiempo) ────
// La UCI a veces deja a un NO-clasificado en la cabeza de una etapa: rank=1 con un
// `irm` de abandono (DNF/DNS/OTL/DSQ/ABD) y SIN tiempo, mientras el ganador real
// queda en rank 2 con su tiempo. Caso real: Vuelta a Colombia Femenina 2026 et.3 —
// Flórez sale rank 1 + DNS (no corrió la etapa) y Stefanía Sánchez, que ganó, sale
// 2ª. Sin sanear, la app muestra "2" junto a la ganadora y un DNS encabezando.
//
// Esto NO es lo mismo que un `irm` de RUIDO sobre la verdadera ganadora (p. ej.
// 'LAP'='doblada' en Dwars door de Westhoek, donde la rank 1 SÍ ganó): ese código
// no es de abandono → no se toca aquí (lo gestiona el render, ver js/uci-irm.js).
//
// Criterio CONSERVADOR (deben cumplirse las tres):
//   1. clasificación de ETAPA por tiempo (classKind='stage').
//   2. la fila rank=1 trae un `irm` de ABANDONO y NO trae timeText.
//   3. existe una fila rank=2 CON timeText (la ganadora real desplazada).
// Acción: a la fila espuria se le quita el rank (rank=null, rankText=código) y se
// MANDA AL FINAL (como los demás abandonos de cola); a toda fila con rank>=2 se le
// resta 1 → la ganadora real pasa a rank 1. Idempotente: se aplica en cada volcado,
// así sobrevive al DELETE+INSERT del cron y cubre casos futuros del mismo patrón.
const ABANDON_IRM = new Set(['DNF', 'ABD', 'DNS', 'OTL', 'DSQ']);
const isAbandonIrm = (code) => !!code && ABANDON_IRM.has(String(code).toUpperCase());

function sanitizeSpuriousWinner(rows, classKind) {
  if (classKind !== 'stage' || !Array.isArray(rows)) return rows;
  const r1 = rows.find((r) => n(r.rank) === 1);
  if (!r1 || !isAbandonIrm(r1.irm) || s(r1.timeText)) return rows;     // (1)+(2)
  const r2 = rows.find((r) => n(r.rank) === 2);
  if (!r2 || !s(r2.timeText)) return rows;                            // (3)

  const fixed = rows
    .filter((r) => r !== r1)
    .map((r) => {
      const rk = n(r.rank);
      return rk != null && rk >= 2 ? { ...r, rank: rk - 1 } : r;
    });
  // La fila espuria, ya sin puesto (rankText = su código de abandono, NO el "1"
  // viejo) y al final, igual que los demás abandonos de cola.
  fixed.push({ ...r1, rank: null, rankText: r1.irm });
  log(`  ⚠ saneado ganador espurio: ${r1.riderDisplay || r1.bib} (rank1+${r1.irm}, sin tiempo) → cola; resto −1`);
  return fixed;
}

// Una clasificación parcial no puede sustituir lo ya publicado ni crear una
// pestaña engañosa. Debe traer un rank=1 real y esa fila no puede tener IRM.
// Se comprueba tras sanear el rank=1 espurio de la UCI: si había una ganadora
// real en rank=2, el saneo la convierte en una clasificación válida.
function hasValidWinner(rows) {
  const winner = Array.isArray(rows) && rows.find((r) => n(r.rank) === 1);
  return !!winner && !s(winner.irm);
}

// Una prueba de un día no tiene stageNumber: según la fuente, su resultado
// principal llega tipado como stage/stage o gc/stage. Ambos son la llegada real;
// las generales/secundarias aisladas no abren nunca el gate.
function hasMainStageWinner(classifications, stageNumber) {
  return classifications.some((cl) => {
    const kind = s(cl.classKind);
    const isMain = kind === 'stage' || (stageNumber == null && kind === 'gc');
    return isMain && s(cl.scope) === 'stage' && hasValidWinner(cl.rows);
  });
}

// ── Fase 6: split de DisplayName UCI "APELLIDO(S) Nombre(s)" → {first,last} ───
// La UCI publica el nombre en una sola cadena con el/los apellido(s) en MAYÚSCULAS
// (DisplayFirstName/LastName vienen null en las carreras pequeñas). Heurística
// Unicode-aware (NO rangos Latin-1 — ver feedback_unicode_case_ranges): el apellido
// son los tokens en mayúsculas iniciales (un token es "mayúsculas" si tiene \p{Lu} y
// no \p{Ll}), absorbiendo partículas (de/van/von…) intercaladas entre tokens uppercase;
// el resto es el nombre. El apellido se pasa a Title Case respetando partículas y
// apóstrofos/guiones. El split exacto NO importa para casar: compute_identity_key es
// token-set (invariante al orden), solo afecta a la legibilidad de la ficha creada.
const _PARTICLE = /^(de|del|della|der|den|van|von|da|di|do|dos|das|la|le|el|al|bin|ben|mac|mc|ter|ten|zur|zum)$/i;
function splitUciDisplay(display) {
  const str = (display || '').trim().replace(/\s+/g, ' ');
  if (!str) return { first: '', last: '' };
  const tokens = str.split(' ');
  const isUpper = (t) => /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t);
  let i = 0;
  const lastTokens = [];
  while (i < tokens.length) {
    if (isUpper(tokens[i])) { lastTokens.push(tokens[i]); i++; continue; }
    if (_PARTICLE.test(tokens[i]) && i + 1 < tokens.length && isUpper(tokens[i + 1])) { lastTokens.push(tokens[i]); i++; continue; }
    break;
  }
  if (lastTokens.length === 0) { lastTokens.push(tokens[0]); i = 1; }        // todo Title Case → 1er token = apellido
  if (i >= tokens.length && lastTokens.length > 1) { i = lastTokens.length - 1; lastTokens.length = i; } // no dejar nombre vacío
  const titleCase = (t) => t.split(/([ -])/).map((part) => {
    if (part === ' ' || part === '-') return part;
    return part.replace(/\p{L}[\p{L}'’]*/gu, (w) => {
      const lw = w.toLocaleLowerCase();
      if (_PARTICLE.test(w)) return lw;
      return lw.replace(/(^|['’])(\p{L})/gu, (_, p, c) => p + c.toLocaleUpperCase());
    });
  }).join('');
  return { first: tokens.slice(i).join(' '), last: lastTokens.map(titleCase).join(' ') };
}

// Extrae UN corredor por dorsal (bib) de todas las clasificaciones individuales,
// con nombre partido + nacionalidad + fecha de nacimiento (todo de la UCI). Para
// resolve_uci_results_by_name (Fase 6). Prefiere los campos separados si la UCI los
// trae; si no, parte DisplayName/riderDisplay.
export function extractRidersForNameResolve(data, acceptedEventIds = null) {
  const byBib = new Map();
  for (const st of (data.stages || [])) {
    for (const cl of (st.classifications || [])) {
      if (acceptedEventIds && !acceptedEventIds.has(n(cl.eventId))) continue;
      if (cl.isTeamEvent) continue;
      for (const r of (cl.rows || [])) {
        const bib = s(r.bib);
        const hasBib = !!bib && /^[0-9]+$/.test(bib);
        const display = s(r.riderDisplay);
        // Algunos fetchers solo pueden aportar dorsal+IRM (p. ej. un abandono
        // listado en el resumen PDF pero ausente de la clasificación). Esa fila
        // se enlaza por dorsal en Fase 3; nunca debe llegar a Fase 6, que la
        // interpretaría como una persona real llamada «Sin identificar».
        if (/^sin identificar$/i.test(display)) continue;
        // (093) Las filas SIN dorsal también viajan: la UCI a veces omite el
        // bib (GP Beiras: "NOHALES NIETO Edgar", 340 filas en 7 carreras) y
        // sin esto eran invisibles para ambas RPCs (ni dorsal ni nombre).
        // resolve_uci_results_by_name las enlaza por riderDisplay; el campo
        // 'display' viaja SIEMPRE (también con bib, es inocuo). La clave del
        // mapa dedupe por persona: bib o, sin él, el display.
        const key = hasBib ? `b:${bib}` : (display ? `n:${display.toLowerCase()}` : null);
        if (!key || byBib.has(key)) continue;
        let first = s(r.firstName), last = s(r.lastName);
        if (!first || !last) {
          const sp = splitUciDisplay(display || '');
          first = first || sp.first; last = last || sp.last;
        }
        if (!first && !last) continue;
        byBib.set(key, {
          bib: hasBib ? bib : '',
          display,
          firstName: first || '',
          lastName: last || '',
          countryCode: s(r.isoCode2) || '',
          teamName: s(r.teamName) || '',     // para resolve_uci_startlist (Fase 6)
          birthDate: s(r.birthDate) || '',   // 'YYYY-MM-DD' o ''
        });
      }
    }
  }
  return [...byBib.values()];
}

// ── plan: lista de statements {text, params} reutilizada por ambos modos ─────
// Placeholders $1.. → en modo SQL se serializan a literales; en modo apply van como params.
// skipEventIds: Set de eventId (number) cuyas clasificaciones YA están volcadas y
// no deben re-procesarse (ver --skip-existing). Sus statements se omiten por completo
// → el candado lockedAt y las gemelas sintéticas quedan intactos (ni se tocan).
// officialLogicalKeys: Set de claves lógicas "stageNumber|classKind|scope" que YA
// existen en la BD bajo un eventId POSITIVO (fuente oficial, DataRide). Cuando una
// clasificación ENTRANTE es SINTÉTICA (eventId < 0: cronometrador Domtel/Tissot/PDF/…)
// y su gemela lógica ya está cubierta por el oficial, se OMITE entera (ni purga ni
// insert) → así el oficial (positivo) REEMPLAZA al cronometrador (negativo) de forma
// permanente y Domtel no re-duplica lo que DataRide ya publicó (híbrido UCI-preferente).
// Solo afecta a entrantes negativas: un volcado oficial (positivo) nunca se bloquea.
function buildPlan(data, skipEventIds = null, presentEventIds = null, officialLogicalKeys = null) {
  const competitionId = n(data.competitionId);
  const disciplineId = n(data.disciplineId) ?? 10;
  if (!competitionId) { log('FATAL: el JSON no tiene competitionId'); process.exit(1); }

  const stages = (Array.isArray(data.stages) ? data.stages : []).map((st) => ({
    ...st,
    classifications: (Array.isArray(st.classifications) ? st.classifications : []).map((cl) => ({
      ...cl,
      // Normalizar antes de los gates: un rank 1 de abandono espurio puede
      // revelar al ganador real de la etapa.
      rows: sanitizeSpuriousWinner(Array.isArray(cl.rows) ? cl.rows : [], s(cl.classKind)),
    })),
  }));
  const plan = [];
  const acceptedEventIds = new Set();
  // nStages = clasificaciones que entran en el plan (nuevas + re-volcado dentro de
  // ventana). nNew = SOLO las cuyo eventId no existía aún en la BD → es la señal de
  // "hay página/contenido nuevo que SEO debe reflejar". Re-volcar datos de una
  // clasificación ya volcada (Tissot corrigiendo gaps en la 1ª hora) NO crea URL nueva
  // → no debe regenerar og-pages/sitemap (decisión Dani 2026-06-12).
  let nStages = 0, nResults = 0, nSkipped = 0, nRejected = 0, nNew = 0;

  // La pseudo-etapa final se construye desde las generales de la última jornada.
  // No se debe publicar si el mismo fetch no confirma siquiera una llegada: de
  // otro modo un feed parcial podría exponer la general final antes de que exista
  // un rank 1 de etapa. Se limita a las etapas que este run puede procesar para
  // respetar --only-stage/--include-final.
  const hasStageWinnerInPayload = stages.some((st) => {
    const stageNumber = n(st.stageNumber);
    if (st.isFinalClassification || !shouldIncludeStage(stageNumber, false)) return false;
    return hasMainStageWinner(st.classifications, stageNumber);
  });
  const hasIncludedNonFinalStage = stages.some((st) =>
    !st.isFinalClassification && shouldIncludeStage(n(st.stageNumber), false));

  // 1) Puente carrera↔competición. Requiere que la carrera exista (FK).
  //    Con --source se fija también race_uci_links.source (090); sin él no se toca.
  //    STS exige además stsCode: Postgres valida el CHECK ANTES de resolver el
  //    ON CONFLICT, así que no basta con conservar el código de un enlace previo.
  const stsCode = SOURCE === 'sts' ? data.stsCode : null;
  if (SOURCE === 'sts' && !stsCode) {
    throw new Error('--source sts requiere stsCode en el JSON del fetcher STS');
  }
  const classificacoesCode = SOURCE === 'classificacoes'
    ? (CLASSIFICACOES_CODE || data.classificacoesCode) : null;
  if (SOURCE === 'classificacoes' && !classificacoesCode) {
    throw new Error('--source classificacoes requiere --classificacoes-code o classificacoesCode en el JSON');
  }
  const infocityCode = SOURCE === 'infocity' ? (INFOCITY_CODE || data.infocityCode) : null;
  if (SOURCE === 'infocity' && !infocityCode) {
    throw new Error('--source infocity requiere --infocity-code o infocityCode en el JSON');
  }
  const sportsoftCode = SOURCE === 'sportsoft' ? (SPORTSOFT_CODE || data.sportsoftCode) : null;
  if (SOURCE === 'sportsoft' && !sportsoftCode) {
    throw new Error('--source sportsoft requiere --sportsoft-code o sportsoftCode en el JSON');
  }
  const eqtimingCode = SOURCE === 'eqtiming' ? (EQTIMING_CODE || data.eqtimingCode) : null;
  if (SOURCE === 'eqtiming' && !eqtimingCode) {
    throw new Error('--source eqtiming requiere --eqtiming-code o eqtimingCode en el JSON');
  }
  const asoUrl = SOURCE === 'ASO' ? (ASO_URL || data.asoUrl) : null;
  if (SOURCE === 'ASO' && !asoUrl) {
    throw new Error('--source ASO requiere --aso-url o asoUrl en el JSON');
  }
  const colombiaCode = SOURCE === 'colombia' ? (COLOMBIA_CODE || data.colombiaCode) : null;
  if (SOURCE === 'colombia' && !colombiaCode) {
    throw new Error('--source colombia requiere --colombia-code o colombiaCode en el JSON');
  }
  const linkStatement = SOURCE ? {
    note: `puente carrera↔competición (source='${SOURCE}'${UCI_RACE_ID ? `, uciRaceId=${UCI_RACE_ID}` : ''})`,
    text: `INSERT INTO public.race_uci_links
  ("raceId","competitionId","disciplineId","seasonId","uciRaceId","autoMatched","lastSyncedAt","syncStatus","source","stsCode","classificacoesCode","infocityCode","sportsoftCode","eqtimingCode","asoUrl","colombiaCode")
VALUES ($1,$2,$3,$4,$7,FALSE,now(),$5,$6,$8,$9,$10,$11,$12,$13,$14)
ON CONFLICT ("raceId") DO UPDATE SET
  "competitionId"=EXCLUDED."competitionId", "disciplineId"=EXCLUDED."disciplineId",
  "seasonId"=EXCLUDED."seasonId", "uciRaceId"=EXCLUDED."uciRaceId", "lastSyncedAt"=now(),
  "syncStatus"=EXCLUDED."syncStatus", "syncError"=NULL, "source"=EXCLUDED."source",
  "stsCode"=COALESCE(EXCLUDED."stsCode", race_uci_links."stsCode"),
  "classificacoesCode"=COALESCE(EXCLUDED."classificacoesCode", race_uci_links."classificacoesCode"),
  "infocityCode"=COALESCE(EXCLUDED."infocityCode", race_uci_links."infocityCode"),
  "sportsoftCode"=COALESCE(EXCLUDED."sportsoftCode", race_uci_links."sportsoftCode"),
  "eqtimingCode"=CASE WHEN EXCLUDED.source='ASO' THEN NULL ELSE COALESCE(EXCLUDED."eqtimingCode", race_uci_links."eqtimingCode") END,
  "asoUrl"=COALESCE(EXCLUDED."asoUrl", race_uci_links."asoUrl"),
  "colombiaCode"=COALESCE(EXCLUDED."colombiaCode", race_uci_links."colombiaCode")`,
    params: [RACE_ID, competitionId, disciplineId, SEASON, STATUS, SOURCE, UCI_RACE_ID, stsCode, classificacoesCode, infocityCode, sportsoftCode, eqtimingCode, asoUrl, colombiaCode],
  } : {
    note: `puente carrera↔competición${UCI_RACE_ID ? ` (uciRaceId=${UCI_RACE_ID})` : ''}`,
    text: `INSERT INTO public.race_uci_links
  ("raceId","competitionId","disciplineId","seasonId","uciRaceId","autoMatched","lastSyncedAt","syncStatus")
VALUES ($1,$2,$3,$4,$6,FALSE,now(),$5)
ON CONFLICT ("raceId") DO UPDATE SET
  "competitionId"=EXCLUDED."competitionId", "disciplineId"=EXCLUDED."disciplineId",
  "seasonId"=EXCLUDED."seasonId", "uciRaceId"=EXCLUDED."uciRaceId", "lastSyncedAt"=now(),
  "syncStatus"=EXCLUDED."syncStatus", "syncError"=NULL`,
    params: [RACE_ID, competitionId, disciplineId, SEASON, STATUS, UCI_RACE_ID],
  };

  for (const st of stages) {
    const stageNumber = n(st.stageNumber);     // null (Final Classification) o 0 (prólogo) o N
    const isFinal = !!st.isFinalClassification;
    // --only-stage: descartar toda etapa que no sea la pedida (comparación estricta).
    // stageNumber null nunca casa un N numérico. --include-final hace una excepción
    // explícita solo para la pseudo-etapa final; descartada = ni purga ni insert.
    if (!shouldIncludeStage(stageNumber, isFinal)) continue;
    // Fuentes con IDs sintéticos (p. ej. Classificações.net) no proporcionan
    // un uciRaceId por etapa. En ese caso conservan el ID de la competición
    // (0 para una vuelta completa) que ya se guarda en el enlace de carrera.
    // race_uci_stages lo exige como NOT NULL.
    const uciRaceId = n(st.uciRaceId) ?? UCI_RACE_ID;
    const dateKey = s(st.dateKey);
    const raceType = s(st.raceType);
    // Doble sector: dos jornadas comparten stageNumber; sectorIndex (0=A,1=B,…)
    // selecciona la jornada correcta como OFFSET dentro de ese stageNumber
    // ordenado por hora de salida. Sin sector → 0 (etapa normal, 1 sola jornada).
    const sectorIndex = Math.max(0, n(st.sectorIndex) || 0);
    const classifications = st.classifications;

    // Un feed intermedio puede traer las generales y clasificaciones secundarias
    // mientras la llegada sigue sin publicar. No debe aparecer NADA de esa etapa
    // en la web hasta que exista un ganador real de la clasificación de etapa.
    // Es un gate de etapa, no de fuente: protege por igual UCI y todos los
    // cronometradores que pasan por este upsert central.
    const hasStageWinner = hasMainStageWinner(classifications, stageNumber);
    if (!isFinal && !hasStageWinner) {
      nRejected += classifications.length;
      log(`  ⚠ etapa ${stageNumber == null ? 'FINAL' : stageNumber} omitida: falta rank=1 válido sin IRM en la clasificación de etapa`);
      continue;
    }
    if (isFinal && !shouldPublishFinalClassification(hasStageWinnerInPayload, hasIncludedNonFinalStage)) {
      nRejected += classifications.length;
      log('  ⚠ clasificación final omitida: el payload no contiene una etapa con rank=1 válido sin IRM');
      continue;
    }

    for (const cl of classifications) {
      const eventId = n(cl.eventId);
      const stageRef = `ru_${eventId}`;
      // Ya volcada (y, en Tissot, fuera de la ventana de re-volcado) → omitir entera.
      if (skipEventIds && eventId != null && skipEventIds.has(eventId)) { nSkipped++; continue; }
      // Guard híbrido UCI-preferente: si esta clasificación ENTRANTE es sintética
      // (eventId < 0: cronometrador) y su gemela lógica ya está cubierta por la fuente
      // OFICIAL (eventId > 0, DataRide), se omite entera → el oficial manda y Domtel no
      // re-crea un duplicado de lo que UCI ya publicó. No toca entrantes oficiales.
      const logicalKey = `${stageNumber == null ? 'null' : stageNumber}|${s(cl.classKind)}|${s(cl.scope)}`;
      if (officialLogicalKeys && eventId != null && eventId < 0 && officialLogicalKeys.has(logicalKey)) {
        nSkipped++; continue;
      }
      const rows = cl.rows;
      if (!hasValidWinner(rows)) {
        nRejected++;
        log(`  ⚠ clasificación omitida: etapa ${stageNumber == null ? 'FINAL' : stageNumber} · ${cl.scope}/${cl.classKind} · event ${eventId} (falta rank=1 válido sin IRM)`);
        continue;
      }
      nStages++;
      acceptedEventIds.add(eventId);
      // ¿Es una clasificación REALMENTE nueva (su eventId no estaba en la BD)?
      // presentEventIds incluye TODOS los eventId ya volcados con filas (sin filtro de
      // tiempo, a diferencia de skipEventIds). Si no está → cuenta como nueva.
      if (presentEventIds && (eventId == null || !presentEventIds.has(eventId))) nNew++;
      else if (!presentEventIds) nNew++;   // sin info de presentes (no --apply): conservador

      // Purga de GEMELAS SINTÉTICAS: si esta MISMA clasificación lógica
      // (raceId + stageNumber + classKind + scope) ya existe bajo OTRO eventId
      // NEGATIVO — volcado provisional desde PDF (skill cc-resultados-pdf) o
      // restos Tissot tras conmutar la carrera a 'uci' — se borra ANTES de
      // upsertar (cascade → también sus filas). Así la fuente que llega
      // REEMPLAZA el placeholder en vez de duplicar la pestaña en la web.
      // Guarda de lock ASIMÉTRICA (decisión Dani 2026-06-10, matizada 2026-07-19):
      //   · entrante OFICIAL (eventId > 0, DataRide): purga SIN mirar lockedAt →
      //     un placeholder provisional nunca bloquea a la fuente oficial.
      //   · entrante SINTÉTICA (eventId < 0, otro cronometrador/PDF): RESPETA el
      //     candado. Entre dos fuentes provisionales ninguna es "la verdad", así
      //     que una clasificación curada a mano y bloqueada desde el panel no se
      //     pisa (caso Valle d'Aosta 2026: E1-E3 volcadas de PCS/libro STS y
      //     curadas, con el .clax de STS llegando después bajo otro eventId).
      const purgeLockGuard = (eventId != null && eventId < 0)
        ? `\n  AND "lockedAt" IS NULL`
        : '';
      plan.push({
        note: null,
        text: `DELETE FROM public.race_uci_stages
WHERE "raceId"=$1 AND "eventId" <> $2 AND "eventId" < 0
  AND "stageNumber" IS NOT DISTINCT FROM $3 AND "classKind"=$4 AND scope=$5${purgeLockGuard}`,
        params: [RACE_ID, eventId, stageNumber, s(cl.classKind), s(cl.scope)],
      });

      // raceDayId se resuelve EN SQL por (raceId, stageNumber). Final Classification → NULL.
      // El SELECT se inyecta como fragmento, no como parámetro (los params no pueden ser SQL).
      // Doble sector: cuando hay ≥2 jornadas con ese stageNumber, se ordenan por hora de
      // salida y se elige la $16-ésima (sectorIndex: 0=A, 1=B). Etapa normal (1 jornada) →
      // OFFSET 0 = esa jornada. El orden es el MISMO que usa la web para el sufijo A/B.
      const raceDayExpr = (stageNumber == null)
        ? 'NULL'
        : `(SELECT id FROM public.race_days WHERE "raceId"=$2 AND "stageNumber"=$11
             ORDER BY "neutralStartTimeUtc" ASC NULLS LAST, id ASC LIMIT 1 OFFSET $16)`;

      // stageDate: la VERDAD es la fecha de la JORNADA curada (race_days.dateKey),
      // NO el dateKey del fetcher — las fuentes lo dan mal de dos formas conocidas:
      // (1) el .clax de Wiclax/STS reparte la MISMA fecha base a todas las etapas
      //     (Occitania E2 2026-06-19 salía como 06-18); (2) DataRide/UCI da medianoche
      //     CET que al truncar en UTC cae al día anterior (desfase −1 sistemático en
      //     Istrian/Rhodes/Gracia…). Para etapas con jornada → tomar dateKey de race_days
      //     y caer al dateKey del JSON solo si no hubiera jornada. Final Classification
      //     (stageNumber null, sin jornada) → el dateKey del JSON como hasta ahora.
      const stageDateExpr = (stageNumber == null)
        ? '$12'
        : `COALESCE((SELECT "dateKey" FROM public.race_days WHERE "raceId"=$2 AND "stageNumber"=$11
             ORDER BY "neutralStartTimeUtc" ASC NULLS LAST, id ASC LIMIT 1 OFFSET $16), $12)`;

      // Espejo de la guarda asimétrica de la purga: si la gemela lógica sigue viva
      // porque está BLOQUEADA, una entrante SINTÉTICA no debe insertarse al lado
      // (el ON CONFLICT es por "eventId", que aquí NO colisiona → saldrían dos
      // pestañas de la misma clasificación en la web). La entrante oficial sí entra:
      // su purga ya se llevó por delante a la gemela.
      const insertLockGuard = (eventId != null && eventId < 0)
        ? `\nWHERE NOT EXISTS (SELECT 1 FROM public.race_uci_stages g
     WHERE g."raceId"=$2 AND g."eventId" <> $5 AND g."eventId" < 0
       AND g."stageNumber" IS NOT DISTINCT FROM $11 AND g."classKind"=$6 AND g.scope=$7
       AND g."lockedAt" IS NOT NULL)`
        : '';
      plan.push({
        note: `stage ${stageNumber == null ? 'FINAL' : stageNumber} · ${cl.scope}/${cl.classKind} · event ${eventId} · ${cl.rowCount} filas`,
        text: `INSERT INTO public.race_uci_stages
  (id,"raceId","raceDayId","competitionId","uciRaceId","eventId","classKind",scope,"eventName",
   "isTeamEvent","stageNumber","isFinalClassification","stageDate","raceType","winnerName","rowCount")
SELECT $1,$2,${raceDayExpr},$3,$4,$5,$6,$7,$8,$9,$11,$10,${stageDateExpr},$13,$14,$15${insertLockGuard}
ON CONFLICT ("eventId") DO UPDATE SET
  "raceId"=EXCLUDED."raceId", "raceDayId"=EXCLUDED."raceDayId",
  "competitionId"=EXCLUDED."competitionId", "uciRaceId"=EXCLUDED."uciRaceId",
  "classKind"=EXCLUDED."classKind", scope=EXCLUDED.scope, "eventName"=EXCLUDED."eventName",
  "isTeamEvent"=EXCLUDED."isTeamEvent", "stageNumber"=EXCLUDED."stageNumber",
  "isFinalClassification"=EXCLUDED."isFinalClassification", "stageDate"=EXCLUDED."stageDate",
  "raceType"=EXCLUDED."raceType", "winnerName"=EXCLUDED."winnerName", "rowCount"=EXCLUDED."rowCount"
WHERE race_uci_stages."lockedAt" IS NULL`,
        params: [
          stageRef, RACE_ID, competitionId, uciRaceId, eventId, s(cl.classKind), s(cl.scope),
          s(cl.eventName), !!cl.isTeamEvent, isFinal, stageNumber, dateKey, raceType,
          s(cl.winnerName), n(cl.rowCount),
          // $16 = sectorIndex (doble sector). SOLO se añade cuando el SQL lo
          // referencia: con stageNumber null (Final Classification) raceDayExpr es
          // 'NULL' y stageDateExpr es '$12', así que ninguna expresión usa $16 y
          // pasarlo igualmente hace que Postgres rechace el bind entero
          // ("supplies 16 parameters, but prepared statement requires 15") y aborte
          // el --apply. Afectaba a todo volcado con pseudo-etapa final; --emit-sql
          // no lo notaba porque serializa a literales.
          ...(stageNumber == null ? [] : [sectorIndex]),
        ],
      });

      // Reemplazo de las filas de esta clasificación (idempotente). Una clasificación
      // BLOQUEADA desde el panel (lockedAt NOT NULL, migración 087) no se toca.
      const notLocked = `NOT EXISTS (SELECT 1 FROM public.race_uci_stages s WHERE s.id=$1 AND s."lockedAt" IS NOT NULL)`;
      plan.push({
        note: null,
        text: `DELETE FROM public.race_uci_results WHERE "stageRef"=$1 AND ${notLocked}`,
        params: [stageRef],
      });

      rows.forEach((r, i) => {
        nResults++;
        const rank = n(r.rank);
        // sortOrder = índice de aparición en el volcado UCI. La UCI ya entrega las
        // filas en orden de clasificación (clasificados por posición, IRM al final),
        // así que preservar ese orden es lo más fiel — y es IMPRESCINDIBLE para las
        // CRE disfrazadas de individual (Tour de Japón et.4): allí solo el líder de
        // cada equipo trae rank y los compañeros van con rank=null INMEDIATAMENTE
        // detrás; el render los agrupa por orden de fila. Si usáramos `rank ?? 1000+i`
        // los compañeros (rank=null) se dispersarían al final y se rompería el grupo.
        const sortOrder = i;
        // La fila guarda solo dorsal + dato. El corredor (nombre/equipo/país/
        // fecha-nac) se reconstruye por bib→startlist_riders.dorsal→globalRiderId
        // (RPC resolve_uci_results, llamada al final del --apply). riderDisplay se
        // conserva como fallback de visualización si el dorsal no casa.
        // Además del lock propio, la cabecera debe EXISTIR: si el guard asimétrico
        // de arriba impidió insertarla (gemela sintética bloqueada), sus filas no
        // tienen a qué colgar y el FK stageRef reventaría el apply entero.
        plan.push({
          note: null,
          text: `INSERT INTO public.race_uci_results
  ("stageRef","raceId","eventId",rank,"rankText",bib,"riderDisplay",
   "globalRiderId","teamId","resultValue","timeText","gapText",points,irm,"sortOrder")
SELECT $1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13,$14
WHERE ${notLocked}
  AND EXISTS (SELECT 1 FROM public.race_uci_stages h WHERE h.id=$1)`,
          params: [
            stageRef, RACE_ID, eventId, rank, s(r.rankText), s(r.bib), s(r.riderDisplay),
            s(r.teamId), s(r.resultValue), s(r.timeText), s(r.gapText), nInt(r.points), s(r.irm), sortOrder,
          ],
        });
      });
    }
  }

  // Si el feed solo trae clasificaciones parciales, tampoco se actualiza el
  // enlace: así no queda una falsa sincronización sin resultados válidos.
  if (nStages > 0) plan.unshift(linkStatement);
  return { plan, competitionId, nStages, nResults, nSkipped, nRejected, nNew, acceptedEventIds };
}

// ── serializar un statement parametrizado a SQL literal (modo --emit-sql) ────
function lit(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function toSQL({ text, params }) {
  // Reemplaza $N por el literal correspondiente. $N de 2 dígitos primero para no romper $1 vs $11.
  return text.replace(/\$(\d+)/g, (_, d) => lit(params[Number(d) - 1]));
}

// Las clasificaciones por equipos no llevan dorsal y, por tanto, no pueden pasar
// por resolve_uci_results. Se enlazan contra la startlist de ESTA carrera usando
// el nombre canónico del equipo y sus aliases. Esto conserva el vínculo tras cada
// re-volcado (las filas se reemplazan por completo en cada pasada).
//
// Las fuentes no dan el nombre a secas: lo envuelven en el código UCI y el país
// ("NDT - NSN DEVELOPMENT TEAM (SUI)"). Comparar en crudo no casaba NUNCA, así que
// se despieza el envoltorio y se comparan solo los alfanuméricos en minúscula, que
// absorbe las diferencias de puntuación entre fuente y ficha ("Anicolor / Campicarn"
// vs "ANICOLOR/CAMPICARN"). Los sufijos genéricos que algunas fuentes añaden
// ("... CYCLING TEAM") se recortan como último intento, nunca antes de probar el
// nombre completo: "UAE Development Team" es una ficha distinta de "UAE Development".
function linkTeamResultRowsSql(raceId) {
  return `WITH src AS (
  SELECT r.id,
         COALESCE(public.fold_team_name(
           regexp_replace(
             regexp_replace(r."riderDisplay", '^\\s*[A-Z0-9]{2,4}\\s+-\\s+', ''),
             '\\s*\\([A-Za-z]{3}\\)\\s*$', '')), '') AS core
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  WHERE r."raceId" = ${lit(raceId)}
    AND s."classKind" = 'teams'
    AND r."riderDisplay" IS NOT NULL
), cand AS (
  SELECT st."teamId",
         st."sortOrder",
         st.id AS st_id,
         COALESCE(public.fold_team_name(btrim(alias.name)), '') AS core
  FROM public.startlist_teams st
  JOIN public.teams t ON t.id = st."teamId"
  CROSS JOIN LATERAL unnest(string_to_array(
    t.name || E'\\n' || COALESCE(t."nameAliases", ''), E'\\n'
  )) AS alias(name)
  WHERE st."raceId" = ${lit(raceId)}
    AND btrim(alias.name) <> ''
), matches AS (
  SELECT src.id, cand."teamId",
         row_number() OVER (
           PARTITION BY src.id
           ORDER BY exact_hit DESC, cand."sortOrder", cand.st_id
         ) AS rn
  FROM src
  JOIN LATERAL (
    SELECT c."teamId", c."sortOrder", c.st_id,
           (c.core = src.core) AS exact_hit
    FROM cand c
    WHERE c.core = src.core
       OR regexp_replace(c.core, '(cyclingteam|team)$', '')
          = regexp_replace(src.core, '(cyclingteam|team)$', '')
  ) cand ON TRUE
)
UPDATE public.race_uci_results r
SET "teamId" = m."teamId"
FROM matches m
WHERE r.id = m.id
  AND m.rn = 1
  AND r."teamId" IS DISTINCT FROM m."teamId"`;
}

// ── carga del .env (solo DATABASE_URL; sin dependencias) ─────────────────────
function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

async function main() {
  if (!IN) { log('FATAL: falta --in <ruta-json-del-fetcher>'); process.exit(1); }
  if (!RACE_ID) { log('FATAL: falta --race-id <raceId nuestro>'); process.exit(1); }

  const data = JSON.parse(readFileSync(IN, 'utf8'));

  if (!APPLY) {
    const { plan, competitionId, nStages, nResults, nRejected, acceptedEventIds } = buildPlan(data);
    // ── modo SQL ──
    const out = [
      '-- ════════════════════════════════════════════════════════════════',
      `-- UPSERT resultados UCI — competitionId ${competitionId} → raceId ${RACE_ID}`,
      `-- Generado por uci-results-upsert.mjs desde ${IN}`,
      `-- fetchedAt del fetcher: ${data.fetchedAt || '?'}`,
      '-- Idempotente: re-aplicar re-sincroniza al estado actual de la UCI.',
      '-- ════════════════════════════════════════════════════════════════',
      'BEGIN;',
      '',
    ];
    for (const st of plan) {
      if (st.note) out.push(`-- ${st.note}`);
      out.push(toSQL(st) + ';');
    }
    // Fase 3: enlazar globalRiderId por dorsal contra la startlist (mismo TX).
    if (nStages > 0) {
      out.push('', '-- enlazar riders por dorsal (Fase 3)');
      out.push(`SELECT public.resolve_uci_results(${lit(RACE_ID)});`);
      out.push('', '-- enlazar equipos de sus clasificaciones contra la startlist');
      out.push(linkTeamResultRowsSql(RACE_ID) + ';');
    }
    // Fase 6: enlazar por nombre + crear fichas que falten, solo para las filas
    // que el enlace por dorsal no haya resuelto. El modo --apply ya usa ese guard;
    // mantenerlo también al emitir SQL evita que una variante ortográfica de la
    // fuente cree una ficha duplicada sobre una startlist completa.
    if (GENDER && nStages > 0) {
      const ridersJson = JSON.stringify(extractRidersForNameResolve(data, acceptedEventIds));
      out.push('', '-- enlazar riders por nombre + crear fichas faltantes (Fase 6)');
      out.push(`SELECT public.resolve_uci_results_by_name(${lit(RACE_ID)},${lit(GENDER)},${lit(ridersJson)}::jsonb)
WHERE EXISTS (
  SELECT 1 FROM public.race_uci_results
  WHERE "raceId"=${lit(RACE_ID)} AND "globalRiderId" IS NULL
);`);
    }
    out.push('', 'COMMIT;', '', `-- Resumen: ${nStages} clasificaciones, ${nResults} filas.`);
    if (nRejected) out.push(`-- Omitidas por no tener rank=1 válido sin IRM: ${nRejected}.`);
    const sql = out.join('\n');
    if (OUT_SQL === '-') process.stdout.write(sql + '\n');
    else { mkdirSync(dirname(OUT_SQL), { recursive: true }); writeFileSync(OUT_SQL, sql); log(`✅ ${nStages} clasificaciones, ${nResults} filas → ${OUT_SQL}`); }
    return;
  }

  // ── modo apply ──
  const env = { ...loadEnv(), ...process.env };
  const url = env.DATABASE_URL;
  if (!url) { log('FATAL: --apply necesita DATABASE_URL (en .env o entorno)'); process.exit(1); }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // --skip-existing: averiguar qué clasificaciones (eventId) ya están volcadas para
  // OMITIRLAS del plan. Solo las que tengan filas (rowCount>0): una cabecera con 0
  // filas es un ∅-guard previo que SÍ queremos reintentar. Con --skip-existing-after-min
  // (Tissot) solo se omiten las volcadas hace más de N minutos — reloj = race_uci_links
  // ."lastSyncedAt" (lo pone now() en cada volcado de la carrera); las recién volcadas
  // se re-vuelcan para recoger las correcciones que Tissot publica en la 1ª hora. Si el
  // link aún no tiene lastSyncedAt (raro), NO se omite (se re-vuelca, conservador).
  // Las BLOQUEADAS (lockedAt) también se omiten: están congeladas a propósito → re-volcar
  // no las tocaría igualmente (las guardas del plan lo impiden).
  let skipEventIds = null;
  // presentEventIds = TODOS los eventId ya volcados con filas (sin filtro de tiempo).
  // Sirve para contar cuántas clasificaciones del fetch son REALMENTE nuevas (nNew):
  // el cron usa esa señal para regenerar og-pages/sitemap solo si hay contenido nuevo,
  // no por un re-volcado de datos sobre páginas que ya existían.
  let presentEventIds = null;
  // officialLogicalKeys = claves lógicas (stageNumber|classKind|scope) ya cubiertas por
  // la fuente OFICIAL (eventId > 0, DataRide). El guard híbrido las usa para omitir una
  // clasificación ENTRANTE sintética (Domtel/Tissot/…) cuya gemela ya publicó DataRide.
  let officialLogicalKeys = null;
  {
    const { rows: pr } = await client.query(
      `SELECT "eventId", "stageNumber", "classKind", scope FROM public.race_uci_stages
        WHERE "raceId" = $1 AND COALESCE("rowCount",0) > 0`,
      [RACE_ID],
    );
    presentEventIds = new Set(pr.map((r) => Number(r.eventId)));
    officialLogicalKeys = new Set(
      pr.filter((r) => Number(r.eventId) > 0)
        .map((r) => `${r.stageNumber == null ? 'null' : Number(r.stageNumber)}|${r.classKind}|${r.scope}`),
    );
  }
  if (SKIP_EXISTING) {
    const afterClause = (SKIP_EXISTING_AFTER_MIN != null)
      ? `AND l."lastSyncedAt" IS NOT NULL AND l."lastSyncedAt" < now() - ($2 || ' minutes')::interval`
      : '';
    const params = [RACE_ID];
    if (SKIP_EXISTING_AFTER_MIN != null) params.push(String(SKIP_EXISTING_AFTER_MIN));
    // Se compara por eventId EXACTO (estable por clasificación; positivo en UCI,
    // negativo sintético en Tissot — ambos válidos como clave). No se filtra por
    // signo: la coincidencia exacta con una fila entrante ya es la señal. Las
    // gemelas PDF (eventId negativo distinto) no coinciden → no se omiten, y su
    // purga la sigue haciendo el plan. El cron nunca llama aquí con source='pdf'
    // (las salta antes), así que un negativo presente es Tissot legítimo.
    const { rows } = await client.query(
      `SELECT s."eventId"
         FROM public.race_uci_stages s
         LEFT JOIN public.race_uci_links l ON l."raceId" = s."raceId"
        WHERE s."raceId" = $1 AND COALESCE(s."rowCount",0) > 0
          ${afterClause}`,
      params,
    );
    skipEventIds = new Set(rows.map((r) => Number(r.eventId)));
  }

  const { plan, competitionId, nStages, nResults, nSkipped, nRejected, nNew, acceptedEventIds } = buildPlan(data, skipEventIds, presentEventIds, officialLogicalKeys);
  if (nStages === 0) {
    // Nada nuevo que volcar: todas las clasificaciones del fetch ya estaban. Salir
    // limpio sin tocar la BD (ni resolve_*; no hay filas nuevas que enlazar).
    // EXIT 2 = "ok pero SIN escritura": el cron lo distingue del 0 (sí escribió) para
    // NO regenerar og-pages/sitemap en balde cuando no hubo resultados nuevos.
    await client.end().catch(() => {});
    const reasons = [];
    if (nSkipped) reasons.push(`${nSkipped} ya volcadas`);
    if (nRejected) reasons.push(`${nRejected} sin rank=1 válido sin IRM`);
    log(`✅ sin cambios: ${reasons.join('; ') || 'ninguna clasificación válida'}${SKIP_EXISTING ? ' (--skip-existing)' : ''}`);
    process.exit(2);
  }
  try {
    await client.query('BEGIN');
    for (const st of plan) await client.query(st.text, st.params);

    // --fill-dnf-from-startlist: marca como DNF (por diferencia) los dorsales de la
    // startlist curada ausentes de cada clasificación de ETAPA recién volcada. Para
    // fuentes que no publican los abandonos (manual_timing). Va ANTES de resolve_uci_results
    // para que los DNF también se enlacen por dorsal. Respeta el lock del panel.
    let dnfFilled = 0;
    if (FILL_DNF) {
      for (const stg of (data.stages || [])) {
        for (const cl of (stg.classifications || [])) {
          if (!acceptedEventIds.has(n(cl.eventId))) continue;
          if (cl.classKind !== 'stage') continue;          // solo la orden de llegada
          const stageRef = `ru_${cl.eventId}`;
          const r = await client.query(
            `INSERT INTO public.race_uci_results
               ("stageRef","raceId","eventId",rank,"rankText",bib,"riderDisplay",
                "globalRiderId","resultValue","timeText","gapText",points,irm,"sortOrder")
             SELECT $1,$2,$3,NULL,'DNF',sr.dorsal::text,
                    COALESCE(NULLIF(trim(concat_ws(' ', upper(sr."lastName"), sr."firstName")), ''), '#' || sr.dorsal::text),
                    sr."globalRiderId",
                    NULL,NULL,NULL,NULL,'DNF',
                    10000 + row_number() OVER (ORDER BY (sr.dorsal)::int)
               FROM public.startlist_riders_resolved sr
              WHERE sr."raceId"=$2 AND sr.dorsal IS NOT NULL
                AND sr.dorsal::text NOT IN (
                  SELECT bib FROM public.race_uci_results
                   WHERE "stageRef"=$1 AND bib IS NOT NULL)
                AND NOT EXISTS (SELECT 1 FROM public.race_uci_stages s
                                 WHERE s.id=$1 AND s."lockedAt" IS NOT NULL)`,
            [stageRef, RACE_ID, cl.eventId],
          );
          dnfFilled += r.rowCount || 0;
          if (r.rowCount > 0) {
            // actualizar rowCount de la cabecera para incluir los DNF
            await client.query(
              `UPDATE public.race_uci_stages SET "rowCount"=(
                 SELECT count(*) FROM public.race_uci_results WHERE "stageRef"=$1)
               WHERE id=$1 AND "lockedAt" IS NULL`, [stageRef]);
          }
        }
      }
    }

    // --irm-override DORSAL:CODIGO: corrige el IRM de un dorsal en la clasif. de ETAPA
    // (p. ej. un derivado DNF que en realidad es DNS/OTL). Tras los DNF, pisa el genérico.
    // Solo sobre filas que YA son IRM (no toca a un corredor clasificado). Respeta el lock.
    let irmOverridden = 0;
    if (IRM_OVERRIDES.size) {
      for (const stg of (data.stages || [])) {
        for (const cl of (stg.classifications || [])) {
          if (!acceptedEventIds.has(n(cl.eventId))) continue;
          if (cl.classKind !== 'stage') continue;
          const stageRef = `ru_${cl.eventId}`;
          for (const [bib, code] of IRM_OVERRIDES) {
            const r = await client.query(
              `UPDATE public.race_uci_results
                  SET irm=$3, "rankText"=$3
                WHERE "stageRef"=$1 AND bib=$2 AND irm IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.race_uci_stages s
                                   WHERE s.id=$1 AND s."lockedAt" IS NOT NULL)`,
              [stageRef, String(bib), code]);
            irmOverridden += r.rowCount || 0;
          }
        }
      }
    }

    // Fase 3: enlazar globalRiderId por dorsal contra la startlist curada.
    // Dentro de la misma transacción → upsert + enlace son atómicos.
    const rr = await client.query('SELECT matched, unresolved FROM public.resolve_uci_results($1)', [RACE_ID]);
    let { matched = 0, unresolved = 0 } = rr.rows[0] || {};
    await client.query(linkTeamResultRowsSql(RACE_ID));
    // Fase 6: si quedaron filas sin enlazar (carrera sin startlist) y se pasó --gender,
    // resolver por NOMBRE desde el propio resultado UCI, creando la ficha que falte.
    let created = 0;
    const ridersJson = JSON.stringify(extractRidersForNameResolve(data, acceptedEventIds));
    if (GENDER && unresolved > 0) {
      const rn = await client.query(
        'SELECT matched, created, unresolved FROM public.resolve_uci_results_by_name($1,$2,$3::jsonb)',
        [RACE_ID, GENDER, ridersJson],
      );
      ({ matched = matched, created = 0, unresolved = unresolved } = rn.rows[0] || {});
    }
    // Fase 6: sembrar la startlist desde el volcado UCI (solo si --seed-startlist y --gender).
    // El cron lo activa SOLO para carreras sin startlist curada (no pisa la del panel).
    // Lee globalRiderId de race_uci_results (ya resuelto arriba) → nombre bonito + bandera + equipo en la web.
    let slInfo = null;
    if (SEED_STARTLIST && GENDER) {
      const rs = await client.query(
        'SELECT teams_seeded, riders_seeded, teams_matched, teams_unmatched FROM public.resolve_uci_startlist($1,$2,$3::jsonb)',
        [RACE_ID, GENDER, ridersJson],
      );
      slInfo = rs.rows[0] || null;
    }
    await client.query('COMMIT');
    log(`✅ aplicado: ${nStages} clasificaciones, ${nResults} filas (competition ${competitionId} → ${RACE_ID})` +
        (nSkipped ? `; ${nSkipped} ya volcadas, omitidas (--skip-existing)` : ''));
    if (nRejected) log(`   ↳ ${nRejected} omitidas sin rank=1 válido sin IRM`);
    if (dnfFilled > 0) log(`   ↳ DNF derivados de la startlist: ${dnfFilled} (--fill-dnf-from-startlist)`);
    if (irmOverridden > 0) log(`   ↳ IRM corregidos: ${irmOverridden} (--irm-override)`);
    log(`   ↳ riders: ${matched} enlazados, ${unresolved} sin enlazar` +
        (created > 0 ? `, ${created} fichas creadas (Fase 6 por nombre)` : '') +
        (unresolved > 0 ? ' (sin nombre/dorsal útil → visibles por riderDisplay)' : ''));
    if (slInfo) {
      log(`   ↳ startlist sembrada: ${slInfo.riders_seeded} corredores, ${slInfo.teams_seeded} equipos ` +
          `(${slInfo.teams_matched} casados, ${slInfo.teams_unmatched} sin casar → nombre crudo)`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
    log('FATAL en apply (rollback hecho): ' + (e.message || e));
    process.exit(1);
  }
  await client.end().catch(() => {});
  // EXIT 3 = "escribió, pero NINGUNA clasificación era nueva" (solo re-volcado de datos
  // sobre páginas ya existentes: Tissot/Matsport corrigiendo en la 1ª hora). El cron lo
  // distingue del 0 (hubo clasificación nueva → sí hay contenido/URL nueva) para NO
  // regenerar og-pages/sitemap en balde. Si presentEventIds no estaba poblado, nNew
  // es conservador (= nStages) y nunca da 3 sin motivo.
  if (nNew === 0) {
    log(`ℹ️  sin contenido nuevo: ${nStages} clasificación(es) re-volcada(s), 0 nuevas → no se regenera SEO`);
    process.exit(3);
  }
}

// Solo arranca como CLI. Importado desde los tests (que ejercitan buildPlan
// directamente) no debe ejecutar nada ni llamar a process.exit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { buildPlan, linkTeamResultRowsSql };
