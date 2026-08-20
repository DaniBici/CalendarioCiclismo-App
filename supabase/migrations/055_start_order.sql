-- Tabla de entradas del orden de salida (contrarreloj individual/equipo)
CREATE TABLE start_order_entries (
  id TEXT PRIMARY KEY,
  "raceDayId" TEXT NOT NULL REFERENCES race_days(id) ON DELETE CASCADE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  dorsal INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "riderId" TEXT REFERENCES startlist_riders(id) ON DELETE SET NULL,
  "riderName" TEXT,
  "teamName" TEXT,
  "countryCode" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_start_order_race_day ON start_order_entries("raceDayId", "sortOrder");

ALTER TABLE race_days ADD COLUMN "startOrderImportedAt" TIMESTAMPTZ;

ALTER TABLE start_order_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read_start_order" ON start_order_entries FOR SELECT USING (true);
CREATE POLICY "auth_write_start_order" ON start_order_entries FOR ALL USING (auth.uid() IS NOT NULL);
