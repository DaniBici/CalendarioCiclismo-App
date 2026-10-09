-- Retirada de la maquinaria de ingesta del backfill 2020-2025.
-- Requisito: el VPS ejecuta ya el results-upsert.mjs sin llamadas a
-- public.resolve_historical_* (rama claude/cleanup-backfill-2020-2025-a19381).
-- Se conserva el aislamiento historicalCatalogOnly (columna, políticas,
-- private.mark_historical_catalog_row y los triggers promote_*), que aún cubre
-- 12 fichas de Morvedre 2025, 18 de ciclocross y un equipo de 2026.

-- RPC vigentes que leían las tablas del histórico.
CREATE OR REPLACE FUNCTION public.admin_get_team_roster(p_team_id text, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows jsonb;
begin
  perform private.assert_startlist_import_admin();
  if p_year not between 1900 and 2100 then
    raise exception 'Temporada no válida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.teams where id = p_team_id) then
    raise exception 'Equipo no encontrado' using errcode = 'P0002';
  end if;

  with roster_rows as (
    select
      a.id,
      a."riderId",
      a."riderGender",
      a."dateFrom",
      a."dateTo",
      a."affiliationType",
      a."sourceUrl",
      a."dateBasis",
      false as "readOnly",
      'affiliation'::text as "sourceKind",
      0 as sort_order
    from public.rider_team_affiliations a
    where a."teamId" = p_team_id and a.year = p_year

  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'riderId', "riderId",
        'riderGender', "riderGender",
        'dateFrom', "dateFrom",
        'dateTo', "dateTo",
        'affiliationType', "affiliationType",
        'sourceUrl', "sourceUrl",
        'dateBasis', "dateBasis",
        'readOnly', "readOnly",
        'sourceKind', "sourceKind"
      ) order by sort_order, "affiliationType", "riderGender", "riderId"
    ),
    '[]'::jsonb
  ) into v_rows
  from roster_rows;

  return v_rows;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_rename_rider(p_gender text, p_old_id text, p_new_id text)
 RETURNS jsonb
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
    'rider_uci_profile_aliases', v_perfiles_uci, 'uci_catalog_changes', v_cambios_uci
  );
END;
$function$;

-- Funciones de ingesta y resolución del histórico.
DROP FUNCTION public.resolve_historical_result_participations(text, text);
DROP FUNCTION public.resolve_historical_uci_results_by_name(text, text, jsonb);
DROP FUNCTION private.apply_historical_identity_chunk(text, jsonb, jsonb, jsonb);
DROP FUNCTION private.record_historical_roster_observation(text, integer, text, text, text, text, text, timestamp with time zone);
DROP FUNCTION private.record_historical_participation_decision(text, integer, bigint, bigint, text, text, text, text, text, text, text, text, jsonb, text);
DROP FUNCTION private.upsert_historical_affiliation(text, text, text, text, text, integer, text, date, date, text, text, text, timestamp with time zone, jsonb);
DROP FUNCTION private.upsert_historical_regular_affiliation(text, text, text, text, integer, date, date, text, timestamp with time zone, jsonb);
DROP FUNCTION private.upsert_historical_rider_profile(text, integer, text, text, text, text, text, text, date, text, jsonb);
DROP FUNCTION private.upsert_historical_team_season(text, integer, text, text, text, text, text, text, text, text, jsonb, jsonb);
DROP FUNCTION private.begin_historical_identity_batch(text, jsonb);
DROP FUNCTION private.finish_historical_identity_batch(text);
DROP FUNCTION private.historical_batch_guard(text);
DROP FUNCTION private.historical_current_state();
DROP FUNCTION private.resolve_rider_uci_profile(text, text);

-- Tablas de trabajo del histórico y sus respaldos exclusivos.
DROP TABLE private.historical_identity_changes;
DROP TABLE private.historical_team_roster_observations;
DROP TABLE private.historical_participation_decisions;
DROP TABLE private.historical_identity_batches;
DROP TABLE public.team_season_variants;
DROP TABLE private.hist_recreadas_20260930;
DROP TABLE private.bak_races_hist_recreadas_20260930;
DROP TABLE private.bak_giro_ciclistico_2020_20260930;
