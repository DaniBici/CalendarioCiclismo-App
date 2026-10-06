-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260504102119, nombre 036_pg_cron_scheduled_push_fix_v2). Texto aplicado en producción, sin cambios.

CREATE OR REPLACE FUNCTION public.process_scheduled_push_notifications()
RETURNS void AS $$
DECLARE
  v_supabase_url text := 'https://bcecwlkynpgovnzhbpah.supabase.co';
  v_service_key text;
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

  -- Invocar la Edge Function vía pg_net (fire-and-forget)
  PERFORM net.http_post(
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
  );

  RAISE LOG '[pg_cron] process_scheduled_push_notifications: request sent';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[pg_cron] process_scheduled_push_notifications error: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
