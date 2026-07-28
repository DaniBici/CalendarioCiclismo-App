#!/usr/bin/env node
/**
 * uci-results-cron.mjs — Fase 6 (PLAN-resultados-web.md §5/§7): refresco de
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
 *        · backlog → el resto: pending con >=1 etapa pasada (dateKey < hoy) PERO sin
 *                    etapa hoy (terminadas o en curso entre jornadas). Troceado con
 *                    --limit. Cadencia lenta (cada 2 h): no urge, no cambia rápido.
 *        · all     → today ∪ backlog (default). Uso bajo demanda / backfill one-shot.
 *      Ordena: etapa-hoy → pending por endDate desc.
 *   2. Por carrera: fetcher según race_uci_links.source (migración 089) —
 *      'uci' → uci-results-fetch (DataRide) · 'tissot' → tissot-results-fetch
 *      (Tissot Timing, carreras que cronometra: publica antes que la UCI) ·
 *      'matsport' (101) → matsport-results-fetch · 'raceresult' (108) →
 *      raceresult-results-fetch (my.raceresult.com; API JSON pública, key+server
 *      resueltos del /config) · 'sts' (109) → sts-results-fetch (STS/Wiclax,
 *      stsport.fr; .clax XML público en /LIVE/<stsCode>.clax) · 'domtel' (118) →
 *      domtel-results-fetch (Domtel Sport Timing, domtel-sport.pl; JSON público
 *      wp-admin/admin-ajax.php, pid = domtelCode) · 'livetiming' (119) →
 *      livetiming-results-fetch (livetiming.at, cronometrador austriaco/Tour of
 *      Austria; JSON público live_links.php + live_data_all.php, un V_ID por etapa,
 *      livetimingCode = V_ID etapa 1 y se derivan los demás por fecha) · 'pdf' (090) /
 *      'sportstiming' (103) / 'manual_timing' (104) → SE SALTAN (volcado manual/local;
 *      sin fetcher automático) —
 *      HÍBRIDO UCI-preferente: source='uci' + domtelCode poblado → se corren AMBOS
 *      fetchers (UCI primero, Domtel de relleno después). DataRide (oficial y completo:
 *      etapa+gc+puntos+montaña+jóvenes+equipos) REEMPLAZA a Domtel (provisional, solo
 *      etapa+general) donde ya publicó (su purga borra la gemela sintética; el guard del
 *      upsert impide re-duplicarla); Domtel tapa las etapas que DataRide aún no da. El
 *      competitionId del link = el REAL de DataRide (positivo). —
 *      → uci-results-upsert --apply (subproceso, con --gender y, si la carrera
 *      NO tiene startlist curada, --seed-startlist). El upsert ya enlaza riders
 *      (082/083) y siembra la startlist (084) en su transacción. Ambos fetchers
 *      emiten el MISMO JSON → el upsert no distingue fuentes. syncStatus pasa
 *      a 'ok' | 'error'. ∅-guard: si el fetch no trae NINGUNA fila (comp
 *      enlazada pero la UCI aún sin publicar), NO se upserta → el link queda
 *      'pending' y los pases siguientes del backlog lo reintentan.
 *      NO RE-VOLCAR LO ASENTADO: en el volcado automático del día (scope=today sin
 *      --race-id ni --ignore-window) el upsert recibe --skip-existing → omite las
 *      clasificaciones ya volcadas (mismo eventId, rowCount>0). La UCI publica
 *      completo y definitivo, así que en la etapa 15 las 14 anteriores cuestan 1
 *      SELECT en vez de re-procesarse cada 30 min (las correcciones se hacen a
 *      mano desde el panel). Las fuentes EN VIVO (tissot/matsport/raceresult/sts/
 *      domtel) llegan parciales y se corrigen durante la ventana de meta → para ellas
 *      se añade --skip-existing-after-min (TISSOT_REVOLCADO_MIN = 180 ≈ la ventana
 *      entera; omite solo lo volcado hace >180 min, así un cambio tardío —un finisher
 *      provisional que pasa a DNF, una descalificación— se re-vuelca mientras la
 *      carrera siga en ventana). El fetcher sí baja la competición entera (red barata);
 *      el ahorro está en evitar el DELETE+INSERT de miles de filas + las RPC.
 *   3. Reporta cuántas se tocaron y si hubo cambios (para que el workflow decida
 *      si regenerar páginas).
 *
 * Dos workflows lo invocan con cadencias distintas (.github/workflows/):
 *   · uci-results-today.yml   cada 30 min, solo en ventana de meta (el gate previo
 *                             vive en pg_cron, migración 087) → --scope today
 *   · uci-results-backlog.yml cada 2 h     → --scope backlog (retrasadas)
 *
 * NO descubre carreras nuevas (el alta es curada). Solo procesa lo ya enlazado.
 *
 * Uso:
 *   node scripts/results-fetchers/uci-results-cron.mjs --scope today
 *   node scripts/results-fetchers/uci-results-cron.mjs --scope backlog --limit 25
 *   node scripts/results-fetchers/uci-results-cron.mjs --dry-run            # all
 *   node scripts/results-fetchers/uci-results-cron.mjs --race-id <id>       # una concreta
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
 *   --stage N      (solo con --race-id) re-escribir SOLO la etapa stageNumber==N; el
 *                  resto de etapas del JSON se descartan (se pasa --only-stage al upsert).
 *                  El "Volcar esta etapa" del panel: la etapa 16 no re-vuelca la 1-15.
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
// --stage N: SOLO con --race-id. Restringe el volcado a la etapa stageNumber==N (se
// pasa como --only-stage al upsert). El fetcher siempre trae la carrera entera, pero
// solo re-escribimos esa etapa → el "Volcar esta etapa" del panel no re-vuelca las
// anteriores (la etapa 16 del Tour ya no arrastra la 1-15). Sin --race-id se ignora.
const ONE_STAGE = (ONE_RACE && getArg('stage') != null) ? parseInt(getArg('stage'), 10) : null;
const DRY = hasFlag('dry-run');
const IGNORE_WINDOW = hasFlag('ignore-window');
// Selección por las ventanas configuradas en el panel. El pg_cron solo despierta
// este runner si existe al menos una candidata; las carreras enlazadas sin regla
// activa no entran nunca.
const CONFIGURED = hasFlag('configured');
// No re-volcar clasificaciones ya presentes (ver uci-results-upsert --skip-existing).
// Activo por defecto en el volcado AUTOMÁTICO del día (scope=today, sin --race-id ni
// --ignore-window): la UCI publica completo y definitivo, así que re-volcar las etapas
// ya volcadas cada 30 min es trabajo en balde. Tissot llega parcial y se corrige en la
// 1ª hora → para esa fuente se omite solo lo volcado hace >60 min (per-carrera abajo).
// Se desactiva con --no-skip-existing (forzar re-volcado completo sin --race-id) y NO
// aplica a --ignore-window ni --race-id (forzados manuales: re-vuelcan todo a propósito).
// EXCEPCIÓN: --skip-existing explícito lo fuerza ON aunque sea --ignore-window — lo usa
// la pasada de tarde para volcar lo recién enlazado del día (HAS_TODAY) sin re-volcar a lo
// bestia lo ya asentado. --race-id sigue re-volcando completo (forzado manual de UNA carrera).
const SKIP_EXISTING = (hasFlag('skip-existing') && !ONE_RACE)
  || (SCOPE === 'today' && !ONE_RACE && !IGNORE_WINDOW && !hasFlag('no-skip-existing'));
// Ventana de re-volcado de las fuentes EN VIVO (tissot/matsport/raceresult/sts) tras
// meta. Debe cubrir toda la ventana de meta del cron (meta+15min → meta+3h): una
// clasificación volcada EN VIVO puede cambiar hasta bastante después del primer
// volcado (un finisher provisional que pasa a DNF, una descalificación, un reordenado).
// Con 60 min una clasificación volcada pronto quedaba CONGELADA el resto de la ventana
// y el cambio tardío se perdía (cazado en la Volta a Portugal Feminina 2026 E2: un DNF
// que Wiclax marcó >1 h tras el primer volcado se quedó como finisher sin tiempo →
// rompía el cálculo de diferencias en la web). 180 min ≈ la ventana entera → el cron
// re-vuelca cada clasificación en cada pasada mientras la carrera siga en ventana.
const TISSOT_REVOLCADO_MIN = 180;
// Throttle: pausa (ms) tras CADA carrera que escribió algo, para no encadenar los
// checkpoints de Postgres (escrituras grandes → WAL → checkpoint largo → I/O saturada
// → la web se arrastra y le caducan las queries). Solo pausa tras escritura real: las
// carreras saltadas (vacías / sin cambios) no estresan el disco. 0 = sin pausa.
// Una sola carrera (--race-id) tampoco pausa (no hay "siguiente" que proteger).
const THROTTLE_MS = ONE_RACE ? 0 : parseInt(getArg('throttle', '4000'), 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const HERE = new URL('.', import.meta.url).pathname;
const FETCH = join(HERE, 'uci-results-fetch.mjs');
const TISSOT_FETCH = join(HERE, 'tissot-results-fetch.mjs');
const MATSPORT_FETCH = join(HERE, 'matsport-results-fetch.mjs');
const RACERESULT_FETCH = join(HERE, 'raceresult-results-fetch.mjs');
const STS_FETCH = join(HERE, 'sts-results-fetch.mjs');
const DOMTEL_FETCH = join(HERE, 'domtel-results-fetch.mjs');
const LIVETIMING_FETCH = join(HERE, 'livetiming-results-fetch.mjs');
const UPSERT = join(HERE, 'uci-results-upsert.mjs');

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
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

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

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
        `SELECT l."raceId", l."competitionId", l."uciRaceId", l."source", l."tissotCode", l."matsportCode", l."raceresultCode", l."stsCode", l."domtelCode", l."livetimingCode", r.gender, r.year,
                (SELECT count(*) FROM startlist_teams t WHERE t."raceId" = r.id) AS sl,
                ${LIVE_STAGE_SUBSELECT} AS "liveStage",
                (SELECT max(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id) AS "totalStages",
                (SELECT min(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id AND d."isRestDay" = false) AS "minStage"
         FROM race_uci_links l JOIN races r ON r.id = l."raceId"
         WHERE l."raceId" = $1`, [ONE_RACE]);
      targets = rows;
    } else if (CONFIGURED) {
      const { rows } = await client.query(
        `SELECT DISTINCT ON (l."raceId")
                l."raceId", l."competitionId", l."uciRaceId", l."source", l."tissotCode", l."matsportCode", l."raceresultCode", l."stsCode", l."domtelCode", l."livetimingCode", r.gender, r.year,
                d.id AS "scheduleRaceDayId", d."stageNumber" AS "scheduledStage",
                (SELECT count(*) FROM startlist_teams t WHERE t."raceId" = r.id) AS sl,
                d."stageNumber" AS "liveStage",
                (SELECT max(x."stageNumber") FROM race_days x WHERE x."raceId" = r.id) AS "totalStages",
                (SELECT min(x."stageNumber") FROM race_days x WHERE x."raceId" = r.id AND x."isRestDay" = false) AS "minStage"
         FROM race_uci_links l
         JOIN races r ON r.id = l."raceId"
         JOIN race_days d ON d."raceId" = l."raceId"
         WHERE d."estimatedFinishTimeUtc" IS NOT NULL
           AND COALESCE(d."resultsAutoSyncEnabled", l."autoSyncEnabled")
           AND l."source" NOT IN ('pdf', 'sportstiming', 'manual_timing')
           AND now() >= d."estimatedFinishTimeUtc"
             + COALESCE(d."resultsSyncStartOffsetMinutes", l."syncStartOffsetMinutes") * interval '1 minute'
           AND now() <= d."estimatedFinishTimeUtc"
             + COALESCE(d."resultsSyncStopOffsetMinutes", l."syncStopOffsetMinutes") * interval '1 minute'
           AND (d."resultsLastAutoSyncAt" IS NULL OR d."resultsLastAutoSyncAt" <= now()
             - COALESCE(d."resultsSyncIntervalMinutes", l."syncIntervalMinutes") * interval '1 minute')
         ORDER BY l."raceId", d."estimatedFinishTimeUtc" DESC
         LIMIT $1`, [LIMIT]);
      targets = rows;
      // Registrar el intento ANTES del fetch evita que el tick de cada minuto
      // encole el mismo trabajo mientras el runner sigue arrancando.
      if (targets.length) {
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
      //     Excluye lo del día (lo lleva 'today') y las ok terminadas ya volcadas.
      //     EXCEPCIÓN: las carreras híbridas UCI-preferentes sin cubrir por DataRide
      //     entran aquí AUNQUE estén 'ok' (Domtel las dejó 'ok') — ver HYBRID_UNCOVERED.
      const HAS_TODAY = `EXISTS (SELECT 1 FROM race_days d
                  WHERE d."raceId" = r.id AND d."dateKey" = to_char(now(), 'YYYY-MM-DD'))`;
      const HAS_PAST = `EXISTS (SELECT 1 FROM race_days d
                  WHERE d."raceId" = r.id AND d."dateKey" < to_char(now(), 'YYYY-MM-DD'))`;
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
      // HÍBRIDO UCI-preferente sin cubrir: carrera con source='uci' + domtelCode (corre
      // ambos fetchers) en la que AÚN quedan clasificaciones sintéticas de Domtel
      // (eventId < 0) sin reemplazar por el oficial de DataRide. La etapa la volcó Domtel
      // rápido (link 'ok'), pero DataRide publica horas/días después y su ventana de meta
      // ya cerró (3 h) → sin esto NADA la vuelve a mirar (el backlog solo cogía 'pending').
      // Se mantiene en el backlog (pasada de tarde diaria) hasta que DataRide reemplace
      // todas las gemelas Domtel: al hacerlo, esas filas pasan a eventId > 0 y el predicado
      // deja de casar (se AUTO-TERMINA). Solo carreras recientes (endDate en los últimos
      // 20 días) para no re-consultar indefinidamente una que DataRide nunca publicará.
      const HYBRID_UNCOVERED = `l."source" = 'uci' AND l."domtelCode" IS NOT NULL
                  AND r."endDate" >= to_char(now() - interval '20 days', 'YYYY-MM-DD')
                  AND EXISTS (SELECT 1 FROM race_uci_stages s
                              WHERE s."raceId" = r.id AND s."eventId" < 0
                                AND COALESCE(s."rowCount",0) > 0)`;
      const backlogPred = `(${HAS_PAST}) AND NOT (${HAS_TODAY})
                  AND ((l."syncStatus" = 'pending') OR (${HYBRID_UNCOVERED}))`;
      const where = SCOPE === 'today' ? todayPred
                  : SCOPE === 'backlog' ? backlogPred
                  : `(${todayPred}) OR (${backlogPred})`;   // all

      const { rows } = await client.query(
        `SELECT l."raceId", l."competitionId", l."uciRaceId", l."source", l."tissotCode", l."matsportCode", l."raceresultCode", l."stsCode", l."domtelCode", l."livetimingCode", r.gender, r.year,
                (SELECT count(*) FROM startlist_teams t WHERE t."raceId" = r.id) AS sl,
                ${LIVE_STAGE_SUBSELECT} AS "liveStage",
                (SELECT max(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id) AS "totalStages",
                (SELECT min(d."stageNumber") FROM race_days d WHERE d."raceId" = r.id AND d."isRestDay" = false) AS "minStage",
                CASE WHEN ${HAS_TODAY} THEN 0 ELSE 1 END AS sort_live
         FROM race_uci_links l JOIN races r ON r.id = l."raceId"
         WHERE l."source" NOT IN ('pdf', 'sportstiming', 'manual_timing') AND (${where})
         ORDER BY sort_live ASC, r."endDate" DESC
         LIMIT $1`, [LIMIT]);
      targets = rows;
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
        // Híbrido UCI-preferente: source='uci' + domtelCode → UCI + relleno Domtel.
        : t.source === 'uci' && t.domtelCode ? `uci + domtel:${t.domtelCode} (relleno)` : 'uci';
      log(`  · ${t.raceId}  comp ${t.competitionId}  [${src}]  ${t.gender}  startlist=${t.sl > 0 ? 'sí' : 'NO→seed'}`);
    }
    process.stdout.write(JSON.stringify({ processed: 0, ok: 0, errored: 0, changed: false, dryRun: true, count: targets.length }) + '\n');
    return;
  }

  let ok = 0, errored = 0, empty = 0, wrote = 0, unchanged = 0, revolcado = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'uci-cron-'));

  // Ejecuta UN fetcher (`kind`) + su upsert para la carrera `t`. Devuelve el desenlace
  // ('ok'|'empty'|'error'|'unchanged'|'revolcado') y si escribió en BD (para el throttle).
  // NO hace `continue` ni toca los contadores: el bucle agrega. Clave para el híbrido
  // UCI+Domtel: si una fuente sale vacía (∅), la SIGUIENTE debe correr igual — por eso
  // el ∅-guard aquí solo salta ESTA fuente, no la carrera entera. Cada fuente vuelca en
  // su propia subcarpeta para no pisar el <comp>.json de la otra.
  async function processSource(t, kind) {
    const outDir = join(tmp, String(t.competitionId), kind);
    // CN (source='uci' con uciRaceId != 0, migración 110): volcar SOLO esa prueba del país.
    const uciRaceId = kind === 'uci' && t.source === 'uci' && t.uciRaceId ? t.uciRaceId : 0;
    let fc, srcLabel;
    if (kind === 'tissot') {
      // 'tissot' (089): comp_id {código}{año} (el año DEBE ser estable: su hash genera
      // los eventId sintéticos negativos). El JSON lleva el competitionId del puente.
      const tissotComp = `${t.tissotCode}${t.year}`;
      srcLabel = ` ← tissot:${tissotComp}`;
      fc = await run(TISSOT_FETCH, ['--competition', tissotComp, '--competition-id', String(t.competitionId), '--out', outDir, '--delay', DELAY]);
    } else if (kind === 'matsport') {
      // 'matsport' (101): comp id {year}_{code} ("2026_PYF"); competitionId sintético negativo.
      const matsportComp = `${t.year}_${t.matsportCode}`;
      srcLabel = ` ← matsport:${matsportComp}`;
      fc = await run(MATSPORT_FETCH, ['--competition', matsportComp, '--competition-id', String(t.competitionId), '--out', outDir, '--delay', DELAY]);
    } else if (kind === 'raceresult') {
      // 'raceresult' (108): API JSON de my.raceresult.com; raceresultCode = eventId numérico.
      srcLabel = ` ← raceresult:${t.raceresultCode}`;
      fc = await run(RACERESULT_FETCH, ['--event', String(t.raceresultCode), '--competition-id', String(t.competitionId), '--out', outDir, '--delay', DELAY,
        // La lista LIVE de race|result no filtra por etapa → solo activamos su fallback en
        // vivo apuntando a la etapa de HOY con --stage (si la hay). Sin etapa hoy, se queda
        // con las listas "results" oficiales (con selector, seguras).
        ...(t.liveStage != null ? ['--stage', String(t.liveStage)] : [])]);
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
        ...(stsOffset !== 0 ? ['--stage-offset', String(stsOffset)] : [])]);
    } else if (kind === 'domtel') {
      // 'domtel' (118): Domtel Sport Timing (domtel-sport.pl), cronometrador polaco.
      // domtelCode = id de post WordPress; POST a wp-admin/admin-ajax.php. Un pid acumula
      // TODAS las etapas + GENERAL. eventId sintéticos NEGATIVOS. Como cronometrador, en el
      // híbrido UCI-preferente es RELLENO: donde DataRide ya publicó (positivo), el guard
      // del upsert omite la gemela Domtel; donde no, Domtel tapa el hueco.
      srcLabel = ` ← domtel:${t.domtelCode}`;
      fc = await run(DOMTEL_FETCH, ['--pid', String(t.domtelCode), '--competition-id', String(t.competitionId), '--out', outDir,
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : [])]);
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
        ...(t.totalStages != null ? ['--total-stages', String(t.totalStages)] : [])]);
    } else {
      // 'uci' (DataRide): fuente oficial. --uci-race-id para una prueba concreta (CN).
      srcLabel = uciRaceId ? ` ← prueba ${uciRaceId}` : '';
      fc = await run(FETCH, ['--competition', String(t.competitionId), '--out', outDir, '--delay', DELAY,
        ...(uciRaceId ? ['--uci-race-id', String(uciRaceId)] : [])]);
    }
    log(`\n▶ ${t.raceId} [${kind}] (comp ${t.competitionId}${srcLabel}, ${t.gender}, startlist ${t.sl > 0 ? 'sí' : 'NO'})`);
    if (fc !== 0) { log(`  ✗ fetch falló (exit ${fc})`); return { status: 'error', didWrite: false }; }

    const jsonPath = join(outDir, `${t.competitionId}.json`);

    // ∅-guard: si la fuente no publicó aún NINGUNA fila (comp enlazada sin resultados),
    // upsertar marcaría el link 'ok' con 0 clasificaciones y la carrera SALDRÍA del
    // backlog para siempre (backlog = solo 'pending'). Saltar el upsert → queda 'pending'
    // y el siguiente pase la reintenta (barato: el fetch vacío es 1 request).
    let totalRows = 0;
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
      for (const st of (parsed.stages || []))
        for (const cl of (st.classifications || [])) totalRows += cl.rowCount || 0;
    } catch { totalRows = -1; }   // JSON ilegible → que el upsert falle visible (errored)
    if (totalRows === 0) { log('  ∅ la fuente aún no publica filas → se deja pending (sin upsert)'); return { status: 'empty', didWrite: false }; }

    const upArgs = ['--in', jsonPath, '--race-id', t.raceId, '--gender', t.gender, '--apply'];
    // Volcado dirigido a UNA etapa (--stage con --race-id): el upsert descarta el resto
    // de etapas del JSON. Solo aquí; el cron automático (sin --race-id) nunca lo pasa.
    const targetStage = ONE_STAGE != null ? ONE_STAGE : t.scheduledStage;
    if (targetStage != null) upArgs.push('--only-stage', String(targetStage));
    // CN: persistir el MISMO uciRaceId en el link (sin esto el upsert lo resetea a 0 y
    // choca con el índice único (competitionId, disciplineId, uciRaceId)).
    if (uciRaceId) upArgs.push('--uci-race-id', String(uciRaceId));
    if (!(t.sl > 0)) upArgs.push('--seed-startlist');   // sin startlist curada → sembrar desde UCI
    if (SKIP_EXISTING) {
      upArgs.push('--skip-existing');
      // Los cronometradores llegan parciales / con correcciones en la 1ª hora tras meta
      // (publican en vivo) → re-volcar solo lo reciente; lo asentado (>60 min) se omite.
      // UCI (DataRide) es definitivo → se omite cualquier clasificación ya presente.
      if (kind !== 'uci') upArgs.push('--skip-existing-after-min', String(TISSOT_REVOLCADO_MIN));
    }
    const up = await run(UPSERT, upArgs);
    // exit 2 = ok pero SIN escritura (--skip-existing omitió todo). No cuenta como cambio.
    if (up === 2) { log('  = sin cambios (todo ya volcado)'); return { status: 'unchanged', didWrite: false }; }
    // exit 3 = escribió datos pero NINGUNA clasificación era nueva (re-volcado de un
    // cronometrador sobre páginas ya existentes). Hubo escritura (throttle sí), pero NO
    // crea contenido/URL nueva → NO regenera og-pages/sitemap.
    if (up === 3) { log('  ~ re-volcado de datos (sin clasificaciones nuevas) → no regenera SEO'); return { status: 'revolcado', didWrite: true }; }
    if (up !== 0) { log(`  ✗ upsert falló (exit ${up})`); return { status: 'error', didWrite: false }; }
    return { status: 'ok', didWrite: true };
  }

  for (const t of targets) {
    // 'pdf' (090) = volcado manual desde PDF (skill cc-resultados-pdf): sin fetcher
    // automático, competitionId sintético negativo → saltar (la query auto ya los
    // excluye; esto cubre --race-id explícito).
    if (t.source === 'pdf') { log(`\n▸ ${t.raceId} — source='pdf' (volcado manual), se salta`); continue; }
    // 'sportstiming' (103) y 'manual_timing' (104): volcados EN LOCAL (sin fetcher automático).
    if (t.source === 'sportstiming' || t.source === 'manual_timing') {
      log(`\n▸ ${t.raceId} — source='${t.source}' (volcado local), se salta`); continue;
    }

    // Fuente PRIMARIA según race_uci_links.source (089+).
    const primaryKind =
      t.source === 'tissot' && t.tissotCode && t.year ? 'tissot'
      : t.source === 'matsport' && t.matsportCode && t.year ? 'matsport'
      : t.source === 'raceresult' && t.raceresultCode ? 'raceresult'
      : t.source === 'sts' && t.stsCode ? 'sts'
      : t.source === 'domtel' && t.domtelCode ? 'domtel'
      : t.source === 'livetiming' && t.livetimingCode ? 'livetiming'
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

    for (const kind of kinds) {
      const r = await processSource(t, kind);
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
  }

  log(`\n✅ Resumen: ${ok} ok (${wrote} con clasif. nueva, ${revolcado} re-volcado sin novedad, ${unchanged} sin cambios), ${errored} con error, ${empty} sin publicar (quedan pending), de ${targets.length}.`);
  // changed = hubo al menos una CLASIFICACIÓN NUEVA (contenido/URL que SEO debe
  // reflejar) → el workflow regenera og-pages/sitemap. Ni el re-volcado de datos sobre
  // páginas existentes (exit 3 → `revolcado`) ni los skip-existing (exit 2) cuentan:
  // así no se queman los workflows cuando las carreras ya tenían su página.
  process.stdout.write(JSON.stringify({ processed: targets.length, ok, wrote, revolcado, unchanged, errored, empty, changed: wrote > 0, count: targets.length }) + '\n');
  if (errored > 0 && ok === 0) process.exit(1);   // todo falló → marcar el job en rojo
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
