-- Respaldo recuperable de la corrección de nombres de equipo truncados o
-- duplicados en las clasificaciones por equipos de la Vuelta a Bélgica y el
-- Renewi Tour 2026.
CREATE TABLE private.repair_team_display_20260926_backup (
  entity text NOT NULL, row_key text NOT NULL, row_data jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (entity,row_key)
);
ALTER TABLE private.repair_team_display_20260926_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.repair_team_display_20260926_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON private.repair_team_display_20260926_backup TO service_role;
