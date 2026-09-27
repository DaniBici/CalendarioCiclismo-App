-- Orden de salida por EQUIPOS (CRE / relevo mixto) en la RPC de startlists del VPS.
--
-- En una CRE la startlist de Tissot son filas de equipo y el orden es por equipo:
-- `rank` = orden y `value` = hora local. `start_order_entries` se rellena con
-- `dorsal=0`, `riderId`/`riderName`/`countryCode` NULL y el `teamName` cruzado
-- contra `startlist_teams` por nombre normalizado (sin acentos ni separadores); si
-- no casa, se usa el nombre publicado con iniciales. El payload añade
-- `startOrderTeams: [{order, teamName, startTime}]`; `startOrder` sigue siendo el
-- de las CRI individuales.

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
  v_sot        jsonb := p_payload->'startOrderTeams';
  v_race_day   text := nullif(p_payload->>'raceDayId', '');
  v_tz         text := nullif(p_payload->>'timezone', '');
  v_report     jsonb := '{}'::jsonb;
  v_ready      boolean := false;
  v_import_id  uuid;
  v_so_rows    integer := 0;
  v_n          integer := 0;
  v_slug       text;
  v_asset_url  text;
  v_has_so     boolean;
  v_has_sot    boolean;
BEGIN
  IF v_race_id IS NULL THEN
    RAISE EXCEPTION 'vps_import_tissot_startlist: falta raceId';
  END IF;

  v_has_so  := v_so  IS NOT NULL AND jsonb_typeof(v_so)  = 'array' AND jsonb_array_length(v_so)  > 0;
  v_has_sot := v_sot IS NOT NULL AND jsonb_typeof(v_sot) = 'array' AND jsonb_array_length(v_sot) > 0;

  v_report := public.prepare_startlist_import(v_race_id, v_doc, false);
  v_ready := coalesce((v_report->>'ready')::boolean, false);
  IF v_ready THEN
    v_import_id := (v_report->>'importId')::uuid;
    v_report := v_report || jsonb_build_object(
      'apply', public.apply_startlist_import(v_import_id, '{}'::jsonb)
    );
  END IF;

  IF v_ready AND v_race_day IS NOT NULL AND (v_has_so OR v_has_sot) THEN
    DELETE FROM public.start_order_entries e WHERE e."raceDayId" = v_race_day;

    IF v_has_so THEN
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
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_so_rows := v_so_rows + v_n;
    END IF;

    IF v_has_sot THEN
      INSERT INTO public.start_order_entries
        (id, "raceDayId", "sortOrder", dorsal, "startTime", "riderId", "riderName", "teamName", "countryCode")
      SELECT gen_random_uuid()::text,
             v_race_day,
             coalesce((e->>'sortOrder')::int, (e->>'order')::int, 0),
             0,
             e->>'startTime',
             NULL, NULL,
             coalesce(
               (SELECT st."teamName" FROM public.startlist_teams st
                 WHERE st."raceId" = v_race_id
                   AND lower(regexp_replace(st."teamName", '[^a-zA-Z0-9]', '', 'g'))
                     = lower(regexp_replace(coalesce(e->>'teamName', ''), '[^a-zA-Z0-9]', '', 'g'))
                 LIMIT 1),
               initcap(lower(e->>'teamName'))),
             NULL
      FROM jsonb_array_elements(v_sot) AS e
      WHERE e->>'startTime' IS NOT NULL AND coalesce(e->>'teamName', '') <> '';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_so_rows := v_so_rows + v_n;
    END IF;

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
