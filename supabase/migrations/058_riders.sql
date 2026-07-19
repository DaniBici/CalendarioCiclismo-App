-- ═══════════════════════════════════════════════════════════════════
--  RIDERS — Base de datos canónica de corredores.
--  Dos tablas separadas (masculino / femenino) para simplificar
--  queries y permisos. El matching se realiza en el cliente (panel).
-- ═══════════════════════════════════════════════════════════════════

-- ─── Columnas nuevas en teams ────────────────────────────────────
-- category: categoría UCI del equipo
--   WT (WorldTour masc) | WWT (WorldTour fem)
--   PT (ProTeam masc)   | PRW (ProTeam fem)
--   CT (Continental masc)| CTW (Continental fem)
--   CLUBM (Club masc)   | CLUBW (Club fem)
--   NTM (Selección masc)| NTW (Selección fem)
-- gender: 'male' | 'female' (simplifica queries sin parsear category)
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS gender   TEXT;

-- ─── riders_men ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riders_men (
  id              TEXT PRIMARY KEY,
  "firstName"     TEXT NOT NULL,
  "lastName"      TEXT NOT NULL,
  -- Alias separados por coma: segundos apellidos, variantes ortográficas,
  -- abreviaturas — usados para matching cuando una startlist usa formas
  -- alternativas del nombre. Ej: "Cano" para "Rodríguez Cano".
  "otherNames"    TEXT,
  nationality     TEXT,                    -- ISO 3166-1 alpha-2: "es", "fr"
  "birthDate"     DATE,
  "currentTeamId" TEXT REFERENCES teams(id) ON DELETE SET NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_riders_men_lastname
  ON riders_men (lower("lastName"));

CREATE INDEX IF NOT EXISTS idx_riders_men_team
  ON riders_men ("currentTeamId");

-- ─── riders_women ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS riders_women (
  id              TEXT PRIMARY KEY,
  "firstName"     TEXT NOT NULL,
  "lastName"      TEXT NOT NULL,
  "otherNames"    TEXT,
  nationality     TEXT,
  "birthDate"     DATE,
  "currentTeamId" TEXT REFERENCES teams(id) ON DELETE SET NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_riders_women_lastname
  ON riders_women (lower("lastName"));

CREATE INDEX IF NOT EXISTS idx_riders_women_team
  ON riders_women ("currentTeamId");

-- ─── Link opcional desde startlist_riders ────────────────────────
-- Sin FK constraint: puede referenciar riders_men o riders_women
-- según races.gender. Se infiere en el join por aplicación.
ALTER TABLE startlist_riders
  ADD COLUMN IF NOT EXISTS "globalRiderId" TEXT;

-- ─── RLS ─────────────────────────────────────────────────────────
ALTER TABLE riders_men   ENABLE ROW LEVEL SECURITY;
ALTER TABLE riders_women ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_riders_men"
  ON riders_men FOR SELECT USING (true);

CREATE POLICY "auth_write_riders_men"
  ON riders_men FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "public_read_riders_women"
  ON riders_women FOR SELECT USING (true);

CREATE POLICY "auth_write_riders_women"
  ON riders_women FOR ALL USING (auth.uid() IS NOT NULL);
