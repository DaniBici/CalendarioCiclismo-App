-- Reserva corta antes de llamar a GitHub: evita que el tick de cada minuto
-- encole varias Actions para la misma jornada durante el arranque del runner.

ALTER TABLE public.race_days
  ADD COLUMN IF NOT EXISTS "resultsAutoSyncQueuedAt" timestamptz;

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
    AND COALESCE(d."resultsAutoSyncEnabled", l."autoSyncEnabled")
    AND now() >= d."estimatedFinishTimeUtc"
        + COALESCE(d."resultsSyncStartOffsetMinutes", l."syncStartOffsetMinutes") * interval '1 minute'
    AND now() <= d."estimatedFinishTimeUtc"
        + COALESCE(d."resultsSyncStopOffsetMinutes", l."syncStopOffsetMinutes") * interval '1 minute'
    AND (d."resultsLastAutoSyncAt" IS NULL OR d."resultsLastAutoSyncAt" <= now()
        - COALESCE(d."resultsSyncIntervalMinutes", l."syncIntervalMinutes") * interval '1 minute')
    AND (d."resultsAutoSyncQueuedAt" IS NULL OR d."resultsAutoSyncQueuedAt" <= now() - interval '10 minutes');

  IF NOT FOUND THEN RETURN; END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token' LIMIT 1;
  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE WARNING '[uci-cron] falta github_dispatch_token';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://api.github.com/repos/DaniBici/calendario-ciclismo/actions/workflows/uci-results-today.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'supabase-pg-cron', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('configured', 'true')),
    timeout_milliseconds := 15000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_configured_uci_results_workflow() FROM PUBLIC;
