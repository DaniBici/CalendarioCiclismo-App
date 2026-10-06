-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260813061546, nombre reset_results_auto_sync_to_opt_in). Texto aplicado en producción, sin cambios.

-- Reinicia todas las reglas de captación automática de resultados.
--
-- La programación es opt-in: enlazar una fuente no activa el cron. Las
-- activaciones existentes se eliminan y solo pueden recuperarse mediante una
-- acción expresa en el panel.

ALTER TABLE public.race_uci_links
  ALTER COLUMN "autoSyncEnabled" SET DEFAULT false;

UPDATE public.race_uci_links
SET "autoSyncEnabled" = false
WHERE "autoSyncEnabled" IS DISTINCT FROM false;

-- Un override activo anterior deja de contar como consentimiento. NULL hace
-- que la jornada herede la regla de carrera, que acaba de quedar desactivada;
-- una activación global futura desde el panel volverá a incluirla.
UPDATE public.race_days
SET "resultsAutoSyncEnabled" = NULL,
    "resultsAutoSyncQueuedAt" = NULL
WHERE "resultsAutoSyncEnabled" IS TRUE;

COMMENT ON COLUMN public.race_uci_links."autoSyncEnabled" IS
  'Activa el volcado automático de la fuente para la carrera. Opt-in estricto: default false y activación expresa desde el panel.';
