-- ═══════════════════════════════════════════════════════════════════
--  TEAMS — Campo specialEdition (ediciones especiales de Grandes Vueltas)
-- ═══════════════════════════════════════════════════════════════════

-- Añade una columna para marcar equipos de edición especial.
-- Estos equipos no podrán participar en autoasignaciones automáticas.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS "specialEdition" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_teams_special_edition
  ON teams ("specialEdition");
