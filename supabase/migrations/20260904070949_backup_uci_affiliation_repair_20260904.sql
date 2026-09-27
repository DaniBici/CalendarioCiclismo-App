-- Backup dirigido de la reparación de afiliaciones UCI 2026.
CREATE TABLE private.uci_affiliation_repair_20260904_backup (
  table_name text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, row_id)
);
COMMENT ON COLUMN private.uci_affiliation_repair_20260904_backup.row_data IS
  'NULL identifica una fila creada por esta operación y ausente antes del cambio.';
ALTER TABLE private.uci_affiliation_repair_20260904_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.uci_affiliation_repair_20260904_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.uci_affiliation_repair_20260904_backup TO service_role;
