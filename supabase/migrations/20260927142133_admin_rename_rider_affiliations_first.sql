-- Corrige el orden de admin_rename_rider: las afiliaciones se re-vinculan y su id
-- determinista se regenera antes de re-vincular inscritos. El trigger
-- sync_startlist_rider_club_roster incorpora la ficha a la plantilla del club cuando no
-- encuentra afiliación con el riderId nuevo; con el orden anterior creaba
-- nuevo__equipo__año y la regeneración del id posterior chocaba con esa fila.

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
  v_otra text;
  v_fila boolean;
  v_ocupado boolean;
  v_compartido boolean;
  v_startlist integer;
  v_resultados integer;
  v_afiliaciones integer;
  v_afiliaciones_id integer;
  v_transferencias integer;
  v_alias integer;
  v_plantillas_hist integer;
  v_decisiones_hist integer;
  v_perfiles_uci integer;
  v_cambios_uci integer;
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
  v_otra := CASE p_gender WHEN 'male' THEN 'riders_women' ELSE 'riders_men' END;
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
  EXECUTE pg_catalog.format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_otra)
    INTO v_compartido USING p_old_id;

  IF v_compartido AND (
    EXISTS (SELECT 1 FROM public.startlist_riders s LEFT JOIN public.races r ON r.id = s."raceId"
            WHERE s."globalRiderId" = p_old_id AND COALESCE(s."riderGender", r.gender) IS NULL)
    OR EXISTS (SELECT 1 FROM public.race_uci_results x LEFT JOIN public.races r ON r.id = x."raceId"
               WHERE x."globalRiderId" = p_old_id AND r.gender IS NULL)
    OR EXISTS (SELECT 1 FROM private.historical_participation_decisions d
               LEFT JOIN public.teams t ON t.id = d."teamId"
               WHERE d."riderId" = p_old_id AND t.gender IS NULL)
  ) THEN
    RAISE EXCEPTION 'El id % existe en ambos géneros y hay referencias sin género determinable', p_old_id
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rider_team_affiliations a
    WHERE a."riderId" = p_old_id AND a."riderGender" = p_gender
      AND pg_catalog.left(a.id, pg_catalog.length(p_old_id) + 2) = p_old_id || '__'
      AND EXISTS (SELECT 1 FROM public.rider_team_affiliations o
                  WHERE o.id = p_new_id || pg_catalog.substr(a.id, pg_catalog.length(p_old_id) + 1))
  ) THEN
    RAISE EXCEPTION 'Ya existe una afiliación con el identificador regenerado para %', p_new_id
      USING ERRCODE = '23505';
  END IF;

  EXECUTE pg_catalog.format('UPDATE public.%I SET id = $1 WHERE id = $2', v_tabla)
    USING p_new_id, p_old_id;

  UPDATE public.rider_team_affiliations SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND "riderGender" = p_gender;
  GET DIAGNOSTICS v_afiliaciones = ROW_COUNT;

  UPDATE public.rider_team_affiliations
  SET id = p_new_id || pg_catalog.substr(id, pg_catalog.length(p_old_id) + 1)
  WHERE "riderId" = p_new_id AND "riderGender" = p_gender
    AND pg_catalog.left(id, pg_catalog.length(p_old_id) + 2) = p_old_id || '__';
  GET DIAGNOSTICS v_afiliaciones_id = ROW_COUNT;

  UPDATE public.startlist_riders s SET "globalRiderId" = p_new_id
  WHERE s."globalRiderId" = p_old_id
    AND (NOT v_compartido OR COALESCE(s."riderGender",
      (SELECT r.gender FROM public.races r WHERE r.id = s."raceId")) = p_gender);
  GET DIAGNOSTICS v_startlist = ROW_COUNT;

  UPDATE public.race_uci_results x SET "globalRiderId" = p_new_id
  WHERE x."globalRiderId" = p_old_id
    AND (NOT v_compartido OR (SELECT r.gender FROM public.races r WHERE r.id = x."raceId") = p_gender);
  GET DIAGNOSTICS v_resultados = ROW_COUNT;

  UPDATE public.rider_transfers SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND "riderGender" = p_gender;
  GET DIAGNOSTICS v_transferencias = ROW_COUNT;

  UPDATE public.rider_identity_aliases SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND gender = p_gender;
  GET DIAGNOSTICS v_alias = ROW_COUNT;

  UPDATE private.historical_team_roster_observations SET "riderId" = p_new_id
  WHERE "riderId" = p_old_id AND gender = p_gender;
  GET DIAGNOSTICS v_plantillas_hist = ROW_COUNT;

  UPDATE private.historical_participation_decisions d SET "riderId" = p_new_id
  WHERE d."riderId" = p_old_id
    AND (NOT v_compartido OR (SELECT t.gender FROM public.teams t WHERE t.id = d."teamId") = p_gender);
  GET DIAGNOSTICS v_decisiones_hist = ROW_COUNT;

  UPDATE private.rider_uci_profile_aliases SET "riderId" = p_new_id, "updatedAt" = pg_catalog.now()
  WHERE "riderId" = p_old_id AND "riderGender" = p_gender;
  GET DIAGNOSTICS v_perfiles_uci = ROW_COUNT;

  UPDATE private.uci_catalog_changes SET rider_id = p_new_id
  WHERE rider_id = p_old_id AND gender = p_gender;
  GET DIAGNOSTICS v_cambios_uci = ROW_COUNT;

  EXECUTE pg_catalog.format('UPDATE public.%I SET "updatedAt" = pg_catalog.now() WHERE id = $1', v_tabla)
    USING p_new_id;

  RETURN pg_catalog.jsonb_build_object(
    'table', v_tabla, 'oldId', p_old_id, 'newId', p_new_id, 'riders', 1,
    'sharedAcrossGenders', v_compartido,
    'startlist_riders', v_startlist, 'race_uci_results', v_resultados,
    'rider_team_affiliations', v_afiliaciones, 'rider_team_affiliations_ids', v_afiliaciones_id,
    'rider_transfers', v_transferencias, 'rider_identity_aliases', v_alias,
    'historical_team_roster_observations', v_plantillas_hist,
    'historical_participation_decisions', v_decisiones_hist,
    'rider_uci_profile_aliases', v_perfiles_uci, 'uci_catalog_changes', v_cambios_uci
  );
END;
$function$;

COMMENT ON FUNCTION public.admin_rename_rider(text,text,text) IS
  'Renombra el slug de una ficha de carretera y re-vincula por género inscritos, resultados, afiliaciones (con id regenerado), transferencias, alias de identidad, catálogo histórico y perfiles UCI en una transacción.';

REVOKE ALL ON FUNCTION public.admin_rename_rider(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;
GRANT EXECUTE ON FUNCTION public.admin_rename_rider(text, text, text) TO authenticated;
