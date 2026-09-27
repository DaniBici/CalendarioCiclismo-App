-- Respaldo recuperable de la reparación del relevo mixto del Mundial 2026.
CREATE TABLE private.repair_worlds_mixed_relay_20260922_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);
ALTER TABLE private.repair_worlds_mixed_relay_20260922_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_worlds_mixed_relay_20260922_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_worlds_mixed_relay_20260922_backup TO service_role;
