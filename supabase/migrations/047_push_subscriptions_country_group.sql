-- ─────────────────────────────────────────────────────────────────
--  047_push_subscriptions_country_group.sql
--
--  Granularidad fina opcional para segmentar notificaciones por el
--  GRUPO de país real del usuario (no el bucket continental).
--
--  La columna `region` (migración 039) sigue siendo la fuente de la
--  preferencia visible al usuario en Ajustes — 5 valores: SPAIN /
--  EUROPE / AMERICAS / ASIA / AFRICA / ALL. Es el gate de Premium.
--
--  Esta nueva columna `countryGroup` es DERIVADA y opcional: la app
--  la calcula desde TimeZone.current y la envía en cada upsert. Sirve
--  exclusivamente al cron `auto_dispatch_premium_pushes` para que la
--  notificación `tv_start` use el horario del primer canal visible
--  para ESE grupo fino, en lugar del primer canal del bucket entero.
--
--  Valores aceptados (los 15 grupos `broadcasts.country` no globales):
--    Europa fina   → ES, PT, FR, BE, NL, IT, DE_AT_CH, UK_IE, SCANDI, EE
--    Extracontinen → NORTEAM, LATAM, ASIAPAC, MENA, AFRICA
--
--  NULL = sin granularidad fina (apps pre-2.x, Web Push, o TZ no
--  cubierta). El cron tratará esos casos con el fallback existente
--  por bucket continental `region`.
--
--  Aditivo: no rompe ningún flujo existente.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS "countryGroup" TEXT NULL;

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS chk_push_subscriptions_country_group;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT chk_push_subscriptions_country_group
    CHECK (
      "countryGroup" IS NULL OR "countryGroup" IN (
        'ES', 'PT', 'FR', 'BE', 'NL', 'IT',
        'DE_AT_CH', 'UK_IE', 'SCANDI', 'EE',
        'NORTEAM', 'LATAM',
        'ASIAPAC', 'MENA',
        'AFRICA'
      )
    );

-- Índice parcial para segmentación por grupo fino. Solo cubre tokens
-- activos con countryGroup definido.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_country_group_active
  ON push_subscriptions ("countryGroup")
  WHERE "isActive" = true AND "countryGroup" IS NOT NULL;

-- ── RPC v2: upsert completo + countryGroup ───────────────────────
-- Extiende set_push_subscription_full añadiendo p_country_group. La
-- antigua se mantiene intacta para apps en versiones anteriores.
CREATE OR REPLACE FUNCTION set_push_subscription_v2(
  p_token          TEXT,
  p_platform       TEXT,
  p_is_active      BOOLEAN,
  p_region         TEXT,
  p_country_group  TEXT,       -- NULL = sin granularidad fina (fallback al bucket por `region`)
  p_categories     TEXT[],
  p_followed_races TEXT[],
  p_race_filters   TEXT[]
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id     TEXT;
  v_cat    TEXT;
  v_race   TEXT;
  v_filter TEXT;
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

  -- 3. Reemplaza suscripciones individuales a carreras
  DELETE FROM push_race_subscriptions WHERE "subscriptionId" = v_id;
  FOREACH v_race IN ARRAY COALESCE(p_followed_races, ARRAY[]::TEXT[]) LOOP
    INSERT INTO push_race_subscriptions ("subscriptionId", "raceId")
    VALUES (v_id, v_race)
    ON CONFLICT ("subscriptionId", "raceId") DO NOTHING;
  END LOOP;

  -- 4. Reemplaza filtros de grupo
  DELETE FROM push_race_filters WHERE "subscriptionId" = v_id;
  FOREACH v_filter IN ARRAY COALESCE(p_race_filters, ARRAY[]::TEXT[]) LOOP
    INSERT INTO push_race_filters ("subscriptionId", "filterKey")
    VALUES (v_id, v_filter)
    ON CONFLICT ("subscriptionId", "filterKey") DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_push_subscription_v2(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;
