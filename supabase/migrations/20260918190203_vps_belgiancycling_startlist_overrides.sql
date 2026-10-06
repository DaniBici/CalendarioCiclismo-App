-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260918190203, nombre vps_belgiancycling_startlist_overrides). Texto aplicado en producción, sin cambios.

-- La aplicación manual desde el VPS necesita resolver excepciones sin tocar
-- las RPC internas: la envoltura acepta overrides (riders por dorsal, teams
-- por índice) y los pasa a apply_startlist_import, que los valida y re-planifica.

CREATE OR REPLACE FUNCTION public.vps_import_belgiancycling_startlist(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_race_id    text := nullif(p_payload->>'raceId', '');
  v_doc        jsonb := coalesce(p_payload->'document', '{}'::jsonb);
  v_signature  text := nullif(p_payload->>'signature', '');
  v_provisional boolean := coalesce((p_payload->>'provisional')::boolean, false);
  v_overrides  jsonb := coalesce(p_payload->'overrides', '{}'::jsonb);
  v_report     jsonb := '{}'::jsonb;
  v_ready      boolean := false;
  v_import_id  uuid;
  v_last_sig   text;
BEGIN
  IF v_race_id IS NULL THEN
    RAISE EXCEPTION 'vps_import_belgiancycling_startlist: falta raceId';
  END IF;

  -- Misma versión ya aplicada → nada que hacer (el reemplazo provisional→
  -- oficial cambia la firma por el modo y por el Last Update de la fuente).
  IF v_signature IS NOT NULL AND jsonb_typeof(v_overrides) = 'object'
     AND (v_overrides - ARRAY['riders','teams']) = '{}'::jsonb THEN
    SELECT document->>'signature' INTO v_last_sig
      FROM private.startlist_imports
     WHERE race_id = v_race_id AND status = 'applied'
     ORDER BY created_at DESC LIMIT 1;
    IF v_last_sig IS NOT NULL AND v_last_sig = v_signature THEN
      RETURN jsonb_build_object('applied', true, 'ready', true, 'unchanged', true);
    END IF;
  END IF;

  -- Si la preparación no está lista (excepciones de identidad o de equipo),
  -- NO se aplica nada y se devuelve el informe para revisión manual.
  v_report := public.prepare_startlist_import(v_race_id, v_doc, v_provisional);
  v_ready := coalesce((v_report->>'ready')::boolean, false);
  IF v_ready THEN
    v_import_id := (v_report->>'importId')::uuid;
    v_report := v_report || jsonb_build_object(
      'apply', public.apply_startlist_import(v_import_id, v_overrides)
    );
  END IF;

  RETURN v_report || jsonb_build_object('applied', v_ready);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.vps_import_belgiancycling_startlist(jsonb) TO cc_results_worker;
