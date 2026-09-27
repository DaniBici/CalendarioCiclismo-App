-- Datos sintéticos y suplantación de roles solo dentro de esta transacción.
BEGIN;
GRANT cc_results_worker TO postgres WITH SET TRUE;
DO $$
DECLARE race_id text:=gen_random_uuid()::text; rider_id text:='cc-cx-ingest-'||gen_random_uuid(); admin_id text;
  tournament_id text:='cc-cx-ingest-tournament-'||gen_random_uuid();
BEGIN
  SELECT user_id::text INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('cc.cx_ingest_race',race_id,true);
  PERFORM set_config('cc.cx_ingest_rider',rider_id,true);
  PERFORM set_config('cc.cx_ingest_admin',admin_id,true);
  PERFORM set_config('cc.cx_ingest_tournament',tournament_id,true);
  INSERT INTO public.cx_riders_men(id,"firstName","lastName",nationality,"birthDate",verified)
    VALUES(rider_id,'A','Prueba','ES','2000-01-01',true);
  INSERT INTO public.cx_tournaments(id,name,slug,"seasonKey","pointsScheme")
    VALUES(tournament_id,'Prueba importación',tournament_id,'2026-27','{"categories":{"ME":{"mode":"points"}}}');
  INSERT INTO public.cx_races(id,name,slug,"seasonKey","seasonStartYear","dateKey",class,"editorialStatus","tournamentId")
    VALUES(race_id,'Prueba importación',race_id,'2026-27',2026,'2026-11-01','C2','published',tournament_id);
  INSERT INTO public.cx_race_categories("raceId",category) VALUES(race_id,'ME');
  INSERT INTO public.cx_race_uci_links("raceId","competitionId","seasonId") VALUES(race_id,2147483000,472);
  PERFORM set_config('cc.cx_ingest_rows',jsonb_build_array(jsonb_build_object('rank',1,'riderDisplay','A Prueba',
    'globalRiderId',rider_id,'timeSeconds','9007199254740993','bonusSeconds',NULL))::text,true);
  PERFORM set_config('cc.cx_ingest_evidence',jsonb_build_object('inputSource','dataride','sourceUrl','https://dataride.uci.ch/iframe/Results/',
    'seasonKey','2026-27','dateKey','2026-11-01','fetchedAt','2026-11-01T11:00:00Z',
    'dataRide',jsonb_build_object('disciplineId',3,'competitionId',2147483000,'seasonId',472,'uciRaceId',123,'eventId',456),
    'identityEvidence',jsonb_build_array(jsonb_build_object('id',rider_id,'firstName','A','lastName','Prueba',
      'nationality','ES','birthDate','2000-01-01','verified',true)))::text,true);
END $$;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE race_id text:=current_setting('cc.cx_ingest_race'); rows jsonb:=current_setting('cc.cx_ingest_rows')::jsonb;
  evidence jsonb:=current_setting('cc.cx_ingest_evidence')::jsonb; result jsonb; original_id bigint; rejected boolean; bad jsonb;
BEGIN
  result:=public.cx_ingest_results(race_id,'ME',rows,'provisional',evidence);
  SELECT id INTO STRICT original_id FROM public.cx_results WHERE "raceId"=race_id;
  IF result->>'unchanged'<>'false' OR (SELECT "resultsProvider" FROM public.cx_race_categories WHERE "raceId"=race_id)<>'dataride'
    OR (SELECT "timeSeconds" FROM public.cx_results WHERE id=original_id)<>9007199254740993
    OR (SELECT "bonusSeconds" FROM public.cx_results WHERE id=original_id) IS NOT NULL THEN
    RAISE EXCEPTION 'La importación pierde precisión, proveedor o el bono desconocido'; END IF;
  PERFORM set_config('cc.cx_ingest_original_id',original_id::text,true);
  result:=public.cx_ingest_results(race_id,'ME',rows,'provisional',jsonb_set(evidence,'{fetchedAt}','"2026-11-01T12:00:00Z"'));
  IF result->>'unchanged'<>'true' OR (SELECT id FROM public.cx_results WHERE "raceId"=race_id)<>original_id THEN
    RAISE EXCEPTION 'Una descarga idéntica reemplaza resultados'; END IF;
  FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_set(evidence,'{dataRide,disciplineId}','10'),jsonb_set(evidence,'{dataRide,competitionId}','1'),
    jsonb_set(evidence,'{dataRide,seasonId}','455'),jsonb_set(evidence,'{dateKey}','"2027-03-01"'),
    jsonb_set(evidence,'{seasonKey}','"2025-26"'),jsonb_set(evidence,'{dataRide,eventId}','0'))) LOOP
    rejected:=false;
    BEGIN PERFORM public.cx_ingest_results(race_id,'ME',rows,'provisional',bad);
    EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Se admite evidencia ajena a la manga/enlace'; END IF;
  END LOOP;
  rejected:=false;
  BEGIN PERFORM public.cx_ingest_results(race_id,'ME',rows,'official',evidence);
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'La existencia de filas oficializa sin revisión'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_ingest_results(race_id,'ME',rows,'provisional',jsonb_set(evidence,'{identityEvidence,0,lastName}','"Otra"'));
  EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se admite una identidad que cambió desde la preparación'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_ingest_results(race_id,'ME',jsonb_set(rows,'{0,irm}','"DNF"'),'provisional',evidence);
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se admite tiempo real o puesto de un retirado'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_ingest_results(race_id,'ME',rows||rows,'provisional',evidence);
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se admite un puesto duplicado'; END IF;
  IF has_column_privilege(current_user,'public.cx_race_categories','resultsLockedAt','UPDATE')
    OR has_table_privilege(current_user,'public.cx_riders_men','UPDATE') THEN
    RAISE EXCEPTION 'El worker puede desbloquear o modificar fichas'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM private.cx_change_log WHERE "raceId"=current_setting('cc.cx_ingest_race'))<>1 THEN
    RAISE EXCEPTION 'Se audita dos veces una entrada idéntica o se persiste una entrada rechazada'; END IF;
  PERFORM set_config('request.jwt.claim.sub',current_setting('cc.cx_ingest_admin'),true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE result jsonb;
BEGIN
  result:=public.cx_replace_results(current_setting('cc.cx_ingest_race'),'ME',current_setting('cc.cx_ingest_rows')::jsonb,'official',
    '{"sourceUrl":"https://official.test/corrected"}');
  IF result->>'lockedAt' IS NULL THEN RAISE EXCEPTION 'La corrección manual no activa la protección'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN PERFORM public.cx_ingest_results(current_setting('cc.cx_ingest_race'),'ME',current_setting('cc.cx_ingest_rows')::jsonb,'provisional',
    current_setting('cc.cx_ingest_evidence')::jsonb||'{"lockAutomatic":false}');
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'El worker sobrescribe o desbloquea una corrección manual'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_replace_results(current_setting('cc.cx_ingest_race'),'ME',current_setting('cc.cx_ingest_rows')::jsonb,'provisional',
    '{"sourceUrl":"https://official.test/automatic"}');
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'El reemplazo genérico permite saltar el bloqueo'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE evidence jsonb:=current_setting('cc.cx_ingest_evidence')::jsonb; result jsonb; generation bigint;
BEGIN
  -- El administrador puede desbloquear con la misma entrada, sin borrarla.
  PERFORM public.cx_ingest_results(current_setting('cc.cx_ingest_race'),'ME',current_setting('cc.cx_ingest_rows')::jsonb,'provisional',evidence);
  SELECT q.generation INTO generation FROM private.cx_standings_queue q WHERE "tournamentId"=current_setting('cc.cx_ingest_tournament');
  result:=public.cx_ingest_results(current_setting('cc.cx_ingest_race'),'ME',current_setting('cc.cx_ingest_rows')::jsonb,'provisional',evidence||'{"lockAutomatic":false}');
  IF result->>'unchanged'<>'true' OR (SELECT "resultsLockedAt" FROM public.cx_race_categories WHERE "raceId"=current_setting('cc.cx_ingest_race')) IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede quitar el bloqueo de una entrada idéntica'; END IF;
  IF (SELECT q.generation FROM private.cx_standings_queue q WHERE "tournamentId"=current_setting('cc.cx_ingest_tournament'))<>generation THEN
    RAISE EXCEPTION 'El bloqueo sin cambios de resultados vuelve a encolar la general'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE cc_results_worker;
DO $$
DECLARE evidence jsonb:=current_setting('cc.cx_ingest_evidence')::jsonb; result jsonb;
BEGIN
  -- El trigger puede activar la protección de un PDF revisado, sin conceder UPDATE de la columna al worker.
  result:=public.cx_ingest_results(current_setting('cc.cx_ingest_race'),'ME',current_setting('cc.cx_ingest_rows')::jsonb,'official',
    evidence||'{"inputSource":"pdf","officialReviewed":true,"officialReviewSourceUrl":"https://official.test/pdf"}');
  IF result->>'lockedAt' IS NULL OR (SELECT "resultsProvider" FROM public.cx_race_categories WHERE "raceId"=current_setting('cc.cx_ingest_race'))<>'pdf' THEN
    RAISE EXCEPTION 'El documento manual del runtime queda desprotegido'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon','public.cx_ingest_results(text,text,jsonb,text,jsonb)','EXECUTE')
    OR has_function_privilege('service_role','public.cx_ingest_results(text,text,jsonb,text,jsonb)','EXECUTE')
    OR has_function_privilege('cc_results_worker','private.cx_lock_manual_ingestion()','EXECUTE') THEN
    RAISE EXCEPTION 'ACL pública o privada demasiado amplia'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN PERFORM public.cx_ingest_results(current_setting('cc.cx_ingest_race'),'ME','[]','pending','{}');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Un usuario no administrador puede importar'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
