-- Backup privado de la reparación dirigida del Tour of Bulgaria 2026.
-- No contiene datos públicos ni concede acceso a anon/authenticated.
CREATE TABLE IF NOT EXISTS private.repair_tour_of_bulgaria_20260829_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_tour_of_bulgaria_20260829_backup IS
  'Backup privado de la revisión de fichas y códigos de país del Tour of Bulgaria 2026.';

REVOKE ALL ON TABLE private.repair_tour_of_bulgaria_20260829_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_tour_of_bulgaria_20260829_backup TO service_role;
