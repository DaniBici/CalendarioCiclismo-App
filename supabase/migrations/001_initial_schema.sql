-- ═══════════════════════════════════════════════════════════════════
--  CALENDARIO CICLISMO — Esquema inicial Supabase / PostgreSQL
--  Migración desde Firebase Firestore
--
--  INSTRUCCIONES:
--  1. Abre el SQL Editor en tu proyecto Supabase
--  2. Copia y ejecuta este script completo
--  3. A continuación, ejecuta el script de migración de datos (migration.html)
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
--  TABLAS
-- ─────────────────────────────────────────────────────────────────

-- races: carreras profesionales (equivale a la colección 'races' de Firestore)
CREATE TABLE IF NOT EXISTS races (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  abbrev        TEXT,
  "uciCategory" TEXT,
  gender        TEXT,
  "raceFormat"  TEXT,
  "countryCode" TEXT,
  "colorHex"    TEXT,
  "logoUrl"     TEXT,
  "hideFlag"    BOOLEAN NOT NULL DEFAULT false,
  "isGrandTour" BOOLEAN NOT NULL DEFAULT false,
  "isNoClickable" BOOLEAN NOT NULL DEFAULT false,
  "isCancelled" BOOLEAN NOT NULL DEFAULT false,
  "startDate"   TEXT,    -- YYYY-MM-DD
  "endDate"     TEXT,    -- YYYY-MM-DD
  year          INTEGER,
  slug          TEXT UNIQUE,
  "createdAt"   TIMESTAMPTZ DEFAULT now()
);

-- race_days: jornadas/etapas individuales (colección 'race_days' de Firestore)
CREATE TABLE IF NOT EXISTS race_days (
  id                        TEXT PRIMARY KEY,
  "raceId"                  TEXT REFERENCES races(id),
  "dateKey"                 TEXT NOT NULL,   -- YYYY-MM-DD
  date                      TEXT,
  slug                      TEXT UNIQUE,
  "isRestDay"               BOOLEAN NOT NULL DEFAULT false,
  "isCancelledDay"          BOOLEAN NOT NULL DEFAULT false,
  "stageNumber"             INTEGER,
  "startLocation"           TEXT,
  "finishLocation"          TEXT,
  "distanceKm"              NUMERIC,
  "primaryType"             TEXT,
  "secondaryType"           TEXT,
  "neutralStartTimeUtc"     TIMESTAMPTZ,
  "estimatedFinishTimeUtc"  TIMESTAMPTZ,
  "tvStatus"                TEXT,
  description               TEXT,
  bonuses                   TEXT,
  notes                     TEXT,
  "editorialStatus"         TEXT NOT NULL DEFAULT 'draft',
  "hasAssets"               BOOLEAN NOT NULL DEFAULT false,
  "updatedAt"               TIMESTAMPTZ DEFAULT now()
);

-- broadcasts: retransmisiones de TV/streaming
--   Equivale a la subcolección race_days/{id}/broadcasts en Firestore
CREATE TABLE IF NOT EXISTS broadcasts (
  id             TEXT PRIMARY KEY,
  "raceDayId"    TEXT NOT NULL REFERENCES race_days(id) ON DELETE CASCADE,
  channel        TEXT,
  "startTimeUtc" TIMESTAMPTZ,
  url            TEXT,
  note           TEXT
);

-- assets: documentos de carrera (perfiles, mapas, rutómetros, etc.)
--   Equivale a la subcolección race_days/{id}/assets en Firestore
CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  "raceDayId"  TEXT NOT NULL REFERENCES race_days(id) ON DELETE CASCADE,
  type         TEXT,            -- 'roadbook','profile','ports','map','live_text'
  "sourceType" TEXT DEFAULT 'external',
  url          TEXT
);

-- challenge_groups: grupos de challenge (series de carreras)
CREATE TABLE IF NOT EXISTS challenge_groups (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE,
  gender        TEXT,
  year          INTEGER,
  "uciCategory" TEXT DEFAULT '1.1',
  "countryCode" TEXT,
  "colorHex"    TEXT,
  "logoUrl"     TEXT,
  "raceIds"     TEXT[] DEFAULT '{}',
  "updatedAt"   TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────
--  ÍNDICES (aceleran las queries más frecuentes)
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_race_days_datekey
  ON race_days ("dateKey");

CREATE INDEX IF NOT EXISTS idx_race_days_raceid
  ON race_days ("raceId");

CREATE INDEX IF NOT EXISTS idx_race_days_editorial_datekey
  ON race_days ("editorialStatus", "dateKey");

CREATE INDEX IF NOT EXISTS idx_race_days_editorial_raceid
  ON race_days ("editorialStatus", "raceId");

CREATE INDEX IF NOT EXISTS idx_races_year
  ON races (year);

CREATE INDEX IF NOT EXISTS idx_races_slug
  ON races (slug);

CREATE INDEX IF NOT EXISTS idx_races_startdate
  ON races ("startDate");

CREATE INDEX IF NOT EXISTS idx_race_days_slug
  ON race_days (slug);

CREATE INDEX IF NOT EXISTS idx_broadcasts_racedayid
  ON broadcasts ("raceDayId");

CREATE INDEX IF NOT EXISTS idx_assets_racedayid
  ON assets ("raceDayId");

CREATE INDEX IF NOT EXISTS idx_challenge_groups_slug
  ON challenge_groups (slug);

-- ─────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE races           ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_days       ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcasts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_groups ENABLE ROW LEVEL SECURITY;

-- Lectura pública: cualquiera puede leer
CREATE POLICY "public_read_races"
  ON races FOR SELECT USING (true);

CREATE POLICY "public_read_race_days"
  ON race_days FOR SELECT USING (true);

CREATE POLICY "public_read_broadcasts"
  ON broadcasts FOR SELECT USING (true);

CREATE POLICY "public_read_assets"
  ON assets FOR SELECT USING (true);

CREATE POLICY "public_read_challenge_groups"
  ON challenge_groups FOR SELECT USING (true);

-- Escritura: solo usuarios autenticados (panel admin)
CREATE POLICY "auth_write_races"
  ON races FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_write_race_days"
  ON race_days FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_write_broadcasts"
  ON broadcasts FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_write_assets"
  ON assets FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_write_challenge_groups"
  ON challenge_groups FOR ALL USING (auth.uid() IS NOT NULL);
