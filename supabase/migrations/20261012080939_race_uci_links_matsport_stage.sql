-- Competiciones multiprueba de Matsport (Chrono des Nations): un mismo id
-- ({año}_{código}) agrupa varias pruebas independientes de un día como «etapas»
-- (una por categoría). `matsportStage` identifica la etapa de Matsport que es la
-- carrera enlazada: el fetcher la procesa como prueba de un día y la incluye en
-- la semilla de los eventId/raceId sintéticos (comp#etapa), de modo que cada
-- carrera tenga su propio competitionId negativo. NULL = comportamiento actual
-- (carrera por etapas o de una sola etapa).
--
-- Columna aditiva sobre una tabla con GRANT a nivel de tabla: cc_results_worker
-- y cc_agent ya cubren la columna nueva; no se conceden privilegios extra ni se
-- crean objetos nuevos.

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "matsportStage" smallint;

COMMENT ON COLUMN public.race_uci_links."matsportStage" IS
  'Nº de etapa de Matsport que es esta carrera dentro de una competición multiprueba (Chrono des Nations). NULL en carreras por etapas o de una sola etapa.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_race_uci_links_matsport_stage'
  ) THEN
    ALTER TABLE public.race_uci_links
      ADD CONSTRAINT chk_race_uci_links_matsport_stage
      CHECK ("matsportStage" IS NULL OR "matsportStage" > 0);
  END IF;
END $$;
