-- ─────────────────────────────────────────────────────────────────
--  045_push_race_subscriptions.sql
--
--  Suscripciones a notificaciones por carrera individual y por filtros
--  predefinidos de grupo. Complementa el sistema de categorías (Fase 3)
--  con una capa de segmentación por carrera.
--
--  Semántica de envío:
--    - raceId IS NULL en scheduled_push_notifications → broadcast a
--      TODOS los suscriptores de esa categoría (comportamiento actual).
--    - raceId IS NOT NULL → solo se entrega a suscriptores que:
--        a) No tienen filas en push_race_subscriptions ni en
--           push_race_filters ("follow-all" implícito, comportamiento
--           actual de Premium), O
--        b) Tienen una fila en push_race_subscriptions para esa
--           race específica, O
--        c) Tienen una fila en push_race_filters cuyo filterKey
--           aplica a esa carrera.
--
--  La RPC set_push_subscription_full reemplaza (sin romper)
--  set_push_subscription_with_categories: las apps en versiones antiguas
--  siguen en "follow-all" implícito porque no insertan filas en las
--  nuevas tablas.
--
--  Backward compat: apps antiguas que llaman a la RPC antigua siguen
--  funcionando. Las nuevas apps llaman a set_push_subscription_full.
-- ─────────────────────────────────────────────────────────────────

-- ── Tabla: suscripciones individuales por carrera ────────────────
CREATE TABLE IF NOT EXISTS push_race_subscriptions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscriptionId" TEXT        NOT NULL
                               REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  "raceId"         TEXT        NOT NULL
                               REFERENCES races(id) ON DELETE CASCADE,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_push_race_sub UNIQUE ("subscriptionId", "raceId")
);

CREATE INDEX IF NOT EXISTS idx_push_race_sub_sub
  ON push_race_subscriptions ("subscriptionId");
CREATE INDEX IF NOT EXISTS idx_push_race_sub_race
  ON push_race_subscriptions ("raceId");

ALTER TABLE push_race_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_push_race_subscriptions"
  ON push_race_subscriptions FOR SELECT USING (true);

-- ── Tabla: filtros predefinidos de grupo ─────────────────────────
-- filterKey: 'wt_male'    → uciCategory IN (1.UWT, 2.UWT) AND gender = 'male'
--            'wt_female'  → uciCategory IN (1.WWT, 2.WWT) AND gender = 'female'
--            'grand_tours'→ isGrandTour = true (solo masculinas)
--            'pro_male'   → uciCategory IN (1.Pro, 2.Pro, 1.1, 2.1) AND gender = 'male'
--            'pro_female' → uciCategory IN (1.Pro, 2.Pro, 1.1, 2.1) AND gender = 'female'
CREATE TABLE IF NOT EXISTS push_race_filters (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscriptionId" TEXT        NOT NULL
                               REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  "filterKey"      TEXT        NOT NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_push_race_filter UNIQUE ("subscriptionId", "filterKey"),
  CONSTRAINT chk_push_race_filter_key
    CHECK ("filterKey" IN ('wt_male','wt_female','grand_tours','pro_male','pro_female'))
);

CREATE INDEX IF NOT EXISTS idx_push_race_filter_sub
  ON push_race_filters ("subscriptionId");

ALTER TABLE push_race_filters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_push_race_filters"
  ON push_race_filters FOR SELECT USING (true);

-- ── Columna raceId en tablas de historial y programadas ──────────
-- NULL = broadcast sin restricción de carrera (compatibilidad).
ALTER TABLE scheduled_push_notifications
  ADD COLUMN IF NOT EXISTS "raceId" TEXT REFERENCES races(id) ON DELETE SET NULL;

ALTER TABLE push_notifications
  ADD COLUMN IF NOT EXISTS "raceId" TEXT;

ALTER TABLE push_auto_dispatch
  ADD COLUMN IF NOT EXISTS "raceId" TEXT;

-- ── RPC: determinar qué filterKeys aplican a una carrera dada ────
-- Usada por la Edge Function para resolver qué suscriptores con
-- filtros de grupo deben recibir la notificación de una carrera.
CREATE OR REPLACE FUNCTION get_race_filter_keys(p_race_id TEXT)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY(
    SELECT f.key
    FROM (VALUES
      ('wt_male',    (SELECT r."uciCategory" IN ('1.UWT','2.UWT') AND r.gender = 'male'   FROM races r WHERE r.id = p_race_id)),
      ('wt_female',  (SELECT r."uciCategory" IN ('1.WWT','2.WWT') AND r.gender = 'female' FROM races r WHERE r.id = p_race_id)),
      ('grand_tours',(SELECT r."isGrandTour" = true                                        FROM races r WHERE r.id = p_race_id)),
      ('pro_male',   (SELECT r."uciCategory" IN ('1.Pro','2.Pro','1.1','2.1') AND r.gender = 'male'   FROM races r WHERE r.id = p_race_id)),
      ('pro_female', (SELECT r."uciCategory" IN ('1.Pro','2.Pro','1.1','2.1') AND r.gender = 'female' FROM races r WHERE r.id = p_race_id))
    ) AS f(key, matches)
    WHERE f.matches = true
  );
$$;
GRANT EXECUTE ON FUNCTION get_race_filter_keys(TEXT) TO anon, authenticated;

-- ── RPC: suscriptores "follow-all" (sin restricción de carrera) ──
-- Usuarios Premium sin ninguna fila en las tablas nuevas.
-- Reciben notificaciones de TODAS las carreras (comportamiento actual).
CREATE OR REPLACE FUNCTION get_unrestricted_push_subscribers(
  p_category   TEXT,
  p_regions    TEXT[] DEFAULT NULL,
  p_platforms  TEXT[] DEFAULT NULL
)
RETURNS TABLE("deviceToken" TEXT, platform TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ps."deviceToken", ps.platform
  FROM push_subscriptions ps
  JOIN push_subscription_categories psc
    ON psc."subscriptionId" = ps.id AND psc.category = p_category
  WHERE ps."isActive" = true
    AND NOT EXISTS (
      SELECT 1 FROM push_race_subscriptions prs WHERE prs."subscriptionId" = ps.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM push_race_filters prf WHERE prf."subscriptionId" = ps.id
    )
    AND (p_regions  IS NULL OR array_length(p_regions, 1) = 0  OR ps.region   = ANY(p_regions))
    AND (p_platforms IS NULL OR array_length(p_platforms,1) = 0 OR ps.platform = ANY(p_platforms));
$$;
GRANT EXECUTE ON FUNCTION get_unrestricted_push_subscribers(TEXT, TEXT[], TEXT[]) TO anon, authenticated;

-- ── RPC principal: upsert completo con carreras y filtros ─────────
-- Reemplaza set_push_subscription_with_categories como llamada
-- principal de las apps. La antigua se mantiene intacta.
CREATE OR REPLACE FUNCTION set_push_subscription_full(
  p_token          TEXT,
  p_platform       TEXT,
  p_is_active      BOOLEAN,
  p_region         TEXT,
  p_categories     TEXT[],
  p_followed_races TEXT[],   -- raceIds; vacío = "follow-all" implícito
  p_race_filters   TEXT[]    -- filterKeys; vacío = sin filtros de grupo
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
  -- 1. Upsert de la subscripción base
  INSERT INTO push_subscriptions ("deviceToken", platform, "isActive", region, "updatedAt")
  VALUES (p_token, p_platform, p_is_active, p_region, NOW())
  ON CONFLICT ("deviceToken") DO UPDATE
    SET platform    = EXCLUDED.platform,
        "isActive"  = EXCLUDED."isActive",
        region      = EXCLUDED.region,
        "updatedAt" = NOW()
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

GRANT EXECUTE ON FUNCTION set_push_subscription_full(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;
