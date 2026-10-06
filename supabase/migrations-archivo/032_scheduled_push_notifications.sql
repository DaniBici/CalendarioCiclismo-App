-- Notificaciones push programadas para envío diferido
CREATE TABLE scheduled_push_notifications (
  id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title           TEXT        NOT NULL,
  subtitle        TEXT,
  "imageUrl"      TEXT,
  "deepLink"      TEXT,
  "scheduledAt"   TIMESTAMPTZ NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  "createdAt"     TIMESTAMPTZ DEFAULT now(),
  "createdBy"     TEXT,
  "sentAt"        TIMESTAMPTZ,
  "recipientCount" INTEGER,
  "errorMessage"  TEXT,
  CONSTRAINT chk_scheduled_push_status
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'))
);

ALTER TABLE scheduled_push_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_full" ON scheduled_push_notifications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_read" ON scheduled_push_notifications
  FOR SELECT TO anon USING (true);

CREATE INDEX idx_scheduled_push_pending
  ON scheduled_push_notifications ("scheduledAt")
  WHERE status = 'pending';
