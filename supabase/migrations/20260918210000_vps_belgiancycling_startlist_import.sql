-- Ingesta automática de la lista de inscritos de Belgian Cycling desde el VPS.
--
-- Carril independiente del de Tissot: el PDF «DEELNEMERSLIJST - LISTE DES
-- PARTANTS» no aporta UCI ID ni nacionalidad, así que la resolución de
-- identidad y equipos vive en las RPC genéricas de startlist. Esta envoltura
-- SECURITY DEFINER solo prepara y aplica el documento; no gestiona órdenes de
-- salida (fuente sin CRI/CRE). Privilegio mínimo del worker: EXECUTE aquí; los
-- SELECT de catálogo ya están concedidos por 20260918140000.

CREATE OR REPLACE FUNCTION public.vps_import_belgiancycling_startlist(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_race_id    text := nullif(p_payload->>'raceId', '');
  v_doc        jsonb := coalesce(p_payload->'document', '{}'::jsonb);
  v_report     jsonb := '{}'::jsonb;
  v_ready      boolean := false;
  v_import_id  uuid;
BEGIN
  IF v_race_id IS NULL THEN
    RAISE EXCEPTION 'vps_import_belgiancycling_startlist: falta raceId';
  END IF;

  -- Si la preparación no está lista (excepciones de identidad o de equipo),
  -- NO se aplica nada y se devuelve el informe para revisión manual.
  v_report := public.prepare_startlist_import(v_race_id, v_doc, false);
  v_ready := coalesce((v_report->>'ready')::boolean, false);
  IF v_ready THEN
    v_import_id := (v_report->>'importId')::uuid;
    v_report := v_report || jsonb_build_object(
      'apply', public.apply_startlist_import(v_import_id, '{}'::jsonb)
    );
  END IF;

  RETURN v_report || jsonb_build_object('applied', v_ready);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.vps_import_belgiancycling_startlist(jsonb) TO cc_results_worker;
