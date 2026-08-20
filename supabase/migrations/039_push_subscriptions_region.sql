-- ─────────────────────────────────────────────────────────────────
--  039_push_subscriptions_region.sql
--
--  Añade `region` a push_subscriptions para enviar notificaciones
--  segmentadas por la región seleccionada por el usuario en Ajustes.
--
--  Valores esperados (RegionPreference): SPAIN | EUROPE | AMERICAS |
--    ASIA | AFRICA | ALL.
--
--  Default 'SPAIN' refleja el baseline gratuito (ALL + ES + EUROPA).
--  Aditivo respecto a 1.4.4: usuarios pre-2.0 que actualicen reciben
--  'SPAIN' por defecto y siguen viendo lo mismo que antes.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS "region" TEXT NOT NULL DEFAULT 'SPAIN';

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS chk_push_subscriptions_region;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT chk_push_subscriptions_region
    CHECK ("region" IN ('SPAIN', 'EUROPE', 'AMERICAS', 'ASIA', 'AFRICA', 'ALL'));

-- Índice parcial para envíos segmentados por región. Solo cubre tokens
-- activos: el job de cleanup borra los inactivos antiguos cada 30 días.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_region_active
  ON push_subscriptions ("region")
  WHERE "isActive" = true;
