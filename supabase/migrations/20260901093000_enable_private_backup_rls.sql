-- Endurece los backups privados de reparaciones que se crearon sin RLS.
--
-- El esquema private no está abierto a anon y las tablas no conceden acceso a
-- authenticated, pero RLS añade una segunda barrera si en el futuro cambia la
-- configuración de Data API o se amplían privilegios por error. Los backups
-- usados por service_role conservan sus GRANT; service_role no queda limitado
-- por RLS. El worker de resultados necesita una política explícita propia.

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'repair_clasica_azuero_20260828_backup',
    'repair_invalid_results_race_20260829_backup',
    'repair_results_only_identity_link_20260829_backup',
    'repair_results_only_rider_catalog_20260830_backup',
    'repair_season_2026_rider_enrichment_backup',
    'repair_tour_of_bulgaria_20260829_backup',
    'repair_tour_of_samsun_20260828_backup',
    'repair_tour_of_samsun_20260829_yosandy_results_backup',
    'repair_tpc_20260829_team_links_backup',
    'uci_id_drop_20260830_backup',
    'uci_license_cleanup_20260830_backup'
  ]
  LOOP
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'DROP POLICY IF EXISTS private_backup_deny_api ON private.%I',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY private_backup_deny_api ON private.%I '
      'FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      v_table
    );
  END LOOP;
END
$$;

DROP POLICY IF EXISTS cc_results_worker_backup_access
  ON private.repair_invalid_results_race_20260829_backup;
CREATE POLICY cc_results_worker_backup_access
  ON private.repair_invalid_results_race_20260829_backup
  FOR ALL TO cc_results_worker
  USING (true)
  WITH CHECK (true);
