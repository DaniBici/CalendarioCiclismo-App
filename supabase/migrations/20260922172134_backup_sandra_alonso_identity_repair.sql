-- Respaldo recuperable de la unificación de las fichas de Sandra Alonso.
CREATE TABLE private.repair_sandra_alonso_20260922_backup (
  entity text NOT NULL, row_key text NOT NULL, row_data jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (entity,row_key)
);
ALTER TABLE private.repair_sandra_alonso_20260922_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.repair_sandra_alonso_20260922_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON private.repair_sandra_alonso_20260922_backup TO service_role;
