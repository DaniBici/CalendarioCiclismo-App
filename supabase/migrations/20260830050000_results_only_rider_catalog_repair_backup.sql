-- Backup específico de la reparación dirigida del catálogo generado por DataRide.
-- Se conserva para permitir rollback de fichas y referencias antes de cada lote.
CREATE TABLE IF NOT EXISTS private.repair_results_only_rider_catalog_20260830_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.repair_results_only_rider_catalog_20260830_backup FROM public, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_results_only_rider_catalog_20260830_backup TO service_role;
