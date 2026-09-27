#!/usr/bin/env node
/**
 * results-cron.mjs — Fase 6 (PLAN-resultados-web.md §5/§7): refresco de
 * resultados UCI en lotes. Es el cuerpo del cron (.github/workflows/uci-results.yml)
 * y también la herramienta del backfill one-shot.
 *
 * QUÉ HACE
 *   1. Selecciona carreras de race_uci_links a procesar según --scope:
 *        · today   → carreras con una jornada EN VENTANA DE META (087): desde 15 min
 *                    después de su hora de meta (race_days."estimatedFinishTimeUtc")
 *                    hasta 3 h después — la UCI publica al acabar cada prueba; fuera
 *                    de esa franja no hay nada nuevo que volcar. Jornada de HOY sin
 *                    hora de meta → en ventana todo el día. Sean pending u ok:
 *                    vuelca la etapa del día según la UCI la publica y RE-VERIFICA
 *                    las ya volcadas (descalificaciones, cambios de orden) — el
 *                    upsert es idempotente. SIN --limit por defecto (lo del día
 *                    siempre entra entero; son pocas carreras). --ignore-window
 *                    procesa TODO lo del día (pre-087, para forzados manuales).
 *        · backlog → el resto: enlaces no resueltos con >=1 etapa pasada
 *                    (dateKey < hoy) PERO sin etapa hoy, o carreras ya terminadas
 *                    que todavía no tienen jornadas, más carreras
 *                    results-only ya volcadas que aún tengan resultados sin identidad.
 *                    Troceado con --limit. Los intentos se registran antes del fetch,
 *                    rotan entre carreras y aplican una espera creciente a las que
 *                    siguen vacías o sin una clasificación publicable.
 *        · all     → today ∪ backlog (default). Uso bajo demanda / backfill one-shot.
 *      Ordena: etapa-hoy → backlog disponible por próximo reintento y última tentativa,
 *              con desempate estable por carrera.
 *   2. Por carrera: fetcher según race_uci_links.source (migración 089) —
 *      'uci' → dataride-results-fetch · 'tissot' → tissot-results-fetch
 *      (Tissot Timing, carreras que cronometra: publica antes que la UCI) ·
 *      'matsport' (101) → matsport-results-fetch · 'raceresult' (108) →
 *      raceresult-results-fetch (my.raceresult.com; API JSON pública, key+server
 *      resueltos del /config) · 'sts' (109) → sts-results-fetch (STS/Wiclax,
 *      stsport.fr; .clax XML público en /LIVE/<stsCode>.clax) · 'domtel' (118) →
 *      domtel-results-fetch (Domtel Sport Timing, domtel-sport.pl; JSON público
 *      wp-admin/admin-ajax.php, pid = domtelCode) · 'livetiming' (119) →
 *      livetiming-results-fetch (livetiming.at, cronometrador austriaco/Tour of
 *      Austria; JSON público live_links.php + live_data_all.php, un V_ID por etapa,
 *      livetimingCode = V_ID etapa 1 y se derivan los demás por fecha) ·
 *      'manual_timing' (104) → manual_timing-results-fetch (JSON público live por etapa) ·
 *      'pdf' (090) / 'sportstiming' (103) → SE SALTAN (volcado manual/local;
 *      sin fetcher automático) —
 *      HÍBRIDO UCI-preferente: source='uci' + domtelCode poblado → se corren AMBOS
 *      fetchers (UCI primero, Domtel de relleno después). DataRide (oficial y completo:
 *      etapa+gc+puntos+montaña+jóvenes+equipos) REEMPLAZA a Domtel (provisional, solo
 *      etapa+general) donde ya publicó (su purga borra la gemela sintética; el guard del
 *      upsert impide re-duplicarla); Domtel tapa las etapas que DataRide aún no da. El
 *      competitionId del link = el REAL de DataRide (positivo). —
 *      → results-upsert --apply (subproceso, con --gender y, si la carrera
 *      NO tiene startlist curada, --seed-startlist; en results-only añade
 *      --resolve-bibs-by-name). El upsert ya enlaza riders
 *      (082/083) y siembra la startlist (084) en su transacción. Ambos fetchers
 *      emiten el MISMO JSON → el upsert no distingue fuentes. syncStatus pasa
 *      a 'ok' | 'error'. ∅-guard: si el fetch no trae NINGUNA fila (comp
 *      enlazada pero la UCI aún sin publicar), NO se upserta → el link queda
 *      'pending' y los pases siguientes del backlog lo reintentan.
 *      CIERRE ESTRICTO: una jornada con rank=1 válido queda cerrada para el
 *      automático y las correcciones se hacen desde el panel. El cron solo pide la
 *      etapa pendiente; la clasificación final de una vuelta conserva su propia
 *      pasada hasta que llega su GC. Así se evita incluso descargar la historia de
 *      la competición en cada ejecución.
 *   3. Reporta cuántas se tocaron y si hubo clasificaciones nuevas para
 *      observabilidad. Los workflows no regeneran páginas tras el volcado.
 *
 * La selección automática del día la invoca el timer del VPS con --configured.
 * results-today.yml queda como fallback manual y results-backlog.yml
 * conserva su circuito independiente para retrasadas.
 *
 * NO descubre carreras nuevas (el alta es curada). Solo procesa lo ya enlazado.
 *
 * Uso:
 *   node scripts/results-fetchers/results-cron.mjs --scope today
 *   node scripts/results-fetchers/results-cron.mjs --scope backlog --limit 25
 *   node scripts/results-fetchers/results-cron.mjs --dry-run            # all
 *   node scripts/results-fetchers/results-cron.mjs --race-id <id>       # una concreta
 *
 * Args:
 *   --scope S      today | backlog | all (default all). Qué franja de carreras coge.
 *   --limit N      máximo de carreras por ejecución (default 25). Trocea el backlog.
 *                  En scope=today el default es ilimitado (lo del día entra entero).
 *   --recent-days  (legacy, sin uso en la selección actual; reservado).
 *   --delay        ms entre peticiones del fetcher (default 300; educado con la UCI).
 *   --throttle     ms de pausa tras CADA carrera que escribió (default 4000; protege la
 *                  web: evita encadenar checkpoints de Postgres). 0 = sin pausa. Con
 *                  --race-id se ignora (no hay siguiente carrera que proteger).
 *   --race-id      procesar SOLO esa carrera (ignora la selección por estado).
 *   --require-result junto a --race-id: devuelve error si no se procesa correctamente
 *                  ninguna clasificación; lo usa la cola manual para no cerrar como
 *                  completada una respuesta vacía o una carrera sin objetivo.
 *   --stage N      (solo con --race-id) re-escribir SOLO la etapa stageNumber==N; el
 *                  resto de etapas del JSON se descartan (se pasa --only-stage al upsert).
 *                  El "Volcar esta etapa" del panel: la etapa 16 no re-vuelca la 1-15.
 *   --sector-index N (solo con --race-id --stage) limitar un doble sector a 0=A, 1=B, ….
 *   --ignore-window  (solo scope=today) ignora la ventana de meta: coge todo lo que
 *                  tenga etapa HOY, como antes de 087. Para forzados manuales.
 *   --no-skip-existing  fuerza el re-volcado COMPLETO en scope=today (desactiva la
 *                  omisión de clasificaciones ya volcadas que va por defecto). Útil
 *                  para re-sincronizar todo sin acotar a una carrera con --race-id.
 *   --skip-existing  fuerza la omisión de clasificaciones ya volcadas AUNQUE no esté
 *                  activa por defecto (p. ej. junto a --ignore-window). La pasada de
 *                  tarde (uci-link-evening.yml) la usa con `--scope today --ignore-window
 *                  --skip-existing` para volcar SOLO las carreras recién enlazadas del
 *                  día (las ya asentadas se saltan baratas) sin depender de la ventana
 *                  de meta (que para una carrera de la mañana ya habría cerrado).
 *   --configured   selecciona únicamente las reglas automáticas activas y en ventana.
 *                  Es el modo del watcher del VPS. Resuelve la jornada exacta y,
 *                  en dobles sectores, pasa también 0=A/1=B al upsert.
 *   --historical   junto a --scope backlog limita la selección a carreras de 2020–2025.
 *                  Es el modo del proceso histórico separado del watcher actual.
 *   --dry-run      lista lo que haría, sin fetch ni escritura.
 *
 * Requiere DATABASE_URL (.env o entorno). Salida JSON de resumen en stdout (la
 * última línea) para que el workflow la parsee; logs en stderr.
 */
'use strict';

import { spawn } from 'child_process';
import { readFileSync, existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { hasPublishableResults } from './results-upsert.mjs';
import { pendingHistoricalRaceIds } from './historical-identity-log.mjs';
import { LIVE_RESULT_SOURCES, COVERED_STAGE_REFRESH_SOURCES, MANUAL_RESULT_SOURCES, MANUAL_OBSERVATION_PROVIDERS, isProgressiveResultSource } from './result-publication.mjs';
export { LIVE_RESULT_SOURCES, COVERED_STAGE_REFRESH_SOURCES, MANUAL_RESULT_SOURCES };

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const SCOPE = (getArg('scope') || 'all').toLowerCase();   // today | backlog | all
if (!['today', 'backlog', 'all'].includes(SCOPE)) {
  process.stderr.write(`FATAL: --scope inválido "${SCOPE}" (today|backlog|all)\n`); process.exit(1);
}
// En scope=today no troceamos: las carreras del día son pocas y todas son prioridad.
// El usuario puede forzar --limit igualmente.
const LIMIT = getArg('limit') != null ? parseInt(getArg('limit'), 10)
  : (SCOPE === 'today' ? 1000 : 25);
const DELAY = getArg('delay') || '300';
const ONE_RACE = getArg('race-id');
// Las solicitudes dirigidas desde la cola manual deben distinguir una importación
// válida de una respuesta vacía. El cron automático conserva su política habitual.
const REQUIRE_RESULT = hasFlag('require-result');
if (REQUIRE_RESULT && !ONE_RACE) {
  process.stderr.write('FATAL: --require-result solo se admite junto a --race-id\n');
  process.exit(1);
}
// --stage N: SOLO con --race-id. Restringe el volcado a la etapa stageNumber==N (se
// pasa como --only-stage al upsert). El fetcher siempre trae la carrera entera, pero
// solo re-escribimos esa etapa → el "Volcar esta etapa" del panel no re-vuelca las
// anteriores (la etapa 16 del Tour ya no arrastra la 1-15). Sin --race-id se ignora.
const ONE_STAGE = (ONE_RACE && getArg('stage') != null) ? parseInt(getArg('stage'), 10) : null;
// --sector-index N: junto a --race-id --stage, limita una doble jornada a su
// sector exacto (0=A, 1=B, …). Lo usa el enlazador live cuando una carrera se
// incorpora el mismo día de una jornada 3A/3B.
const ONE_SECTOR_INDEX = (ONE_RACE && getArg('sector-index') != null)
  ? parseInt(getArg('sector-index'), 10) : null;
const DRY = hasFlag('dry-run');
const IGNORE_WINDOW = hasFlag('ignore-window');
const HISTORICAL = hasFlag('historical');
// Selección por las ventanas configuradas en el panel. El timer despierta este
// proceso cada minuto, pero las carreras enlazadas sin regla activa no entran nunca.
const CONFIGURED = hasFlag('configured');
// La frecuencia ya no es configuración editorial. El panel define únicamente la
// ventana y el servicio decide cada cuánto observar la fuente según su capacidad:
//   · feeds live: cada minuto;
//   · fuentes post-meta rápidas: cada 2 min alrededor de meta, luego cada 5;
//   · DataRide/UCI: cada 5 min solo entre +30 y +120 min post-meta; 10 fuera.
// Sigue siendo observación adaptativa, no push: los proveedores no exponen un
// webhook común. La detección condicional por proveedor se podrá añadir donde la
// fuente exponga metadatos fiables; nunca vuelve a ser un control del panel.
const sqlStringList = (values) => values.map((value) => `'${value}'`).join(', ');
export const BACKLOG_RETRY_INTERVAL_SQL = `CASE
  WHEN COALESCE(l."backlogAttemptCount", 0) < 1 THEN interval '10 minutes'
  WHEN COALESCE(l."backlogAttemptCount", 0) < 2 THEN interval '30 minutes'
  WHEN COALESCE(l."backlogAttemptCount", 0) < 3 THEN interval '2 hours'
  WHEN COALESCE(l."backlogAttemptCount", 0) < 4 THEN interval '6 hours'
  WHEN COALESCE(l."backlogAttemptCount", 0) < 5 THEN interval '12 hours'
  ELSE interval '24 hours'
END`;
export const CONFIGURED_POLL_INTERVAL_MINUTES_SQL = `CASE
  WHEN l."source" IN (${sqlStringList(LIVE_RESULT_SOURCES)})
    OR l."evodataCode" IS NOT NULL
    THEN 1
  WHEN l."source" = 'uci' THEN CASE
    WHEN now() < d."estimatedFinishTimeUtc" + interval '30 minutes' THEN 10
    WHEN now() <= d."estimatedFinishTimeUtc" + interval '120 minutes' THEN 5
    ELSE 10
  END
  ELSE CASE
    WHEN now() < d."estimatedFinishTimeUtc" THEN 10
    WHEN now() <= d."estimatedFinishTimeUtc" + interval '60 minutes' THEN 2
    ELSE 5
  END
END`;
const CONFIGURED_START_AT_SQL = `CASE
  WHEN d."resultsSyncStartAt" IS NOT NULL
    THEN d."resultsSyncStartAt"
  WHEN d."resultsSyncStartOffsetMinutes" IS NOT NULL
    THEN d."estimatedFinishTimeUtc" + d."resultsSyncStartOffsetMinutes" * interval '1 minute'
  WHEN l."syncStartTime" IS NOT NULL
    THEN ((d."estimatedFinishTimeUtc" AT TIME ZONE 'Europe/Madrid')::date + l."syncStartTime")
      AT TIME ZONE 'Europe/Madrid'
  ELSE d."estimatedFinishTimeUtc"
    + COALESCE(d."resultsSyncStartOffsetMinutes", l."syncStartOffsetMinutes") * interval '1 minute'
END`;
const CONFIGURED_STOP_AT_SQL = `CASE
  WHEN d."resultsSyncStopAt" IS NOT NULL
    THEN d."resultsSyncStopAt"
  WHEN d."resultsSyncStopOffsetMinutes" IS NOT NULL
    THEN d."estimatedFinishTimeUtc" + d."resultsSyncStopOffsetMinutes" * interval '1 minute'
  WHEN l."syncStopTime" IS NOT NULL
    THEN (((d."estimatedFinishTimeUtc" AT TIME ZONE 'Europe/Madrid')::date + l."syncStopTime")
      + CASE WHEN l."syncStartTime" IS NOT NULL AND l."syncStopTime" <= l."syncStartTime"
          THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE 'Europe/Madrid'
  ELSE d."estimatedFinishTimeUtc"
    + COALESCE(d."resultsSyncStopOffsetMinutes", l."syncStopOffsetMinutes") * interval '1 minute'
END`;
// No re-volcar clasificaciones ya presentes (ver results-upsert --skip-existing).
// Activo por defecto en el volcado AUTOMÁTICO del día (scope=today, sin --race-id ni
// --ignore-window): la UCI publica completo y definitivo, así que re-volcar las etapas
// ya volcadas en cada pasada es trabajo en balde. SportSoft Live puede publicar la meta
// con décimas antes de incorporar grupos y bonificaciones: se reescribe durante toda
// la ventana de meta (per-carrera abajo).
// Se desactiva con --no-skip-existing (forzar re-volcado completo sin --race-id) y NO
// aplica a --ignore-window ni --race-id (forzados manuales: re-vuelcan todo a propósito).
// EXCEPCIÓN: --skip-existing explícito lo fuerza ON aunque sea --ignore-window — lo usa
// la pasada de tarde para volcar lo recién enlazado del día (HAS_TODAY) sin re-volcar a lo
// bestia lo ya asentado. --race-id sigue re-volcando completo (forzado manual de UNA carrera).
const SKIP_EXISTING = (hasFlag('skip-existing') && !ONE_RACE)
  || (SCOPE === 'today' && !ONE_RACE && !IGNORE_WINDOW && !hasFlag('no-skip-existing'));
// Throttle: pausa (ms) tras CADA carrera que escribió algo, para no encadenar los
// checkpoints de Postgres (escrituras grandes → WAL → checkpoint largo → I/O saturada
// → la web se arrastra y le caducan las queries). Solo pausa tras escritura real: las
// carreras saltadas (vacías / sin cambios) no estresan el disco. 0 = sin pausa.
// Una sola carrera (--race-id) tampoco pausa (no hay "siguiente" que proteger).
const THROTTLE_MS = ONE_RACE ? 0 : parseInt(getArg('throttle', '4000'), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const HERE = new URL('.', import.meta.url).pathname;
const FETCH = join(HERE, 'dataride-results-fetch.mjs');
const TISSOT_FETCH = join(HERE, 'tissot-results-fetch.mjs');
const MATSPORT_FETCH = join(HERE, 'matsport-results-fetch.mjs');
const RACERESULT_FETCH = join(HERE, 'raceresult-results-fetch.mjs');
const STS_FETCH = join(HERE, 'sts-results-fetch.mjs');
const DOMTEL_FETCH = join(HERE, 'domtel-results-fetch.mjs');
const LIVETIMING_FETCH = join(HERE, 'livetiming-results-fetch.mjs');
const CLASSIFICACOES_FETCH = join(HERE, 'classificacoes-results-fetch.mjs');
const INFOCITY_FETCH = join(HERE, 'infocity-results-fetch.mjs');
const EQTIMING_FETCH = join(HERE, 'eqtiming-results-fetch.mjs');
const ASO_FETCH = join(HERE, 'aso-results-fetch.mjs');
const manual_timing_FETCH = join(HERE, 'manual_timing-results-fetch.mjs');
const SPORTSOFT_FETCH = join(HERE, 'sportsoft-results-fetch.mjs');
const COLOMBIA_FETCH = join(HERE, 'colombia-pdf-results-fetch.mjs');
const BURGOS_FETCH = join(HERE, 'burgos-results-fetch.mjs');
const CHRONORACE_FETCH = join(HERE, 'chronorace-results-fetch.mjs');
const TIMING_FETCH = join(HERE, 'timing-results-fetch.mjs');
const BELGIANCYCLING_FETCH = join(HERE, 'belgiancycling-results-fetch.mjs');
const EVODATA_FETCH = join(HERE, 'evodata-results-fetch.mjs');
const CHRONOHR_FETCH = join(HERE, 'chronohr-results-fetch.mjs');
const MANEFFIC_FETCH = join(HERE, 'maneffic-results-fetch.mjs');
const ISTANBUL_FETCH = join(HERE, 'istanbul-results-fetch.mjs');
const BORNAN_FETCH = join(HERE, 'bornan-results-fetch.mjs');
const ATRESULTS_FETCH = join(HERE, 'atresults-results-fetch.mjs');
const SOUTHBOHEMIA_FETCH = join(HERE, 'southbohemia-results-fetch.mjs');
const UPSERT = join(HERE, 'results-upsert.mjs');

function topologyFromPayload(kind, data) {
  return {
    version: 1,
    source: kind,
    fetchedAt: data.fetchedAt || new Date().toISOString(),
    stages: (data.stages || []).map((st) => ({
      uciRaceId: st.uciRaceId ?? null,
      stageNumber: st.stageNumber ?? null,
      sectorIndex: st.sectorIndex ?? null,
      stageName: st.stageName ?? null,
      dateKey: st.dateKey ?? null,
      raceType: st.raceType ?? null,
      isFinalClassification: !!st.isFinalClassification,
      eventIds: (st.classifications || []).map((cl) => cl.eventId).filter((id) => id != null),
    })),
  };
}

async function saveTopology(url, raceId, kind, data) {
  // La caché no participa en el volcado: si falla, el resultado sigue siendo
  // válido y el siguiente runner volverá a descubrir la topología.
  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query(
      `UPDATE public.race_uci_links
       SET "resultsFetchTopology" = $2::jsonb, "resultsFetchTopologyUpdatedAt" = now()
       WHERE "raceId" = $1`,
      [raceId, JSON.stringify(topologyFromPayload(kind, data))],
    );
    await client.end();
  } catch (e) {
    log(`  ⚠ no se pudo guardar caché de topología: ${e.message}`);
  }
}

export function isProtectedInvalidRaceDeletion(error) {
  return error?.code === '55000'
    && String(error?.message || '').includes('conserva una clasificación principal válida');
}

async function invalidatePublicationRead(url, raceId, provider, stageNumber) {
  if (!isProgressiveResultSource(provider)) return;
  const { default: pg } = await import('pg');
  const client = new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}});
  await client.connect();
  try { await client.query('SELECT public.invalidate_result_observations($1,$2,$3)',[raceId,provider,stageNumber ?? null]); }
  finally { await client.end(); }
}

async function deleteInvalidResultsRace(url, raceId, reason) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const operationId = `auto-invalid-results-${raceId}-${Date.now()}`;
  await client.connect();
  try {
    try {
      const { rows } = await client.query(
        'SELECT private.delete_invalid_results_race($1, $2, $3) AS result',
        [raceId, operationId, reason],
      );
      return rows[0]?.result || null;
    } catch (error) {
      // La función privada protege una carrera que ya conserva una llegada válida.
      // Ese desenlace es resolutivo, no un fallo del servicio: el payload nuevo puede
      // estar vacío, pero los resultados asentados bastan para cerrar el backlog.
      if (!isProtectedInvalidRaceDeletion(error)) throw error;
      await client.query(
        `UPDATE public.race_uci_links
         SET "syncStatus" = 'ok', "syncError" = NULL
         WHERE "raceId" = $1`,
        [raceId],
      );
      return { deleted: false, preserved: true, reason: 'valid_results_present' };
    }
  } finally {
    await client.end().catch(() => {});
  }
}

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

// ¿La etapa que estamos volcando es la ÚLTIMA de la vuelta? Decide DOS cosas a la vez
// (por eso vive aquí y no inline): que el fetch lea la competición ENTERA en vez de
// `--stage N`, y que el upsert reciba `--include-final`. Las dos son necesarias: la
// pseudo-etapa "Final Classification" de DataRide es una `race` aparte con stageNumber
// NULL, así que `--stage N` no la trae y sin ella `--include-final` no filtra nada.
//
// `needsFinal` lo calcula la query --configured (mira si la general final ya está
// cubierta). `isLastRaceDay`, cuando viene del timer, distingue el último sector:
// 3A y 3B comparten el máximo stageNumber, pero solo 3B puede abrir la final. En el
// disparo manual no existe ese dato y se conserva el fallback por totalStages.
export function isFinalStageDump(targetStage, totalStages, needsFinal = false, isLastRaceDay = null) {
  if (needsFinal) return true;
  if (isLastRaceDay != null) return isLastRaceDay === true;
  if (targetStage == null || totalStages == null) return false;
  return Number(targetStage) === Number(totalStages);
}

// Argumentos del filtro final de escritura. El fetcher puede devolver más de una
// jornada (DataRide devuelve 3A y 3B al pedir --stage 3); el upsert es la frontera
// que garantiza que solo se persista el sector cuya ventana seleccionó el timer.
export function stageFilterArgs(targetStage, targetSectorIndex = null, includeFinal = false) {
  if (targetStage == null) return [];
  return [
    '--only-stage', String(targetStage),
    ...(targetSectorIndex == null ? [] : ['--only-sector-index', String(targetSectorIndex)]),
    ...(includeFinal ? ['--include-final'] : []),
  ];
}

// Toda fuente live puede publicar una llegada parcial y ampliarla o corregirla durante
// la ventana. Una etapa con rank=1 no está cerrada para estas fuentes: debe seguir
// seleccionándose y el upsert debe reescribirla. Compartir la lista evita que la
// cadencia y el guard de etapa cubierta diverjan al añadir una fuente.
export function refreshesCoveredStage(source) {
  return COVERED_STAGE_REFRESH_SOURCES.includes(source);
}

// Las carreras marcadas resultsOnly conservan resultados sin generar inscritos.
// La excepción se limita a DataRide: otras fuentes nunca aportan una identidad
// autorizada para sembrar una startlist.
export function shouldSeedStartlist(startlistCount, source, resultsOnly = false) {
  return !(startlistCount > 0) && source === 'uci' && !resultsOnly;
}

// Las carreras results-only no tienen startlist pública, pero DataRide sí aporta
// nombre, país y fecha de nacimiento en las filas con dorsal. Activar la Fase 6
// nominal sobre esas filas permite fijar globalRiderId sin sembrar inscritos.
export function shouldResolveBibsByName(source, resultsOnly = false) {
  return source === 'uci' && resultsOnly === true;
}

export function manual_timingFetchArgs({ code, stage, date, competitionId, outDir, isFinalStage = false }) {
  if (!code || stage == null) return null;
  return [
    '--code', String(code),
    '--stage', String(stage),
    '--date', String(date || ''),
    '--competition-id', String(competitionId),
    '--out', outDir,
    '--require-arrivi',
    ...(isFinalStage ? ['--final'] : []),
  ];
}

export function raceresultFetchArgs({
  event, competitionId, outDir, delay, gender, raceFormat, date, targetStage,
}) {
  if (!event) return null;
  return [
    '--event', String(event),
    '--competition-id', String(competitionId),
    '--out', outDir,
    '--delay', String(delay),
    ...(gender ? ['--gender', String(gender)] : []),
    ...(raceFormat === 'one_day' ? ['--one-day'] : []),
    ...(date ? ['--date', String(date)] : []),
    ...(targetStage != null ? ['--stage', String(targetStage)] : []),
  ];
}

// Ejecuta un script Node como subproceso; resuelve con su exit code. Hereda stderr.
function run(script, scriptArgs) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...scriptArgs], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.DATABASE_URL;
  if (!url) { log('FATAL: falta DATABASE_URL (.env o entorno)'); process.exit(1); }
  const identityPendingLog = env.HISTORICAL_IDENTITY_PENDING_LOG || null;
  if (HISTORICAL && !identityPendingLog) {
    log('FATAL: falta HISTORICAL_IDENTITY_PENDING_LOG para el backlog histórico');
    process.exit(1);
  }
  const blockedHistoricalRaceIds = HISTORICAL
    ? pendingHistoricalRaceIds(identityPendingLog)
    : new Set();

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  if (CONFIGURED && !DRY) await client.query('SELECT public.expire_result_updating()');

  // Nº de etapa cuya jornada es HOY (la que está en vivo / recién terminada). Solo se
  // usa para source='raceresult': su lista LIVE no filtra por etapa, así que el fetcher
  // necesita que le digamos QUÉ etapa pedir con --stage (ver raceresult-results-fetch.mjs).
  // Si hay varias jornadas hoy (no debería) coge la menor; NULL si ninguna es hoy.
  const LIVE_STAGE_SUBSELECT = `(SELECT min(d."stageNumber") FROM race_days d
       WHERE d."raceId" = r.id AND d."dateKey" = to_char(now(), 'YYYY-MM-DD')
         AND d."stageNumber" IS NOT NULL)`;

  let targets;
  try {
    if (ONE_RACE) {
      const { rows } = await client.query(
        `SELECT l."raceId", l."competitionId", l."uciRaceId", l."source", l."tissotCode", l."tissotEventNumber", l."matsportCode", l."raceresultCode", l."stsCode", l."stsArticleUrl", l."stsSkipClaxPoints", l."domtelCode", l."livetimingCode", l."classificacoesCode", l."infocityCode", l."sportsoftCode", l."eqtimingCode", l."asoUrl", l."manual_timingCode", l."colombiaCode", l."chronoraceCode", l."timingCode", l."belgianCyclingCode", l."evodataCode", l."chronoHrCode", l."manefficCode", l."bornanCode", l."atresultsCode", l."resultsFetchTopology" AS "fetchTopology", r.gender, r.year, r."raceFormat", r."resultsOnly",
                (SELECT jsonb_object_agg(x."stageNumber"::text, x."dateKey") FROM race_days x
                  WHERE x."raceId" = r.id AND x."stageNumber" IS NOT NULL AND x."isRestDay" = false) AS "stageDates",
                COALESCE((SELECT min(d2."dateKey") FROM race_days d2
                          WHERE d2."raceId" = r.id
                            AND d2."stageNumber" = COALESCE($2::int, ${LIVE_STAGE_SUBSELECT})),
                         r."startDate") AS "scheduledDate",
                $3::int AS "scheduledSectorIndex",
                (
                  (
                    SELECT x.id
                    FROM (
                      SELECT d3.id,
                             row_number() OVER (
                               PARTITION BY d3."stageNumber"
                               ORDER BY d3."neutralStartTimeUtc" ASC NULLS LAST, d3.id ASC
                             ) - 1 AS sector_index
                      FROM race_days d3
                      WHERE d3."raceId" = r.id
                        AND d3."stageNumber" = COALESCE($2::int, ${LIVE_STAGE_SUBSELECT})
                        AND d3."isRestDay" = false
                    ) x
                    WHERE $3::int IS NULL OR x.sector_index = $3::int
                    ORDER BY x.sector_index
                    LIMIT 1
                  ) = (
                    SELECT d4.id
                    FROM race_days d4
                    WHERE d4."raceId" = r.id AND d4."isRestDay" = false
                    ORDER BY d4."dateKey" DESC,
                             d4."neutralStartTimeUtc" DESC NULLS LAST,
                             d4."estimatedFinishTimeUtc" DESC NULLS LAST,
                             d4.id DESC
                    LIMIT 1
                  )
                ) AS "scheduledIsLastRaceDay",
                (SELECT count(*) FROM startlist_teams t WHERE t."raceId" = r.id) AS sl,
                ${LIVE_STAGE_SUBSELECT} AS "liveStage",
                (SELECT max(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id) AS "totalStages",
                (SELECT min(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id AND d."isRestDay" = false) AS "minStage"
         FROM race_uci_links l JOIN races r ON r.id = l."raceId"
         WHERE l."raceId" = $1`, [ONE_RACE, ONE_STAGE, ONE_SECTOR_INDEX]);
      targets = rows;
    } else if (CONFIGURED) {
      // Una llegada con ganador y adquisición registrada está cubierta para las
      // fuentes post-meta. Un avance manual sin adquisición no cierra la ventana.
      // Las fuentes live conservan su refresco y la final se trata por separado.
      // Un placeholder manual (PDF u otra fuente no oficial) registra observación con proveedor manual
      // o 'unknown' y comparte eventId con el fetcher: no cuenta como adquisición.
      const AUTOMATIC_ACQUISITION = `s."lastSyncedAt" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM private.result_publication_state p
            WHERE p."stageRef" = s.id AND p.provider IN (${sqlStringList(MANUAL_OBSERVATION_PROVIDERS)}))`;
      const MAIN_COVERED = `EXISTS (
        SELECT 1 FROM public.race_uci_stages s
        JOIN public.race_uci_results rr ON rr."stageRef" = s.id
        WHERE (s."raceDayId" = d.id OR (d."stageNumber" IS NULL
               AND s."raceId" = d."raceId" AND s."stageNumber" IS NULL
               AND s."isFinalClassification" = false))
          AND s.scope = 'stage'
          AND (s."classKind" = 'stage' OR (d."stageNumber" IS NULL AND s."classKind" = 'gc'))
          AND ${AUTOMATIC_ACQUISITION}
          AND rr.rank = 1 AND COALESCE(rr.irm, '') = ''
      )`;
      const FINAL_COVERED = `EXISTS (
        SELECT 1 FROM public.race_uci_stages s
        JOIN public.race_uci_results rr ON rr."stageRef" = s.id
        WHERE s."raceId" = l."raceId" AND s."isFinalClassification" = true
          AND s."classKind" = 'gc' AND s.scope = 'stage'
          AND ${AUTOMATIC_ACQUISITION}
          AND rr.rank = 1 AND COALESCE(rr.irm, '') = ''
      )`;
      // Una clasificación sintética (PDF o cronometrador) puede haber dejado un
      // ganador válido antes de que DataRide publique la oficial. MAIN_COVERED la
      // considera cubierta por diseño, pero con source='uci' debe seguir entrando:
      // el upsert oficial purga la gemela negativa aunque no esté bloqueada.
      // Acotamos la excepción a la carrera que sigue en su ventana configurada;
      // una fuente que no sea UCI conserva el cierre estricto habitual.
      const UCI_OFFICIAL_REPLACEMENT_PENDING = `l."source" = 'uci' AND EXISTS (
        SELECT 1 FROM public.race_uci_stages s
        WHERE s."raceId" = l."raceId" AND s."eventId" < 0
          AND COALESCE(s."rowCount",0) > 0
      )`;
      // Última JORNADA, no solo máximo stageNumber: en 3A/3B ambos comparten el 3,
      // pero la clasificación final solo pertenece al sector B. dateKey y horas
      // ordenan los sectores igual que el índice A/B usado por el upsert.
      const IS_LAST_RACE_DAY = `d.id = (
        SELECT x.id FROM race_days x
        WHERE x."raceId" = l."raceId" AND x."isRestDay" = false
        ORDER BY x."dateKey" DESC,
                 x."neutralStartTimeUtc" DESC NULLS LAST,
                 x."estimatedFinishTimeUtc" DESC NULLS LAST,
                 x.id DESC
        LIMIT 1
      )`;
      const { rows } = await client.query(
        `SELECT DISTINCT ON (l."raceId")
                l."raceId", l."competitionId", l."uciRaceId", l."source", l."tissotCode", l."tissotEventNumber", l."matsportCode", l."raceresultCode", l."stsCode", l."stsArticleUrl", l."stsSkipClaxPoints", l."domtelCode", l."livetimingCode", l."classificacoesCode", l."infocityCode", l."sportsoftCode", l."eqtimingCode", l."asoUrl", l."manual_timingCode", l."colombiaCode", l."chronoraceCode", l."timingCode", l."belgianCyclingCode", l."evodataCode", l."chronoHrCode", l."manefficCode", l."bornanCode", l."atresultsCode", l."resultsFetchTopology" AS "fetchTopology", r.gender, r.year, r."raceFormat", r."resultsOnly",
                (SELECT jsonb_object_agg(x."stageNumber"::text, x."dateKey") FROM race_days x
                  WHERE x."raceId" = r.id AND x."stageNumber" IS NOT NULL AND x."isRestDay" = false) AS "stageDates",
                d."dateKey" AS "scheduledDate",
                d.id AS "scheduleRaceDayId", d."stageNumber" AS "scheduledStage",
                d."scheduledSectorIndex", (${IS_LAST_RACE_DAY}) AS "scheduledIsLastRaceDay",
                ${MAIN_COVERED} AS "stageCovered",
                (COALESCE(r."raceFormat", 'stage_race') <> 'one_day' AND ${IS_LAST_RACE_DAY} AND NOT (${FINAL_COVERED})) AS "needsFinal",
                (SELECT count(*) FROM startlist_teams t WHERE t."raceId" = r.id) AS sl,
                (${CONFIGURED_POLL_INTERVAL_MINUTES_SQL})::int AS "pollIntervalMinutes",
                d."stageNumber" AS "liveStage",
                (SELECT max(x."stageNumber") FROM race_days x WHERE x."raceId" = r.id) AS "totalStages",
                (SELECT min(x."stageNumber") FROM race_days x WHERE x."raceId" = r.id AND x."isRestDay" = false) AS "minStage"
         FROM race_uci_links l
         JOIN races r ON r.id = l."raceId"
         JOIN (
           SELECT d0.*,
                  row_number() OVER (
                    PARTITION BY d0."raceId", d0."stageNumber"
                    ORDER BY d0."neutralStartTimeUtc" ASC NULLS LAST, d0.id ASC
                  ) - 1 AS "scheduledSectorIndex"
             FROM race_days d0
         ) d ON d."raceId" = l."raceId"
         WHERE d."estimatedFinishTimeUtc" IS NOT NULL
           AND l."source" NOT IN (${sqlStringList(MANUAL_RESULT_SOURCES)})
           AND now() >= (${CONFIGURED_START_AT_SQL})
           AND now() <= (${CONFIGURED_STOP_AT_SQL})
           AND (d."resultsLastAutoSyncAt" IS NULL OR d."resultsLastAutoSyncAt" <= now()
             - (${CONFIGURED_POLL_INTERVAL_MINUTES_SQL}) * interval '1 minute')
           AND (NOT (${MAIN_COVERED}) OR l."source" IN (${sqlStringList(COVERED_STAGE_REFRESH_SOURCES)}) OR (${UCI_OFFICIAL_REPLACEMENT_PENDING})
             OR (COALESCE(r."raceFormat", 'stage_race') <> 'one_day' AND ${IS_LAST_RACE_DAY} AND NOT (${FINAL_COVERED})))
         ORDER BY l."raceId", d."estimatedFinishTimeUtc" DESC
         LIMIT $1`, [LIMIT]);
      targets = rows;
      // Registrar el intento ANTES del fetch evita que el tick de cada minuto
      // encole el mismo trabajo mientras el runner sigue arrancando.
      if (targets.length && !DRY) {
        await client.query(
          `UPDATE race_days SET "resultsLastAutoSyncAt" = now(), "resultsAutoSyncQueuedAt" = NULL
           WHERE id = ANY($1::text[])`, [targets.map(t => t.scheduleRaceDayId)]);
      }
    } else {
      // Predicados de selección por scope (sobre race_days; "hoy" = la fecha real,
      // NO la navegada). El upsert es idempotente → re-procesar el día reescribe
      // por stageRef y propaga descalificaciones/cambios de orden.
      //
      //   · IN_WINDOW:  ventana de meta (087) — now() ∈ [meta+15min, meta+3h] de
      //     alguna jornada. La UCI publica al acabar cada prueba → fuera de esa
      //     franja no hay nada nuevo que volcar. NO mira dateKey: una meta a las
      //     23:50 UTC sigue en ventana de madrugada aunque su dateKey ya sea
      //     "ayer". Jornada de HOY sin hora de meta → en ventana todo el día (no
      //     perder cobertura). ESPEJO del guard de pg_cron (migración 087):
      //     cambiar la ventana aquí = cambiarla también allí.
      //   · HAS_TODAY:  existe una etapa con dateKey = hoy. Lo usan scope=all y
      //     --ignore-window (forzados manuales: todo lo del día, sin ventana).
      //   · BACKLOG:    pending con >=1 etapa ya pasada (dateKey < hoy) y SIN etapa
      //     hoy → terminadas o en curso entre jornadas. Lo lento (scope=backlog; su
      //     cron propio está desactivado — lo dispara la pasada de tarde una vez al día).
      //     Excluye lo del día (lo lleva 'today') y las ok terminadas ya volcadas,
      //     salvo las results-only con resultados sin globalRiderId: esas carreras
      //     deben volver a pasar por DataRide para aprovechar sus metadatos nominales.
      //     EXCEPCIÓN: las carreras híbridas UCI-preferentes sin cubrir por DataRide
      //     entran aquí AUNQUE estén 'ok' (el relleno las dejó 'ok') — ver HYBRID_UNCOVERED.
      const HAS_TODAY = `EXISTS (SELECT 1 FROM race_days d
                  WHERE d."raceId" = r.id AND d."dateKey" = to_char(now(), 'YYYY-MM-DD'))`;
      // Un enlace histórico puede preceder al alta de sus jornadas. En ese caso la
      // fecha final de la carrera permite que el backlog lo procese; sin este fallback
      // queda pendiente para siempre porque no puede satisfacer EXISTS(race_days).
      const HAS_PAST = `(EXISTS (SELECT 1 FROM race_days d
                  WHERE d."raceId" = r.id AND d."dateKey" < to_char(now(), 'YYYY-MM-DD'))
                OR (NOT EXISTS (SELECT 1 FROM race_days d WHERE d."raceId" = r.id)
                  AND r."endDate" < to_char(now(), 'YYYY-MM-DD')))`;
      // La rama "hoy sin hora de meta" solo abre ventana si la jornada es
      // competición REAL (un-día o etapa numerada), NO un día de descanso
      // (stageNumber NULL/0 en un stage_race) — si no, una vuelta en descanso
      // mantendría el cron disparando todo el día. Espejo del guard 087+100.
      const IN_WINDOW = `EXISTS (SELECT 1 FROM race_days d
                  WHERE d."raceId" = r.id AND (
                    (d."estimatedFinishTimeUtc" IS NOT NULL
                     AND now() >= d."estimatedFinishTimeUtc" + interval '15 minutes'
                     AND now() <= d."estimatedFinishTimeUtc" + interval '3 hours')
                    OR (d."estimatedFinishTimeUtc" IS NULL
                     AND d."dateKey" = to_char(now(), 'YYYY-MM-DD')
                     AND (r."raceFormat" = 'one_day' OR d."stageNumber" >= 1))
                  ))`;
      const todayPred = (SCOPE === 'today' && !IGNORE_WINDOW) ? IN_WINDOW : HAS_TODAY;
      // HÍBRIDO UCI-preferente sin cubrir: carrera con source='uci' en la que AÚN
      // quedan clasificaciones sintéticas (eventId < 0) sin reemplazar por el
      // oficial. El caso original era el relleno Domtel/EvoData; desde el secuestro
      // del enlace por un volcado PDF (Vuelta al Ecuador 2026, E6) también hay
      // restos sintéticos de manuales anteriores a la publicación de DataRide.
      // La etapa la volcó la relleno o el manual rápido (link 'ok'), pero DataRide
      // publica horas/días después y su ventana de meta ya cerró (3 h) → sin esto
      // NADA la vuelve a mirar (el backlog solo cogía 'pending'). Se mantiene en el
      // backlog (pasada de tarde diaria) hasta que DataRide reemplace todas las
      // gemelas: al hacerlo, esas filas pasan a eventId > 0 y el predicado deja de
      // casar (se AUTO-TERMINA). Solo carreras recientes (endDate en los últimos
      // 20 días) para no re-consultar indefinidamente una que DataRide nunca
      // publicará; la protección de borrado conserva cualquier llegada válida,
      // también las sintéticas curadas a mano.
      const HYBRID_UNCOVERED = `l."source" = 'uci'
                  AND r."endDate" >= to_char(now() - interval '20 days', 'YYYY-MM-DD')
                  AND EXISTS (SELECT 1 FROM race_uci_stages s
                              WHERE s."raceId" = r.id AND s."eventId" < 0
                                AND COALESCE(s."rowCount",0) > 0)`;
      const RESULTS_ONLY_UNRESOLVED = `r."resultsOnly" = true
                  AND l."source" = 'uci'
                  AND EXISTS (SELECT 1 FROM race_uci_results rr
                              JOIN race_uci_stages rs ON rs.id = rr."stageRef"
                              WHERE rr."raceId" = l."raceId"
                                AND rs."isTeamEvent" = false
                                AND rr."globalRiderId" IS NULL)`;
      const backlogRetryReady = `(l."backlogNextAttemptAt" IS NULL
                  OR l."backlogNextAttemptAt" <= now())`;
      const backlogPred = `(${HAS_PAST}) AND NOT (${HAS_TODAY})
                  AND ${backlogRetryReady}
                  AND ((l."syncStatus" IN ('pending', 'partial', 'error')) OR (${HYBRID_UNCOVERED})
                    OR (${RESULTS_ONLY_UNRESOLVED}))`;
      const where = SCOPE === 'today' ? todayPred
                  : SCOPE === 'backlog' ? backlogPred
                  : `(${todayPred}) OR (${backlogPred})`;   // all

      const { rows } = await client.query(
        `SELECT l."raceId", l."competitionId", l."uciRaceId", l."source", l."tissotCode", l."tissotEventNumber", l."matsportCode", l."raceresultCode", l."stsCode", l."stsArticleUrl", l."stsSkipClaxPoints", l."domtelCode", l."livetimingCode", l."classificacoesCode", l."infocityCode", l."sportsoftCode", l."eqtimingCode", l."asoUrl", l."manual_timingCode", l."colombiaCode", l."chronoraceCode", l."timingCode", l."belgianCyclingCode", l."evodataCode", l."chronoHrCode", l."manefficCode", l."bornanCode", l."atresultsCode", l."resultsFetchTopology" AS "fetchTopology", r.gender, r.year, r."raceFormat", r."resultsOnly",
                (SELECT jsonb_object_agg(x."stageNumber"::text, x."dateKey") FROM race_days x
                  WHERE x."raceId" = r.id AND x."stageNumber" IS NOT NULL AND x."isRestDay" = false) AS "stageDates",
                (SELECT count(*) FROM startlist_teams t WHERE t."raceId" = r.id) AS sl,
                ${LIVE_STAGE_SUBSELECT} AS "liveStage",
                (SELECT min(d."dateKey") FROM race_days d
                  WHERE d."raceId" = r.id AND d."stageNumber" = ${LIVE_STAGE_SUBSELECT}) AS "scheduledDate",
                (SELECT max(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id) AS "totalStages",
                (SELECT min(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id AND d."isRestDay" = false) AS "minStage",
                CASE WHEN ${HAS_TODAY} THEN 0 ELSE 1 END AS sort_live
         FROM race_uci_links l JOIN races r ON r.id = l."raceId"
         WHERE l."source" NOT IN (${sqlStringList(MANUAL_RESULT_SOURCES)})
           AND (${where})
           AND (${HISTORICAL ? 'r.year BETWEEN 2020 AND 2025' : 'TRUE'})
           AND (${HISTORICAL && blockedHistoricalRaceIds.size ? 'NOT (l."raceId" = ANY($2::text[]))' : 'TRUE'})
         ORDER BY sort_live ASC,
                  l."backlogNextAttemptAt" ASC NULLS FIRST,
                  l."backlogLastAttemptAt" ASC NULLS FIRST,
                  r."endDate" DESC NULLS LAST,
                  l."raceId" ASC
         LIMIT $1`, HISTORICAL && blockedHistoricalRaceIds.size
          ? [LIMIT, [...blockedHistoricalRaceIds]]
          : [LIMIT]);
      targets = rows;
      // Un fetch vacío, rechazado o fallido no puede seguir ocupando el primer
      // puesto del backlog. Registrar el intento antes de acceder a la fuente
      // hace que la rotación sea duradera entre ticks y también cubre abortos.
      if (!DRY && SCOPE === 'backlog' && targets.length) {
        await client.query(
          `UPDATE public.race_uci_links AS l
           SET "backlogLastAttemptAt" = now(),
               "backlogAttemptCount" = COALESCE(l."backlogAttemptCount", 0) + 1,
               "backlogNextAttemptAt" = now() + ${BACKLOG_RETRY_INTERVAL_SQL}
           WHERE l."raceId" = ANY($1::text[])`,
          [targets.map((target) => target.raceId)],
        );
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  const scopeLabel = ONE_RACE ? 'race-id'
    : CONFIGURED ? 'configured'
    : SCOPE === 'today' ? (IGNORE_WINDOW ? 'today (todo el día, --ignore-window)' : 'today (ventana de meta 15min–3h)')
    : SCOPE;
  log(`Scope: ${scopeLabel} · Carreras a procesar: ${targets.length}` + (DRY ? ' (DRY-RUN)' : ''));
  if (DRY) {
    for (const t of targets) {
      const src = t.source === 'tissot' && t.tissotCode ? `tissot:${t.tissotCode}`
        : t.source === 'matsport' && t.matsportCode ? `matsport:${t.matsportCode}`
        : t.source === 'raceresult' && t.raceresultCode ? `raceresult:${t.raceresultCode}`
        : t.source === 'sts' && t.stsCode ? `sts:${t.stsCode}`
        : t.source === 'domtel' && t.domtelCode ? `domtel:${t.domtelCode}`
        : t.source === 'livetiming' && t.livetimingCode ? `livetiming:${t.livetimingCode}`
        : t.source === 'classificacoes' && t.classificacoesCode ? `classificacoes:${t.classificacoesCode}`
        : t.source === 'infocity' && t.infocityCode ? `infocity:${t.infocityCode}`
        : t.source === 'sportsoft' && t.sportsoftCode ? `sportsoft:${t.sportsoftCode}`
        : t.source === 'eqtiming' && t.eqtimingCode ? `eqtiming:${t.eqtimingCode}`
        : t.source === 'ASO' && t.asoUrl ? `ASO:${t.asoUrl}`
        : t.source === 'manual_timing' && t.manual_timingCode ? `manual_timing:${t.manual_timingCode}`
        : t.source === 'colombia' && t.colombiaCode ? `colombia:${t.colombiaCode}`
        : t.source === 'chronorace' && t.chronoraceCode ? `chronorace:${t.chronoraceCode}`
        : t.source === 'timing.ee' && t.timingCode ? `timing.ee:${t.timingCode}`
        : t.source === 'belgiancycling' && t.belgianCyclingCode ? `belgiancycling:${t.belgianCyclingCode}`
        : t.source === 'evodata' && t.evodataCode ? `evodata:${t.evodataCode}`
        : t.source === 'chronohr' && t.chronoHrCode ? `chronohr:${t.chronoHrCode}`
        : t.source === 'maneffic' && t.manefficCode ? `maneffic:${t.manefficCode}`
        : t.source === 'bornan' && t.bornanCode ? `bornan:${t.bornanCode}`
        : t.source === 'atresults' && t.atresultsCode ? `atresults:${t.atresultsCode}`
        : t.source === 'istanbul' ? `istanbul:${t.year}`
        : t.source === 'southbohemia' ? `southbohemia:${t.year}`
        // Híbridos UCI-preferentes: DataRide oficial seguido de los rellenos configurados.
        : t.source === 'uci' && t.domtelCode && t.evodataCode ? `uci + domtel:${t.domtelCode} + evodata:${t.evodataCode} (relleno)`
        : t.source === 'uci' && t.evodataCode ? `uci + evodata:${t.evodataCode} (relleno)`
        : t.source === 'uci' && t.domtelCode ? `uci + domtel:${t.domtelCode} (relleno)` : 'uci';
      log(`  · ${t.raceId}  comp ${t.competitionId}  [${src}]  ${t.gender}  startlist=${t.sl > 0 ? 'sí' : (t.source === 'uci' ? 'NO→seed' : 'NO')}`
        + (t.pollIntervalMinutes ? `  observación=${t.pollIntervalMinutes}min` : ''));
    }
    process.stdout.write(JSON.stringify({ processed: 0, ok: 0, errored: 0, changed: false, dryRun: true, count: targets.length }) + '\n');
    return;
  }

  let ok = 0, errored = 0, empty = 0, wrote = 0, unchanged = 0, revolcado = 0, deleted = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'uci-cron-'));

  // Ejecuta UN fetcher (`kind`) + su upsert para la carrera `t`. Devuelve el desenlace
  // ('ok'|'empty'|'error'|'unchanged'|'revolcado') y si escribió en BD (para el throttle).
  // NO hace `continue` ni toca los contadores: el bucle agrega. Clave para el híbrido
  // UCI+Domtel: si una fuente sale vacía (∅), la SIGUIENTE debe correr igual — por eso
  // el ∅-guard aquí solo salta ESTA fuente, no la carrera entera. Cada fuente vuelca en
  // su propia subcarpeta para no pisar el <comp>.json de la otra.
  async function processSource(t, kind) {
    const outDir = join(tmp, String(t.competitionId), kind);
    // La sincronización automática trabaja UNA jornada. Solo la final pendiente
    // hace una lectura completa: varios proveedores la derivan de la última
    // etapa y no la emiten bajo --stage. Es un caso único por vuelta.
    const targetStage = ONE_STAGE != null ? ONE_STAGE : t.scheduledStage;
    // --configured y el enlazador live conocen la jornada exacta seleccionada. Los
    // disparos manuales sin --sector-index mantienen su contrato histórico.
    const targetSectorIndex = ONE_SECTOR_INDEX != null
      ? ONE_SECTOR_INDEX
      : (ONE_RACE || t.scheduledSectorIndex == null ? null : Number(t.scheduledSectorIndex));
    // La UCI/DataRide y algunos proveedores emiten una clasificación final
    // adicional fuera de la etapa; por eso su última etapa se lee completa. ASO
    // funciona distinto: cada página /stage-N contiene SOLO una etapa y no tiene
    // una pseudo-etapa final separada. Si se omite --stage en ASO, su URL base
    // /rankings se interpreta como etapa 1 aunque la última etapa ya esté publicada.
    const isFinalStage = isFinalStageDump(
      targetStage,
      t.totalStages,
      t.needsFinal,
      t.scheduledIsLastRaceDay,
    );
    const fetchStageArgs = kind === 'ASO' && targetStage != null
      ? ['--stage', String(targetStage)]
      : targetStage != null && !isFinalStage
        ? ['--stage', String(targetStage)]
        : [];
    // CN (source='uci' con uciRaceId != 0, migración 110): volcar SOLO esa prueba del país.
    const uciRaceId = kind === 'uci' && t.source === 'uci' && t.uciRaceId ? t.uciRaceId : 0;
    let fc, srcLabel;
    if (kind === 'tissot') {
      // 'tissot' (089): comp_id {código}{año} (el año DEBE ser estable: su hash genera
      // los eventId sintéticos negativos). El JSON lleva el competitionId del puente.
      // MultiEvents (Mundial): tissotEventNumber selecciona la prueba dentro del comp_id
      // y entra en la semilla de los IDs sintéticos; sin él, la rama de etapas no cambia.
      const tissotComp = `${t.tissotCode}${t.year}`;
      const tissotEventArgs = t.tissotEventNumber != null
        ? ['--tissot-event', String(t.tissotEventNumber)] : [];
      srcLabel = ` ← tissot:${tissotComp}${t.tissotEventNumber != null ? `#${t.tissotEventNumber}` : ''}`;
      fc = await run(TISSOT_FETCH, ['--competition', tissotComp, '--competition-id', String(t.competitionId), '--out', outDir, '--delay', DELAY, ...tissotEventArgs, ...fetchStageArgs]);
    } else if (kind === 'matsport') {
      // 'matsport' (101): comp id {year}_{code} ("2026_PYF"); competitionId sintético negativo.
      const matsportComp = `${t.year}_${t.matsportCode}`;
      srcLabel = ` ← matsport:${matsportComp}`;
      fc = await run(MATSPORT_FETCH, ['--competition', matsportComp, '--competition-id', String(t.competitionId), '--out', outDir, '--delay', DELAY, ...fetchStageArgs]);
    } else if (kind === 'raceresult') {
      // 'raceresult' (108): API JSON de my.raceresult.com; raceresultCode = eventId numérico.
      srcLabel = ` ← raceresult:${t.raceresultCode}`;
      // La lista LIVE de race|result no filtra por etapa → solo activamos su fallback en
      // vivo apuntando a la etapa de HOY con --stage (si la hay). Sin etapa hoy, se queda
      // con las listas "results" oficiales (con selector, seguras).
      fc = await run(RACERESULT_FETCH, raceresultFetchArgs({
        event: t.raceresultCode,
        competitionId: t.competitionId,
        outDir,
        delay: DELAY,
        gender: t.gender,
        raceFormat: t.raceFormat,
        date: t.scheduledDate,
        targetStage,
      }));
    } else if (kind === 'sts') {
      // 'sts' (109): STS/Wiclax; .clax XML público en /LIVE/<stsCode>.clax.
      // TIMERSPEED y otros cronometradores usan el MISMO motor Wiclax con OTRO host
      // (p. ej. https://timerspeed.com/live/events/2026/6_vpf_2026.clax). Si el stsCode
      // ya es una URL absoluta (http/https), se usa TAL CUAL; si no, se aplica el prefijo
      // STS clásico. El fetcher (fetch directo del .clax) es agnóstico del host.
      const stsClaxUrl = /^https?:\/\//i.test(t.stsCode) ? t.stsCode : `https://www.stsport.fr/LIVE/${t.stsCode}.clax`;
      srcLabel = ` ← sts:${t.stsCode}`;
      // Wiclax numera las etapas 1-based por orden de aparición. Si NUESTRAS race_days
      // empiezan en 0 (prólogo), hay que restar 1 al nº emitido para que case con
      // race_days.stageNumber (el upsert resuelve raceDayId por ahí). --stage-offset =
      // minStage - 1 (prólogo 0 → -1; carrera normal que empieza en 1 → 0).
      const stsOffset = t.minStage != null ? Number(t.minStage) - 1 : 0;
      fc = await run(STS_FETCH, ['--clax-url', stsClaxUrl, '--code', String(t.stsCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.stsArticleUrl ? ['--article-url', String(t.stsArticleUrl)] : []),
        ...(t.stsSkipClaxPoints ? ['--skip-clax-points'] : []),
        ...(stsOffset !== 0 ? ['--stage-offset', String(stsOffset)] : []), ...fetchStageArgs]);
    } else if (kind === 'domtel') {
      // 'domtel' (118): Domtel Sport Timing (domtel-sport.pl), cronometrador polaco.
      // domtelCode = id de post WordPress; POST a wp-admin/admin-ajax.php. Un pid acumula
      // TODAS las etapas + GENERAL. eventId sintéticos NEGATIVOS. Como cronometrador, en el
      // híbrido UCI-preferente es RELLENO: donde DataRide ya publicó (positivo), el guard
      // del upsert omite la gemela Domtel; donde no, Domtel tapa el hueco.
      srcLabel = ` ← domtel:${t.domtelCode}`;
      fc = await run(DOMTEL_FETCH, ['--pid', String(t.domtelCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []), ...fetchStageArgs]);
    } else if (kind === 'livetiming') {
      // 'livetiming' (119): livetiming.at, cronometrador austriaco (Tour of Austria).
      // livetimingCode = V_ID de la ETAPA 1 (AAMMDD); el fetcher deriva los V_ID de las
      // etapas siguientes sumando días. --total-stages = max(stageNumber) de race_days
      // (cuántos días recorrer). eventId sintéticos NEGATIVOS. Publica en vivo → parcial,
      // se corrige en la 1ª hora (skip-existing-after-min como tissot/matsport).
      // Las GENERALES solo se emiten cuando están CONFIRMADAS (todas las filas en verde,
      // markTime='bggrn'); mientras la etapa está en curso el fetcher las omite (evita
      // volcar una general provisional). La clasificación de etapa se emite siempre.
      // Sin --allow-provisional-generals → filtro activo por defecto.
      srcLabel = ` ← livetiming:${t.livetimingCode}`;
      fc = await run(LIVETIMING_FETCH, ['--vid', String(t.livetimingCode), '--competition-id', String(t.competitionId), '--out', outDir, '--delay', DELAY,
        ...(t.stageDates ? ['--stage-dates', JSON.stringify(t.stageDates)] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []), ...fetchStageArgs]);
    } else if (kind === 'classificacoes') {
      // Classificações.net: el slug de la prueba descubre los ids variables de
      // etapa y clasificación; no persiste ni supone una URL por día.
      srcLabel = ` ← classificacoes:${t.classificacoesCode}`;
      fc = await run(CLASSIFICACOES_FETCH, ['--code', String(t.classificacoesCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(targetStage != null ? ['--stage', String(targetStage)] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : [])]);
    } else if (kind === 'infocity') {
      // InfoCity (Tour de Pologne): el endpoint entrega JavaScript+HTML. El código
      // fija race:test:ced de E1 y el fetcher deriva los ced correlativos.
      const fetchStage = ONE_RACE ? null : (targetStage ?? t.liveStage);
      srcLabel = ` ← infocity:${t.infocityCode}`;
      fc = await run(INFOCITY_FETCH, ['--code', String(t.infocityCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(fetchStage != null ? ['--stage', String(fetchStage)] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : [])]);
    } else if (kind === 'eqtiming') {
      srcLabel = ` ← eqtiming:${t.eqtimingCode}`;
      fc = await run(EQTIMING_FETCH, ['--code', String(t.eqtimingCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(targetStage != null ? ['--stage', String(targetStage)] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : [])]);
    } else if (kind === 'ASO') {
      srcLabel = ` ← ASO:${t.asoUrl}`;
      fc = await run(ASO_FETCH, ['--url', String(t.asoUrl), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.raceFormat === 'one_day' ? ['--one-day'] : []),
        ...(isFinalStage && t.raceFormat !== 'one_day' ? ['--final'] : []),
        ...fetchStageArgs]);
    } else if (kind === 'manual_timing') {
      const manual_timingStage = targetStage ?? t.liveStage ?? t.minStage;
      const manual_timingArgs = manual_timingFetchArgs({
        code: t.manual_timingCode,
        stage: manual_timingStage,
        date: t.scheduledDate,
        competitionId: t.competitionId,
        outDir,
        isFinalStage,
      });
      if (!manual_timingArgs) {
        log(`  ✗ manual_timing sin manual_timingCode o etapa seleccionable`);
        return { status: 'error', didWrite: false };
      }
      srcLabel = ` ← manual_timing:${t.manual_timingCode}`;
      fc = await run(manual_timing_FETCH, manual_timingArgs);
    } else if (kind === 'sportsoft') {
      // HTML completo y público; el fetcher descubre los competitionId en cada pasada.
      srcLabel = ` ← sportsoft:${t.sportsoftCode}`;
      fc = await run(SPORTSOFT_FETCH, ['--code', String(t.sportsoftCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []), ...fetchStageArgs]);
    } else if (kind === 'colombia') {
      srcLabel = ` ← colombia:${t.colombiaCode}`;
      fc = await run(COLOMBIA_FETCH, ['--code', String(t.colombiaCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.raceFormat === 'one_day' ? ['--one-day'] : []),
        ...(t.year != null ? ['--expected-year', String(t.year)] : []),
        ...(t.stageDates ? ['--stage-dates', JSON.stringify(t.stageDates)] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []), ...fetchStageArgs]);
    } else if (kind === 'burgos') {
      // Vuelta a Burgos: URL estable por etapa y PDFs oficiales. En la última
      // lectura no se pasa --stage para incluir la Final Classification.
      srcLabel = ` ← burgos:${t.year}`;
      fc = await run(BURGOS_FETCH, ['--year', String(t.year), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []), ...fetchStageArgs]);
    } else if (kind === 'chronorace') {
      srcLabel = ` ← chronorace:${t.chronoraceCode}`;
      fc = await run(CHRONORACE_FETCH, ['--event-id', String(t.chronoraceCode), '--race-id', String(t.raceId), '--stage', String(targetStage ?? t.minStage ?? 0), '--date', String(t.scheduledDate || t.startDate || ''), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(isFinalStage ? ['--include-final'] : [])]);
    } else if (kind === 'timing.ee') {
      // timing.ee: un event agrupa todas las jornadas y clasificaciones. El JSON
      // público conserva el distance_id necesario para enlazar el PDF oficial.
      srcLabel = ` ← timing.ee:${t.timingCode}`;
      fc = await run(TIMING_FETCH, ['--code', String(t.timingCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []), ...fetchStageArgs]);
    } else if (kind === 'belgiancycling') {
      // Belgian Cycling sustituye un PDF marcador por el resultado definitivo en
      // la misma URL. El fetcher evita caché, rechaza el marcador y emite una sola
      // clasificación de carrera de un día.
      srcLabel = ` ← belgiancycling:${t.belgianCyclingCode}`;
      fc = await run(BELGIANCYCLING_FETCH, ['--code', String(t.belgianCyclingCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.scheduledDate || t.startDate ? ['--date', String(t.scheduledDate || t.startDate)] : [])]);
    } else if (kind === 'evodata') {
      // EvoData CIS: el eventId padre descubre las jornadas; cada jornada ofrece
      // llegada y generales mediante un token público efímero de aplicación.
      srcLabel = ` ← evodata:${t.evodataCode}`;
      fc = await run(EVODATA_FETCH, ['--code', String(t.evodataCode), '--competition-id', String(t.competitionId), '--out', outDir, '--delay', DELAY,
        ...(t.raceFormat === 'one_day' ? ['--one-day'] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []), ...fetchStageArgs]);
    } else if (kind === 'chronohr') {
      // CH:RO:NO publica progresivamente la portada de la jornada y cada cuadro.
      // La etapa se selecciona por la etiqueta deportiva del índice, no por el
      // nombre de archivo, que cambia entre carreras y dobles sectores.
      srcLabel = ` ← chronohr:${t.chronoHrCode}`;
      fc = await run(CHRONOHR_FETCH, ['--code', String(t.chronoHrCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(targetStage != null ? ['--stage', String(targetStage)] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []),
        ...(isFinalStage ? ['--final'] : [])]);
    } else if (kind === 'maneffic') {
      // Maneffic publica JSON estables por jornada. --expected-date descarta los
      // datos de prueba que pueden existir en esas mismas URLs antes de la carrera.
      srcLabel = ` ← maneffic:${t.manefficCode}`;
      fc = await run(MANEFFIC_FETCH, ['--code', String(t.manefficCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(targetStage != null ? ['--stage', String(targetStage)] : []),
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []),
        ...(t.stageDates ? ['--stage-dates', JSON.stringify(t.stageDates)] : []),
        ...(targetStage != null && t.scheduledDate ? ['--expected-date', String(t.scheduledDate)] : [])]);
    } else if (kind === 'bornan') {
      // El sistema Bornan de unos Juegos publica el cuadro Results (PDF) por
      // unidad cuando la prueba queda OFFICIAL; el índice de informes se vuelve
      // a leer en cada pasada para recoger revisiones.
      srcLabel = ` ← bornan:${t.bornanCode}`;
      fc = await run(BORNAN_FETCH, ['--code', String(t.bornanCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.scheduledDate ? ['--date', String(t.scheduledDate)] : [])]);
    } else if (kind === 'atresults') {
      // AT Results Service publica un dossier PDF por etapa con nombre estable en
      // su servidor; un archivo inexistente equivale a dossier no publicado.
      srcLabel = ` ← atresults:${t.atresultsCode}`;
      fc = await run(ATRESULTS_FETCH, ['--code', String(t.atresultsCode), '--year', String(t.year), '--race-id', String(t.raceId),
        '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []),
        ...(t.stageDates ? ['--stage-dates', JSON.stringify(t.stageDates)] : []),
        ...fetchStageArgs]);
    } else if (kind === 'istanbul' || kind === 'southbohemia') {
      // El organizador publica un dossier PDF por jornada en una página estable.
      // El fetcher redescubre los enlaces en cada pasada y valida año, etapa y
      // fecha antes de interpretar las seis clasificaciones públicas.
      srcLabel = ` ← ${kind}:${t.year}`;
      fc = await run(kind === 'istanbul' ? ISTANBUL_FETCH : SOUTHBOHEMIA_FETCH, ['--year', String(t.year), '--race-id', String(t.raceId), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : []),
        ...(t.stageDates ? ['--stage-dates', JSON.stringify(t.stageDates)] : []),
        ...fetchStageArgs]);
    } else {
      // 'uci' (DataRide): fuente oficial. --uci-race-id para una prueba concreta (CN).
      srcLabel = uciRaceId ? ` ← prueba ${uciRaceId}` : '';
      // Misma condición que fetchStageArgs: la caché solo sirve para atajar el
      // descubrimiento de UNA etapa. En la final leemos la competición entera
      // (--stage ausente), y ahí el fetcher la ignora de todas formas.
      const cachedTopology = kind === 'uci' && targetStage != null && !isFinalStage
        && t.fetchTopology?.source === 'uci' ? ['--topology', JSON.stringify(t.fetchTopology)] : [];
      fc = await run(FETCH, ['--competition', String(t.competitionId), '--out', outDir, '--delay', DELAY,
        ...(uciRaceId ? ['--uci-race-id', String(uciRaceId)] : []), ...fetchStageArgs, ...cachedTopology]);
    }
    log(`\n▶ ${t.raceId} [${kind}] (comp ${t.competitionId}${srcLabel}, ${t.gender}, startlist ${t.sl > 0 ? 'sí' : 'NO'})`);
    if (fc !== 0) { await invalidatePublicationRead(url,t.raceId,kind,targetStage); log(`  ✗ fetch falló (exit ${fc})`); return { status: 'error', didWrite: false }; }

    const jsonPath = join(outDir, `${t.competitionId}.json`);

    // ∅-guard: no se ejecuta el upsert sobre una respuesta sin filas. En backlog,
    // tras consultar todas las fuentes configuradas, esta respuesta también cuenta
    // como verificación de que no hay una clasificación que añadir y puede activar
    // la retirada con backup; en today solo se informa y no se borra nada.
    let totalRows = 0;
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
      for (const st of (parsed.stages || []))
        for (const cl of (st.classifications || [])) totalRows += cl.rowCount || 0;
    } catch { totalRows = -1; }   // JSON ilegible → que el upsert falle visible (errored)
    if (totalRows === 0) {
      await invalidatePublicationRead(url,t.raceId,kind,targetStage);
      log('  ∅ la fuente no devuelve filas');
      return { status: 'empty', didWrite: false, verified: true, hasPublishableResults: false };
    }
    if (parsed) await saveTopology(url, t.raceId, kind, parsed);
    const publishable = hasPublishableResults(parsed, {
      onlyStage: targetStage,
      onlySectorIndex: targetSectorIndex,
      includeFinal: isFinalStage,
    });

    const upArgs = ['--in', jsonPath, '--race-id', t.raceId, '--gender', t.gender, '--apply'];
    // Volcado acotado a UNA etapa: el manual usa --stage con --race-id; el automático
    // configurado trae scheduledStage. En la ÚLTIMA etapa se conserva además la
    // pseudo-etapa Final Classification (stageNumber NULL), porque nace en el mismo
    // fetch. Sin --include-final el filtro de etapa la descartaría silenciosamente.
    //
    // La condición fue `!ONE_RACE && …` hasta 2026-08-07: como ONE_STAGE solo existe
    // junto a ONE_RACE (--stage exige --race-id), ese `!ONE_RACE` hacía --include-final
    // INALCANZABLE en el único camino que llega aquí con targetStage != null. Resultado:
    // "Volcar esta etapa" sobre la última etapa dejaba la general final SIN volcar y sin
    // avisar (cazado en el Tour of Kahramanmaraş 2026: las 4 finales —general, puntos,
    // montaña, jóvenes— nunca llegaron a la web). Es la MISMA etapa y el MISMO fetch:
    // que el disparo sea manual o automático no cambia que la final ya está publicada.
    upArgs.push(...stageFilterArgs(targetStage, targetSectorIndex, isFinalStage));
    // CN: persistir el MISMO uciRaceId en el link (sin esto el upsert lo resetea a 0 y
    // choca con el índice único (competitionId, disciplineId, uciRaceId)).
    if (uciRaceId) upArgs.push('--uci-race-id', String(uciRaceId));
    // Fuentes con código obligatorio en race_uci_links (CHECK NOT NULL): el upsert
    // propone source=<fuente> y Postgres valida el código en la fila propuesta
    // antes del ON CONFLICT. El captador no siempre lo publica en el JSON, así que
    // se lo pasamos desde la fila del enlace. Sin esto el volcado revierte y la
    // clasificación no llega a la web (Tour de Luxemburgo E1, 2026-09-16).
    if (kind === 'tissot' && t.tissotCode) upArgs.push('--tissot-code', String(t.tissotCode));
    if (kind === 'matsport' && t.matsportCode) upArgs.push('--matsport-code', String(t.matsportCode));
    if (kind === 'domtel' && t.domtelCode) upArgs.push('--domtel-code', String(t.domtelCode));
    if (kind === 'livetiming' && t.livetimingCode) upArgs.push('--livetiming-code', String(t.livetimingCode));
    // Solo DataRide aporta el payload de identidad autorizado para sembrar una
    // startlist. Los cronometradores conservan sus nombres como texto transitorio.
    if (shouldSeedStartlist(t.sl, kind, t.resultsOnly)) upArgs.push('--seed-startlist');
    if (shouldResolveBibsByName(kind, t.resultsOnly)) upArgs.push('--resolve-bibs-by-name');
    if (HISTORICAL && t.resultsOnly) {
      upArgs.push('--require-resolved-identities', '--identity-pending-log', identityPendingLog);
    }
    if (SKIP_EXISTING && !refreshesCoveredStage(kind)) {
      upArgs.push('--skip-existing');
      // SportSoft Live consolida bonificaciones tras el orden de meta. Cada
      // re-volcado refresca lastSyncedAt, por lo que el umbral cubre toda la
      // ventana de meta sin reabrir etapas asentadas en pasadas posteriores.
      if (kind === 'sportsoft') upArgs.push('--skip-existing-after-min', '180');
    }
    const up = await run(UPSERT, upArgs);
    // exit 2 = ok pero SIN escritura (--skip-existing omitió todo). No cuenta como cambio.
    if (up === 2) {
      log('  = sin cambios (todo ya volcado)');
      return { status: 'unchanged', didWrite: false, verified: true, hasPublishableResults: publishable };
    }
    // exit 3 = escribió datos pero NINGUNA clasificación era nueva. Se distingue
    // para observabilidad; ningún volcado de resultados regenera el sitio porque
    // las páginas existentes leen las clasificaciones en vivo desde Supabase.
    if (up === 3) {
      log('  ~ re-volcado de datos (sin clasificaciones nuevas)');
      return { status: 'revolcado', didWrite: true, verified: true, hasPublishableResults: publishable };
    }
    if (up !== 0) {
      await invalidatePublicationRead(url,t.raceId,kind,targetStage);
      log(`  ✗ upsert falló (exit ${up})`);
      return { status: 'error', didWrite: false, verified: false, hasPublishableResults: false };
    }
    return { status: 'ok', didWrite: true, verified: true, hasPublishableResults: publishable };
  }

  for (const t of targets) {
    // Fuentes manuales: la query automática ya las excluye; este guard cubre
    // también los disparos dirigidos por --race-id.
    if (MANUAL_RESULT_SOURCES.includes(t.source)) {
      log(`\n▸ ${t.raceId} — source='${t.source}' (volcado manual), se salta`); continue;
    }

    // Fuente PRIMARIA según race_uci_links.source (089+).
    const primaryKind =
      t.source === 'tissot' && t.tissotCode && t.year ? 'tissot'
      : t.source === 'matsport' && t.matsportCode && t.year ? 'matsport'
      : t.source === 'raceresult' && t.raceresultCode ? 'raceresult'
      : t.source === 'sts' && t.stsCode ? 'sts'
      : t.source === 'domtel' && t.domtelCode ? 'domtel'
      : t.source === 'livetiming' && t.livetimingCode ? 'livetiming'
      : t.source === 'classificacoes' && t.classificacoesCode ? 'classificacoes'
      : t.source === 'infocity' && t.infocityCode ? 'infocity'
      : t.source === 'eqtiming' && t.eqtimingCode ? 'eqtiming'
      : t.source === 'ASO' && t.asoUrl ? 'ASO'
      : t.source === 'manual_timing' && t.manual_timingCode ? 'manual_timing'
      : t.source === 'sportsoft' && t.sportsoftCode ? 'sportsoft'
      : t.source === 'colombia' && t.colombiaCode ? 'colombia'
      : t.source === 'burgos' ? 'burgos'
      : t.source === 'chronorace' && t.chronoraceCode ? 'chronorace'
      : t.source === 'timing.ee' && t.timingCode ? 'timing.ee'
      : t.source === 'belgiancycling' && t.belgianCyclingCode ? 'belgiancycling'
      : t.source === 'evodata' && t.evodataCode ? 'evodata'
      : t.source === 'chronohr' && t.chronoHrCode ? 'chronohr'
      : t.source === 'maneffic' && t.manefficCode ? 'maneffic'
      : t.source === 'istanbul' ? 'istanbul'
      : t.source === 'southbohemia' ? 'southbohemia'
      : t.source === 'bornan' && t.bornanCode ? 'bornan'
      : t.source === 'atresults' && t.atresultsCode ? 'atresults'
      : 'uci';
    const kinds = [primaryKind];
    // HÍBRIDO UCI-preferente: source='uci' (oficial, completo) + domtelCode poblado
    // (cronometrador de RELLENO). Corremos UCI PRIMERO (deja sus clasificaciones
    // positivas y su purga borra gemelas sintéticas viejas) y Domtel DESPUÉS (rellena
    // las etapas que DataRide aún no publica; el guard del upsert le impide re-crear lo
    // que UCI ya cubre). Así "cuando entra DataRide, reemplaza a Domtel" de forma
    // automática y permanente. Convención sin migración: no forbidde el CHECK del
    // domtelCode (source<>'domtel' OR domtelCode NOT NULL se cumple por el OR).
    if (primaryKind === 'uci' && t.domtelCode) kinds.push('domtel');
    // Mismo contrato híbrido para EvoData: los eventId negativos solo rellenan
    // claves lógicas que DataRide todavía no haya publicado.
    if (primaryKind === 'uci' && t.evodataCode) kinds.push('evodata');

    const sourceResults = [];
    for (const kind of kinds) {
      const r = await processSource(t, kind);
      sourceResults.push(r);
      switch (r.status) {
        case 'error': errored++; break;
        case 'empty': empty++; break;
        case 'unchanged': ok++; unchanged++; break;
        case 'revolcado': ok++; revolcado++; break;
        case 'ok': ok++; wrote++; break;
      }
      // Throttle SOLO tras escritura real: deja que Postgres asiente el checkpoint antes
      // de la siguiente fuente/carrera, para no saturar la I/O y tumbar la web.
      if (r.didWrite && THROTTLE_MS > 0) { log(`  ⏸ throttle ${THROTTLE_MS}ms`); await sleep(THROTTLE_MS); }
    }
    // El backlog solo entra aquí después de que todas las fuentes configuradas
    // hayan respondido correctamente. Si ninguna ofrece una clasificación
    // principal publicable, la carrera está mal enlazada o no tiene resultado
    // útil: se conserva un backup y se retiran carrera, jornadas y enlace para
    // que no vuelva a ocupar la cola. Un fallo de fuente no autoriza el borrado.
    if (SCOPE === 'backlog'
      && sourceResults.length > 0
      && sourceResults.every((r) => r.verified)
      && !sourceResults.some((r) => r.hasPublishableResults)) {
      const deletion = await deleteInvalidResultsRace(
        url,
        t.raceId,
        `backlog automático: ninguna fuente devolvió una clasificación principal publicable (competition ${t.competitionId})`,
      );
      if (deletion?.deleted) {
        deleted++;
        log(`  🗑 carrera sin resultados válidos eliminada: ${t.raceId} (${deletion.raceDaysDeleted} jornadas)`);
      } else if (deletion?.preserved) {
        log(`  = carrera conservada: ya contiene una clasificación principal válida (${t.raceId})`);
      }
    }
  }

  log(`\n✅ Resumen: ${ok} ok (${wrote} con clasif. nueva, ${revolcado} re-volcado sin novedad, ${unchanged} sin cambios), ${errored} con error, ${empty} sin publicar, ${deleted} carreras retiradas, de ${targets.length}.`);
  // changed conserva el indicador de clasificaciones nuevas para observabilidad.
  // Los workflows consumidores no lo usan para regenerar el sitio.
  process.stdout.write(JSON.stringify({ processed: targets.length, ok, wrote, revolcado, unchanged, errored, empty, deleted, changed: wrote > 0, count: targets.length }) + '\n');
  if (errored > 0 && ok === 0) process.exit(1);   // todo falló → marcar el job en rojo
  if (REQUIRE_RESULT && ok === 0) {
    log('FATAL: la ejecución dirigida no procesó correctamente ninguna clasificación');
    process.exit(1);
  }
}

// Solo ejecuta al invocarlo directamente (no al importarlo desde los tests), mismo
// patrón que dataride-results-fetch.mjs.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
