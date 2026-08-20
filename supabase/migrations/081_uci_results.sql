-- ═══════════════════════════════════════════════════════════════════
--  RESULTADOS UCI (DataRide) — páginas de resultados propias
--
--  Fase 2 del plan (scripts/results-fetchers/PLAN-resultados-web.md).
--  Sustituye los enlaces salientes a PCS/FirstCycling por páginas nativas
--  alimentadas desde la API UCI DataRide. Alcance: solo carreras YA en DB,
--  desde 2026; el alta de carreras es curada (Dani), el sistema solo ENLAZA.
--
--  Principio de diseño: PERSISTENCIA SEGMENTADA — ninguna tabla larga que
--  haya que recorrer. Toda lectura es por clave directa
--  (competición → etapa → clasificación), nunca un scan global. Tres tablas:
--
--   (1) race_uci_links   — el puente: 1 fila por carrera nuestra ↔ competitionId.
--   (2) race_uci_stages  — 1 fila por (etapa × clasificación) disponible.
--   (3) race_uci_results — las filas de clasificación; SIEMPRE se leen por stageRef.
--
--  fcId/pcsSlug ya existen formalmente en `races` (esquema actual) → el §1.4
--  del plan está cubierto; esta migración NO los toca.
--
--  Qué clasificaciones usa la WEB (decidido con Dani 2026-06-09, sobre datos reales):
--    OJO con la nomenclatura UCI. Por CADA etapa la UCI publica, de cada ranking,
--    dos variantes: "Stage X" (el resultado DE esa etapa) y "Overall X" (el ranking
--    ACUMULADO tras esa etapa). Excepción: la general se publica como "Stage General
--    Classification" (no "Overall") pero ES la GC acumulada del día (su ganador = el
--    líder). Cuando la carrera termina, una etapa con isFinalClassification=true trae
--    las "Overall …" DEFINITIVAS.
--    Caso de uso: mostrar la CLASIFICACIÓN DE LA ETAPA y las GENERALES de cada día
--    (no las secundarias de la etapa), más las finales al cerrar. Traducción exacta:
--      · classKind IN (stage, gc)  → SIEMPRE (resultado de etapa + GC del día).
--      · scope = overall           → SIEMPRE (generales acumuladas de puntos/montaña/
--                                    jóvenes/equipos del día; y, en la final, las
--                                    definitivas — mismo scope, entran solas).
--    Lo que queda FUERA: las secundarias DE LA ETAPA — "Stage Points/Mountain/Youth
--    Classification" (scope=stage, classKind ≠ stage/gc). Se INGESTA todo igualmente
--    (sin pérdida); la columna generada `keepForWeb` marca el subconjunto mostrable.
--
--  RLS: lectura pública (USING true) + escritura TO authenticated (panel). El
--  cron/backfill escribe con la service key (bypassa RLS) → mismo patrón que
--  today_highlights (066) y el resto de tablas de catálogo.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. race_uci_links — el puente (1 fila por carrera) ──────────────
CREATE TABLE IF NOT EXISTS public.race_uci_links (
  "raceId"        TEXT PRIMARY KEY REFERENCES public.races(id) ON DELETE CASCADE,
  "competitionId" INTEGER NOT NULL,
  "disciplineId"  INTEGER NOT NULL DEFAULT 10,   -- 10 = carretera
  "seasonId"      INTEGER,                        -- 464 = 2026
  "autoMatched"   BOOLEAN NOT NULL DEFAULT false, -- lo casó el matcher vs un humano
  "lastSyncedAt"  TIMESTAMPTZ,
  "syncStatus"    TEXT NOT NULL DEFAULT 'pending' -- pending|ok|error|partial
    CHECK ("syncStatus" IN ('pending','ok','error','partial')),
  "syncError"     TEXT,                           -- último mensaje de error (diagnóstico)
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un competitionId no debería estar enlazado a dos carreras distintas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_uci_links_competition
  ON public.race_uci_links ("competitionId", "disciplineId");

COMMENT ON TABLE public.race_uci_links IS
  'Puente carrera↔competición UCI DataRide. 1 fila por carrera nuestra. El enlace UCI es '
  'metadato de integración (no de la carrera) → separado de races para poder recablear sin '
  'tocar la carrera. autoMatched=true si lo enlazó el matcher; false si lo confirmó un humano.';

COMMENT ON COLUMN public.race_uci_links."competitionId" IS
  'CompetitionId de DataRide (Dauphiné 2026 = 76394, Giro = 76390).';

-- ─── 2. race_uci_stages — eventos de cada etapa (clasificaciones) ────
-- Cada (etapa × tipo de clasificación) es su propia fila-cabecera. Buscar "la
-- GC de la etapa 5 del Giro" = 1 lookup por (raceId, stageNumber, classKind, scope),
-- sin tocar las filas de resultados.
CREATE TABLE IF NOT EXISTS public.race_uci_stages (
  id              TEXT PRIMARY KEY,               -- ru_{eventId}
  "raceId"        TEXT NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  "raceDayId"     TEXT REFERENCES public.race_days(id) ON DELETE SET NULL, -- enlace a NUESTRA etapa
  "competitionId" INTEGER NOT NULL,
  "uciRaceId"     INTEGER NOT NULL,               -- raceId de DataRide (la "etapa")
  "eventId"       INTEGER NOT NULL UNIQUE,        -- el evento concreto (clasificación)
  "classKind"     TEXT NOT NULL,                  -- stage|gc|points|kom|youth|teams|other
  scope           TEXT NOT NULL DEFAULT 'stage',  -- stage (de esta etapa) | overall (acumulado)
  "eventName"     TEXT,                           -- "Stage General Classification"
  "isTeamEvent"   BOOLEAN NOT NULL DEFAULT false,
  "stageNumber"   INTEGER,                        -- copiado para ordenar sin joins (NULL = final)
  "isFinalClassification" BOOLEAN NOT NULL DEFAULT false, -- pseudo-etapa "Final Classification"
  "stageDate"     TEXT,                           -- YYYY-MM-DD
  "raceType"      TEXT,                           -- IRR (línea) | ITT (crono indiv) | TTT (crono equipos)
  "winnerName"    TEXT,
  "rowCount"      INTEGER NOT NULL DEFAULT 0,
  -- Subconjunto que la web pinta (ver cabecera): la clasificación de etapa (stage) + la GC
  -- del día (gc) + TODAS las generales acumuladas (scope=overall, incl. las finales). Quedan
  -- fuera las secundarias DE la etapa (Stage Points/Mountain/Youth: scope=stage, classKind≠stage,gc).
  "keepForWeb"    BOOLEAN GENERATED ALWAYS AS (
    "classKind" IN ('stage','gc') OR scope = 'overall'
  ) STORED,
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_race_uci_stages_race
  ON public.race_uci_stages ("raceId", "stageNumber", "classKind", scope);
CREATE INDEX IF NOT EXISTS idx_race_uci_stages_raceday
  ON public.race_uci_stages ("raceDayId");
-- Lectura web típica: las clasificaciones "mostrables" de una carrera/etapa.
CREATE INDEX IF NOT EXISTS idx_race_uci_stages_web
  ON public.race_uci_stages ("raceId", "stageNumber")
  WHERE "keepForWeb";

COMMENT ON TABLE public.race_uci_stages IS
  'Cabecera por (etapa × clasificación) de una carrera enlazada. classKind = tipo '
  '(stage/gc/points/kom/youth/teams); scope = stage (clasif. acumulada TRAS la etapa, '
  'pese al nombre "Stage…") u overall (general FINAL de la carrera). keepForWeb marca lo que '
  'la web pinta.';

COMMENT ON COLUMN public.race_uci_stages."keepForWeb" IS
  'Generada: TRUE para classKind stage (clasificación de la etapa) y gc (general del día), y para '
  'TODO scope=overall (generales acumuladas de puntos/montaña/jóvenes/equipos del día + las '
  'definitivas de la final). FALSE para las secundarias DE LA ETAPA (Stage Points/Mountain/Youth).';

-- ─── 3. race_uci_results — filas de clasificación ───────────────────
-- Anti-tabla-larga: toda lectura web filtra por stageRef (índice) → como mucho
-- ~200 filas (una clasificación). El índice (raceId) existe solo para purga/
-- re-sync por carrera. Candidata natural a partición por raceId si creciera.
CREATE TABLE IF NOT EXISTS public.race_uci_results (
  id              BIGSERIAL PRIMARY KEY,
  "stageRef"      TEXT NOT NULL REFERENCES public.race_uci_stages(id) ON DELETE CASCADE,
  "raceId"        TEXT NOT NULL,                  -- desnormalizado: purga/partición por carrera
  "eventId"       INTEGER NOT NULL,
  rank            INTEGER,                        -- NULL si DNF/DNS/OTL
  "rankText"      TEXT,                           -- "1", "DNF", "OTL"…
  bib             TEXT,
  "riderDisplay"  TEXT NOT NULL,                  -- "CHARMIG Anthon" (tal cual UCI)
  "firstName"     TEXT,
  "lastName"      TEXT,
  "globalRiderId" TEXT,                           -- ← matching a riders_men/women (NULL si no casó)
  "teamName"      TEXT,
  "isoCode2"      TEXT,
  "birthDate"     TEXT,                           -- YYYY-MM-DD
  "resultValue"   TEXT,                           -- "5:40:29" o gap "+0:14"
  "timeText"      TEXT,                           -- tiempo absoluto (ganador / cronos)
  "gapText"       TEXT,                           -- diferencia "+0:14"
  points          INTEGER,                        -- PointPcR
  irm             TEXT,                           -- DNF/DNS/OTL/DSQ
  "sortOrder"     INTEGER
);

-- Siempre se lee por stageRef; nunca se escanea entera.
CREATE INDEX IF NOT EXISTS idx_race_uci_results_stage
  ON public.race_uci_results ("stageRef", "sortOrder");
-- Solo para purga/re-sync por carrera.
CREATE INDEX IF NOT EXISTS idx_race_uci_results_race
  ON public.race_uci_results ("raceId");
-- Para revisar/backfill el matching de riders.
CREATE INDEX IF NOT EXISTS idx_race_uci_results_rider
  ON public.race_uci_results ("globalRiderId")
  WHERE "globalRiderId" IS NOT NULL;

COMMENT ON TABLE public.race_uci_results IS
  'Filas de clasificación UCI. SIEMPRE se leen por stageRef (índice) → como mucho ~200 filas. '
  'raceId desnormalizado solo para purga/re-sync por carrera. riderDisplay siempre visible '
  'aunque globalRiderId sea NULL (no se pierde el resultado si no casa el corredor).';

-- ─── 4. Triggers updatedAt (links + stages) ─────────────────────────
CREATE OR REPLACE FUNCTION public.race_uci_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_race_uci_links_updated_at ON public.race_uci_links;
CREATE TRIGGER trg_race_uci_links_updated_at
  BEFORE UPDATE ON public.race_uci_links
  FOR EACH ROW EXECUTE FUNCTION public.race_uci_set_updated_at();

DROP TRIGGER IF EXISTS trg_race_uci_stages_updated_at ON public.race_uci_stages;
CREATE TRIGGER trg_race_uci_stages_updated_at
  BEFORE UPDATE ON public.race_uci_stages
  FOR EACH ROW EXECUTE FUNCTION public.race_uci_set_updated_at();

-- La función trigger no debe ser invocable vía API REST (PostgREST). Postgres da
-- EXECUTE a PUBLIC por defecto a las funciones nuevas → revocarlo (mismo patrón que
-- las migraciones revoke_internal_secdef_funcs_from_public/api_roles de 2026-06-01).
REVOKE EXECUTE ON FUNCTION public.race_uci_set_updated_at() FROM PUBLIC, anon, authenticated;

-- ─── 5. RLS — lectura pública, escritura autenticados ───────────────
-- (El cron/backfill usa la service key, que bypassa RLS.)
ALTER TABLE public.race_uci_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_uci_stages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_uci_results ENABLE ROW LEVEL SECURITY;

-- race_uci_links
DROP POLICY IF EXISTS race_uci_links_select_public ON public.race_uci_links;
CREATE POLICY race_uci_links_select_public
  ON public.race_uci_links FOR SELECT USING (true);
DROP POLICY IF EXISTS race_uci_links_write_authed ON public.race_uci_links;
CREATE POLICY race_uci_links_write_authed
  ON public.race_uci_links FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- race_uci_stages
DROP POLICY IF EXISTS race_uci_stages_select_public ON public.race_uci_stages;
CREATE POLICY race_uci_stages_select_public
  ON public.race_uci_stages FOR SELECT USING (true);
DROP POLICY IF EXISTS race_uci_stages_write_authed ON public.race_uci_stages;
CREATE POLICY race_uci_stages_write_authed
  ON public.race_uci_stages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- race_uci_results
DROP POLICY IF EXISTS race_uci_results_select_public ON public.race_uci_results;
CREATE POLICY race_uci_results_select_public
  ON public.race_uci_results FOR SELECT USING (true);
DROP POLICY IF EXISTS race_uci_results_write_authed ON public.race_uci_results;
CREATE POLICY race_uci_results_write_authed
  ON public.race_uci_results FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
