-- ═══════════════════════════════════════════════════════════════════
--  MODELO TEMPORAL — versiones de equipo por temporada y afiliaciones
--  corredor↔equipo por año.
--
--  Hasta ahora el sistema era "foto fija": teams.name / colores / category
--  eran un único valor (el vigente) y riders_*.currentTeamId apuntaba a un
--  solo equipo, sin historia. Esto introduce dimensión temporal HACIA
--  ADELANTE (2026 y siguientes); NO se reconstruye el pasado.
--
--  - team_seasons: el equipo (teams) pasa a ser la IDENTIDAD permanente;
--    su nombre/colores/categoría de cada temporada viven aquí (1 fila/año).
--  - rider_team_affiliations: a qué equipo pertenece un corredor en una
--    temporada, con fechas opcionales para fichajes a mitad de año.
--
--  teams.* y riders_*.currentTeamId se conservan como CACHÉ del año vigente
--  (compatibilidad con web/apps actuales, que aún no leen estas tablas).
-- ═══════════════════════════════════════════════════════════════════

-- ─── team_seasons ────────────────────────────────────────────────
-- Una fila por (equipo, año). Espeja los campos de `teams` que pueden
-- cambiar de temporada a temporada. La identidad estable es teams.id.
CREATE TABLE IF NOT EXISTS team_seasons (
  id                 TEXT PRIMARY KEY,
  "teamId"           TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  year               INTEGER NOT NULL,
  -- Nombre/aliases de ESE año (p.ej. "Soudal Quick-Step" en 2024,
  -- otro nombre en 2026). El matching de startlists del año usa estos.
  name               TEXT NOT NULL,
  "nameAliases"      TEXT,
  -- Colores/maillot de la temporada (espejo de teams; mismos defaults).
  "headerBg"         TEXT NOT NULL DEFAULT '#1f2937',
  "headerText"       TEXT NOT NULL DEFAULT '#ffffff',
  "badgeTorsoCenter" TEXT NOT NULL DEFAULT '#ffffff',
  "badgeTorsoSides"  TEXT NOT NULL DEFAULT '#000000',
  "badgeInnerCircle" TEXT,
  "badgeShorts"      TEXT NOT NULL DEFAULT '#000000',
  -- Categoría UCI del año (un equipo puede ascender CT→PT→WT entre años).
  category           TEXT,
  gender             TEXT,
  translations       JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("teamId", year)
);

CREATE INDEX IF NOT EXISTS idx_team_seasons_team
  ON team_seasons ("teamId");

CREATE INDEX IF NOT EXISTS idx_team_seasons_year
  ON team_seasons (year);

-- ─── rider_team_affiliations ─────────────────────────────────────
-- A qué equipo pertenece un corredor en una temporada. dateFrom/dateTo
-- permiten modelar traspasos intra-año (equipo A hasta 30-jun, B desde
-- 1-jul → dos filas del mismo año con fechas que no solapan).
--
-- Sin FK a riders_* (igual que startlist_riders.globalRiderId): el género
-- determina la tabla. teamId sí referencia la identidad estable.
CREATE TABLE IF NOT EXISTS rider_team_affiliations (
  id            TEXT PRIMARY KEY,
  "riderId"     TEXT NOT NULL,
  "riderGender" TEXT NOT NULL,              -- 'male' | 'female' → tabla riders_*
  "teamId"      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  year          INTEGER NOT NULL,
  "dateFrom"    DATE,                        -- null = desde inicio de temporada
  "dateTo"      DATE,                        -- null = hasta fin de temporada
  source        TEXT NOT NULL DEFAULT 'manual',
  verified      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rta_rider_year
  ON rider_team_affiliations ("riderId", year);

CREATE INDEX IF NOT EXISTS idx_rta_team_year
  ON rider_team_affiliations ("teamId", year);

-- ─── RLS ─────────────────────────────────────────────────────────
ALTER TABLE team_seasons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rider_team_affiliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_team_seasons"
  ON team_seasons FOR SELECT USING (true);

CREATE POLICY "auth_write_team_seasons"
  ON team_seasons FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "public_read_rider_team_affiliations"
  ON rider_team_affiliations FOR SELECT USING (true);

CREATE POLICY "auth_write_rider_team_affiliations"
  ON rider_team_affiliations FOR ALL USING (auth.uid() IS NOT NULL);
