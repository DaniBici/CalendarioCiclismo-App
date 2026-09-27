-- Regresión de dorsales 0, equipos vacíos y fichas de ambos catálogos.
-- Ejecutar íntegra por MCP. Ninguna fila de prueba persiste.
BEGIN;
INSERT INTO public.races(id,name,gender,"year","startDate","endDate") VALUES
('zz-test-startlist-zero-20260912','Prueba sin dorsales','male',2026,'2026-09-20','2026-09-20'),
('zz-test-startlist-mixed-20260912','Prueba relevo mixto',NULL,2026,'2026-09-22','2026-09-22');
DO $$
DECLARE doc jsonb; prepared jsonb; applied jsonb; first_ids text[]; second_ids text[];
  male_id text; female_id text; national_id text;
BEGIN
  SELECT id INTO STRICT male_id FROM public.riders_men WHERE "firstName"='Remco' AND "lastName"='Evenepoel';
  SELECT id INTO STRICT female_id FROM public.riders_women WHERE "firstName"='Lotte' AND "lastName"='Kopecky';
  SELECT id INTO STRICT national_id FROM public.teams WHERE "teamKind"='selection' AND "selectionScope"='national' AND "selectionCode"='be' AND gender='male';
  doc := jsonb_build_object('raceId','zz-test-startlist-zero-20260912','expectedRiderCount',2,'teams',jsonb_build_array(
    jsonb_build_object('teamName','Belgium','teamId',national_id,'riders',jsonb_build_array(
      jsonb_build_object('rowKey','one','dorsal',0,'firstName','Remco','lastName','Evenepoel','globalRiderId',male_id),
      jsonb_build_object('rowKey','two','dorsal',0,'firstName','Zzregression20260912','lastName','Fixture','birthDate','2000-01-02','countryCode','be'))),
    jsonb_build_object('teamName','ZZ Pending Selection 20260912','riders','[]'::jsonb)));
  prepared := public.prepare_startlist_import('zz-test-startlist-zero-20260912',doc,true);
  IF NOT (prepared->>'ready')::boolean THEN RAISE EXCEPTION 'Lista sin dorsales bloqueada: %',prepared; END IF;
  applied := public.apply_startlist_import((prepared->>'importId')::uuid);
  IF applied->>'status'<>'applied' OR applied->>'riders'<>'2' OR applied->>'teams'<>'2' THEN RAISE EXCEPTION 'Aplicación sin dorsales incorrecta: %',applied; END IF;
  SELECT array_agg(id ORDER BY id) INTO first_ids FROM public.startlist_riders WHERE "raceId"='zz-test-startlist-zero-20260912';
  prepared := public.prepare_startlist_import('zz-test-startlist-zero-20260912',doc,true);
  applied := public.apply_startlist_import((prepared->>'importId')::uuid);
  SELECT array_agg(id ORDER BY id) INTO second_ids FROM public.startlist_riders WHERE "raceId"='zz-test-startlist-zero-20260912';
  IF first_ids IS DISTINCT FROM second_ids THEN RAISE EXCEPTION 'No conserva filas sin dorsal'; END IF;
  -- Un mismo id puede existir en ambos catálogos; el género explícito debe resolverlo.
  INSERT INTO public.riders_men(id,"firstName","lastName",nationality) VALUES(female_id,'Zzcollision20260912','Fixture','be');
  doc := jsonb_build_object('raceId','zz-test-startlist-mixed-20260912','expectedRiderCount',2,'teams',jsonb_build_array(
    jsonb_build_object('teamName','Belgium','teamId',national_id,'riders',jsonb_build_array(
      jsonb_build_object('rowKey','male','dorsal',0,'firstName','Remco','lastName','Evenepoel','globalRiderId',male_id),
      jsonb_build_object('rowKey','female','riderGender','female','dorsal',0,'firstName','Lotte','lastName','Kopecky','globalRiderId',female_id)))));
  BEGIN
    PERFORM private.plan_startlist_import('zz-test-startlist-mixed-20260912',
      jsonb_set(doc,'{teams,0,riders,1}',(doc#>'{teams,0,riders,1}')-'riderGender'));
    RAISE EXCEPTION 'Acepta una ficha ambigua sin catálogo explícito';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Una lista mixta requiere una ficha existente y unívoca:%' THEN RAISE; END IF;
  END;
  prepared := public.prepare_startlist_import('zz-test-startlist-mixed-20260912',doc,true);
  applied := public.apply_startlist_import((prepared->>'importId')::uuid);
  IF applied->>'status'<>'applied' OR applied->>'createdRiders'<>'0' THEN RAISE EXCEPTION 'Relevo mixto incorrecto: %',applied; END IF;
  IF (SELECT count(*) FROM public.startlist_riders_resolved WHERE "raceId"='zz-test-startlist-mixed-20260912' AND "birthDate" IS NOT NULL AND race_gender IN ('male','female'))<>2
    OR NOT EXISTS(SELECT 1 FROM public.startlist_riders_resolved WHERE "raceId"='zz-test-startlist-mixed-20260912' AND "globalRiderId"=female_id AND race_gender='female') THEN
    RAISE EXCEPTION 'La vista no resuelve ambos catálogos';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'OK: dorsales 0, equipos vacíos, conservación y relevo mixto' AS result;
