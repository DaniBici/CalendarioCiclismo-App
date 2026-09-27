-- Tissot MultiEvents (Mundial de carretera): un comp_id agrupa varias pruebas de
-- un día. `tissotEventNumber` identifica la prueba dentro del comp_id y entra en
-- la semilla de los eventId/raceId sintéticos (comp#evento), para que cada carrera
-- del campeonato tenga su propio competitionId negativo y no colisione con las
-- demás. NULL = comportamiento de etapas (Tour, Vuelta, …), que no cambia.
--
-- Columna aditiva sobre una tabla con GRANT a nivel de tabla: cc_results_worker
-- (SELECT/INSERT/UPDATE/DELETE) ya cubre la columna nueva; no se conceden
-- privilegios extra ni se crean objetos nuevos.

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "tissotEventNumber" smallint;

COMMENT ON COLUMN public.race_uci_links."tissotEventNumber" IS
  'Nº de evento dentro de un comp_id MultiEvents de Tissot (Mundial). NULL en carreras por etapas.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_race_uci_links_tissot_event_number'
  ) THEN
    ALTER TABLE public.race_uci_links
      ADD CONSTRAINT chk_race_uci_links_tissot_event_number
      CHECK ("tissotEventNumber" IS NULL OR "tissotEventNumber" > 0);
  END IF;
END $$;
