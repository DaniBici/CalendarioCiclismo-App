-- ═══════════════════════════════════════════════════════════════════
--  TEAMS — parentTeamId (vínculo a equipo base para ediciones especiales)
-- ═══════════════════════════════════════════════════════════════════
--  Las ediciones especiales (specialEdition = true) pueden vincularse
--  a su equipo base mediante este FK. Permite agruparlas en el panel
--  y distinguirlas de equipos independientes.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS "parentTeamId" TEXT REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_teams_parent_team_id
  ON teams ("parentTeamId");
