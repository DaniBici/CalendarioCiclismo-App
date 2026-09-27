-- Backup privado del saneamiento de fichas de corredores de la temporada 2026.
-- Conserva el estado completo de cada fila antes de una modificación dirigida.
CREATE TABLE IF NOT EXISTS private.repair_season_2026_rider_enrichment_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_season_2026_rider_enrichment_backup IS
  'Backup privado y recuperable del saneamiento de nombres, fechas y nacionalidades de fichas vinculadas a startlists 2026.';

REVOKE ALL ON TABLE private.repair_season_2026_rider_enrichment_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_season_2026_rider_enrichment_backup TO service_role;
