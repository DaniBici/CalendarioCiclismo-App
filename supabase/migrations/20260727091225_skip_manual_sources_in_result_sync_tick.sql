-- Una regla configurada directamente por SQL no debe despertar un runner para
-- fuentes sin fetcher automático. El panel no las deja programar, pero el gate
-- de BD es la garantía que evita consumo accidental de CI.

CREATE OR REPLACE FUNCTION public.trigger_configured_uci_results_workflow()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.race_uci_links l
    JOIN public.race_days d ON d."raceId" = l."raceId"
    WHERE l."source" NOT IN ('pdf', 'sportstiming', 'manual_timing')
      AND d."estimatedFinishTimeUtc" IS NOT NULL
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
