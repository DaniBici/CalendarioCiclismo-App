-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260724155954, nombre target_tissot_stage_in_results_dispatch). Texto aplicado en producción, sin cambios.

CREATE OR REPLACE FUNCTION public.trigger_uci_results_today_workflow()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token text;
  v_owner text := 'DaniBici';
  v_repo text := 'calendario-ciclismo';
  v_wf text := 'uci-results-today.yml';
  v_race_id text;
  v_stage_number integer;
BEGIN
  SELECT l."raceId", d."stageNumber"
  INTO v_race_id, v_stage_number
  FROM race_uci_links l
  JOIN race_days d ON d."raceId" = l."raceId"
  WHERE l.source = 'tissot'
    AND d."estimatedFinishTimeUtc" IS NOT NULL
    AND now() >= d."estimatedFinishTimeUtc"
    AND now() <= d."estimatedFinishTimeUtc" + interval '3 hours'
  ORDER BY d."estimatedFinishTimeUtc" DESC
  LIMIT 1;

  IF v_race_id IS NULL AND NOT EXISTS (
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
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token'
  LIMIT 1;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE WARNING '[uci-cron] falta el secret de Vault "github_dispatch_token"';
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
    body := CASE
      WHEN v_race_id IS NOT NULL THEN jsonb_build_object(
        'ref', 'main',
        'inputs', jsonb_build_object(
          'race_id', v_race_id,
          'stage_number', v_stage_number::text
        )
      )
      ELSE jsonb_build_object('ref', 'main')
    END,
    timeout_milliseconds := 15000
  );
END;
$function$;
