CREATE TABLE private.repair_anton_metternich_20260904_backup (
  entity_table text NOT NULL, entity_id text NOT NULL, before_row jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entity_table,entity_id)
);
ALTER TABLE private.repair_anton_metternich_20260904_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.repair_anton_metternich_20260904_backup FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.repair_anton_metternich_20260904_backup TO service_role;
