-- Copia recuperable previa a la reparación acotada del Tour of Shanghai.
CREATE TABLE private.shanghai_biography_backup_20260904 (
  table_name text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, row_id)
);
ALTER TABLE private.shanghai_biography_backup_20260904 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.shanghai_biography_backup_20260904 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.shanghai_biography_backup_20260904 TO service_role;
