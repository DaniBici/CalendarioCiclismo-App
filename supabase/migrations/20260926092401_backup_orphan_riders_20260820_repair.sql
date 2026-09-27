-- Respaldo recuperable de la retirada de las fichas huérfanas creadas por el
-- resolutor por nombre el 20-08-2026 (de, van y cinco nombres abreviados).
CREATE TABLE private.repair_orphan_riders_20260926_backup (
  entity text NOT NULL, row_key text NOT NULL, row_data jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (entity,row_key)
);
ALTER TABLE private.repair_orphan_riders_20260926_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.repair_orphan_riders_20260926_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON private.repair_orphan_riders_20260926_backup TO service_role;
