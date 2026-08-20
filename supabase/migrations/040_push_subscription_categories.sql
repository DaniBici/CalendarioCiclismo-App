-- ─────────────────────────────────────────────────────────────────
--  040_push_subscription_categories.sql
--
--  Notificaciones enriquecidas Premium (Fase 3 del plan 2.0).
--
--  Crea la tabla `push_subscription_categories` que mapea cada device
--  registrado en `push_subscriptions` a uno o varios tipos de
--  notificación. La Edge Function `send-push` usa esta tabla para
--  filtrar el público objetivo según el campo `category` del request.
--
--  Categorías:
--    - 'general'    → notificaciones de difusión administradas por el
--                     equipo (anuncios, novedades). Gratis para siempre.
--    - 'race_start' → aviso T-X min antes de arrancar una carrera.
--    - 'tv_start'   → aviso T-X min antes de empezar una emisión TV.
--    - 'results'    → resumen de resultados al cerrar la jornada.
--
--  Las 3 últimas son features Premium (Fase 6 RevenueCat). Se cumple
--  la regla "no degradar lo gratis" porque:
--   1. Devices preexistentes reciben automáticamente la categoría
--      'general' vía backfill al final de esta migración.
--   2. Nuevos devices que se registren más adelante reciben 'general'
--      por defecto vía trigger AFTER INSERT en `push_subscriptions`.
--   3. Las apps (iOS/Android) llaman a la RPC
--      `set_push_subscription_with_categories` para reemplazar el
--      conjunto de categorías cuando el usuario las modifica.
--   4. La web nunca toca categorías; sigue recibiendo solo 'general'.
--
--  Adicionalmente añade `category` a `scheduled_push_notifications`
--  para que las notificaciones programadas mantengan el filtro al
--  ejecutarse vía `processScheduled`.
-- ─────────────────────────────────────────────────────────────────

-- ── Tabla principal ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscription_categories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "subscriptionId" TEXT NOT NULL
                   REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  category         TEXT NOT NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_push_subscription_categories_category
    CHECK (category IN ('general', 'race_start', 'tv_start', 'results')),
  CONSTRAINT uq_push_subscription_categories_pair
    UNIQUE ("subscriptionId", category)
);

CREATE INDEX IF NOT EXISTS idx_push_sub_cat_subscription
  ON push_subscription_categories ("subscriptionId");

CREATE INDEX IF NOT EXISTS idx_push_sub_cat_category
  ON push_subscription_categories (category);

-- ── RLS ──────────────────────────────────────────────────────────
-- Lectura pública (las apps no la usan pero el panel admin sí podría
-- exponerla en el futuro). Escritura controlada vía RPC con
-- SECURITY DEFINER, así que NO hay políticas anon de escritura aquí.
ALTER TABLE push_subscription_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_push_subscription_categories"
  ON push_subscription_categories FOR SELECT USING (true);

-- ── Trigger: nueva subscription ⇒ asignar 'general' por defecto ──
-- Cubre el caso de la web (que sigue insertando filas en
-- push_subscriptions sin pasar por la RPC) y cualquier otro cliente
-- que se incorpore en el futuro sin lógica de categorías.
--
-- Solo se dispara para INSERTs reales (no para UPDATEs derivados de
-- ON CONFLICT DO UPDATE), por lo que NO interfiere con las
-- renovaciones de token desde la web ni con el flujo de la RPC
-- (que reemplaza las categorías inmediatamente después del INSERT).
CREATE OR REPLACE FUNCTION ensure_default_push_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO push_subscription_categories ("subscriptionId", category)
  VALUES (NEW.id, 'general')
  ON CONFLICT ("subscriptionId", category) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_subscriptions_default_category
  ON push_subscriptions;

CREATE TRIGGER trg_push_subscriptions_default_category
  AFTER INSERT ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION ensure_default_push_category();

-- ── Backfill: devices preexistentes reciben 'general' ────────────
-- Idempotente: ON CONFLICT DO NOTHING permite re-ejecutar la migración
-- sin duplicados ni errores.
INSERT INTO push_subscription_categories ("subscriptionId", category)
SELECT id, 'general' FROM push_subscriptions
ON CONFLICT ("subscriptionId", category) DO NOTHING;

-- ── RPC: upsert de subscripción + reemplazo atómico de categorías ─
-- Las apps iOS/Android la llaman en lugar del upsert directo a
-- push_subscriptions cuando registran/renuevan/desactivan el token o
-- cuando el usuario cambia sus preferencias de tipo de notificación.
--
-- Ventajas frente al patrón "2 fetches" desde cliente:
--   - Atómica: si algo falla, ni el upsert ni el reemplazo se aplican.
--   - SECURITY DEFINER: no requiere políticas RLS de escritura sobre
--     push_subscription_categories (que serían imposibles de hacer
--     seguras sin un user account asociado al deviceToken).
--   - Una sola llamada de red.
--
-- p_categories debe ser un array no vacío con valores válidos. Si se
-- pasa vacío, la subscripción queda activa sin categorías y NO recibe
-- ninguna notificación (la regla "no degradar lo gratis" exige que la
-- UI cliente siempre incluya 'general' al menos para usuarios free).
CREATE OR REPLACE FUNCTION set_push_subscription_with_categories(
  p_token       TEXT,
  p_platform    TEXT,
  p_is_active   BOOLEAN,
  p_region      TEXT,
  p_categories  TEXT[]
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id  TEXT;
  v_cat TEXT;
BEGIN
  -- 1. Upsert de la subscripción. Devuelve el id en cualquier caso.
  INSERT INTO push_subscriptions ("deviceToken", platform, "isActive", region, "updatedAt")
  VALUES (p_token, p_platform, p_is_active, p_region, NOW())
  ON CONFLICT ("deviceToken") DO UPDATE
    SET platform   = EXCLUDED.platform,
        "isActive" = EXCLUDED."isActive",
        region     = EXCLUDED.region,
        "updatedAt" = NOW()
  RETURNING id INTO v_id;

  -- 2. Reemplaza las categorías. El trigger AFTER INSERT pudo haber
  --    insertado 'general' si era una fila nueva — el DELETE lo limpia
  --    antes de aplicar el conjunto que pide el cliente.
  DELETE FROM push_subscription_categories
  WHERE "subscriptionId" = v_id;

  IF p_categories IS NOT NULL AND array_length(p_categories, 1) > 0 THEN
    FOREACH v_cat IN ARRAY p_categories LOOP
      INSERT INTO push_subscription_categories ("subscriptionId", category)
      VALUES (v_id, v_cat)
      ON CONFLICT ("subscriptionId", category) DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_id;
END;
$$;

-- Permite que `anon` y `authenticated` invoquen la RPC. Como tiene
-- SECURITY DEFINER ejecuta con privilegios del owner de la función
-- (postgres), saltándose RLS de las dos tablas.
GRANT EXECUTE ON FUNCTION set_push_subscription_with_categories(
  TEXT, TEXT, BOOLEAN, TEXT, TEXT[]
) TO anon, authenticated;

-- ── scheduled_push_notifications: añadir category ────────────────
-- Las notificaciones programadas heredan el filtro por categoría. El
-- procesador (Mode 3 de send-push) lee este campo y se lo pasa a doSend.
ALTER TABLE scheduled_push_notifications
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE scheduled_push_notifications
  DROP CONSTRAINT IF EXISTS chk_scheduled_push_notifications_category;

ALTER TABLE scheduled_push_notifications
  ADD CONSTRAINT chk_scheduled_push_notifications_category
    CHECK (category IN ('general', 'race_start', 'tv_start', 'results'));

-- ── push_notifications: añadir category al historial ─────────────
-- Para que el panel admin pueda mostrar a posteriori qué categoría se
-- envió en cada notificación histórica. Default 'general' para mantener
-- compatibilidad con los 11 registros preexistentes.
ALTER TABLE push_notifications
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE push_notifications
  DROP CONSTRAINT IF EXISTS chk_push_notifications_category;

ALTER TABLE push_notifications
  ADD CONSTRAINT chk_push_notifications_category
    CHECK (category IN ('general', 'race_start', 'tv_start', 'results'));
