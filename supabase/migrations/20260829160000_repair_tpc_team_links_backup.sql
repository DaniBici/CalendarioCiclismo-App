-- Backup privado de la reparación dirigida de enlaces de equipos del TPC 2026.
CREATE TABLE IF NOT EXISTS private.repair_tpc_20260829_team_links_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_tpc_20260829_team_links_backup IS
  'Backup privado y recuperable de la reparación dirigida de enlaces de equipos del TPC en Nouvelle-Aquitaine 2026.';

REVOKE ALL ON TABLE private.repair_tpc_20260829_team_links_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_tpc_20260829_team_links_backup TO service_role;
