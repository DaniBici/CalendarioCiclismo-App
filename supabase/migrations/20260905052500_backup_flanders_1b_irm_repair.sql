-- Backup recuperable para la normalización dirigida de IRM de Flanders Tomorrow Tour 1B.
CREATE TABLE private.repair_flanders_1b_irm_20260905_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_flanders_1b_irm_20260905_backup IS
  'Backup de las filas ru_384981 con DNS/DNF recibidos en ResultValue y sin irm; permite rollback por id.';

ALTER TABLE private.repair_flanders_1b_irm_20260905_backup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.repair_flanders_1b_irm_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_flanders_1b_irm_20260905_backup
  TO service_role;
