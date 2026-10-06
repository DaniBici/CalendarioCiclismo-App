-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260510182905, nombre push_subscriptions_is_debug). Texto aplicado en producción, sin cambios.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS "isDebug" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_debug
  ON push_subscriptions ("isDebug")
  WHERE "isDebug" = TRUE;
