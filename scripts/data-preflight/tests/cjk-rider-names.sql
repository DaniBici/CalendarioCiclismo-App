-- Ejecutar íntegro por Supabase MCP. No conserva datos de prueba.
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.races(id,name,gender,"year","startDate","endDate")
VALUES ('zz-test-cjk-20260904','Prueba CJK','male',2026,'2026-09-04','2026-09-04');
INSERT INTO public.race_days(id,"raceId","dateKey","editorialStatus")
VALUES ('zz-test-cjk-day-20260904','zz-test-cjk-20260904','2026-09-04','published');
INSERT INTO public.startlist_teams(id,"raceId","teamName")
VALUES ('zz-test-cjk-team-20260904','zz-test-cjk-20260904','Individual');
INSERT INTO public.race_uci_stages(id,"raceId","competitionId","uciRaceId","eventId","classKind","isTeamEvent")
VALUES ('zz-test-cjk-stage-20260904','zz-test-cjk-20260904',-609040900,-609040900,-609040900,'stage',false),
       ('zz-test-cjk-teams-20260904','zz-test-cjk-20260904',-609040900,-609040900,-609040901,'teams',true);
DO $test$
DECLARE actual record; expected record; resolved record;
BEGIN
  IF NOT has_function_privilege('cc_results_worker','public.remove_cjk_name_annotations(text)','EXECUTE')
     OR NOT has_function_privilege('cc_results_worker','public.normalize_cjk_rider_name(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Faltan permisos de normalización al recolector VPS';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('TSAI 雅羽 Ya Yu','蔡','Ya Yu','Tsai'),
    ('志濠 Chih Hao杜','Tu','Chih Hao','Tu'),
    ('晟伊 Sheng Yi','廖 Liao','Sheng Yi','Liao'),
    ('太郎 Taro','山田 Yamada','Taro','Yamada'),
    ('민수 Min Su','김 Kim','Min Su','Kim'),
    ('ﾀﾛｳ Taro','ﾔﾏﾀﾞ Yamada','Taro','Yamada'),
    ('José','Muñoz','José','Muñoz'),
    ('Jiří','Šťastný','Jiří','Šťastný'),
    ('Łukasz','O’Connor','Łukasz','O’Connor'),
    ('Александр','Власов','Александр','Власов')
  ) AS cases(first,last,new_first,new_last) LOOP
    SELECT * INTO actual FROM public.normalize_cjk_rider_name(expected.first,expected.last);
    IF actual."firstName" IS DISTINCT FROM expected.new_first
       OR actual."lastName" IS DISTINCT FROM expected.new_last THEN
      RAISE EXCEPTION 'Normalización inesperada: % -> %',expected,actual;
    END IF;
  END LOOP;
  IF public.remove_cjk_name_annotations(U&'\+020000\+030000 Taro Yamada') <> 'Taro Yamada' THEN
    RAISE EXCEPTION 'No cubre Han suplementario';
  END IF;
  BEGIN
    PERFORM public.normalize_cjk_rider_name('太郎','山田');
    RAISE EXCEPTION 'Acepta un nombre sin grafía latina';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.normalize_cjk_rider_name('Ya Yu','蔡');
    RAISE EXCEPTION 'Ha inventado un apellido';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate")
  VALUES ('zz-test-cjk-rider-20260904','TESTCJK 翔 Cjkcheckzeta','蔡','tw','2000-01-01');
  IF NOT EXISTS (SELECT 1 FROM public.riders_men WHERE id='zz-test-cjk-rider-20260904'
    AND "firstName"='Cjkcheckzeta' AND "lastName"='Testcjk'
    AND "identityKey"=public.compute_identity_key('Cjkcheckzeta','Testcjk')) THEN
    RAISE EXCEPTION 'Trigger de ficha o clave incorrectos';
  END IF;
  INSERT INTO public.riders_women(id,"firstName","lastName")
  VALUES ('zz-test-cjk-rider-w-20260904','太郎 Cjktestwomen','山田 Testcjk');
  IF NOT EXISTS (SELECT 1 FROM public.riders_women WHERE id='zz-test-cjk-rider-w-20260904'
    AND "firstName"='Cjktestwomen' AND "lastName"='Testcjk') THEN
    RAISE EXCEPTION 'No normaliza el catálogo femenino';
  END IF;
  INSERT INTO public.startlist_riders(id,"raceId","teamId",dorsal,"firstName","lastName")
  VALUES ('zz-test-cjk-sr-20260904','zz-test-cjk-20260904','zz-test-cjk-team-20260904',1,
          '太郎 Cjkcheckzeta','山田 Testcjk');
  UPDATE public.startlist_riders SET "firstName"='TESTCJK 翔 Cjkcheckzeta',"lastName"='蔡'
  WHERE id='zz-test-cjk-sr-20260904';
  IF NOT EXISTS (SELECT 1 FROM public.startlist_riders WHERE id='zz-test-cjk-sr-20260904'
    AND "firstName"='Cjkcheckzeta' AND "lastName"='Testcjk') THEN
    RAISE EXCEPTION 'No normaliza el snapshot de inscritos';
  END IF;
  INSERT INTO public.start_order_entries(id,"raceDayId",dorsal,"startTime","riderName")
  VALUES ('zz-test-cjk-order-20260904','zz-test-cjk-day-20260904',1,'12:00','翔 Cjkcheckzeta 蔡 Testcjk');
  IF NOT EXISTS (SELECT 1 FROM public.start_order_entries WHERE id='zz-test-cjk-order-20260904'
                 AND "riderName"='Cjkcheckzeta Testcjk') THEN
    RAISE EXCEPTION 'No normaliza el orden de salida';
  END IF;
  INSERT INTO public.race_uci_results(id,"stageRef","raceId","eventId",rank,"riderDisplay",bib)
  VALUES (-609040900,'zz-test-cjk-stage-20260904','zz-test-cjk-20260904',-609040900,1,'蔡 TESTCJK 翔 Cjkcheckzeta',NULL),
         (-609040901,'zz-test-cjk-teams-20260904','zz-test-cjk-20260904',-609040901,1,'日本チーム',NULL);
  IF (SELECT "riderDisplay" FROM public.race_uci_results WHERE id=-609040901) <> '日本チーム' THEN
    RAISE EXCEPTION 'Ha modificado un equipo';
  END IF;
  SELECT * INTO resolved FROM public.resolve_uci_results_by_name('zz-test-cjk-20260904','male',
    '[{"display":"蔡 TESTCJK 翔 Cjkcheckzeta","firstName":"TESTCJK 翔 Cjkcheckzeta","lastName":"蔡","countryCode":"tw","birthDate":"2000-01-01","eventIds":[-609040900]}]');
  IF resolved.created <> 0 OR resolved.unresolved <> 0
    OR NOT EXISTS (SELECT 1 FROM public.race_uci_results WHERE id=-609040900
                   AND "riderDisplay"='TESTCJK Cjkcheckzeta'
                   AND "globalRiderId"='zz-test-cjk-rider-20260904') THEN
    RAISE EXCEPTION 'No resuelve el resultado sin dorsal: %',resolved;
  END IF;
  BEGIN
    UPDATE public.race_uci_results SET "riderDisplay"='山田太郎' WHERE id=-609040900;
    RAISE EXCEPTION 'Acepta un resultado sin grafía latina';
  EXCEPTION WHEN check_violation THEN NULL; END;
END;
$test$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT * FROM public.normalize_cjk_rider_name('민수 Min Su','김 Kim');
ROLLBACK;
SELECT 'OK: nombres, identidades, snapshots, resolución sin dorsal, equipos y permisos' AS result;
