-- ═══════════════════════════════════════════════════════════════════
--  STARTLISTS — Lista de inscritos por carrera
--  Cada fila = un corredor inscrito en una carrera
-- ═══════════════════════════════════════════════════════════════════

-- startlist_teams: equipos participantes en una carrera, con orden de dorsal
CREATE TABLE IF NOT EXISTS startlist_teams (
  id          TEXT PRIMARY KEY,
  "raceId"    TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  "teamName"  TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,   -- orden por dorsal del primer corredor
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- startlist_riders: corredores inscritos, asociados a un equipo
CREATE TABLE IF NOT EXISTS startlist_riders (
  id          TEXT PRIMARY KEY,
  "teamId"    TEXT NOT NULL REFERENCES startlist_teams(id) ON DELETE CASCADE,
  "raceId"    TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  dorsal      INTEGER NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName"  TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────
--  ÍNDICES
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_startlist_teams_raceid
  ON startlist_teams ("raceId");

CREATE INDEX IF NOT EXISTS idx_startlist_riders_teamid
  ON startlist_riders ("teamId");

CREATE INDEX IF NOT EXISTS idx_startlist_riders_raceid
  ON startlist_riders ("raceId");

CREATE INDEX IF NOT EXISTS idx_startlist_riders_dorsal
  ON startlist_riders ("raceId", dorsal);

-- ─────────────────────────────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE startlist_teams  ENABLE ROW LEVEL SECURITY;
ALTER TABLE startlist_riders ENABLE ROW LEVEL SECURITY;

-- Lectura pública
CREATE POLICY "public_read_startlist_teams"
  ON startlist_teams FOR SELECT USING (true);

CREATE POLICY "public_read_startlist_riders"
  ON startlist_riders FOR SELECT USING (true);

-- Escritura: solo usuarios autenticados
CREATE POLICY "auth_write_startlist_teams"
  ON startlist_teams FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_write_startlist_riders"
  ON startlist_riders FOR ALL USING (auth.uid() IS NOT NULL);
