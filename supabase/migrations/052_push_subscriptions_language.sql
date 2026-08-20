-- ─────────────────────────────────────────────────────────────────
--  052_push_subscriptions_language.sql
--
--  Idioma del device para localizar las notificaciones Premium
--  (race_start, tv_start, results) al español o inglés según la
--  preferencia que el usuario eligió en Ajustes → Idioma.
--
--  Columna `language` en push_subscriptions: 'es' o 'en'. NULL = apps
--  pre-2.x que aún no envían idioma → se tratan como 'es' (baseline
--  histórico). El default a nivel de columna es 'es' para que el
--  trigger AFTER INSERT existente (categoría general) no rompa.
--
--  Columna `targetLanguages TEXT[]` en scheduled_push_notifications
--  y en push_notifications: array opcional con los idiomas a los que
--  va dirigida la notificación. NULL/vacío = sin filtro (default
--  legacy, llega a todos). Mismo patrón que `targetRegions` /
--  `targetCountryGroups` / `targetPlatforms`.
--
--  Aditivo: no rompe nada. Las apps antiguas y los flujos del panel
--  admin siguen funcionando sin tocar nada.
-- ─────────────────────────────────────────────────────────────────

-- 1. push_subscriptions.language
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es';

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS chk_push_subscriptions_language;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT chk_push_subscriptions_language
    CHECK (language IN ('es', 'en'));

-- Índice parcial para segmentación por idioma (tokens activos).
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_language_active
  ON push_subscriptions (language)
  WHERE "isActive" = true;

-- 2. scheduled_push_notifications.targetLanguages
ALTER TABLE scheduled_push_notifications
  ADD COLUMN IF NOT EXISTS "targetLanguages" TEXT[] NULL;

ALTER TABLE scheduled_push_notifications
  DROP CONSTRAINT IF EXISTS chk_scheduled_push_target_languages;

ALTER TABLE scheduled_push_notifications
  ADD CONSTRAINT chk_scheduled_push_target_languages
    CHECK (
      "targetLanguages" IS NULL
      OR (
        array_length("targetLanguages", 1) > 0
        AND "targetLanguages" <@ ARRAY['es', 'en']::TEXT[]
      )
    );

-- 3. push_notifications.targetLanguages (historial)
ALTER TABLE push_notifications
  ADD COLUMN IF NOT EXISTS "targetLanguages" TEXT[] NULL;

ALTER TABLE push_notifications
  DROP CONSTRAINT IF EXISTS chk_push_notifications_target_languages;

ALTER TABLE push_notifications
  ADD CONSTRAINT chk_push_notifications_target_languages
    CHECK (
      "targetLanguages" IS NULL
      OR (
        array_length("targetLanguages", 1) > 0
        AND "targetLanguages" <@ ARRAY['es', 'en']::TEXT[]
      )
    );

-- ── RPC v3: upsert completo + language + followed_stages ─────────
--
-- v2 (047) tenía 8 params: token, platform, isActive, region,
-- countryGroup, categories, followedRaces, raceFilters.
--
-- v3 añade 2 params al final: followedStages (ya soportado por la
-- 049 pero como param adicional de `set_push_subscription_full`,
-- nunca cableado en apps) y language (nuevo en esta migración).
--
-- Las apps que actualicen a 2.0 final llamarán a v3. v2 queda
-- intacta para back-compat (aplicará default 'es' en language vía
-- el default de columna).
CREATE OR REPLACE FUNCTION set_push_subscription_v3(
  p_token           TEXT,
  p_platform        TEXT,
  p_is_active       BOOLEAN,
  p_region          TEXT,
  p_country_group   TEXT,
  p_language        TEXT,
  p_categories      TEXT[],
  p_followed_races  TEXT[],
  p_race_filters    TEXT[],
  p_followed_stages TEXT[]
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id      TEXT;
  v_lang    TEXT := COALESCE(p_language, 'es');
  v_cat     TEXT;
  v_race    TEXT;
  v_filter  TEXT;
  v_stage   TEXT;
BEGIN
  -- Validación defensiva
  IF v_lang NOT IN ('es', 'en') THEN
    v_lang := 'es';
  END IF;

  -- 1. Upsert de la subscripción base (incluye language)
  INSERT INTO push_subscriptions (
    "deviceToken", platform, "isActive", region, "countryGroup", language, "updatedAt"
  )
  VALUES (p_token, p_platform, p_is_active, p_region, p_country_group, v_lang, NOW())
  ON CONFLICT ("deviceToken") DO UPDATE
    SET platform       = EXCLUDED.platform,
        "isActive"     = EXCLUDED."isActive",
        region         = EXCLUDED.region,
        "countryGroup" = EXCLUDED."countryGroup",
        language       = EXCLUDED.language,
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

  -- 5. Reemplaza suscripciones individuales a jornadas
  DELETE FROM push_stage_subscriptions WHERE "subscriptionId" = v_id;
  FOREACH v_stage IN ARRAY COALESCE(p_followed_stages, ARRAY[]::TEXT[]) LOOP
    INSERT INTO push_stage_subscriptions ("subscriptionId", "raceDayId")
    VALUES (v_id, v_stage)
    ON CONFLICT ("subscriptionId", "raceDayId") DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_push_subscription_v3(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT[], TEXT[]
) TO anon, authenticated;

COMMENT ON FUNCTION set_push_subscription_v3(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT[], TEXT[]
) IS 'Upsert atómico push_subscription + language + categorías + carreras seguidas + filtros + jornadas seguidas. v3 añade language y followedStages respecto a v2.';
