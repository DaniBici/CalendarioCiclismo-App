-- Contratos y ACL con datos sintéticos, sin resultados/torneos persistidos ni push.
BEGIN;
-- postgres tiene ADMIN OPTION, pero SET está revocado. Solo habilitar la
-- suplantación para esta transacción de pruebas; ROLLBACK restaura la membresía.
GRANT cc_results_worker TO postgres WITH SET TRUE;
DO $$
DECLARE tournament_id text:='cc-cx-test-'||gen_random_uuid(); race_id text:=gen_random_uuid()::text;
  rider_id text:='cc-cx-rider-'||gen_random_uuid(); second_id text:='cc-cx-rider-'||gen_random_uuid();
  woman_id text:='cc-cx-rider-'||gen_random_uuid(); admin_id text;
BEGIN
  SELECT user_id::text INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('cc.cx_standings_tournament',tournament_id,true);
  PERFORM set_config('cc.cx_standings_race',race_id,true);
  PERFORM set_config('cc.cx_standings_rider',rider_id,true);
  PERFORM set_config('cc.cx_standings_second',second_id,true);
  PERFORM set_config('cc.cx_standings_woman',woman_id,true);
  PERFORM set_config('cc.cx_standings_admin',admin_id,true);
  INSERT INTO public.cx_riders_men(id,"firstName","lastName") VALUES(rider_id,'A','Prueba'),(second_id,'B','Prueba');
  INSERT INTO public.cx_riders_women(id,"firstName","lastName","birthDate") VALUES(woman_id,'C','Prueba','2005-01-01');
  INSERT INTO public.cx_tournaments(id,name,slug,"seasonKey","pointsScheme") VALUES(tournament_id,'Prueba generales',tournament_id,'2026-27',
    '{"version":1,"status":"verified","edition":{"seasonKey":"2026-27","reviewedAt":"2026-09-12"},"sourceUrls":["https://official.test/rules"],
      "categories":{"ME":{"mode":"points","review":{"sourceUrl":"https://official.test/rules","cotejoUrl":"https://official.test/general"}},
      "WE":{"mode":"points","review":{"sourceUrl":"https://official.test/rules","cotejoUrl":"https://official.test/general"}},
      "WU":{"mode":"points","extras":{"derived":{"fromCategory":"WE"}},"review":{"sourceUrl":"https://official.test/rules","cotejoUrl":"https://official.test/general"}}}}');
  INSERT INTO public.cx_races(id,name,slug,"seasonKey","seasonStartYear","dateKey",class,"tournamentId")
    VALUES(race_id,'Prueba generales',race_id,'2026-27',2026,'2026-11-01','C2',tournament_id);
  INSERT INTO public.cx_race_categories("raceId",category) VALUES(race_id,'ME'),(race_id,'WE');
  UPDATE private.cx_standings_queue SET "requestedAt"='1900-01-01' WHERE "tournamentId"=tournament_id;
END $$;

SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE value jsonb; snapshot jsonb; calculation jsonb; previous_state jsonb; rejected boolean:=false; outdated_version integer;
BEGIN
  PERFORM public.cx_replace_results(current_setting('cc.cx_standings_race'),'ME',jsonb_build_array(
    jsonb_build_object('rank',1,'bib','A01','riderDisplay','A Prueba','globalRiderId',current_setting('cc.cx_standings_rider'),'timeSeconds','9007199254740993'),
    jsonb_build_object('rank',2,'bib','B02','riderDisplay','B Prueba','globalRiderId',current_setting('cc.cx_standings_second'))),
    'official','{"sourceUrl":"https://official.test/finish","rankScope":"officialCategory","categoryClassificationSourceUrl":"https://official.test/category"}');
  snapshot:=public.cx_standings_snapshot(current_setting('cc.cx_standings_tournament'),'ME');
  IF jsonb_typeof(snapshot#>'{input,rounds,0,results,0,timeSeconds}')<>'string'
    OR snapshot#>>'{input,rounds,0,results,0,timeSeconds}'<>'9007199254740993'
    OR snapshot#>>'{input,rounds,0,manga,resultsEvidence,rankScope}'<>'officialCategory' THEN
    RAISE EXCEPTION 'El snapshot pierde tiempo BIGINT o evidencia de categoría'; END IF;
  PERFORM set_config('cc.cx_standings_digest',snapshot->>'digest',true);
  calculation:=jsonb_build_object('engineVersion',3,'category','ME','unit','points','status','ready','issues','[]'::jsonb,'breakdown','[]'::jsonb,
    'roundIds',jsonb_build_array(current_setting('cc.cx_standings_race')),'rows',jsonb_build_array(
      jsonb_build_object('rank',1,'globalRiderId',current_setting('cc.cx_standings_rider'),'riderDisplay','A Prueba','points','40','timeSeconds',NULL),
      jsonb_build_object('rank',2,'globalRiderId',current_setting('cc.cx_standings_second'),'riderDisplay','B Prueba','points','30','timeSeconds',NULL)));
  -- Ninguna versión anterior puede publicar filas ni registrar revisión.
  SELECT to_jsonb(s) INTO previous_state FROM public.cx_standings_state s
    WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME';
  FOR outdated_version IN 1..2 LOOP
    rejected:=false;
    BEGIN
      PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',
        jsonb_set(calculation,'{engineVersion}',to_jsonb(outdated_version)));
    EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
    IF NOT rejected OR previous_state IS DISTINCT FROM (SELECT to_jsonb(s) FROM public.cx_standings_state s
      WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME')
      OR EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME') THEN
      RAISE EXCEPTION 'Un motor anterior publica filas o cambia estado al rechazarse'; END IF;
    rejected:=false;
    BEGIN
      PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',
        jsonb_build_object('engineVersion',outdated_version,'category','ME','unit','points','status','needs_review',
          'rows','[]'::jsonb,'issues','[{"code":"review"}]'::jsonb,'roundIds','[]'::jsonb,'breakdown','[]'::jsonb));
    EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Un motor anterior registra revisión tras la transición'; END IF;
  END LOOP;
  rejected:=false;
  PERFORM set_config('cc.cx_standings_calculation',calculation::text,true);
  value:=public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',calculation);
  IF value->>'rows'<>'2' OR (SELECT status FROM public.cx_standings_state WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME')<>'ready' OR NOT EXISTS(SELECT 1 FROM public.cx_standings_state WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME' AND "engineVersion"=3) THEN
    RAISE EXCEPTION 'No publica la general calculada'; END IF;
  BEGIN
    PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',
      jsonb_set(calculation,'{rows,1,timeSeconds}','"3600"'));
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected OR (SELECT count(*) FROM public.cx_tournament_standings WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME')<>2 THEN
    RAISE EXCEPTION 'La fila inválida no revierte el reemplazo completo'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',jsonb_set(calculation,'{roundIds}','[]'));
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se admite omitir una ronda oficial'; END IF;
  -- Una nueva oficialización invalida la anterior y rechaza el digest calculado.
  PERFORM public.cx_replace_results(current_setting('cc.cx_standings_race'),'ME',jsonb_build_array(
    jsonb_build_object('rank',1,'riderDisplay','A Corregida','globalRiderId',current_setting('cc.cx_standings_rider'))),
    'official','{"sourceUrl":"https://official.test/corrected"}');
  rejected:=false;
  BEGIN PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',calculation);
  EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
  IF NOT rejected OR EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME') THEN
    RAISE EXCEPTION 'Se conserva o publica una general calculada con entrada obsoleta'; END IF;
  snapshot:=public.cx_standings_snapshot(current_setting('cc.cx_standings_tournament'),'ME');
  calculation:=jsonb_set(calculation,'{rows}',jsonb_build_array(calculation#>'{rows,0}'));
  PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',calculation);
  PERFORM set_config('cc.cx_standings_digest',snapshot->>'digest',true);
  PERFORM set_config('cc.cx_standings_calculation',calculation::text,true);
  PERFORM public.cx_replace_results(current_setting('cc.cx_standings_race'),'WE',jsonb_build_array(
    jsonb_build_object('rank',1,'riderDisplay','C Prueba','globalRiderId',current_setting('cc.cx_standings_woman'))),
    'official','{"sourceUrl":"https://official.test/women"}');
  IF NOT EXISTS(SELECT 1 FROM private.cx_standings_queue WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='WU' AND status='pending') THEN
    RAISE EXCEPTION 'No encola WU derivada cuando cambia WE'; END IF;
  value:=private.cx_claim_standings();
  IF value IS NULL OR value->>'tournamentId'<>current_setting('cc.cx_standings_tournament') OR jsonb_typeof(value->'generation')<>'string' THEN
    RAISE EXCEPTION 'Claim o generación BIGINT inválidos'; END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',current_setting('cc.cx_standings_admin'),true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('cc.cx_standings_admin'))::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE snapshot jsonb; calculation jsonb;
BEGIN
  snapshot:=public.cx_standings_snapshot(current_setting('cc.cx_standings_tournament'),'ME');
  calculation:=current_setting('cc.cx_standings_calculation')::jsonb;
  PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',calculation,false,'manual',
    '{"sourceUrl":"https://official.test/standings","reason":"Clasificación oficial de prueba"}');
  IF (SELECT status FROM public.cx_standings_state WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME')<>'manual' THEN
    RAISE EXCEPTION 'No identifica el override manual'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE rejected boolean:=false; snapshot jsonb;
BEGIN
  snapshot:=public.cx_standings_snapshot(current_setting('cc.cx_standings_tournament'),'ME');
  BEGIN PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',current_setting('cc.cx_standings_calculation')::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'El worker sustituye el override manual'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',current_setting('cc.cx_standings_calculation')::jsonb,true);
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'El worker puede autorizar el override'; END IF;
  PERFORM public.cx_replace_results(current_setting('cc.cx_standings_race'),'ME',jsonb_build_array(
    jsonb_build_object('rank',1,'riderDisplay','A Provisional','globalRiderId',current_setting('cc.cx_standings_rider'))),
    'provisional','{"sourceUrl":"https://official.test/provisional"}');
  IF NOT EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='ME' AND source='manual') THEN
    RAISE EXCEPTION 'La invalidación automática borra el override manual'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE snapshot jsonb; calculation jsonb; rejected boolean:=false; time_id text:=current_setting('cc.cx_standings_tournament')||'-time';
  time_race text:=gen_random_uuid()::text; policy text; review_calculation jsonb;
BEGIN
  INSERT INTO public.cx_tournaments(id,name,slug,"seasonKey","pointsScheme") VALUES(time_id,'Prueba tiempo',time_id,'2026-27',
    '{"version":1,"status":"verified","edition":{"seasonKey":"2026-27"},"categories":{"ME":{"mode":"time",
    "review":{"forfaitBonusesPolicy":"discard","sourceUrl":"https://official.test/rules","cotejoUrl":"https://official.test/general"}}}}');
  INSERT INTO public.cx_races(id,name,slug,"seasonKey","seasonStartYear","dateKey",class,"tournamentId")
    VALUES(time_race,'Prueba tiempo',time_race,'2026-27',2026,'2026-11-01','C2',time_id);
  INSERT INTO public.cx_race_categories("raceId",category) VALUES(time_race,'ME');
  PERFORM public.cx_replace_results(time_race,'ME',jsonb_build_array(jsonb_build_object('rank',1,'riderDisplay','A Tiempo',
    'globalRiderId',current_setting('cc.cx_standings_rider'),'timeSeconds','9007199254740993','bonusSeconds',0)),
    'official','{"sourceUrl":"https://official.test/time","bonusSourceUrl":"https://official.test/bonuses"}');
  snapshot:=public.cx_standings_snapshot(time_id,'ME');
  calculation:=jsonb_build_object('engineVersion',3,'category','ME','unit','time','status','ready','issues','[]'::jsonb,'breakdown','[]'::jsonb,
    'roundIds',jsonb_build_array(time_race),'rows',jsonb_build_array(jsonb_build_object('rank',1,'riderDisplay','A Tiempo',
    'globalRiderId',current_setting('cc.cx_standings_rider'),'timeSeconds','9007199254740993','points',NULL)));
  -- La RPC tampoco acepta ready con una política ausente o desconocida.
  FOREACH policy IN ARRAY ARRAY[NULL::text,'ignore'] LOOP
    UPDATE public.cx_tournaments SET "pointsScheme"=CASE WHEN policy IS NULL
      THEN "pointsScheme" #- '{categories,ME,review,forfaitBonusesPolicy}'
      ELSE jsonb_set("pointsScheme",'{categories,ME,review,forfaitBonusesPolicy}',to_jsonb(policy)) END WHERE id=time_id;
    snapshot:=public.cx_standings_snapshot(time_id,'ME'); rejected:=false;
    BEGIN PERFORM public.cx_publish_standings(time_id,'ME',snapshot->>'digest',calculation);
    EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
    IF NOT rejected OR EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=time_id) THEN
      RAISE EXCEPTION 'Se publica tiempo sin una política explícita de bonos ante forfait'; END IF;
    review_calculation:=calculation||'{"status":"needs_review","rows":[],"issues":[{"code":"forfait_policy"}]}'::jsonb;
    PERFORM public.cx_publish_standings(time_id,'ME',snapshot->>'digest',review_calculation);
    IF NOT EXISTS(SELECT 1 FROM public.cx_standings_state WHERE "tournamentId"=time_id AND category='ME'
      AND status='needs_review' AND "engineVersion"=3) THEN
      RAISE EXCEPTION 'La falta de política no permite registrar revisión sin filas'; END IF;
  END LOOP;
  UPDATE public.cx_tournaments SET "pointsScheme"=jsonb_set("pointsScheme",'{categories,ME,review,forfaitBonusesPolicy}','"discard"') WHERE id=time_id;
  snapshot:=public.cx_standings_snapshot(time_id,'ME');
  PERFORM public.cx_publish_standings(time_id,'ME',snapshot->>'digest',calculation);
  IF NOT EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=time_id AND points IS NULL AND "timeSeconds"=9007199254740993) THEN
    RAISE EXCEPTION 'La general por tiempo pierde BIGINT o mezcla puntos'; END IF;
  INSERT INTO public.cx_race_categories("raceId",category) VALUES(time_race,'MU');
  UPDATE public.cx_results SET category='MU' WHERE "raceId"=time_race AND category='ME';
  IF EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=time_id AND category='ME') THEN
    RAISE EXCEPTION 'Reasignar resultados deja calculada la categoría anterior'; END IF;
  UPDATE public.cx_results SET category='ME' WHERE "raceId"=time_race AND category='MU';
  snapshot:=public.cx_standings_snapshot(time_id,'ME');
  PERFORM public.cx_publish_standings(time_id,'ME',snapshot->>'digest',calculation);
  UPDATE public.cx_tournaments SET "pointsScheme"=jsonb_set("pointsScheme",'{categories}','{}') WHERE id=time_id;
  IF EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=time_id AND category='ME')
    OR NOT EXISTS(SELECT 1 FROM private.cx_standings_queue WHERE "tournamentId"=time_id AND category='ME' AND status='pending') THEN
    RAISE EXCEPTION 'Retirar una categoría del esquema conserva general o no encola revisión'; END IF;
  UPDATE public.cx_tournaments SET "pointsScheme"=jsonb_set("pointsScheme",'{categories}',
    '{"ME":{"mode":"time","review":{"forfaitBonusesPolicy":"discard","sourceUrl":"https://official.test/rules","cotejoUrl":"https://official.test/general"}}}') WHERE id=time_id;
  snapshot:=public.cx_standings_snapshot(time_id,'ME');
  PERFORM public.cx_publish_standings(time_id,'ME',snapshot->>'digest',calculation);
  snapshot:=public.cx_standings_snapshot(current_setting('cc.cx_standings_tournament'),'WU');
  calculation:=jsonb_build_object('engineVersion',3,'category','WU','unit','points','status','ready','issues','[]'::jsonb,'breakdown','[]'::jsonb,
    'roundIds',jsonb_build_array(current_setting('cc.cx_standings_race')),'rows',jsonb_build_array(jsonb_build_object('rank',1,'riderDisplay','C General',
    'globalRiderId',current_setting('cc.cx_standings_rider'),'points','40','timeSeconds',NULL)));
  BEGIN PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'WU',snapshot->>'digest',calculation);
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Una general femenina admite ficha masculina'; END IF;
  calculation:=jsonb_set(calculation,'{rows,0,globalRiderId}',to_jsonb(current_setting('cc.cx_standings_woman')));
  PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'WU',snapshot->>'digest',calculation);
  UPDATE public.cx_riders_women SET verified=false WHERE id=current_setting('cc.cx_standings_woman');
  IF EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=current_setting('cc.cx_standings_tournament') AND category='WU') THEN
    RAISE EXCEPTION 'Cambiar la identidad/edad no invalida WU derivada'; END IF;
  -- Quitar la regla deja una revisión sin filas; nunca hereda la modalidad élite.
  snapshot:=public.cx_standings_snapshot(time_id,'WJ');
  calculation:='{"engineVersion":3,"category":"WJ","unit":null,"status":"needs_review","issues":[{"code":"scheme"}],"breakdown":[],"roundIds":[],"rows":[]}';
  PERFORM public.cx_publish_standings(time_id,'WJ',snapshot->>'digest',calculation);
  IF NOT EXISTS(SELECT 1 FROM public.cx_standings_state WHERE "tournamentId"=time_id AND category='WJ' AND status='needs_review' AND "engineVersion"=3) THEN
    RAISE EXCEPTION 'Una categoría sin esquema no queda pendiente de revisión'; END IF;
  UPDATE public.cx_riders_men SET id=id||'-changed' WHERE id=current_setting('cc.cx_standings_rider');
  IF EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=time_id AND source='computed') THEN
    RAISE EXCEPTION 'Cambiar el ID sin cambiar nacimiento/verified conserva general obsoleta'; END IF;
  snapshot:=public.cx_standings_snapshot(current_setting('cc.cx_standings_tournament'),'ME');
  calculation:='{"engineVersion":3,"category":"ME","unit":"points","status":"empty","issues":[],"breakdown":[],"roundIds":[],"rows":[]}';
  PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',snapshot->>'digest',calculation,true,'manual',
    '{"sourceUrl":"https://official.test/standings","reason":"Retirada oficial de clasificación de prueba"}');
  PERFORM set_config('cc.cx_standings_digest',snapshot->>'digest',true);
  PERFORM set_config('cc.cx_standings_calculation',calculation::text,true);
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME',current_setting('cc.cx_standings_digest'),
    current_setting('cc.cx_standings_calculation')::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'El worker sustituye el override vacío'; END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
  IF has_function_privilege('anon','public.cx_standings_snapshot(text,text)','EXECUTE')
    OR has_function_privilege('service_role','public.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb)','EXECUTE')
    OR has_function_privilege('cc_results_worker','private.cx_enqueue_standings(text,text)','EXECUTE')
    OR has_table_privilege('anon','private.cx_standings_queue','SELECT')
    OR has_table_privilege('cc_results_worker','public.cx_standings_state','INSERT,UPDATE,DELETE')
    OR has_column_privilege('cc_results_worker','public.cx_race_categories','startTimeUtc','UPDATE') THEN
    RAISE EXCEPTION 'Se amplían privilegios sobre cola privada, programa o estado'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.cx_change_log WHERE operation='publish_standings' AND evidence->>'tournamentId'=current_setting('cc.cx_standings_tournament')
    AND "actorRole"='cc_results_worker') OR NOT EXISTS(SELECT 1 FROM private.cx_change_log WHERE operation='publish_standings'
    AND evidence->>'tournamentId'=current_setting('cc.cx_standings_tournament') AND "actorRole"='authenticated' AND evidence->>'source'='manual') THEN
    RAISE EXCEPTION 'La auditoría pierde operación, fuente o actor'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN PERFORM public.cx_standings_snapshot(current_setting('cc.cx_standings_tournament'),'ME');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Editor no admin accede al snapshot de publicación'; END IF;
  rejected:=false;
  BEGIN PERFORM private.cx_claim_standings(); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Editor no admin reclama trabajo de cola'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_publish_standings(current_setting('cc.cx_standings_tournament'),'ME','invalid','{}');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Editor no admin accede a publicación privilegiada'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'CX standings: snapshot, cola, digest, unidades, rollback, override y ACL comprobados sin datos persistidos' AS result;
