-- ═══════════════════════════════════════════════════════════════════
--  TEAMS — Equipos globales reutilizables entre carreras.
--  Se usan para "enriquecer" listas de inscritos:
--  - cabecera con color personalizado
--  - chapa (badge) estilo ciclista generada por SVG con colores propios
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS teams (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  -- Alias separados por "\n" para búsquedas alternativas (una por línea)
  "nameAliases"       TEXT,
  -- Cabecera del equipo en la tabla de inscritos
  "headerBg"          TEXT NOT NULL DEFAULT '#1f2937',
  "headerText"        TEXT NOT NULL DEFAULT '#ffffff',
  -- Colores de la chapa (badge). Todos hex #rrggbb.
  "badgeTorsoCenter"  TEXT NOT NULL DEFAULT '#ffffff',
  "badgeTorsoSides"   TEXT NOT NULL DEFAULT '#000000',
  -- Círculo interior del semicírculo superior. NULL = vacío (transparente).
  "badgeInnerCircle"  TEXT,
  "badgeShorts"       TEXT NOT NULL DEFAULT '#000000',
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_name
  ON teams (lower(name));

-- ─── startlist_teams.teamId ─────────────────────────────────────────
-- Enlace opcional al equipo global. NULL = sin match / no enriquecido.
ALTER TABLE startlist_teams
  ADD COLUMN IF NOT EXISTS "teamId" TEXT REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_startlist_teams_teamid
  ON startlist_teams ("teamId");

-- ─── races.enrichedStartlist ────────────────────────────────────────
-- Flag por carrera: true = renderizar la startlist con colores/chapas.
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS "enrichedStartlist" BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── RLS ────────────────────────────────────────────────────────────
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_teams"
  ON teams FOR SELECT USING (true);

CREATE POLICY "auth_write_teams"
  ON teams FOR ALL USING (auth.uid() IS NOT NULL);
