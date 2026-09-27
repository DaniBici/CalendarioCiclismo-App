-- F6: referencias del catálogo con fixtures aislados y sin avisos enviados.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';
DO $$ DECLARE admin_id uuid;
BEGIN
  SELECT user_id INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',admin_id)::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  trophy text:=gen_random_uuid()::text; race_id text:=gen_random_uuid()::text;
  control_race text:=gen_random_uuid()::text; shared_id text:=gen_random_uuid()::text;
  control_id text:=gen_random_uuid()::text; team_id text:=gen_random_uuid()::text;
  control_team text:=gen_random_uuid()::text; race jsonb; categories jsonb;
  preparation jsonb; gender text; category_code text; rejected boolean;
  broadcasts_before jsonb; videos_before jsonb; results_before jsonb;
  rows_before jsonb; standings_before jsonb; expected jsonb;
BEGIN
  PERFORM public.cx_save_tournament(jsonb_build_object('id',trophy,'name','Fixture referencias F6',
    'slug',trophy,'seasonKey','2026-27','pointsScheme',
    '{"categories":{"ME":{"mode":"points","perRank":[25,20]},"WE":{"mode":"points","perRank":[25,20]}}}'::jsonb));
  INSERT INTO public.cx_teams(id,name,"uciCode",gender,"colorHex") VALUES
    (team_id,'Equipo fixture','F6A','mixed','#008800'),
    (control_team,'Equipo control','F6B','male','#333333');
  INSERT INTO public.cx_riders_men(id,"firstName","lastName",nationality,"currentTeamId") VALUES
    (shared_id,'Nombre','Fixture','BE',team_id),(control_id,'Control','Fixture','BE',control_team);
  -- Mismo ID en los dos catálogos: borrar uno nunca afecta al otro género.
  INSERT INTO public.cx_riders_women(id,"firstName","lastName",nationality,"currentTeamId")
    VALUES(shared_id,'Nombre','Fixture','BE',team_id);
  race:=jsonb_build_object('id',race_id,'name','Carrera fixture','slug',race_id,'seasonKey','2026-27',
    'seasonStartYear',2026,'dateKey','2026-11-01','class','C2','timezone','Europe/Brussels','tournamentId',trophy);
  categories:='[{"category":"ME","dateKey":"2026-11-01"},{"category":"WE","dateKey":"2026-11-01"}]';
  PERFORM public.cx_save_race(race,categories);
  PERFORM public.cx_save_race(race||jsonb_build_object('id',control_race,'slug',control_race),
    '[{"category":"ME","dateKey":"2026-11-01"}]');
  FOREACH category_code IN ARRAY ARRAY['ME','WE'] LOOP
    preparation:=public.cx_prepare_startlist_import(race_id,category_code,jsonb_build_object(
      'sourceUrl','https://example.org/fixture-startlist','rows',jsonb_build_array(jsonb_build_object(
        'bib','01','firstName','Nombre','lastName','Fixture','countryCode','BE','globalRiderId',shared_id,'teamId',team_id))));
    PERFORM public.cx_apply_startlist_import((preparation->>'importId')::uuid);
    PERFORM public.cx_replace_results(race_id,category_code,jsonb_build_array(jsonb_build_object(
      'rank',1,'bib','01','riderDisplay','Nombre Fixture','globalRiderId',shared_id,'teamName','Equipo fixture',
      'isoCode2','BE','timeSeconds',3600)),'official','{"sourceUrl":"https://example.org/fixture-results","lockAutomatic":true}');
    INSERT INTO public.cx_tournament_standings("tournamentId","seasonKey",category,rank,points,"globalRiderId","riderDisplay","teamName",source)
      VALUES(trophy,'2026-27',category_code,1,25,shared_id,'Nombre Fixture','Equipo fixture','manual');
  END LOOP;
  preparation:=public.cx_prepare_startlist_import(control_race,'ME',jsonb_build_object(
    'sourceUrl','https://example.org/control-startlist','rows',jsonb_build_array(jsonb_build_object(
      'bib','02','firstName','Control','lastName','Fixture','countryCode','BE','globalRiderId',control_id,'teamId',control_team))));
  PERFORM public.cx_apply_startlist_import((preparation->>'importId')::uuid);
  PERFORM public.cx_replace_results(control_race,'ME',jsonb_build_array(jsonb_build_object(
    'rank',1,'riderDisplay','Control Fixture','globalRiderId',control_id,'teamName','Equipo control')),
    'official','{"sourceUrl":"https://example.org/control-results"}');
  PERFORM public.cx_save_media(race_id,'broadcasts',jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid()::text,'category','ME','channel','Fixture ME','url','https://example.org/tv-me','country','BE'),
    jsonb_build_object('id',gen_random_uuid()::text,'category','WE','channel','Fixture WE','url','https://example.org/tv-we','country','BE'),
    jsonb_build_object('id',gen_random_uuid()::text,'channel','Fixture global','url','https://example.org/tv-global','country','ALL')));
  PERFORM public.cx_save_media(race_id,'videos',jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid()::text,'category','WE','title','Fixture WE','url','https://example.org/video-we'),
    jsonb_build_object('id',gen_random_uuid()::text,'title','Fixture global','url','https://example.org/video-global')));
  INSERT INTO public.cx_race_uci_links("raceId","competitionId","seasonId")
    SELECT race_id,coalesce(max("competitionId"),0)+1,472 FROM public.cx_race_uci_links;

  rejected:=false;
  BEGIN DELETE FROM public.cx_tournaments WHERE id=trophy;
  EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected OR NOT EXISTS(SELECT 1 FROM public.cx_tournaments WHERE id=trophy) THEN
    RAISE EXCEPTION 'Eliminar trofeo con carreras no queda protegido'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_save_tournament(jsonb_build_object('id',trophy,'name','Cambio rechazado','slug',trophy,'seasonKey','2027-28'));
  EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected OR (SELECT "seasonKey" FROM public.cx_tournaments WHERE id=trophy)<>'2026-27'
    OR (SELECT name FROM public.cx_tournaments WHERE id=trophy)<>'Fixture referencias F6' THEN
    RAISE EXCEPTION 'Cambiar temporada del trofeo rompe referencias o no es atómico'; END IF;

  DELETE FROM public.cx_teams WHERE id=team_id;
  IF EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=shared_id AND "currentTeamId" IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.cx_riders_women WHERE id=shared_id AND "currentTeamId" IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.cx_startlist_riders WHERE "raceId"=race_id AND "teamId" IS NOT NULL)
    OR (SELECT "currentTeamId" FROM public.cx_riders_men WHERE id=control_id) IS DISTINCT FROM control_team
    OR (SELECT "teamId" FROM public.cx_startlist_riders WHERE "raceId"=control_race) IS DISTINCT FROM control_team
    OR EXISTS(SELECT 1 FROM public.cx_results WHERE "raceId"=race_id AND "teamName"<>'Equipo fixture') THEN
    RAISE EXCEPTION 'Eliminar equipo afecta al control o pierde texto/referencias'; END IF;

  FOREACH gender IN ARRAY ARRAY['men','women'] LOOP
    category_code:=CASE gender WHEN 'men' THEN 'ME' ELSE 'WE' END;
    SELECT to_jsonb(r) INTO results_before FROM public.cx_results r WHERE "raceId"=race_id AND category=category_code;
    SELECT to_jsonb(r) INTO rows_before FROM public.cx_startlist_riders r WHERE "raceId"=race_id AND category=category_code;
    SELECT to_jsonb(r) INTO standings_before FROM public.cx_tournament_standings r WHERE "tournamentId"=trophy AND category=category_code;
    IF results_before IS NULL OR rows_before IS NULL OR standings_before IS NULL THEN
      RAISE EXCEPTION 'Fixture de referencias incompleto para %',gender; END IF;
    PERFORM public.cx_delete_rider(shared_id,gender);
    expected:=jsonb_set(results_before,'{globalRiderId}','null');
    IF (SELECT to_jsonb(r) FROM public.cx_results r WHERE "raceId"=race_id AND category=category_code) IS DISTINCT FROM expected
      OR (SELECT to_jsonb(r) FROM public.cx_startlist_riders r WHERE "raceId"=race_id AND category=category_code) IS DISTINCT FROM jsonb_set(rows_before,'{globalRiderId}','null')
      OR (SELECT to_jsonb(r) FROM public.cx_tournament_standings r WHERE "tournamentId"=trophy AND category=category_code) IS DISTINCT FROM jsonb_set(standings_before,'{globalRiderId}','null')
      OR NOT EXISTS(SELECT 1 FROM public.cx_race_categories WHERE "raceId"=race_id AND category=category_code AND "resultsStatus"='official' AND "resultsLockedAt" IS NOT NULL) THEN
      RAISE EXCEPTION 'Borrar ficha % altera datos publicados o deja referencias',gender; END IF;
    IF gender='men' AND (NOT EXISTS(SELECT 1 FROM public.cx_riders_women WHERE id=shared_id)
      OR (SELECT "globalRiderId" FROM public.cx_results WHERE "raceId"=race_id AND category='WE') IS DISTINCT FROM shared_id
      OR (SELECT "globalRiderId" FROM public.cx_startlist_riders WHERE "raceId"=race_id AND category='WE') IS DISTINCT FROM shared_id
      OR (SELECT "globalRiderId" FROM public.cx_tournament_standings WHERE "tournamentId"=trophy AND category='WE') IS DISTINCT FROM shared_id) THEN
      RAISE EXCEPTION 'Borrar hombre cambia el catálogo o las referencias femeninas'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=shared_id)
    OR EXISTS(SELECT 1 FROM public.cx_riders_women WHERE id=shared_id) THEN
    RAISE EXCEPTION 'Borrar ficha conserva un registro del catálogo'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_delete_rider(control_id,'mixed');
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected OR NOT EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=control_id) THEN
    RAISE EXCEPTION 'Género inválido aceptado al borrar ficha'; END IF;
  rejected:=false;
  BEGIN PERFORM public.cx_delete_rider(shared_id,'women');
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Borrado de ficha inexistente aceptado'; END IF;

  SELECT jsonb_agg(to_jsonb(r) ORDER BY id) INTO broadcasts_before FROM public.cx_broadcasts r WHERE "raceId"=race_id;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY id) INTO videos_before FROM public.cx_videos r WHERE "raceId"=race_id;
  rejected:=false;
  BEGIN PERFORM public.cx_save_race(race||jsonb_build_object('name','Cambio rechazado'),'[{"category":"ME"}]');
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true; END;
  IF NOT rejected OR (SELECT name FROM public.cx_races WHERE id=race_id)<>'Carrera fixture'
    OR (SELECT count(*) FROM public.cx_race_categories WHERE "raceId"=race_id)<>2
    OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cx_broadcasts r WHERE "raceId"=race_id) IS DISTINCT FROM broadcasts_before
    OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cx_videos r WHERE "raceId"=race_id) IS DISTINCT FROM videos_before THEN
    RAISE EXCEPTION 'Retirar categoría sin intención no conserva identidad y medios'; END IF;
  PERFORM public.cx_save_race(race,'[{"category":"ME"}]',true);
  IF EXISTS(SELECT 1 FROM public.cx_startlist_riders WHERE "raceId"=race_id AND category='WE')
    OR EXISTS(SELECT 1 FROM public.cx_results WHERE "raceId"=race_id AND category='WE')
    OR EXISTS(SELECT 1 FROM public.cx_broadcasts WHERE "raceId"=race_id AND category='WE')
    OR EXISTS(SELECT 1 FROM public.cx_videos WHERE "raceId"=race_id AND category='WE')
    OR (SELECT count(*) FROM public.cx_broadcasts WHERE "raceId"=race_id)<>2
    OR (SELECT count(*) FROM public.cx_videos WHERE "raceId"=race_id)<>1
    OR (SELECT count(*) FROM public.cx_results WHERE "raceId"=race_id AND category='ME')<>1 THEN
    RAISE EXCEPTION 'Retirar WE borra ME/global o conserva datos de la categoría'; END IF;
  DELETE FROM public.cx_races WHERE id=race_id;
  IF EXISTS(SELECT 1 FROM public.cx_race_categories WHERE "raceId"=race_id)
    OR EXISTS(SELECT 1 FROM public.cx_startlist_riders WHERE "raceId"=race_id)
    OR EXISTS(SELECT 1 FROM public.cx_results WHERE "raceId"=race_id)
    OR EXISTS(SELECT 1 FROM public.cx_broadcasts WHERE "raceId"=race_id)
    OR EXISTS(SELECT 1 FROM public.cx_videos WHERE "raceId"=race_id)
    OR EXISTS(SELECT 1 FROM public.cx_race_uci_links WHERE "raceId"=race_id)
    OR (SELECT "globalRiderId" FROM public.cx_results WHERE "raceId"=control_race) IS DISTINCT FROM control_id
    OR NOT EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=control_id) THEN
    RAISE EXCEPTION 'Eliminar carrera deja datos o afecta al control'; END IF;
  DELETE FROM public.cx_races WHERE id=control_race;
  DELETE FROM public.cx_tournaments WHERE id=trophy;
  IF EXISTS(SELECT 1 FROM public.cx_tournament_standings WHERE "tournamentId"=trophy) THEN
    RAISE EXCEPTION 'Eliminar trofeo sin carreras deja generales'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'cc_cx_catalog_references_ok' AS result;
