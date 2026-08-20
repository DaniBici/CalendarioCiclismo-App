-- Migración 036: pg_cron job para procesar notificaciones push programadas
-- Reemplaza la dependencia de GitHub Actions con un cron job interno en PostgreSQL
-- Ejecución: cada 5 minutos, con reintentos y logging automáticos

-- Nota: Esta función requiere que la Edge Function 'send-push' tenga disponible
-- SUPABASE_SERVICE_ROLE_KEY como variable de entorno.

-- Crear función que invoca send-push vía pg_net
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

  -- Invocar la Edge Function vía pg_net (fire-and-forget)
  -- pg_net es asincróno, la respuesta se procesa en el Edge Function
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

-- Crear el cron job si no existe
SELECT cron.schedule(
  'process-scheduled-push-notifications',
  '*/5 * * * *',
  'SELECT public.process_scheduled_push_notifications();'
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job
  WHERE jobname = 'process-scheduled-push-notifications'
);

-- Comentario de auditoría
COMMENT ON FUNCTION public.process_scheduled_push_notifications()
  IS 'Procesa notificaciones push programadas vía pg_cron cada 5 minutos. '
      'Invoca send-push con SUPABASE_SERVICE_ROLE_KEY para autenticación interna.';
