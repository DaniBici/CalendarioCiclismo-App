-- Endurecimiento de RPCs privilegiadas y cierre explícito de políticas vacías.

-- La vista debe aplicar permisos y RLS del cliente. Todos sus consumidores
-- previstos conservan SELECT en las cuatro tablas subyacentes.
ALTER VIEW public.startlist_riders_resolved SET (security_invoker = true);
REVOKE ALL ON public.startlist_riders_resolved
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
GRANT SELECT ON public.startlist_riders_resolved TO anon, authenticated, service_role;

-- Solo administradores pueden renombrar fichas. search_path vacío impide que
-- objetos temporales o de otros esquemas sustituyan las relaciones públicas.
CREATE OR REPLACE FUNCTION public.admin_rename_rider(
  p_gender text,
  p_old_id text,
  p_new_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tabla text;
  v_fila boolean;
  v_ocupado boolean;
  v_startlist integer;
  v_resultados integer;
  v_afiliaciones integer;
  v_transferencias integer;
  v_alias integer;
  v_orden integer;
BEGIN
  IF NOT COALESCE(private.is_admin(), false) THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'Género inválido; usar male o female' USING ERRCODE = '22023';
  END IF;
  IF p_old_id IS NULL OR p_new_id IS NULL THEN
    RAISE EXCEPTION 'Identificadores obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_new_id = p_old_id THEN
    RAISE EXCEPTION 'El slug nuevo coincide con el actual' USING ERRCODE = '22023';
  END IF;
  IF p_new_id !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION 'Slug nuevo inválido' USING ERRCODE = '22023';
  END IF;

  v_tabla := CASE p_gender WHEN 'male' THEN 'riders_men' ELSE 'riders_women' END;
  EXECUTE pg_catalog.format('SELECT true FROM public.%I WHERE id = $1 FOR UPDATE', v_tabla)
    INTO v_fila USING p_old_id;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION 'Corredor % no encontrado', p_old_id USING ERRCODE = '22023';
  END IF;
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_tabla)
    INTO v_ocupado USING p_new_id;
  IF v_ocupado THEN
    RAISE EXCEPTION 'El slug % ya está ocupado', p_new_id USING ERRCODE = '22023';
  END IF;

  EXECUTE pg_catalog.format('UPDATE public.%I SET id = $1 WHERE id = $2', v_tabla)
    USING p_new_id, p_old_id;
  UPDATE public.startlist_riders SET "globalRiderId" = p_new_id WHERE "globalRiderId" = p_old_id;
  GET DIAGNOSTICS v_startlist = ROW_COUNT;
  UPDATE public.race_uci_results SET "globalRiderId" = p_new_id WHERE "globalRiderId" = p_old_id;
  GET DIAGNOSTICS v_resultados = ROW_COUNT;
  UPDATE public.rider_team_affiliations SET "riderId" = p_new_id WHERE "riderId" = p_old_id;
  GET DIAGNOSTICS v_afiliaciones = ROW_COUNT;
  UPDATE public.rider_transfers SET "riderId" = p_new_id WHERE "riderId" = p_old_id;
  GET DIAGNOSTICS v_transferencias = ROW_COUNT;
  UPDATE public.rider_identity_aliases SET "riderId" = p_new_id WHERE "riderId" = p_old_id;
  GET DIAGNOSTICS v_alias = ROW_COUNT;
  UPDATE public.start_order_entries SET "riderId" = p_new_id WHERE "riderId" = p_old_id;
  GET DIAGNOSTICS v_orden = ROW_COUNT;
  EXECUTE pg_catalog.format('UPDATE public.%I SET "updatedAt" = pg_catalog.now() WHERE id = $1', v_tabla)
    USING p_new_id;

  RETURN pg_catalog.jsonb_build_object(
    'table', v_tabla, 'oldId', p_old_id, 'newId', p_new_id, 'riders', 1,
    'startlist_riders', v_startlist, 'race_uci_results', v_resultados,
    'rider_team_affiliations', v_afiliaciones, 'rider_transfers', v_transferencias,
    'rider_identity_aliases', v_alias, 'start_order_entries', v_orden
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cx_rename_rider(
  p_gender text,
  p_old_id text,
  p_new_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_tabla text;
  v_fila boolean;
  v_ocupado boolean;
  v_startlist integer;
  v_resultados integer;
  v_general integer;
BEGIN
  IF NOT COALESCE(private.is_admin(), false) THEN
    RAISE EXCEPTION 'Se requieren permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'Género inválido; usar male o female' USING ERRCODE = '22023';
  END IF;
  IF p_old_id IS NULL OR p_new_id IS NULL THEN
    RAISE EXCEPTION 'Identificadores obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_new_id = p_old_id THEN
    RAISE EXCEPTION 'El slug nuevo coincide con el actual' USING ERRCODE = '22023';
  END IF;
  IF p_new_id !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION 'Slug nuevo inválido' USING ERRCODE = '22023';
  END IF;

  v_tabla := CASE p_gender WHEN 'male' THEN 'cx_riders_men' ELSE 'cx_riders_women' END;
  EXECUTE pg_catalog.format('SELECT true FROM public.%I WHERE id = $1 FOR UPDATE', v_tabla)
    INTO v_fila USING p_old_id;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION 'Corredor % no encontrado', p_old_id USING ERRCODE = '22023';
  END IF;
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_tabla)
    INTO v_ocupado USING p_new_id;
  IF v_ocupado THEN
    RAISE EXCEPTION 'El slug % ya está ocupado', p_new_id USING ERRCODE = '22023';
  END IF;

  EXECUTE pg_catalog.format('UPDATE public.%I SET id = $1 WHERE id = $2', v_tabla)
    USING p_new_id, p_old_id;
  UPDATE public.cx_startlist_riders SET "globalRiderId" = p_new_id WHERE "globalRiderId" = p_old_id;
  GET DIAGNOSTICS v_startlist = ROW_COUNT;
  UPDATE public.cx_results SET "globalRiderId" = p_new_id WHERE "globalRiderId" = p_old_id;
  GET DIAGNOSTICS v_resultados = ROW_COUNT;
  UPDATE public.cx_tournament_standings SET "globalRiderId" = p_new_id WHERE "globalRiderId" = p_old_id;
  GET DIAGNOSTICS v_general = ROW_COUNT;
  EXECUTE pg_catalog.format('UPDATE public.%I SET "updatedAt" = pg_catalog.now() WHERE id = $1', v_tabla)
    USING p_new_id;

  RETURN pg_catalog.jsonb_build_object(
    'table', v_tabla, 'oldId', p_old_id, 'newId', p_new_id, 'riders', 1,
    'cx_startlist_riders', v_startlist, 'cx_results', v_resultados,
    'cx_tournament_standings', v_general
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_rename_rider(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
REVOKE ALL ON FUNCTION public.cx_rename_rider(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
GRANT EXECUTE ON FUNCTION public.admin_rename_rider(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cx_rename_rider(text, text, text) TO authenticated;

-- resolve_uci_results se usa desde el panel y desde el worker. El control
-- interno permite solo administradores, service_role o la sesión worker.
CREATE OR REPLACE FUNCTION public.resolve_uci_results(p_race_id text)
RETURNS TABLE (matched integer, unresolved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM private.assert_startlist_import_admin();

  WITH src AS (
    SELECT r.id, sr."globalRiderId" AS gid
    FROM public.race_uci_results r
    JOIN public.race_uci_stages st ON st.id = r."stageRef"
    LEFT JOIN public.startlist_riders sr
      ON sr."raceId" = p_race_id
     AND r.bib ~ '^[0-9]+$'
     AND sr.dorsal = r.bib::integer
     AND sr."globalRiderId" IS NOT NULL
    WHERE r."raceId" = p_race_id
      AND st."isTeamEvent" = false
  )
  UPDATE public.race_uci_results r
     SET "globalRiderId" = src.gid
  FROM src
  WHERE r.id = src.id
    AND src.gid IS NOT NULL
    AND r."globalRiderId" IS DISTINCT FROM src.gid;

  SELECT
    count(*) FILTER (WHERE r."globalRiderId" IS NOT NULL)::integer,
    count(*) FILTER (WHERE r."globalRiderId" IS NULL)::integer
  INTO matched, unresolved
  FROM public.race_uci_results r
  JOIN public.race_uci_stages st ON st.id = r."stageRef"
  WHERE r."raceId" = p_race_id
    AND st."isTeamEvent" = false;

  RETURN NEXT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolve_uci_results(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results(text) TO authenticated, service_role, cc_results_worker;

-- La siembra de startlists no tiene consumidor desde clientes autenticados; solo
-- la ejecutan los procesos de ingesta confiables.
REVOKE EXECUTE ON FUNCTION public.resolve_uci_startlist(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_uci_startlist(text, text, jsonb)
  TO service_role, cc_results_worker;

-- La envoltura de Tissot solo se expone al rol del VPS; sus funciones internas
-- realizan comprobaciones adicionales, pero no se depende de ellas para el ACL.
REVOKE ALL ON FUNCTION public.vps_import_tissot_startlist(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
GRANT EXECUTE ON FUNCTION public.vps_import_tissot_startlist(jsonb) TO cc_results_worker;

-- Las RPC push son endpoints anónimos intencionados de las apps. Se eliminan
-- grants heredados de PUBLIC y se conservan solo los roles de cliente usados.
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_full(text, text, boolean, text, text[], text[], text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_push_subscription_full(text, text, boolean, text, text[], text[], text[])
  TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_v2(text, text, boolean, text, text, text[], text[], text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_push_subscription_v2(text, text, boolean, text, text, text[], text[], text[])
  TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_v2(text, text, boolean, text, text, text[], text[], text[], text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_push_subscription_v2(text, text, boolean, text, text, text[], text[], text[], text[])
  TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_v3(text, text, boolean, text, text, text, text[], text[], text[], text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_push_subscription_v3(text, text, boolean, text, text, text, text[], text[], text[], text[])
  TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_v4(text, text, boolean, text, text, text, text[], text[], text[], text[], text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_push_subscription_v4(text, text, boolean, text, text, text, text[], text[], text[], text[], text[])
  TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_push_subscription_with_categories(text, text, boolean, text, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_push_subscription_with_categories(text, text, boolean, text, text[])
  TO anon, authenticated;

-- Estos 42 objetos ya denegaban acceso por RLS sin políticas. La política
-- restrictiva hace explícito y persistente ese cierre para anon/authenticated.
DO $migration$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('private', 'add_vuelta_ecuador_missing_startlist_riders_20260908_backup'),
      ('private', 'armenia_duplicate_team_20260907_backup'),
      ('private', 'automation_runs'),
      ('private', 'automation_source_runs'),
      ('private', 'baltic_chain_estonia_team_link_20260830_backup'),
      ('private', 'broadcasts_manual_queue'),
      ('private', 'cjk_names_repair_20260904_backup'),
      ('private', 'normalize_rider_names_20260917_backup'),
      ('private', 'normalize_rider_names_20260917b_backup'),
      ('private', 'normalize_uci_team_names_20260907_backup'),
      ('private', 'pending_collective_team_rastreo_20260830_backup'),
      ('private', 'pending_collective_team_rastreo_v2_20260830_backup'),
      ('private', 'repair_anton_metternich_20260904_backup'),
      ('private', 'repair_club_team_duplicates_20260903_backup'),
      ('private', 'repair_club_team_manual_decisions_20260903_backup'),
      ('private', 'repair_collective_team_links_20260830_backup'),
      ('private', 'repair_flanders_1b_irm_20260905_backup'),
      ('private', 'repair_global_results_cleanup_20260830_backup'),
      ('private', 'repair_salalah_stage3_publication_20260908_backup'),
      ('private', 'repair_sauerland_riders_20260903_backup'),
      ('private', 'repair_startlist_enrichment_20260904_backup'),
      ('private', 'repair_team_continuity_20260907_backup'),
      ('private', 'repair_team_gender_null_20260830_backup'),
      ('private', 'repair_tour_britain_fix_all_20260905_backup'),
      ('private', 'repair_tour_salalah_20260908_backup'),
      ('private', 'repair_unlinked_startlist_teams_2026_backup'),
      ('private', 'repair_visma_continuity_20260907_backup'),
      ('private', 'repair_volta_santa_catarina_names_20260902_backup'),
      ('private', 'repair_vuelta_ecuador_stage1_rider_links_20260908_backup'),
      ('private', 'repair_winspace_mayenne_20260907_backup'),
      ('private', 'repara_nombres_ven_ruta_20260911_backup'),
      ('private', 'results_manual_queue'),
      ('private', 'shanghai_biography_backup_20260904'),
      ('private', 'startlist_imports'),
      ('private', 'team_catalog_backfill_20260830_backup'),
      ('private', 'tenvels_le_devoluy_20260908_backup'),
      ('private', 'uci_affiliation_repair_20260904_backup'),
      ('private', 'venezuela_cn_remaining_short_names_20260905_backup'),
      ('private', 'venezuela_cn_rider_names_20260905_backup'),
      ('private', 'venezuela_cn_rider_short_names_20260905_backup'),
      ('public', 'repair_panama_20260824_backup'),
      ('public', 'saneo_0821_bct_stage1_bak')
    ) AS listed(schema_name, table_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = t.schema_name
        AND c.relname = t.table_name
        AND c.relrowsecurity
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname = t.schema_name AND p.tablename = t.table_name
    ) THEN
      EXECUTE pg_catalog.format(
        'CREATE POLICY deny_client_roles ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t.schema_name, t.table_name
      );
    END IF;
  END LOOP;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
