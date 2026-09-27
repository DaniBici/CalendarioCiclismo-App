-- Backup privado de la reparación dirigida de equipos pendientes en inscritos 2026.
-- La carga de filas y la reparación se ejecutan por MCP Supabase después del preflight.

CREATE TABLE IF NOT EXISTS private.repair_unlinked_startlist_teams_2026_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_unlinked_startlist_teams_2026_backup IS
  'Backup dirigido de startlist_teams 2026 y aliases regionales afectados por la reparación de equipos del 2026-08-30. Incluye snapshots de equipos creados para rollback controlado.';

ALTER TABLE private.repair_unlinked_startlist_teams_2026_backup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.repair_unlinked_startlist_teams_2026_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_unlinked_startlist_teams_2026_backup
  TO service_role;
