-- F1 CC-CX: ejecutar por MCP tras aplicar ambas migraciones.
-- Fixtures aleatorias y ROLLBACK; no importa resultados ni envía notificaciones.
BEGIN;
DO $$
DECLARE
  r text := gen_random_uuid()::text;
  t text := gen_random_uuid()::text;
  tt text := gen_random_uuid()::text;
  team text := gen_random_uuid()::text;
  admin_id text;
  tab text;
  rejected boolean;
BEGIN
  SELECT user_id::text INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('cc.cx_test_race',r,true);
  PERFORM set_config('cc.cx_test_tournament',t,true);
  PERFORM set_config('cc.cx_test_time_tournament',tt,true);
  PERFORM set_config('cc.cx_test_admin',admin_id,true);
  PERFORM set_config('cc.cx_test_token','cc-cx-test-'||gen_random_uuid()::text,true);
  PERFORM set_config('cc.cx_test_road_race',(SELECT id FROM public.races LIMIT 1),true);
  INSERT INTO public.cx_tournaments(id,name,slug,"seasonKey","pointsScheme") VALUES
    (t,'Prueba puntos',t,'2026-27','{"categories":{"ME":{"mode":"points"}}}'),
    (tt,'Prueba tiempos',tt,'2026-27','{"categories":{"ME":{"mode":"time"}}}');
  INSERT INTO public.cx_races(id,name,slug,"seasonKey","seasonStartYear","dateKey",class,"tournamentId")
    VALUES(r,'Prueba CX',r,'2026-27',2026,'2026-11-01','CC',t);
  INSERT INTO public.cx_race_categories("raceId",category) VALUES(r,'ME'),(r,'WE');
  INSERT INTO public.cx_teams(id,name,"uciCode","colorHex") VALUES(team,'Equipo prueba','TST','#123456');
  INSERT INTO public.cx_riders_men(id,"firstName","lastName","currentTeamId") VALUES(r,'Nombre','Apellido',team);
  INSERT INTO public.cx_riders_women(id,"firstName","lastName","currentTeamId") VALUES(r,'Nombre','Apellido',team);
  INSERT INTO public.cx_startlist_riders("raceId",category,"firstName","lastName","teamId") VALUES(r,'ME','Nombre','Apellido',team);
  INSERT INTO public.cx_race_uci_links("raceId","competitionId","seasonId") VALUES(r,2147483000,472);
  INSERT INTO public.cx_results("raceId",category,rank,"riderDisplay","timeSeconds","bonusPoints")
    VALUES(r,'ME',1,'APELLIDO Nombre',3600,-25);
  IF (SELECT "bonusSeconds" FROM public.cx_results WHERE "raceId"=r) IS NOT NULL THEN
    RAISE EXCEPTION 'Un bono omitido no debe considerarse cero confirmado';
  END IF;
  INSERT INTO public.cx_tournament_standings("tournamentId","seasonKey",category,rank,points,"riderDisplay")
    VALUES(t,'2026-27','ME',1,40,'APELLIDO Nombre');
  INSERT INTO public.cx_tournament_standings("tournamentId","seasonKey",category,rank,"timeSeconds","riderDisplay")
    VALUES(tt,'2026-27','ME',1,3570,'APELLIDO Nombre');

  FOREACH tab IN ARRAY ARRAY['cx_tournaments','cx_teams','cx_riders_men','cx_riders_women','cx_races',
    'cx_race_categories','cx_broadcasts','cx_videos','cx_startlist_riders','cx_race_uci_links',
    'cx_results','cx_tournament_standings','push_cx_race_subscriptions'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||tab)::regclass) THEN
      RAISE EXCEPTION 'RLS desactivada: %',tab;
    END IF;
    IF has_table_privilege('anon','public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('authenticated','public.'||tab,'TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'ACL excesiva: %',tab;
    END IF;
    IF EXISTS(SELECT 1 FROM pg_class c, LATERAL aclexplode(c.relacl) a
      WHERE c.oid=('public.'||tab)::regclass AND a.grantee=0) THEN
      RAISE EXCEPTION 'Privilegios heredados de PUBLIC: %',tab;
    END IF;
  END LOOP;
  IF has_table_privilege('anon','public.push_cx_race_subscriptions','SELECT')
    OR has_table_privilege('cc_results_worker','public.push_cx_race_subscriptions','SELECT')
    OR has_sequence_privilege('anon','public.cx_results_id_seq','USAGE,SELECT,UPDATE') THEN
    RAISE EXCEPTION 'Suscripciones/secuencia accesibles fuera del contrato';
  END IF;
  IF NOT has_table_privilege('service_role','public.push_cx_race_subscriptions','SELECT') THEN
    RAISE EXCEPTION 'El emisor carece de SELECT explícito';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a
    WHERE p.oid='public.set_push_subscription_v4(text,text,boolean,text,text,text,text[],text[],text[],text[],text[])'::regprocedure
    AND a.grantee=0) THEN RAISE EXCEPTION 'EXECUTE heredado de PUBLIC en RPC v4'; END IF;

  rejected:=false;
  BEGIN INSERT INTO public.cx_races(name,slug,"seasonKey","seasonStartYear","dateKey",class,"tournamentId")
    VALUES('Otra temporada',gen_random_uuid()::text,'2027-28',2027,'2027-11-01','C1',t);
  EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se mezclan temporadas de carrera y torneo'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.cx_races(name,slug,"seasonKey","seasonStartYear","dateKey",class)
    VALUES('Temporada incoherente',gen_random_uuid()::text,'2026-28',2026,'2026-11-01','C1');
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'seasonKey incoherente aceptada'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.cx_results("raceId",category,"riderDisplay") VALUES(r,'WU','Sin manga');
  EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Resultado admitido sin categoría de carrera'; END IF;
  rejected:=false;
  BEGIN UPDATE public.cx_results SET "bonusSeconds"=-5 WHERE "raceId"=r;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Bono temporal negativo admitido'; END IF;
  rejected:=false;
  BEGIN UPDATE public.cx_race_uci_links SET "disciplineId"=10 WHERE "raceId"=r;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Enlace CX admitido con otra disciplina'; END IF;
  rejected:=false;
  BEGIN UPDATE public.cx_tournament_standings SET "timeSeconds"=3600 WHERE "tournamentId"=t;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'General admitida con ambas unidades'; END IF;
  rejected:=false;
  BEGIN UPDATE public.cx_tournament_standings SET points=NULL WHERE "tournamentId"=t;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'General admitida sin unidad'; END IF;

  INSERT INTO public.cx_broadcasts("raceId",category,channel,country) VALUES(r,NULL,'Global','ALL'),(r,'WE','Categoría','ES');
  INSERT INTO public.cx_videos("raceId",category,title,url) VALUES(r,NULL,'Global','https://example.org'),(r,'WE','Categoría','https://example.org');
  rejected:=false;
  BEGIN INSERT INTO public.cx_broadcasts("raceId",category) VALUES(r,'WU');
  EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'TV admitida para categoría ausente'; END IF;
  DELETE FROM public.cx_race_categories WHERE "raceId"=r AND category='WE';
  IF (SELECT count(*) FROM public.cx_broadcasts WHERE "raceId"=r)<>1
    OR (SELECT count(*) FROM public.cx_videos WHERE "raceId"=r)<>1 THEN
    RAISE EXCEPTION 'Borrar categoría no conserva TV/vídeos globales o no elimina específicos';
  END IF;
  INSERT INTO public.today_highlights(id,position,"targetType","cxRaceId") VALUES(gen_random_uuid()::text,999,'cxRace',r);
  INSERT INTO public.today_highlights(id,position,"targetType") VALUES(gen_random_uuid()::text,999,'transfers');
  rejected:=false;
  BEGIN INSERT INTO public.today_highlights(id,position,"targetType") VALUES(gen_random_uuid()::text,999,'cxRace');
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cintillo CX admitido sin destino'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.today_highlights(id,position,"targetType","cxRaceId") VALUES(gen_random_uuid()::text,999,'transfers',r);
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Destino CX admitido en target carretera'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.today_highlights(id,position,"targetType","cxRaceId","customUrl")
    VALUES(gen_random_uuid()::text,999,'cxRace',r,'https://example.org');
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cintillo admitido con destinos mezclados'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('request.jwt.claim.sub'))::text,true);
END $$;

SET LOCAL ROLE anon;
DO $$
DECLARE rejected boolean:=false; sid text;
BEGIN
  IF (SELECT count(*) FROM public.cx_races WHERE id=current_setting('cc.cx_test_race'))<>1 THEN
    RAISE EXCEPTION 'Falta lectura pública CX'; END IF;
  BEGIN PERFORM * FROM public.push_cx_race_subscriptions;
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Lectura anónima de suscripciones'; END IF;
  sid:=public.set_push_subscription_v4(current_setting('cc.cx_test_token'),'ios',true,'SPAIN','ES','es',
    ARRAY['results'],ARRAY[current_setting('cc.cx_test_road_race')],ARRAY[]::text[],ARRAY[]::text[],
    ARRAY[current_setting('cc.cx_test_race'),current_setting('cc.cx_test_race')]);
  PERFORM set_config('cc.cx_test_subscription',sid,true);
  rejected:=false;
  BEGIN PERFORM public.set_push_subscription_v4('', 'ios',true,'SPAIN','ES','es',NULL,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'RPC admite token vacío'; END IF;
END $$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_test_subscription'))<>1
    OR (SELECT count(*) FROM public.push_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_test_subscription'))<>1 THEN
    RAISE EXCEPTION 'RPC no conserva seguimiento carretera o no deduplica CX'; END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE rejected boolean:=false; changed int; sid text;
BEGIN
  IF private.is_admin() THEN RAISE EXCEPTION 'Identidad ordinaria requerida'; END IF;
  IF EXISTS(SELECT 1 FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_test_subscription')) THEN
    RAISE EXCEPTION 'Lectura de suscripciones de usuario ordinario'; END IF;
  BEGIN INSERT INTO public.cx_results("raceId",category,"riderDisplay","sortOrder")
    VALUES(current_setting('cc.cx_test_race'),'ME','Inserción no autorizada',1);
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Inserción CX de usuario ordinario'; END IF;
  UPDATE public.cx_races SET name='Modificación no autorizada' WHERE id=current_setting('cc.cx_test_race');
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Modificación CX de usuario ordinario'; END IF;
  DELETE FROM public.cx_races WHERE id=current_setting('cc.cx_test_race');
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Borrado CX de usuario ordinario'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.push_cx_race_subscriptions("subscriptionId","raceId")
    VALUES(current_setting('cc.cx_test_subscription'),current_setting('cc.cx_test_race'));
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Escritura directa en seguimiento sin RPC'; END IF;
  PERFORM set_config('request.method','POST',true);
  PERFORM set_config('request.path','/rpc/set_push_subscription_v4?test=1',true);
  PERFORM public.cc_check_request();
  PERFORM set_config('request.path','/rpc/cx_recompute_standings',true);
  rejected:=false;
  BEGIN PERFORM public.cc_check_request(); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'El guard admite una ruta no autorizada'; END IF;
  sid:=public.set_push_subscription_v4(current_setting('cc.cx_test_token'),'ios',true,'SPAIN','ES','es',
    ARRAY['results'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],NULL);
  IF sid<>current_setting('cc.cx_test_subscription') THEN RAISE EXCEPTION 'RPC no es idempotente por token'; END IF;
  rejected:=false;
  BEGIN PERFORM public.set_push_subscription_v4(current_setting('cc.cx_test_token'),'ios',true,'SPAIN','ES','en',
    ARRAY['general'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY['cc-cx-inexistente-'||gen_random_uuid()::text]);
  EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'RPC admite carrera CX inexistente'; END IF;
END $$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_test_subscription'))<>1 THEN
    RAISE EXCEPTION 'NULL o fallo FK borró seguimiento CX'; END IF;
  IF (SELECT language FROM public.push_subscriptions WHERE id=current_setting('cc.cx_test_subscription'))<>'es'
    OR NOT EXISTS(SELECT 1 FROM public.push_subscription_categories WHERE "subscriptionId"=current_setting('cc.cx_test_subscription') AND category='results') THEN
    RAISE EXCEPTION 'El fallo FK dejó cambios parciales del contrato v3'; END IF;
  PERFORM public.set_push_subscription_v3(current_setting('cc.cx_test_token'),'ios',true,'SPAIN','ES','es',
    ARRAY['results'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]);
  IF (SELECT count(*) FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_test_subscription'))<>1 THEN
    RAISE EXCEPTION 'El cliente v3 borra seguimiento CX'; END IF;
  PERFORM public.set_push_subscription_v4(current_setting('cc.cx_test_token'),'ios',true,'SPAIN','ES','es',
    ARRAY['results'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[]);
  IF EXISTS(SELECT 1 FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_test_subscription')) THEN
    RAISE EXCEPTION '[] no borra seguimiento CX'; END IF;
  PERFORM public.set_push_subscription_v4(current_setting('cc.cx_test_token'),'ios',true,'SPAIN','ES','es',
    ARRAY['results'],ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],ARRAY[current_setting('cc.cx_test_race')]);
END $$;

-- MCP no permite SET ROLE cc_results_worker (membresía con SET=false).
-- Verificar ACL y políticas efectivas sin ampliar permisos de conexión.
DO $$
DECLARE col text;
BEGIN
  IF NOT has_table_privilege('cc_results_worker','public.cx_results','SELECT')
    OR NOT has_table_privilege('cc_results_worker','public.cx_results','INSERT')
    OR NOT has_table_privilege('cc_results_worker','public.cx_results','UPDATE')
    OR NOT has_table_privilege('cc_results_worker','public.cx_results','DELETE')
    OR NOT has_table_privilege('cc_results_worker','public.cx_tournament_standings','INSERT')
    OR NOT has_sequence_privilege('cc_results_worker','public.cx_results_id_seq','USAGE') THEN
    RAISE EXCEPTION 'El worker no puede reemplazar resultados/generales'; END IF;
  FOREACH col IN ARRAY ARRAY['resultsStatus','resultsImportedAt','winnerName'] LOOP
    IF NOT has_column_privilege('cc_results_worker','public.cx_race_categories',col,'UPDATE') THEN
      RAISE EXCEPTION 'Falta UPDATE worker en %',col; END IF;
  END LOOP;
  FOREACH col IN ARRAY ARRAY['syncStatus','lastFetchAt','lastFetchError','updatedAt'] LOOP
    IF NOT has_column_privilege('cc_results_worker','public.cx_race_uci_links',col,'UPDATE') THEN
      RAISE EXCEPTION 'Falta UPDATE worker en %',col; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='cx_race_categories' AND column_name NOT IN ('resultsStatus','resultsImportedAt','winnerName')
    AND has_column_privilege('cc_results_worker','public.cx_race_categories',column_name,'UPDATE'))
    OR has_table_privilege('cc_results_worker','public.cx_races','INSERT,UPDATE,DELETE')
    OR has_table_privilege('cc_results_worker','public.cx_tournaments','INSERT,UPDATE,DELETE')
    OR has_column_privilege('cc_results_worker','public.cx_race_uci_links','syncEnabled','UPDATE') THEN
    RAISE EXCEPTION 'El worker puede modificar agenda/configuración'; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'cx_worker_%'
    AND 'cc_results_worker'=ANY(roles) AND tablename IN ('cx_results','cx_tournament_standings')
    AND (qual='true' OR with_check='true'))<>8 THEN
    RAISE EXCEPTION 'Políticas worker de resultados/generales incompletas'; END IF;
END $$;

RESET ROLE;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub',current_setting('cc.cx_test_admin'),true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('cc.cx_test_admin'))::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE changed int;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Identidad administradora requerida'; END IF;
  PERFORM public.cc_check_request();
  UPDATE public.cx_races SET name='Edición administrativa' WHERE id=current_setting('cc.cx_test_race');
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'Admin no puede editar CX'; END IF;
  INSERT INTO public.cx_results("raceId",category,rank,"riderDisplay","sortOrder")
    VALUES(current_setting('cc.cx_test_race'),'ME',3,'ADMIN Prueba',2);
  IF NOT EXISTS(SELECT 1 FROM public.push_cx_race_subscriptions WHERE "subscriptionId"=current_setting('cc.cx_test_subscription')) THEN
    RAISE EXCEPTION 'Admin no puede leer seguimiento CX'; END IF;
  DELETE FROM public.cx_races WHERE id=current_setting('cc.cx_test_race');
END $$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.cx_results WHERE "raceId"=current_setting('cc.cx_test_race'))
    OR EXISTS(SELECT 1 FROM public.cx_broadcasts WHERE "raceId"=current_setting('cc.cx_test_race'))
    OR EXISTS(SELECT 1 FROM public.push_cx_race_subscriptions WHERE "raceId"=current_setting('cc.cx_test_race'))
    OR EXISTS(SELECT 1 FROM public.today_highlights WHERE "cxRaceId"=current_setting('cc.cx_test_race')) THEN
    RAISE EXCEPTION 'El borrado CX deja dependencias'; END IF;
END $$;
ROLLBACK;
SELECT 'CC-CX F1: restricciones, unidades, RLS/ACL, worker, Cintillo y RPC compatibles comprobados con rollback' AS result;
