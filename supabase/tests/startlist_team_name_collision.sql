-- Ejecutar mediante MCP después de la migración. No conserva datos de prueba.
BEGIN;
DO $$
DECLARE
  race_id text := gen_random_uuid()::text;
  wt_id text := 'test_col_wt_' || gen_random_uuid()::text;
  ct_id text := 'test_col_ct_' || gen_random_uuid()::text;
  v_doc jsonb;
  v_report jsonb;
  v_year integer := extract(year FROM current_date)::int;
BEGIN
  INSERT INTO public.races (id,name,gender,"startDate","endDate")
    VALUES (race_id,'Carrera de prueba de colisión','male','2099-05-01','2099-05-01');
  INSERT INTO public.teams (id,name,category,gender) VALUES
    (wt_id,'Colisión Prueba','WT','male'),
    (ct_id,'Colisión Prueba','CT','male');
  v_doc := jsonb_build_object('raceId',race_id,'expectedRiderCount',1,'teams',
    jsonb_build_array(jsonb_build_object('teamName','Colisión Prueba','riders',
      jsonb_build_array(jsonb_build_object('dorsal',1,'firstName','Colision','lastName','Pruebaxx',
        'countryCode','es','birthDate','1990-01-01')))));

  -- Mismo nombre canónico WT/CT: ambigüedad de marca y colisión de catálogo.
  v_report := public.prepare_startlist_import(race_id,v_doc,false);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_report->'issues') i
      WHERE i->>'code'='AMBIGUOUS_TEAM' AND i->'candidateIds' ? wt_id AND i->'candidateIds' ? ct_id) THEN
    RAISE EXCEPTION 'Falta la ambigüedad de marca esperada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_report->'issues') i
      WHERE i->>'code'='TEAM_ALIAS_COLLISION' AND i->>'worldTeamId'=wt_id AND i->>'continentalId'=ct_id) THEN
    RAISE EXCEPTION 'Falta el informe de colisión WT/CT';
  END IF;
  IF (v_report->>'ready')::boolean THEN RAISE EXCEPTION 'La colisión debe bloquear la aplicación'; END IF;

  -- Saneado el nombre continental: sin colisión y sin ambigüedad.
  UPDATE public.teams SET name='Colisión Prueba Development Team' WHERE id=ct_id;
  v_report := public.prepare_startlist_import(race_id,v_doc,false);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_report->'issues') i
      WHERE i->>'code'='AMBIGUOUS_TEAM') THEN
    RAISE EXCEPTION 'La filial con marcador sigue siendo ambigua por marca';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_report->'issues') i
      WHERE i->>'code'='TEAM_ALIAS_COLLISION') THEN
    RAISE EXCEPTION 'El marcador de filial no debe reportar colisión';
  END IF;

  -- Nombre continental diferenciado: lista lista.
  UPDATE public.teams SET name='Colisión Prueba CT' WHERE id=ct_id;
  v_report := public.prepare_startlist_import(race_id,v_doc,false);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_report->'issues') i
      WHERE i->>'code' IN ('TEAM_ALIAS_COLLISION','AMBIGUOUS_TEAM')) THEN
    RAISE EXCEPTION 'El saneado del nombre sigue produciendo avisos de equipo';
  END IF;
  IF NOT (v_report->>'ready')::boolean THEN RAISE EXCEPTION 'La lista sana debe quedar lista'; END IF;

  -- Alias estacional de marca compartida: ambigüedad de rutina, sin colisión.
  INSERT INTO public.team_name_aliases (id,"teamId",alias,"foldedName",year,source)
    VALUES (gen_random_uuid()::text,ct_id,'Colisión Prueba',public.fold_team_name('Colisión Prueba'),v_year,'test');
  v_report := public.prepare_startlist_import(race_id,v_doc,false);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_report->'issues') i
      WHERE i->>'code'='AMBIGUOUS_TEAM') THEN
    RAISE EXCEPTION 'El alias de marca debe seguir produciendo ambigüedad resolvable';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_report->'issues') i
      WHERE i->>'code'='TEAM_ALIAS_COLLISION') THEN
    RAISE EXCEPTION 'El alias benigno de marca no debe reportar colisión';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'Colisión WT/CT bloqueante, saneo por renombrado y alias benigno sin colisión: comprobados sin conservar fixtures' AS result;
