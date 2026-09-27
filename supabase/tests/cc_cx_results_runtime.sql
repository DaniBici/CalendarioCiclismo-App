-- Cola, monitor y oficialización: datos sintéticos y cambios de rol con rollback.
BEGIN;
GRANT cc_results_worker TO postgres WITH SET TRUE;
DO $$
DECLARE rid text:=gen_random_uuid()::text; tid text:=gen_random_uuid()::text; admin_id text;
BEGIN
  SELECT user_id::text INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('cc.cx_runtime_race',rid,true);PERFORM set_config('cc.cx_runtime_tournament',tid,true);
  PERFORM set_config('cc.cx_runtime_admin',admin_id,true);
  INSERT INTO public.cx_tournaments(id,name,slug,"seasonKey","pointsScheme") VALUES(tid,'Prueba runtime',tid,'2026-27','{"categories":{"ME":{"mode":"points"}}}');
  INSERT INTO public.cx_races(id,name,slug,"seasonKey","seasonStartYear","dateKey",class,"tournamentId")
    VALUES(rid,'Prueba runtime',rid,'2026-27',2026,'2026-11-01','C2',tid);
  INSERT INTO public.cx_race_categories("raceId",category) VALUES(rid,'ME');
  INSERT INTO public.cx_race_uci_links("raceId","competitionId","seasonId") VALUES(rid,2147483001,472);
  PERFORM set_config('cc.cx_runtime_rows','[{"rank":1,"riderDisplay":"A Prueba","timeSeconds":"9007199254740993","points":"1.00","bonusSeconds":null}]',true);
  PERFORM set_config('cc.cx_runtime_evidence',jsonb_build_object('inputSource','dataride','sourceUrl','https://dataride.uci.ch/iframe/Results/',
    'seasonKey','2026-27','dateKey','2026-11-01','identityEvidence','[]'::jsonb,'lockAutomatic',false,
    'officialReviewed',true,'officialReviewSourceUrl','https://official.test/2026/results',
    'dataRide',jsonb_build_object('disciplineId',3,'seasonId',472,'competitionId',2147483001,'uciRaceId',123,'eventId',456))::text,true);
  PERFORM set_config('request.jwt.claim.sub',admin_id,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE global_request jsonb; own_request jsonb; again jsonb; rejected boolean:=false; rid text:=current_setting('cc.cx_runtime_race');
BEGIN
  global_request:=public.cx_enqueue_results_fetch();
  PERFORM set_config('cc.cx_runtime_global',global_request->>'requestId',true);
  own_request:=public.cx_enqueue_results_fetch(rid,'ME');again:=public.cx_enqueue_results_fetch(rid,'ME');
  IF jsonb_typeof(own_request->'requestId')<>'string' OR own_request->>'requestId'<>again->>'requestId' THEN
    RAISE EXCEPTION 'La solicitud pierde BIGINT o duplica una petición pendiente'; END IF;
  PERFORM set_config('cc.cx_runtime_own',own_request->>'requestId',true);
  BEGIN PERFORM public.cx_enqueue_results_fetch(rid,'WU'); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se solicita una manga ausente'; END IF;
  rejected:=false;BEGIN PERFORM public.cx_enqueue_results_fetch(NULL,'ME'); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Una categoría se solicita sin carrera'; END IF;
  rejected:=false;BEGIN PERFORM public.cx_enqueue_results_fetch('road-only-id'); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'La cola CX resuelve un ID ajeno'; END IF;
  -- Aunque ambas peticiones globales tengan IDs NULL, no se deduplican entre disciplinas.
  PERFORM private.dispatch_results_sync(NULL,NULL,true);
  PERFORM public.cx_ingest_results(rid,'ME',current_setting('cc.cx_runtime_rows')::jsonb,'official',current_setting('cc.cx_runtime_evidence')::jsonb);
END $$;
RESET ROLE;
DO $$
DECLARE global_id bigint:=current_setting('cc.cx_runtime_global')::bigint; own_id bigint:=current_setting('cc.cx_runtime_own')::bigint; road_id bigint;
BEGIN
  SELECT id INTO STRICT road_id FROM private.results_manual_queue WHERE discipline_id=10 AND race_id IS NULL AND status='pending' AND ignore_window ORDER BY id DESC LIMIT 1;
  PERFORM set_config('cc.cx_runtime_road',road_id::text,true);
  UPDATE private.results_manual_queue SET requested_at='1799-01-01' WHERE id=global_id;
  UPDATE private.results_manual_queue SET requested_at='1800-01-01' WHERE id=road_id;
  UPDATE private.results_manual_queue SET requested_at='1801-01-01' WHERE id=own_id;
  IF (SELECT count(*) FROM private.results_manual_queue WHERE id IN (global_id,own_id,road_id))<>3 THEN
    RAISE EXCEPTION 'La petición global de carretera se deduplica con CX'; END IF;
  PERFORM set_config('cc.cx_runtime_result_id',(SELECT id::text FROM public.cx_results WHERE "raceId"=current_setting('cc.cx_runtime_race')),true);
  PERFORM set_config('cc.cx_runtime_audits',(SELECT count(*)::text FROM private.cx_change_log WHERE "raceId"=current_setting('cc.cx_runtime_race')),true);
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE claimed record; result jsonb; rows jsonb:=current_setting('cc.cx_runtime_rows')::jsonb;
  evidence jsonb:=current_setting('cc.cx_runtime_evidence')::jsonb; run_id bigint; rid text:=current_setting('cc.cx_runtime_race'); rejected boolean;
BEGIN
  SELECT * INTO STRICT claimed FROM private.claim_results_manual_request();
  IF claimed.request_id<>current_setting('cc.cx_runtime_road')::bigint THEN RAISE EXCEPTION 'Carretera reclama una petición CX más antigua'; END IF;
  PERFORM private.finish_results_manual_request(claimed.request_id,true);
  SELECT * INTO STRICT claimed FROM private.claim_results_manual_request(3);
  IF claimed.request_id<>current_setting('cc.cx_runtime_global')::bigint OR claimed.race_id IS NOT NULL OR claimed.stage_number IS NOT NULL THEN
    RAISE EXCEPTION 'CX reclama un destino de carretera'; END IF;
  rejected:=false;BEGIN PERFORM private.finish_results_manual_request(claimed.request_id,true);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
  IF NOT rejected THEN RAISE EXCEPTION 'El finish legado acepta una petición CX';END IF;
  rejected:=false;BEGIN PERFORM private.finish_results_manual_request(claimed.request_id,true,NULL,3,claimed.attempts+1);EXCEPTION WHEN serialization_failure THEN rejected:=true;END;
  IF NOT rejected THEN RAISE EXCEPTION 'Un intento obsoleto finaliza una petición reclamada';END IF;
  PERFORM private.finish_results_manual_request(claimed.request_id,true,NULL,3,claimed.attempts);
  SELECT * INTO STRICT claimed FROM private.claim_results_manual_request(3);
  IF claimed.request_id<>current_setting('cc.cx_runtime_own')::bigint OR claimed.cx_race_id<>rid OR claimed.cx_category<>'ME' THEN
    RAISE EXCEPTION 'El claim pierde el alcance propio de categoría'; END IF;
  PERFORM private.finish_results_manual_request(claimed.request_id,true,NULL,3,claimed.attempts);
  rejected:=false;BEGIN PERFORM private.claim_results_manual_request(2);EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se acepta una disciplina no soportada';END IF;
  IF private.cx_results_payload_digest(rows)<>private.cx_results_payload_digest(jsonb_set(rows,'{0,points}','1')) THEN
    RAISE EXCEPTION 'La comparación semántica depende del formato NUMERIC';END IF;
  result:=public.cx_ingest_results(rid,'ME',jsonb_set(rows,'{0,points}','1'),'provisional',evidence-'officialReviewed'-'officialReviewSourceUrl');
  IF result->>'unchanged'<>'true' OR result->>'status'<>'official' OR (SELECT id FROM public.cx_results WHERE "raceId"=rid)<>current_setting('cc.cx_runtime_result_id')::bigint THEN
    RAISE EXCEPTION 'Una descarga idéntica degrada una clasificación revisada o pierde precisión';END IF;
  result:=public.cx_ingest_results(rid,'ME',jsonb_set(rows,'{0,timeSeconds}','"9007199254740994"'),'provisional',evidence-'officialReviewed'-'officialReviewSourceUrl');
  IF result->>'unchanged'<>'false' OR result->>'status'<>'provisional' THEN RAISE EXCEPTION 'Un cambio real hereda la oficialización';END IF;
  run_id:=private.start_automation_run('cx_results','scheduled',NULL,'prueba-rollback');
  PERFORM private.record_automation_source_run(run_id,'dataride_cx','noop',0,0,0,0,'{}');
  PERFORM private.finish_automation_run(run_id,'noop','{}',NULL);
  rejected:=false;BEGIN PERFORM private.start_automation_run('broadcasts','scheduled',NULL,NULL);EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
  IF NOT rejected THEN RAISE EXCEPTION 'El worker de resultados inicia emisiones';END IF;
  IF has_table_privilege(current_user,'private.results_manual_queue','UPDATE') OR has_column_privilege(current_user,'public.cx_race_categories','resultsLockedAt','UPDATE') THEN
    RAISE EXCEPTION 'El runtime recibe edición directa de cola o desbloqueo';END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM private.cx_change_log WHERE "raceId"=current_setting('cc.cx_runtime_race'))<>current_setting('cc.cx_runtime_audits')::integer+1 THEN
    RAISE EXCEPTION 'Una descarga idéntica añade auditoría o un cambio real no se audita';END IF;
  PERFORM set_config('cc.cx_runtime_snapshot',(public.cx_standings_snapshot(current_setting('cc.cx_runtime_tournament'),'ME')->>'digest'),true);
  UPDATE public.cx_race_categories SET "resultsLockedAt"=now() WHERE "raceId"=current_setting('cc.cx_runtime_race');
  IF current_setting('cc.cx_runtime_snapshot')<>public.cx_standings_snapshot(current_setting('cc.cx_runtime_tournament'),'ME')->>'digest' THEN
    RAISE EXCEPTION 'Una protección sin cambio deportivo modifica el digest de la general';END IF;
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN PERFORM public.cx_ingest_results(current_setting('cc.cx_runtime_race'),'ME',current_setting('cc.cx_runtime_rows')::jsonb,'provisional',current_setting('cc.cx_runtime_evidence')::jsonb);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected:=true;END;
  IF NOT rejected THEN RAISE EXCEPTION 'El no-op evita la protección manual';END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE monitor jsonb;
BEGIN
  monitor:=public.admin_get_automation_monitor();
  IF monitor#>>'{queues,cx_results,lastRequest,cxRaceId}'<>current_setting('cc.cx_runtime_race')
    OR monitor#>>'{queues,results,lastRequest,cxRaceId}' IS NOT NULL THEN RAISE EXCEPTION 'El monitor mezcla disciplinas';END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN PERFORM public.cx_enqueue_results_fetch();RAISE EXCEPTION 'Un usuario no administrador encola CX';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon','public.cx_enqueue_results_fetch(text,text)','EXECUTE')
    OR has_function_privilege('service_role','private.cx_dispatch_results_fetch(text,text)','EXECUTE')
    OR has_function_privilege('authenticated','private.claim_results_manual_request(integer)','EXECUTE')
    OR (SELECT NOT relrowsecurity FROM pg_class WHERE oid='private.results_manual_queue'::regclass) THEN
    RAISE EXCEPTION 'La cola pierde RLS o expone helpers';END IF;
END $$;
ROLLBACK;
