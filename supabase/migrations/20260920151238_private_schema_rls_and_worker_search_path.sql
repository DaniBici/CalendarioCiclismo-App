-- RLS de defensa en profundidad para tablas internas antes protegidas por
-- esquema privado y GRANTs. Se preserva el acceso explícito del catálogo UCI.
DO $migration$
DECLARE
  t record;
  v_relid oid;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('cx_repair_dob_offbyone_backup'),
      ('historical_identity_batches'),
      ('historical_identity_changes'),
      ('historical_participation_decisions'),
      ('historical_rider_promotions_20260915_backup'),
      ('historical_rider_repairs_20260907_backup'),
      ('historical_team_roster_observations'),
      ('repair_flandes_link_20260918_backup'),
      ('repair_manual_dataride_links_20260913_backup'),
      ('repair_team_dups_gatineau_20260916_backup'),
      ('repair_tour_istanbul_stage4_20260906_backup'),
      ('repair_vuelta_20260905_stage3_kirsch_backup'),
      ('repair_zlm_20260906_publication_backup'),
      ('rider_identity_merge_backup_20260905'),
      ('rider_uci_profile_aliases'),
      ('special_edition_team_name_sync_20260905_backup'),
      ('team_season_2027_name_sync_20260905_backup'),
      ('trainee_import_batches'),
      ('uci_catalog_baselines'),
      ('uci_catalog_cases'),
      ('uci_catalog_changes'),
      ('uci_catalog_control'),
      ('uci_catalog_decisions'),
      ('uci_catalog_rider_exclusions'),
      ('uci_catalog_runs'),
      ('uci_catalog_team_links'),
      ('uci_rider_verification_backup_20260905'),
      ('uci_team_curated_names_20260905_backup'),
      ('uci_team_officialization_20260905_backup'),
      ('uci_team_rankings_name_link_repair_20260906_backup')
    ) AS listed(table_name)
  LOOP
    v_relid := pg_catalog.to_regclass(pg_catalog.format('private.%I', t.table_name));
    IF v_relid IS NOT NULL THEN
      IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_relid) THEN
        EXECUTE pg_catalog.format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY', t.table_name);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'private'
          AND p.tablename = t.table_name
          AND p.policyname = 'deny_client_roles'
      ) THEN
        EXECUTE pg_catalog.format(
          'CREATE POLICY deny_client_roles ON private.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
          t.table_name
        );
      END IF;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'private'
      AND tablename = 'uci_catalog_rider_exclusions'
      AND policyname = 'cc_uci_catalog_owner_read'
  ) THEN
    EXECUTE 'CREATE POLICY cc_uci_catalog_owner_read ON private.uci_catalog_rider_exclusions FOR SELECT TO cc_uci_catalog_owner USING (true)';
  END IF;
END;
$migration$;

-- La RPC del worker usa relaciones no cualificadas tras las llamadas al
-- importador; pg_temp queda al final para impedir su prioridad implícita.
ALTER FUNCTION public.vps_import_tissot_startlist(jsonb)
  SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp';
