-- Corrige el enlace equipo↔corredor de la RPC de startlists del VPS.
--
-- `startlist_riders."teamId"` NO referencia `startlist_teams."teamId"` (el id
-- canónico, p. ej. `team_ntm_australia`), sino `startlist_teams.id` (el UUID de
-- la fila de la lista). Con el enlace equivocado, la resolución de equipo del
-- orden de salida quedaba en `teamName` NULL. Cazado al revisar el relevo mixto,
-- donde `startlist_riders."teamId"` = `startlist_teams.id`.
--
-- `CREATE OR REPLACE` del mismo cuerpo con el JOIN corregido; sin cambios de
-- permisos (se reafirman por claridad).

CREATE OR REPLACE FUNCTION public.vps_import_tissot_startlist(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_race_id    text := nullif(p_payload->>'raceId', '');
  v_doc        jsonb := coalesce(p_payload->'document', '{}'::jsonb);
  v_so         jsonb := p_payload->'startOrder';
  v_race_day   text := nullif(p_payload->>'raceDayId', '');
  v_tz         text := nullif(p_payload->>'timezone', '');
  v_report     jsonb := '{}'::jsonb;
  v_ready      boolean := false;
  v_import_id  uuid;
  v_so_rows    integer := 0;
  v_slug       text;
  v_asset_url  text;
BEGIN
  IF v_race_id IS NULL THEN
    RAISE EXCEPTION 'vps_import_tissot_startlist: falta raceId';
  END IF;

  v_report := public.prepare_startlist_import(v_race_id, v_doc, false);
  v_ready := coalesce((v_report->>'ready')::boolean, false);
  IF v_ready THEN
    v_import_id := (v_report->>'importId')::uuid;
    v_report := v_report || jsonb_build_object(
      'apply', public.apply_startlist_import(v_import_id, '{}'::jsonb)
    );
  END IF;

  IF v_ready
     AND v_so IS NOT NULL AND jsonb_typeof(v_so) = 'array' AND jsonb_array_length(v_so) > 0
     AND v_race_day IS NOT NULL THEN
    DELETE FROM public.start_order_entries e WHERE e."raceDayId" = v_race_day;

    INSERT INTO public.start_order_entries
      (id, "raceDayId", "sortOrder", dorsal, "startTime", "riderId", "riderName", "teamName", "countryCode")
    SELECT gen_random_uuid()::text,
           v_race_day,
           coalesce((e->>'sortOrder')::int, (e->>'order')::int, 0),
           (e->>'dorsal')::int,
           e->>'startTime',
           sr."globalRiderId",
           nullif(btrim(concat_ws(' ', sr."firstName", sr."lastName")), ''),
           st."teamName",
           sr."countryCode"
    FROM jsonb_array_elements(v_so) AS e
    LEFT JOIN public.startlist_riders sr
      ON sr."raceId" = v_race_id AND sr.dorsal = (e->>'dorsal')::int
    LEFT JOIN public.startlist_teams st
      ON st.id = sr."teamId" AND st."raceId" = sr."raceId"
    WHERE e->>'startTime' IS NOT NULL
      AND e->>'dorsal' IS NOT NULL AND e->>'dorsal' <> '';
    GET DIAGNOSTICS v_so_rows = ROW_COUNT;

    UPDATE public.race_days
       SET "startOrderImportedAt" = now(),
           timezone = coalesce(v_tz, timezone),
           "hasAssets" = true
     WHERE id = v_race_day
     RETURNING slug INTO v_slug;

    DELETE FROM public.assets a
     WHERE a."raceDayId" = v_race_day AND a.type = 'startOrder';
    v_asset_url := CASE
      WHEN v_slug IS NOT NULL THEN 'https://calendariociclismo.app/orden-salida/' || v_slug || '/'
      ELSE 'https://calendariociclismo.app/orden-salida.html?id=' || v_race_day
    END;
    INSERT INTO public.assets (id, "raceDayId", type, "sourceType", url)
    VALUES (gen_random_uuid()::text, v_race_day, 'startOrder', 'external', v_asset_url);
  END IF;

  RETURN v_report || jsonb_build_object(
    'applied', v_ready,
    'startOrderRows', v_so_rows,
    'raceDayId', v_race_day
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.vps_import_tissot_startlist(jsonb) TO cc_results_worker;
