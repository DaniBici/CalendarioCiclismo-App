-- Ejecutar por MCP en una transacción con ROLLBACK. No conserva filas de prueba.
DO $$
DECLARE
  race_id text := gen_random_uuid()::text;
  day_id text := gen_random_uuid()::text;
  stage_id text := gen_random_uuid()::text;
  event_id integer := -2147483000 + floor(random()*500)::integer;
  base timestamptz := now()-interval '5 hours';
  obs jsonb := '{"provider":"tissot","format":"progressive"}';
  minute integer; reads integer;
BEGIN
  INSERT INTO public.races (id,name,"raceFormat","startDate","endDate")
    VALUES (race_id,'Prueba transaccional de estabilidad','stage_race',base::date::text,base::date::text);
  INSERT INTO public.race_days (id,"raceId","dateKey","editorialStatus","stageNumber","estimatedFinishTimeUtc")
    VALUES (day_id,race_id,base::date::text,'published',1,base-interval '1 hour');
  INSERT INTO public.race_uci_stages (id,"raceId","raceDayId","competitionId","uciRaceId","eventId","classKind","stageNumber")
    VALUES (stage_id,race_id,day_id,event_id,event_id,event_id,'stage',1);
  INSERT INTO public.race_uci_results (id,"stageRef","raceId","eventId",bib,rank,"timeText","sortOrder")
    VALUES (event_id,stage_id,race_id,event_id,'1',1,'1:00:00',1);

  -- Falta de censo: lecturas válidas repetidas bastan, pero nunca antes de 30 min.
  FOREACH minute IN ARRAY ARRAY[0,10,20,29] LOOP
    PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+minute*interval '1 minute'));
    IF (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=stage_id)<>'provisional'
      THEN RAISE EXCEPTION 'Cierre prematuro a los % minutos',minute; END IF;
  END LOOP;
  PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+interval '30 minutes'));
  IF (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=stage_id)<>'official'
    THEN RAISE EXCEPTION 'No cerró al completar 30 minutos'; END IF;
  SELECT "stableReads" INTO reads FROM private.result_publication_state WHERE "stageRef"=stage_id;
  PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+interval '30 minutes'));
  IF (SELECT "stableReads" FROM private.result_publication_state WHERE "stageRef"=stage_id)<>reads
    THEN RAISE EXCEPTION 'Reaplicar el archivo contó como lectura'; END IF;

  -- Una corrección devuelve el cuadro a Provisional y reinicia los 30 minutos.
  UPDATE public.race_uci_results SET "timeText"='1:00:01' WHERE "stageRef"=stage_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se ignoró una edición sin observación'; END IF;
  PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+interval '31 minutes'));
  IF (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=stage_id)<>'provisional'
    OR (SELECT "changedAt" FROM private.result_publication_state WHERE "stageRef"=stage_id)<>base+interval '31 minutes'
    THEN RAISE EXCEPTION 'La corrección no reinició el estado'; END IF;
  FOREACH minute IN ARRAY ARRAY[41,51,61] LOOP
    PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+minute*interval '1 minute'));
  END LOOP;
  IF NOT private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'No se estabilizó la corrección'; END IF;

  -- El cierre requiere lecturas después de meta; no basta con un cuadro previo.
  UPDATE public.race_days SET "estimatedFinishTimeUtc"=base+interval '50 minutes' WHERE id=day_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se cerró antes de meta +30'; END IF;
  UPDATE public.race_days SET "estimatedFinishTimeUtc"=NULL WHERE id=day_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se cerró sin meta conocida'; END IF;
  UPDATE public.race_days SET "estimatedFinishTimeUtc"=base-interval '1 hour',"raceStatus"='running' WHERE id=day_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se cerró una etapa marcada en curso'; END IF;
  UPDATE public.race_days SET "raceStatus"=NULL,"isCancelledDay"=true WHERE id=day_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se cerró una etapa cancelada'; END IF;
  UPDATE public.race_days SET "isCancelledDay"=false WHERE id=day_id;
  UPDATE public.race_uci_stages SET "lockedAt"=now() WHERE id=stage_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se ignoró el candado editorial'; END IF;
  UPDATE public.race_uci_stages SET "lockedAt"=NULL WHERE id=stage_id;

  -- La lista inicial no impide cerrar Tissot si omite un inscrito sin puesto.
  -- Un censo independiente verificado y las señales del proveedor sí lo impiden.
  UPDATE private.result_publication_state SET expected='["1","2"]',complete=false WHERE "stageRef"=stage_id;
  IF NOT private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'La lista inicial bloqueó Tissot estabilizado'; END IF;
  UPDATE private.result_publication_state SET evidence=evidence||'{"expectedVerified":true}'::jsonb WHERE "stageRef"=stage_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se cerró con participantes conocidos ausentes'; END IF;
  UPDATE private.result_publication_state SET expected=NULL,evidence=obs||'{"sourceStatus":"incomplete"}' WHERE "stageRef"=stage_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se ignoró la señal incompleta'; END IF;
  UPDATE private.result_publication_state SET evidence=obs||'{"sourceStatus":"provisional"}' WHERE "stageRef"=stage_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se ignoró la señal provisional'; END IF;
  UPDATE private.result_publication_state SET evidence=obs WHERE "stageRef"=stage_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se cerró sin fecha de adquisición'; END IF;
  UPDATE private.result_publication_state SET evidence=obs||jsonb_build_object('observedAt',"observedAt") WHERE "stageRef"=stage_id;
  UPDATE public.race_uci_results SET rank=2 WHERE "stageRef"=stage_id;
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Se cerró sin ganador'; END IF;
  UPDATE public.race_uci_results SET rank=1 WHERE "stageRef"=stage_id;

  -- Un fallo o una pausa larga de sondeo no se convierten en estabilidad.
  PERFORM public.invalidate_result_observations(race_id,'tissot',1);
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'El fallo contó como silencio estable'; END IF;
  PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+interval '62 minutes'));
  IF (SELECT "stableReads" FROM private.result_publication_state WHERE "stageRef"=stage_id)<>1
    THEN RAISE EXCEPTION 'No reinició las lecturas tras el fallo'; END IF;
  PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+interval '92 minutes'));
  IF (SELECT "stableReads" FROM private.result_publication_state WHERE "stageRef"=stage_id)<>1
    THEN RAISE EXCEPTION 'Una pausa de media hora contó como lectura continua'; END IF;

  -- Todas las fuentes live aplican también la invalidación de cuadros ausentes.
  obs := '{"provider":"evodata","format":"progressive"}';
  FOREACH minute IN ARRAY ARRAY[100,110,120,130] LOOP
    PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+minute*interval '1 minute'));
  END LOOP;
  IF NOT private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'EvoData no se estabilizó'; END IF;
  PERFORM public.invalidate_missing_result_observations(race_id,'evodata','[{"stageNumber":1,"sectorIndex":0}]','{}'::bigint[]);
  IF private.result_can_auto_finalize(stage_id) THEN RAISE EXCEPTION 'Un cuadro ausente conservó estabilidad'; END IF;
  FOREACH minute IN ARRAY ARRAY[131,141,151,161] LOOP
    PERFORM public.record_result_observation(stage_id,obs||jsonb_build_object('observedAt',base+minute*interval '1 minute'));
  END LOOP;
  UPDATE public.race_uci_stages SET "publicationStatus"='provisional' WHERE id=stage_id;
  PERFORM set_config('cc.publication_test_stage',stage_id,true);
END;
$$;

-- La misma rutina del timer consolida sin nuevas descargas. El conector no
-- puede asumir cc_results_worker: sus permisos se verifican sin cambiar de rol.
SELECT public.expire_result_updating();
DO $$
BEGIN
  IF NOT has_function_privilege('cc_results_worker','private.result_source_is_live(text)','EXECUTE')
    OR NOT has_function_privilege('cc_results_worker','private.result_fingerprint(text)','EXECUTE')
    OR NOT has_function_privilege('cc_results_worker','private.result_can_auto_finalize(text)','EXECUTE')
    OR NOT has_function_privilege('cc_results_worker','public.expire_result_updating()','EXECUTE')
    THEN RAISE EXCEPTION 'Faltan permisos del trabajador'; END IF;
  IF (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=current_setting('cc.publication_test_stage'))<>'official'
    THEN RAISE EXCEPTION 'El timer no consolidó la estabilidad registrada'; END IF;
  PERFORM public.record_result_observation(current_setting('cc.publication_test_stage'),
    jsonb_build_object('provider','evodata','format','progressive','observedAt',now()));
  IF (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=current_setting('cc.publication_test_stage'))<>'provisional'
    THEN RAISE EXCEPTION 'Una pausa de captación no reinició la estabilidad'; END IF;
  PERFORM public.record_result_observation(current_setting('cc.publication_test_stage'),
    jsonb_build_object('provider','pdf','format','pdf','observedAt',now()));
  IF (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=current_setting('cc.publication_test_stage'))<>'official'
    THEN RAISE EXCEPTION 'El PDF oficial no conservó su cierre inmediato'; END IF;
END;
$$;


-- La lista inicial no bloquea jornadas posteriores cuando el proveedor omite
-- abandonos. Un censo diario acreditado conserva la protección estricta.
DO $$
DECLARE
  race_id text := gen_random_uuid()::text;
  day1_id text := gen_random_uuid()::text;
  day2_id text := gen_random_uuid()::text;
  stage1_id text := gen_random_uuid()::text;
  stage2_id text := gen_random_uuid()::text;
  entry_team_id text := gen_random_uuid()::text;
  rider1_id text := gen_random_uuid()::text;
  rider2_id text := gen_random_uuid()::text;
  canonical_team_id text;
  event1 integer := -2100000000 + floor(random()*1000000)::integer;
  event2 integer := -2090000000 + floor(random()*1000000)::integer;
  base timestamptz := now()-interval '5 hours';
  obs jsonb := '{"provider":"evodata","format":"progressive"}';
  minute integer;
BEGIN
  SELECT id INTO canonical_team_id FROM public.teams LIMIT 1;
  INSERT INTO public.races (id,name,"raceFormat","startDate","endDate","startlistImportedAt","startlistProvisional")
    VALUES (race_id,'Prueba censo inicial multietapa','stage_race','2026-01-01','2026-01-02',base,false);
  INSERT INTO public.race_days (id,"raceId","dateKey","editorialStatus","stageNumber","estimatedFinishTimeUtc")
    VALUES
      (day1_id,race_id,'2026-01-01','published',1,base-interval '1 hour'),
      (day2_id,race_id,'2026-01-02','published',2,base-interval '1 hour');
  INSERT INTO public.startlist_teams (id,"raceId","teamName","teamId","isConfirmed")
    VALUES (entry_team_id,race_id,'Equipo de prueba',canonical_team_id,true);
  INSERT INTO public.startlist_riders (id,"teamId","raceId",dorsal,"firstName","lastName")
    VALUES
      (rider1_id,entry_team_id,race_id,1,'Uno','Prueba'),
      (rider2_id,entry_team_id,race_id,2,'Dos','Prueba');
  INSERT INTO public.race_uci_stages
    (id,"raceId","raceDayId","competitionId","uciRaceId","eventId","classKind","stageNumber")
    VALUES
      (stage1_id,race_id,day1_id,event1,event1,event1,'stage',1),
      (stage2_id,race_id,day2_id,event2,event2,event2,'stage',2);
  INSERT INTO public.race_uci_results (id,"stageRef","raceId","eventId",bib,rank,"timeText","sortOrder")
    VALUES
      (event1,stage1_id,race_id,event1,'1',1,'1:00:00',1),
      (event2,stage2_id,race_id,event2,'1',1,'1:00:00',1);

  PERFORM public.record_result_observation(stage1_id,obs||jsonb_build_object('observedAt',base));
  IF (SELECT jsonb_array_length(expected) FROM private.result_publication_state WHERE "stageRef"=stage1_id)<>2
    OR (SELECT complete FROM private.result_publication_state WHERE "stageRef"=stage1_id)
    THEN RAISE EXCEPTION 'La primera jornada no conservó el censo inicial incompleto'; END IF;

  FOREACH minute IN ARRAY ARRAY[0,10,20,30] LOOP
    PERFORM public.record_result_observation(stage2_id,obs||jsonb_build_object('observedAt',base+minute*interval '1 minute'));
  END LOOP;
  IF (SELECT expected FROM private.result_publication_state WHERE "stageRef"=stage2_id) IS NOT NULL
    OR (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=stage2_id)<>'official'
    THEN RAISE EXCEPTION 'La segunda jornada quedó bloqueada por la lista inicial'; END IF;

  PERFORM public.record_result_observation(stage2_id,obs||jsonb_build_object(
    'observedAt',base+interval '31 minutes',
    'expectedVerified',true,'expectedKind','bib','expectedIds',jsonb_build_array('1','2'),
    'expectedBasis','https://example.test/stage2/startlist'
  ));
  IF (SELECT jsonb_array_length(expected) FROM private.result_publication_state WHERE "stageRef"=stage2_id)<>2
    OR (SELECT complete FROM private.result_publication_state WHERE "stageRef"=stage2_id)
    OR (SELECT "publicationStatus" FROM public.race_uci_stages WHERE id=stage2_id)<>'provisional'
    THEN RAISE EXCEPTION 'El censo explícito incompleto no bloqueó la segunda jornada'; END IF;
END;
$$;
