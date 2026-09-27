-- Backup privado de la limpieza dirigida de resultados 2026.
-- La carga de snapshots y la reparación se ejecutan por MCP Supabase después del preflight.

CREATE TABLE IF NOT EXISTS private.repair_global_results_cleanup_20260830_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_global_results_cleanup_20260830_backup IS
  'Backup dirigido de filas de race_uci_results afectadas por la limpieza global de resultados del 2026-08-30. Incluye snapshots para rollback controlado.';

ALTER TABLE private.repair_global_results_cleanup_20260830_backup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.repair_global_results_cleanup_20260830_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_global_results_cleanup_20260830_backup
  TO service_role;
