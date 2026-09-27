CREATE TABLE private.repair_startlist_enrichment_20260904_backup (
  entity_table text NOT NULL,
  entity_id text NOT NULL,
  before_row jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_table, entity_id)
);
ALTER TABLE private.repair_startlist_enrichment_20260904_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.repair_startlist_enrichment_20260904_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON private.repair_startlist_enrichment_20260904_backup TO service_role;
COMMENT ON TABLE private.repair_startlist_enrichment_20260904_backup IS
  'Respaldo dirigido de listas históricas y dos enlaces de homónimos auditados antes de activar el enriquecimiento obligatorio el 2026-09-04.';
