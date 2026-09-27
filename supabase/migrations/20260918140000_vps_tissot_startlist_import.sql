-- Ingesta automática de startlists y órdenes de salida de Tissot desde el VPS.
--
-- El runner de resultados corre como `cc_results_worker`. Para poder aplicar una
-- startlist oficial y su orden de salida sin ampliar ese rol a DML sobre las
-- tablas de inscritos, se expone una función SECURITY DEFINER que envuelve las
-- RPC existentes (`prepare_startlist_import` + `apply_startlist_import`) y escribe
-- `start_order_entries`, `race_days` y `assets` con los privilegios del definidor.
--
-- Privilegios mínimos concedidos al worker:
--   · EXECUTE de las dos RPC de startlist y de esta envoltura.
--   · SELECT de solo lectura sobre los catálogos que la resolución de identidad
--     necesita (selección/rider por UCI ID). Sin INSERT/UPDATE/DELETE.

GRANT EXECUTE ON FUNCTION public.prepare_startlist_import(text, jsonb, boolean) TO cc_results_worker;
GRANT EXECUTE ON FUNCTION public.apply_startlist_import(uuid, jsonb) TO cc_results_worker;

GRANT SELECT ON public.riders_men TO cc_results_worker;
GRANT SELECT ON public.riders_women TO cc_results_worker;
GRANT SELECT ON public.startlist_riders TO cc_results_worker;
GRANT SELECT ON public.startlist_teams TO cc_results_worker;
GRANT SELECT ON public.teams TO cc_results_worker;

-- p_payload:
-- {
--   "raceId":       "<race-id>",
--   "raceDayId":    "<race-day-id>" | null,   -- jornada del orden de salida (CRI)
--   "timezone":     "America/Toronto" | null,
--   "sourceUrl":    "https://.../startlist",
--   "document":     { raceId, expectedRiderCount, sourceUrl, teams:[{teamName,teamId?,riders:[...]}] },
--   "startOrder":   [{ "order": 1, "dorsal": 12, "startTime": "13:45:00" }] | null
-- }
-- Devuelve el informe de `prepare_startlist_import` más { applied, startOrderRows }.
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

  -- 1) Startlist oficial: sustituye la provisional. Si la preparación no está
  --    lista (excepciones de identidad), NO se toca nada y se devuelve el informe.
  v_report := public.prepare_startlist_import(v_race_id, v_doc, false);
  v_ready := coalesce((v_report->>'ready')::boolean, false);
  IF v_ready THEN
    v_import_id := (v_report->>'importId')::uuid;
    v_report := v_report || jsonb_build_object(
      'apply', public.apply_startlist_import(v_import_id, '{}'::jsonb)
    );
  END IF;

  -- 2) Orden de salida (solo CRI): borrar el lote previo de la jornada e insertar
  --    el nuevo resolviendo identidad por dorsal contra la startlist recién fijada.
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
      ON st."teamId" = sr."teamId" AND st."raceId" = sr."raceId"
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
