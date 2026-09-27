-- Backup privado de la reparación dirigida de dos resultados de Yosandy Darmawan Oetomo.
CREATE TABLE IF NOT EXISTS private.repair_tour_of_samsun_20260829_yosandy_results_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_tour_of_samsun_20260829_yosandy_results_backup IS
  'Backup privado y recuperable de la reparación dirigida de los resultados de Yosandy Darmawan Oetomo en el Tour of Samsun 2026.';

REVOKE ALL ON TABLE private.repair_tour_of_samsun_20260829_yosandy_results_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_tour_of_samsun_20260829_yosandy_results_backup TO service_role;
