-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260504101936, nombre 036_pg_cron_scheduled_push_fix). Texto aplicado en producción, sin cambios.

CREATE OR REPLACE FUNCTION public.process_scheduled_push_notifications()
RETURNS void AS $$
DECLARE
  v_supabase_url text := 'https://bcecwlkynpgovnzhbpah.supabase.co';
  v_service_key text;
  response jsonb;
  status_code int;
  error_detail text;
BEGIN
  -- Intentar obtener service key desde pg_cron_config
  BEGIN
    SELECT value INTO v_service_key
    FROM public.pg_cron_config
    WHERE key = 'supabase_service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[pg_cron] Error reading pg_cron_config, edge function must have SUPABASE_SERVICE_ROLE_KEY env var';
  END;

  -- Invocar la Edge Function vía pg_net
  SELECT
    (http_response).status,
    (http_response).content::jsonb
  INTO status_code, response
  FROM (
    SELECT
      net.http_post(
        url := v_supabase_url || '/functions/v1/send-push',
        headers := jsonb_build_object(
          'Authorization', CASE WHEN v_service_key IS NOT NULL
                                THEN 'Bearer ' || v_service_key
                                ELSE 'Bearer edge-function-internal-call'
                            END,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('processScheduled', true),
        timeout_milliseconds := 30000
      ) as http_response
  );

  -- Log del resultado
  RAISE LOG '[pg_cron] process_scheduled_push_notifications: status=%', status_code;

  IF status_code NOT BETWEEN 200 AND 299 THEN
    error_detail := COALESCE((response->>'error')::text, 'unknown error');
    RAISE WARNING '[pg_cron] send-push failed: status=%, error=%', status_code, error_detail;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[pg_cron] process_scheduled_push_notifications error: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
