-- Limita el procesado periódico de pushes a la franja diurna española.
--
-- pg_cron del proyecto usa GMT y no admite zona horaria por job. Se ejecuta
-- entre 05:00 y 20:55 UTC para cubrir la franja 08:00–21:55 tanto en CET como
-- en CEST; send-push aplica la comprobación exacta con Europe/Madrid antes de
-- reclamar ninguna notificación. Esto evita envíos nocturnos y reduce un 33 %
-- las invocaciones de pg_cron.

SELECT cron.alter_job(
  jobid,
  schedule => '*/5 5-20 * * *'
)
FROM cron.job
WHERE jobname = 'process-scheduled-push-notifications';
