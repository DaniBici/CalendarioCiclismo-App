-- ─────────────────────────────────────────────────────────────────
--  044_push_target_platforms.sql
--
--  Targeting por plataforma para el envío de push notifications.
--  Permite restringir un envío a un subset de plataformas
--  ('ios', 'android', 'web'). Caso de uso típico: avisar SOLO a los
--  usuarios de Android para que actualicen su app cuando llegue una
--  versión nueva incompatible.
--
--  Semántica:
--    NULL        → sin filtro de plataforma (default — comportamiento legacy).
--    Array vacío → equivalente a NULL (defensa por consistencia).
--    Array con plataformas → solo devices con platform IN (...).
--
--  Las plataformas válidas coinciden con el CHECK constraint ya
--  existente sobre push_subscriptions.platform.
-- ─────────────────────────────────────────────────────────────────

-- ── scheduled_push_notifications ─────────────────────────────────
ALTER TABLE scheduled_push_notifications
  ADD COLUMN IF NOT EXISTS "targetPlatforms" TEXT[];

ALTER TABLE scheduled_push_notifications
  DROP CONSTRAINT IF EXISTS chk_scheduled_push_target_platforms;

ALTER TABLE scheduled_push_notifications
  ADD CONSTRAINT chk_scheduled_push_target_platforms
    CHECK (
      "targetPlatforms" IS NULL
      OR (
        array_length("targetPlatforms", 1) > 0
        AND "targetPlatforms" <@ ARRAY['ios', 'android', 'web']::TEXT[]
      )
    );

-- ── push_notifications (historial) ───────────────────────────────
ALTER TABLE push_notifications
  ADD COLUMN IF NOT EXISTS "targetPlatforms" TEXT[];

ALTER TABLE push_notifications
  DROP CONSTRAINT IF EXISTS chk_push_notifications_target_platforms;

ALTER TABLE push_notifications
  ADD CONSTRAINT chk_push_notifications_target_platforms
    CHECK (
      "targetPlatforms" IS NULL
      OR (
        array_length("targetPlatforms", 1) > 0
        AND "targetPlatforms" <@ ARRAY['ios', 'android', 'web']::TEXT[]
      )
    );
