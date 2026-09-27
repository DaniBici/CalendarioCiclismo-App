-- Un enlace a una fuente de resultados activa siempre su captación. Se retiran
-- los estados de apagado por carrera y por jornada, pero se conservan las columnas
-- durante el despliegue para no romper clientes antiguos: las restricciones impiden
-- volver a almacenar un enlace desactivado.

UPDATE public.race_uci_links
SET "autoSyncEnabled" = true
WHERE "autoSyncEnabled" IS DISTINCT FROM true;

UPDATE public.race_days
SET "resultsAutoSyncEnabled" = NULL
WHERE "resultsAutoSyncEnabled" IS NOT NULL;

ALTER TABLE public.race_uci_links
  ALTER COLUMN "autoSyncEnabled" SET DEFAULT true,
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_always_active,
  ADD CONSTRAINT chk_race_uci_links_always_active
    CHECK ("autoSyncEnabled" IS TRUE);

ALTER TABLE public.race_days
  DROP CONSTRAINT IF EXISTS chk_race_days_results_auto_sync_retired,
  ADD CONSTRAINT chk_race_days_results_auto_sync_retired
    CHECK ("resultsAutoSyncEnabled" IS NULL);

COMMENT ON COLUMN public.race_uci_links."autoSyncEnabled" IS
  'Compatibilidad heredada. Siempre true: todo enlace activa la captación automática.';
COMMENT ON COLUMN public.race_days."resultsAutoSyncEnabled" IS
  'Compatibilidad heredada. Siempre NULL: una jornada puede cambiar su ventana, no desactivar la captación.';

CREATE OR REPLACE FUNCTION public.trigger_configured_uci_results_workflow()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_token text;
BEGIN
  UPDATE public.race_days d
  SET "resultsAutoSyncQueuedAt" = now()
  FROM public.race_uci_links l
  WHERE l."raceId" = d."raceId"
    AND l."source" NOT IN ('pdf', 'sportstiming', 'manual_timing')
    AND d."estimatedFinishTimeUtc" IS NOT NULL
    AND now() >= CASE
      WHEN d."resultsSyncStartAt" IS NOT NULL
        THEN d."resultsSyncStartAt"
      WHEN d."resultsSyncStartOffsetMinutes" IS NOT NULL
        THEN d."estimatedFinishTimeUtc" + d."resultsSyncStartOffsetMinutes" * interval '1 minute'
      WHEN l."syncStartTime" IS NOT NULL
        THEN ((d."estimatedFinishTimeUtc" AT TIME ZONE 'Europe/Madrid')::date + l."syncStartTime")
          AT TIME ZONE 'Europe/Madrid'
      ELSE d."estimatedFinishTimeUtc"
        + COALESCE(d."resultsSyncStartOffsetMinutes", l."syncStartOffsetMinutes") * interval '1 minute'
    END
    AND now() <= CASE
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
    END
    AND (d."resultsLastAutoSyncAt" IS NULL OR d."resultsLastAutoSyncAt" <= now()
        - COALESCE(d."resultsSyncIntervalMinutes", l."syncIntervalMinutes") * interval '1 minute')
    AND (d."resultsAutoSyncQueuedAt" IS NULL OR d."resultsAutoSyncQueuedAt" <= now() - interval '10 minutes');

  IF NOT FOUND THEN RETURN; END IF;

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

REVOKE ALL ON FUNCTION public.trigger_configured_uci_results_workflow()
  FROM PUBLIC, anon, authenticated;
