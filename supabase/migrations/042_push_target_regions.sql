-- ─────────────────────────────────────────────────────────────────
--  042_push_target_regions.sql
--
--  Targeting por región para el envío de push notifications.
--  Cierra el pendiente de Fase 2: la columna `region` se rellena en
--  push_subscriptions desde 039 pero la Edge Function send-push aún
--  no filtra por ella. Esta migración añade la columna `targetRegions`
--  a `scheduled_push_notifications` y `push_notifications` para que
--  cada envío pueda restringirse a un subset de regiones.
--
--  Semántica:
--    NULL       → sin filtro de región (default — comportamiento legacy).
--    Array vacío → equivalente a NULL (defensa por consistencia).
--    Array con regiones → solo devices con region IN (...).
--
--  Las regiones válidas son las mismas 5 buckets del baseline
--  (RegionPreference iOS / RegionPreference.kt Android). Premium
--  podrá targetear cualquier subset desde el panel admin (Fase 6).
--  La regla "no degradar lo gratis" se respeta: si un envío no
--  especifica targetRegions, llega a todos los devices (incluyendo
--  los que tienen region='SPAIN' por default).
--
--  Nota: la región 'ALL' del enum cliente NO existe en este universo —
--  representa "Premium full unlock" y se traduce internamente a
--  targetRegions=NULL en el body del request.
-- ─────────────────────────────────────────────────────────────────

-- ── scheduled_push_notifications ─────────────────────────────────
ALTER TABLE scheduled_push_notifications
  ADD COLUMN IF NOT EXISTS "targetRegions" TEXT[];

ALTER TABLE scheduled_push_notifications
  DROP CONSTRAINT IF EXISTS chk_scheduled_push_target_regions;

ALTER TABLE scheduled_push_notifications
  ADD CONSTRAINT chk_scheduled_push_target_regions
    CHECK (
      "targetRegions" IS NULL
      OR (
        array_length("targetRegions", 1) > 0
        AND "targetRegions" <@ ARRAY['SPAIN', 'EUROPE', 'AMERICAS', 'ASIA', 'AFRICA']::TEXT[]
      )
    );

-- ── push_notifications (historial) ───────────────────────────────
ALTER TABLE push_notifications
  ADD COLUMN IF NOT EXISTS "targetRegions" TEXT[];

ALTER TABLE push_notifications
  DROP CONSTRAINT IF EXISTS chk_push_notifications_target_regions;

ALTER TABLE push_notifications
  ADD CONSTRAINT chk_push_notifications_target_regions
    CHECK (
      "targetRegions" IS NULL
      OR (
        array_length("targetRegions", 1) > 0
        AND "targetRegions" <@ ARRAY['SPAIN', 'EUROPE', 'AMERICAS', 'ASIA', 'AFRICA']::TEXT[]
      )
    );
