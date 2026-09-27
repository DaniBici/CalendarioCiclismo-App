-- Contratos CX con fixtures locales a la transacción. Ejecutar vía MCP.
BEGIN;
DO $$ DECLARE admin_id uuid; BEGIN
  SELECT user_id INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',admin_id)::text,true);
  PERFORM set_config('cc.cx_f2_id',gen_random_uuid()::text,true);
  PERFORM set_config('cc.cx_f2_tournament',gen_random_uuid()::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE r text:=current_setting('cc.cx_f2_id'); t text:=current_setting('cc.cx_f2_tournament');
  manifest jsonb; result jsonb; race jsonb; categories jsonb; prep jsonb; rejected boolean; imported_id text; before_count integer;
BEGIN
  IF NOT public.cx_require_admin() THEN RAISE EXCEPTION 'Falta admin'; END IF;
  INSERT INTO public.cx_tournaments(id,name,slug,"seasonKey","pointsScheme")
    VALUES(t,'Test X2O',t,'2026-27','{"categories":{"ME":{"mode":"time"}}}');
  race:=jsonb_build_object('id',r,'name','Test F2','slug',r,'seasonKey','2026-27','seasonStartYear',2026,'dateKey','2026-11-01','class','C1','timezone','Europe/Brussels','tournamentId',t);
  categories:='[{"category":"ME","dateKey":"2026-11-01","startTimeUtc":"2026-11-01T14:00:00Z"},{"category":"WE"}]';
  IF public.cx_save_race(race,categories)<>r THEN RAISE EXCEPTION 'Identidad no conservada'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_save_race(race,'[{"category":"ME"}]'); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected OR (SELECT count(*) FROM public.cx_race_categories WHERE "raceId"=r)<>2 THEN RAISE EXCEPTION 'Eliminación accidental de categorías'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_save_race(race,'[{"category":"ME","startTimeUtc":"2026-11-02T14:00:00Z"},{"category":"WE"}]'); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Horario fuera del día aceptado'; END IF;
  INSERT INTO public.cx_riders_men(id,"firstName","lastName",nationality) VALUES(r,'Nombre','Apellido','BE');
  INSERT INTO public.cx_riders_women(id,"firstName","lastName",nationality) VALUES(r||'-women','Nombre','Apellido','BE');
  prep:=public.cx_prepare_startlist_import(r,'ME',jsonb_build_object('sourceUrl','https://example.org/startlist','rows',jsonb_build_array(jsonb_build_object('bib','1','firstName','Nombre','lastName','Apellido','countryCode','BE'))));
  IF prep->>'matched'<>'1' OR prep#>>'{rows,0,globalRiderId}'<>r THEN RAISE EXCEPTION 'Matching CX por género fallido'; END IF;
  PERFORM public.cx_apply_startlist_import((prep->>'importId')::uuid);
  PERFORM public.cx_apply_startlist_import((prep->>'importId')::uuid);
  IF (SELECT count(*) FROM public.cx_startlist_riders WHERE "raceId"=r)<>1 THEN RAISE EXCEPTION 'Aplicación no idempotente'; END IF;
  prep:=public.cx_prepare_startlist_import(r,'ME',jsonb_build_object('sourceUrl','https://example.org/startlist','rows',jsonb_build_array(jsonb_build_object('firstName','Nombre','lastName','Apellido','countryCode','BE'))));
  UPDATE public.cx_startlist_riders SET bib='2' WHERE "raceId"=r;
  rejected:=false;
  BEGIN PERFORM public.cx_apply_startlist_import((prep->>'importId')::uuid); EXCEPTION WHEN serialization_failure THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Importación obsoleta aplicada'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_prepare_startlist_import(r,'ME',jsonb_build_object('sourceUrl','https://example.org','rows',jsonb_build_array(jsonb_build_object('firstName','Nombre','lastName','Apellido','globalRiderId',r||'-women')))); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Ficha femenina aceptada en ME'; END IF;
  PERFORM public.cx_replace_results(r,'ME',jsonb_build_array(jsonb_build_object('rank',1,'riderDisplay','Apellido Nombre','globalRiderId',r,'timeSeconds',3600)),'official','{"sourceUrl":"https://example.org/results"}');
  IF (SELECT "bonusSeconds" FROM public.cx_results WHERE "raceId"=r) IS NOT NULL THEN RAISE EXCEPTION 'Bonos desconocidos convertidos a cero'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_replace_results(r,'ME','[{"rank":1,"riderDisplay":"Cambio","bonusSeconds":15}]','official','{"sourceUrl":"https://example.org/results"}'); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected OR (SELECT "riderDisplay" FROM public.cx_results WHERE "raceId"=r)<>'Apellido Nombre' THEN RAISE EXCEPTION 'Bono sin fuente o reemplazo no atómico'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_replace_results(r,'ME','[{"rank":1,"riderDisplay":"Cambio","bonusPoints":15}]','official','{"sourceUrl":"https://example.org/results","adjustmentReason":"Test","adjustmentSourceUrl":"https://example.org/adjustment"}'); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Puntos aceptados en X2O'; END IF;
  PERFORM public.cx_replace_results(r,'ME','[{"rank":1,"riderDisplay":"Apellido Nombre","timeSeconds":3600,"bonusSeconds":0}]','official','{"sourceUrl":"https://example.org/results","bonusSourceUrl":"https://example.org/bonuses"}');
  IF (SELECT "bonusSeconds" FROM public.cx_results WHERE "raceId"=r)<>0 THEN RAISE EXCEPTION 'Cero confirmado no conservado'; END IF;
  manifest:=jsonb_build_object('version',1,'source','uci_web_calendar','seasonKey','2026-27','summary',jsonb_build_object('races',1,'categories',1),'races',jsonb_build_array(jsonb_build_object('race',jsonb_build_object('name','Calendario Test','slug',r||'-calendar','seasonKey','2026-27','seasonStartYear',2026,'dateKey','2026-11-01','class','C2','countryCode','BE','uciCalendarId',2147483001,'calendarSourceUrl','https://www.uci.org/competition-details/2027/CRO/2147483001'),'categories',jsonb_build_array(jsonb_build_object('category','ME','dateKey','2026-11-01','sortOrder',0)))));
  result:=public.cx_import_calendar(manifest);
  IF result->>'inserted'<>'1' THEN RAISE EXCEPTION 'Alta desde calendario no funciona'; END IF;
  SELECT id INTO imported_id FROM public.cx_races WHERE "seasonKey"='2026-27' AND "uciCalendarId"=2147483001;
  UPDATE public.cx_races SET name='Nombre editorial',"isCancelled"=true WHERE id=imported_id;
  UPDATE public.cx_race_categories SET "startTimeUtc"='2026-11-01T14:00:00Z' WHERE "raceId"=imported_id;
  result:=public.cx_import_calendar(manifest);
  IF result->>'updated'<>'1' OR (SELECT name FROM public.cx_races WHERE id=imported_id)<>'Nombre editorial'
    OR NOT (SELECT "isCancelled" FROM public.cx_races WHERE id=imported_id)
    OR (SELECT "startTimeUtc" FROM public.cx_race_categories WHERE "raceId"=imported_id) IS NULL THEN RAISE EXCEPTION 'Reimportación destructiva'; END IF;
  SELECT count(*) INTO before_count FROM public.cx_races;
  rejected:=false;
  BEGIN PERFORM public.cx_import_calendar(jsonb_set(manifest,'{summary,categories}','2')); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected OR (SELECT count(*) FROM public.cx_races)<>before_count THEN RAISE EXCEPTION 'Manifiesto incompleto aceptado'; END IF;
  PERFORM public.cx_save_media(r,'broadcasts',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'category','ME','channel','Sporza','url','https://example.org/tv','country','BE','showInRevive',true,'isSporza',true)));
  IF (SELECT count(*) FROM public.cx_broadcasts WHERE "raceId"=r)<>1 THEN RAISE EXCEPTION 'TV no guardada'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_save_media(r,'broadcasts',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'category','WU','url','https://example.org/tv'))); EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected OR (SELECT count(*) FROM public.cx_broadcasts WHERE "raceId"=r)<>1 THEN RAISE EXCEPTION 'TV sin categoría o cambio no atómico'; END IF;
  PERFORM public.cx_save_media(r,'broadcasts','[]');
  IF EXISTS(SELECT 1 FROM public.cx_broadcasts WHERE "raceId"=r) THEN RAISE EXCEPTION 'Diff de TV no elimina enlaces'; END IF;
  PERFORM public.cx_save_tournament(jsonb_build_object('id',t,'name','Test X2O','slug',t,'seasonKey','2026-27','pointsScheme','{"categories":{"ME":{"mode":"time"},"WE":{"mode":"points","perRank":[25,20]}}}'::jsonb));
  rejected:=false;
  BEGIN PERFORM public.cx_save_tournament(jsonb_build_object('id',t,'name','Test X2O','slug',t,'seasonKey','2026-27','pointsScheme','{"categories":{"ME":{"mode":"time","perRank":[25]}}}'::jsonb)); EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Reglamento mezcla unidades'; END IF;
  PERFORM public.cx_delete_rider(r,'men');
  IF EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=r) OR EXISTS(SELECT 1 FROM public.cx_results WHERE "raceId"=r AND "globalRiderId"=r)
    OR (SELECT "riderDisplay" FROM public.cx_results WHERE "raceId"=r)<>'Apellido Nombre' THEN RAISE EXCEPTION 'Borrar ficha deja referencia o pierde texto'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',current_setting('request.jwt.claim.sub'))::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE rejected boolean:=false; BEGIN
  BEGIN PERFORM public.cx_import_calendar('{}'); EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Usuario ordinario importa calendario'; END IF;
  IF EXISTS(SELECT 1 FROM private.cx_change_log WHERE "raceId"=current_setting('cc.cx_f2_id')) THEN RAISE EXCEPTION 'Auditoría privada expuesta'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f regprocedure; BEGIN
  FOREACH f IN ARRAY ARRAY['public.cx_require_admin()'::regprocedure,'public.cx_import_calendar(jsonb)'::regprocedure,'public.cx_save_race(jsonb,jsonb,boolean)'::regprocedure,'public.cx_prepare_startlist_import(text,text,jsonb)'::regprocedure,'public.cx_apply_startlist_import(uuid)'::regprocedure,'public.cx_replace_results(text,text,jsonb,text,jsonb)'::regprocedure] LOOP
    IF has_function_privilege('anon',f,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid=f AND a.grantee=0)
      OR (SELECT prosecdef FROM pg_proc WHERE oid=f) THEN RAISE EXCEPTION 'Contrato expuesto o SECURITY DEFINER: %',f; END IF;
  END LOOP;
END $$;
ROLLBACK;
SELECT 'cc_cx_f2_ok' AS result;
