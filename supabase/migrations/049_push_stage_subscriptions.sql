-- 049_push_stage_subscriptions.sql
-- Suscripciones push a jornadas individuales.
-- Complementa push_race_subscriptions (carreras) con granularidad de etapa.

-- ── 1. Tabla push_stage_subscriptions ────────────────────────────────────────

CREATE TABLE push_stage_subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscriptionId" TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  "raceDayId"      TEXT NOT NULL REFERENCES race_days(id) ON DELETE CASCADE,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_push_stage_sub UNIQUE ("subscriptionId", "raceDayId")
);

CREATE INDEX idx_push_stage_sub_sub  ON push_stage_subscriptions ("subscriptionId");
CREATE INDEX idx_push_stage_sub_day  ON push_stage_subscriptions ("raceDayId");

ALTER TABLE push_stage_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_push_stage_subscriptions"
  ON push_stage_subscriptions FOR SELECT USING (true);

-- ── 2. Columna raceDayId en tablas de historial/programadas ──────────────────
-- NULL = broadcast; NOT NULL = solo jornada concreta.

ALTER TABLE scheduled_push_notifications
  ADD COLUMN IF NOT EXISTS "raceDayId" TEXT REFERENCES race_days(id) ON DELETE SET NULL;

ALTER TABLE push_notifications
  ADD COLUMN IF NOT EXISTS "raceDayId" TEXT;

ALTER TABLE push_auto_dispatch
  ADD COLUMN IF NOT EXISTS "raceDayId" TEXT;

-- ── 3. RPC set_push_subscription_v2 — extiende con p_followed_stages ─────────
-- Añade el 9.º parámetro p_followed_stages TEXT[] para jornadas seguidas
-- individualmente. La firma anterior (8 params) sigue siendo válida para
-- apps en versiones anteriores (overload por nombre de función).
-- Vacío = sin suscripciones de etapa (comportamiento anterior).

CREATE OR REPLACE FUNCTION set_push_subscription_v2(
  p_token           TEXT,
  p_platform        TEXT,
  p_is_active       BOOLEAN,
  p_region          TEXT,
  p_country_group   TEXT,
  p_categories      TEXT[],
  p_followed_races  TEXT[],
  p_race_filters    TEXT[],
  p_followed_stages TEXT[] DEFAULT '{}'
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     TEXT;
  v_cat    TEXT;
  v_race   TEXT;
  v_filter TEXT;
  v_stage  TEXT;
BEGIN
  -- 1. Upsert de la subscripción base (incluye countryGroup)
  INSERT INTO push_subscriptions ("deviceToken", platform, "isActive", region, "countryGroup", "updatedAt")
  VALUES (p_token, p_platform, p_is_active, p_region, p_country_group, NOW())
  ON CONFLICT ("deviceToken") DO UPDATE
    SET platform       = EXCLUDED.platform,
        "isActive"     = EXCLUDED."isActive",
        region         = EXCLUDED.region,
        "countryGroup" = EXCLUDED."countryGroup",
        "updatedAt"    = NOW()
  RETURNING id INTO v_id;

  -- 2. Reemplaza categorías
  DELETE FROM push_subscription_categories WHERE "subscriptionId" = v_id;
  FOREACH v_cat IN ARRAY COALESCE(p_categories, ARRAY[]::TEXT[]) LOOP
    INSERT INTO push_subscription_categories ("subscriptionId", category)
    VALUES (v_id, v_cat)
    ON CONFLICT ("subscriptionId", category) DO NOTHING;
  END LOOP;

  -- 3. Reemplaza suscripciones individuales de carrera
  DELETE FROM push_race_subscriptions WHERE "subscriptionId" = v_id;
  FOREACH v_race IN ARRAY COALESCE(p_followed_races, ARRAY[]::TEXT[]) LOOP
    INSERT INTO push_race_subscriptions ("subscriptionId", "raceId")
    VALUES (v_id, v_race)
    ON CONFLICT ("subscriptionId", "raceId") DO NOTHING;
  END LOOP;

  -- 4. Reemplaza filtros de grupo de carrera
  DELETE FROM push_race_filters WHERE "subscriptionId" = v_id;
  FOREACH v_filter IN ARRAY COALESCE(p_race_filters, ARRAY[]::TEXT[]) LOOP
    INSERT INTO push_race_filters ("subscriptionId", "filterKey")
    VALUES (v_id, v_filter)
    ON CONFLICT ("subscriptionId", "filterKey") DO NOTHING;
  END LOOP;

  -- 5. Reemplaza suscripciones individuales de jornada
  DELETE FROM push_stage_subscriptions WHERE "subscriptionId" = v_id;
  FOREACH v_stage IN ARRAY COALESCE(p_followed_stages, ARRAY[]::TEXT[]) LOOP
    INSERT INTO push_stage_subscriptions ("subscriptionId", "raceDayId")
    VALUES (v_id, v_stage)
    ON CONFLICT ("subscriptionId", "raceDayId") DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_push_subscription_v2(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT[], TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;
