-- Registra el job pg_cron para limpiar tokens de push inactivos (≥ 30 días).
-- Requiere la extensión pg_cron activada en el proyecto.
SELECT cron.schedule(
  'cleanup-inactive-push-tokens',
  '0 4 * * *',
  $$
    DELETE FROM push_subscriptions
    WHERE "isActive" = false
      AND "updatedAt" < NOW() - INTERVAL '30 days';
  $$
);
