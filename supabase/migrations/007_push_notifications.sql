-- ═══════════════════════════════════════════════════════════════════
--  PUSH NOTIFICATIONS — Suscripciones de dispositivos y log de envíos
-- ═══════════════════════════════════════════════════════════════════

-- push_subscriptions: tokens de dispositivos iOS registrados
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "deviceToken" TEXT NOT NULL UNIQUE,
  platform      TEXT NOT NULL DEFAULT 'ios',
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMPTZ DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ DEFAULT now()
);

-- push_notifications: historial de notificaciones enviadas desde el panel
CREATE TABLE IF NOT EXISTS push_notifications (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title            TEXT NOT NULL,
  subtitle         TEXT,
  "imageUrl"       TEXT,
  "deepLink"       TEXT,
  "sentAt"         TIMESTAMPTZ DEFAULT now(),
  "sentBy"         TEXT,
  "recipientCount" INTEGER DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────
--  ÍNDICES
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active
  ON push_subscriptions ("isActive") WHERE "isActive" = true;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_token
  ON push_subscriptions ("deviceToken");

CREATE INDEX IF NOT EXISTS idx_push_notifications_sent
  ON push_notifications ("sentAt" DESC);

-- ─────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE push_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_notifications  ENABLE ROW LEVEL SECURITY;

-- push_subscriptions: lectura pública (para contar), inserción/update desde anon (registro de token)
CREATE POLICY "public_read_push_subscriptions"
  ON push_subscriptions FOR SELECT USING (true);

CREATE POLICY "anon_insert_push_subscriptions"
  ON push_subscriptions FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_update_push_subscriptions"
  ON push_subscriptions FOR UPDATE USING (true);

-- push_notifications: lectura pública, escritura solo autenticados
CREATE POLICY "public_read_push_notifications"
  ON push_notifications FOR SELECT USING (true);

CREATE POLICY "auth_write_push_notifications"
  ON push_notifications FOR ALL USING (auth.uid() IS NOT NULL);
