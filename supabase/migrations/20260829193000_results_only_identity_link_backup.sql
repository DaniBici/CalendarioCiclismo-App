-- Backup específico de la operación de enlace nominal de resultados-only.
-- La tabla se conserva para permitir rollback dirigido de los globalRiderId
-- modificados y documentar las fichas creadas durante la operación.
CREATE TABLE IF NOT EXISTS private.repair_results_only_identity_link_20260829_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.repair_results_only_identity_link_20260829_backup FROM public, anon, authenticated;
GRANT ALL ON TABLE private.repair_results_only_identity_link_20260829_backup TO service_role;
