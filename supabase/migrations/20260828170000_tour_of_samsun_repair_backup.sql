-- Backup privado de la revisión dirigida de fichas y startlist del Tour of Samsun 2026.
CREATE TABLE IF NOT EXISTS private.repair_tour_of_samsun_20260828_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_tour_of_samsun_20260828_backup IS
  'Backup privado y recuperable de la revisión dirigida de fichas y startlist del Tour of Samsun 2026.';

REVOKE ALL ON TABLE private.repair_tour_of_samsun_20260828_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_tour_of_samsun_20260828_backup TO service_role;
