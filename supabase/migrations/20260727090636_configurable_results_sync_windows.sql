-- Volcado de resultados configurable por fuente, carrera y jornada.
--
-- El enlace a una fuente ya no basta para consumir CI: toda sincronización
-- automática queda apagada hasta que se programe expresamente desde el panel.
-- La regla de la carrera se hereda en sus jornadas; cualquier campo no NULL de
-- race_days la sobreescribe para esa etapa.

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "autoSyncEnabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "syncStartOffsetMinutes" integer NOT NULL DEFAULT -15,
  ADD COLUMN IF NOT EXISTS "syncIntervalMinutes" integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "syncStopOffsetMinutes" integer NOT NULL DEFAULT 180,
  ADD CONSTRAINT chk_race_uci_links_sync_offsets
    CHECK ("syncStartOffsetMinutes" BETWEEN -1440 AND 1440
       AND "syncStopOffsetMinutes" BETWEEN -1440 AND 2880
       AND "syncStopOffsetMinutes" >= "syncStartOffsetMinutes"),
  ADD CONSTRAINT chk_race_uci_links_sync_interval
    CHECK ("syncIntervalMinutes" BETWEEN 1 AND 240);

ALTER TABLE public.race_days
  ADD COLUMN IF NOT EXISTS "resultsAutoSyncEnabled" boolean,
  ADD COLUMN IF NOT EXISTS "resultsSyncStartOffsetMinutes" integer,
  ADD COLUMN IF NOT EXISTS "resultsSyncIntervalMinutes" integer,
  ADD COLUMN IF NOT EXISTS "resultsSyncStopOffsetMinutes" integer,
  ADD COLUMN IF NOT EXISTS "resultsLastAutoSyncAt" timestamptz,
  ADD CONSTRAINT chk_race_days_results_sync_offsets
    CHECK (("resultsSyncStartOffsetMinutes" IS NULL OR "resultsSyncStartOffsetMinutes" BETWEEN -1440 AND 1440)
       AND ("resultsSyncStopOffsetMinutes" IS NULL OR "resultsSyncStopOffsetMinutes" BETWEEN -1440 AND 2880)
       AND ("resultsSyncStartOffsetMinutes" IS NULL OR "resultsSyncStopOffsetMinutes" IS NULL
            OR "resultsSyncStopOffsetMinutes" >= "resultsSyncStartOffsetMinutes")),
  ADD CONSTRAINT chk_race_days_results_sync_interval
    CHECK ("resultsSyncIntervalMinutes" IS NULL OR "resultsSyncIntervalMinutes" BETWEEN 1 AND 240);

COMMENT ON COLUMN public.race_uci_links."autoSyncEnabled" IS
  'Activa el volcado automático de la fuente para la carrera. Default false: enlazar una fuente no consume CI.';
COMMENT ON COLUMN public.race_days."resultsAutoSyncEnabled" IS
  'Override por jornada de race_uci_links.autoSyncEnabled; NULL hereda la regla de carrera.';

CREATE OR REPLACE FUNCTION public.trigger_configured_uci_results_workflow()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_token text;
BEGIN
  -- No se despacha ningún runner si ninguna jornada enlazada tiene una regla
  -- activa y está dentro de su ventana relativa a meta.
  IF NOT EXISTS (
    SELECT 1
    FROM public.race_uci_links l
    JOIN public.race_days d ON d."raceId" = l."raceId"
    WHERE d."estimatedFinishTimeUtc" IS NOT NULL
      AND COALESCE(d."resultsAutoSyncEnabled", l."autoSyncEnabled")
      AND now() >= d."estimatedFinishTimeUtc"
          + COALESCE(d."resultsSyncStartOffsetMinutes", l."syncStartOffsetMinutes") * interval '1 minute'
      AND now() <= d."estimatedFinishTimeUtc"
          + COALESCE(d."resultsSyncStopOffsetMinutes", l."syncStopOffsetMinutes") * interval '1 minute'
      AND (d."resultsLastAutoSyncAt" IS NULL OR d."resultsLastAutoSyncAt" <= now()
          - COALESCE(d."resultsSyncIntervalMinutes", l."syncIntervalMinutes") * interval '1 minute')
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token'
  LIMIT 1;
  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE WARNING '[uci-cron] falta github_dispatch_token';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://api.github.com/repos/DaniBici/calendario-ciclismo/actions/workflows/uci-results-today.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'supabase-pg-cron',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('configured', 'true')),
    timeout_milliseconds := 15000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_configured_uci_results_workflow() FROM PUBLIC;

SELECT cron.alter_job(
  jobid,
  schedule => '* * * * *',
  command => 'SELECT public.trigger_configured_uci_results_workflow();'
)
FROM cron.job
WHERE jobname = 'trigger-uci-results-today';
