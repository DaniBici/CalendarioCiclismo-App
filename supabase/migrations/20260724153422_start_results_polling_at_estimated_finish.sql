-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260724153422, nombre start_results_polling_at_estimated_finish). Texto aplicado en producción, sin cambios.

CREATE OR REPLACE FUNCTION public.trigger_uci_results_today_workflow()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token   text;
  v_owner   text := 'DaniBici';
  v_repo    text := 'calendario-ciclismo';
  v_wf      text := 'uci-results-today.yml';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM race_uci_links l
    JOIN races r ON r.id = l."raceId"
    JOIN race_days d ON d."raceId" = l."raceId"
    WHERE (
      d."estimatedFinishTimeUtc" IS NOT NULL
      AND now() >= d."estimatedFinishTimeUtc"
      AND now() <= d."estimatedFinishTimeUtc" + interval '3 hours'
    ) OR (
      d."estimatedFinishTimeUtc" IS NULL
      AND d."dateKey" = to_char(now(), 'YYYY-MM-DD')
      AND (r."raceFormat" = 'one_day' OR d."stageNumber" >= 1)
    )
  ) THEN
    RAISE LOG '[uci-cron] fuera de ventana de meta (ninguna llegada activa) — no disparo el workflow';
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
    WHERE name = 'github_dispatch_token'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[uci-cron] no pude leer vault.decrypted_secrets: %', SQLERRM;
    RETURN;
  END;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE WARNING '[uci-cron] falta el secret de Vault "github_dispatch_token" — no disparo el workflow';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := format('https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches',
                  v_owner, v_repo, v_wf),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'supabase-pg-cron',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main'),
    timeout_milliseconds := 15000
  );

  RAISE LOG '[uci-cron] workflow_dispatch enviado a %/% (%).', v_owner, v_repo, v_wf;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[uci-cron] trigger_uci_results_today_workflow error: %', SQLERRM;
END;
$function$;
