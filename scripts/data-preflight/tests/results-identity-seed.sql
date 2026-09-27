-- Integración reversible de la resolución de identidades y siembra automática.
BEGIN;
INSERT INTO public.races(id,name,gender,year) VALUES
 ('zz-test-result-guards','Prueba identidades resultados','female',2026),
 ('zz-test-result-seed','Prueba siembra completa','female',2026);
INSERT INTO public.race_uci_stages(id,"raceId","competitionId","uciRaceId","eventId","classKind") VALUES
 ('zz-guard-stage','zz-test-result-guards',-214000001,-214000001,-214000001,'stage'),
 ('zz-guard-stage-b','zz-test-result-guards',-214000001,-214000002,-214000002,'stage'),
 ('zz-seed-stage','zz-test-result-seed',-214000003,-214000003,-214000003,'stage');
INSERT INTO public.riders_women(id,"firstName","lastName",nationality,"birthDate")
 VALUES('zz-protected-result-guard','ZzProtectedGuard91','ZzSurname91','es','2000-01-02');
INSERT INTO public.race_uci_results("stageRef","raceId","eventId",bib,"riderDisplay","globalRiderId") VALUES
 ('zz-guard-stage','zz-test-result-guards',-214000001,'1','ZzAlphaGuard91 ZzFamily91',NULL),
 ('zz-guard-stage-b','zz-test-result-guards',-214000002,'1',NULL,NULL),
 ('zz-guard-stage','zz-test-result-guards',-214000001,'2','ZzMissingGuard93 ZzFamily93',NULL),
 ('zz-guard-stage','zz-test-result-guards',-214000001,'3','ZzProtectedGuard91 ZzSurname91',NULL),
 ('zz-guard-stage','zz-test-result-guards',-214000001,'4','ZzAnotherGuard94 ZzFamily94','zz-protected-result-guard');
DO $$
DECLARE v_result record; v_seed record; v_before jsonb;
  v_rows jsonb := '[
    {"bib":"1","eventIds":[-214000001],"display":"ZzAlphaGuard91 ZzFamily91","firstName":"ZzAlphaGuard91","lastName":"ZzFamily91","countryCode":"es","birthDate":"2000-01-02","teamName":"ZZ Guard Club91"},
    {"bib":"1","eventIds":[-214000002],"display":"ZzBetaGuard92 ZzFamily92","firstName":"ZzBetaGuard92","lastName":"ZzFamily92","countryCode":"fr","birthDate":"2001-03-04","teamName":"ZZ Guard National Selection92"},
    {"bib":"2","display":"ZzMissingGuard93 ZzFamily93","firstName":"ZzMissingGuard93","lastName":"ZzFamily93","countryCode":"de"},
    {"bib":"3","display":"ZzProtectedGuard91 ZzSurname91","firstName":"ZzProtectedGuard91","lastName":"ZzSurname91","countryCode":"es","birthDate":"2001-01-02"},
    {"bib":"4","display":"ZzAnotherGuard94 ZzFamily94","firstName":"ZzAnotherGuard94","lastName":"ZzFamily94","countryCode":"es","birthDate":"2000-01-02"}]';
BEGIN
  SELECT * INTO v_result FROM public.resolve_uci_results_by_name('zz-test-result-guards','female',v_rows);
  IF v_result.created<>2 OR v_result.unresolved<>2 THEN
    RAISE EXCEPTION 'Altas/enlaces incorrectos: %',row_to_json(v_result);
  END IF;
  SELECT * INTO v_result FROM public.resolve_uci_results_by_name('zz-test-result-guards','female',
    jsonb_build_array(jsonb_set(v_rows->2,'{birthDate}','"2000-02-31"')));
  IF v_result.created<>0 OR v_result.unresolved<>2 THEN
    RAISE EXCEPTION 'No bloquea la fecha inválida sin perder resultados';
  END IF;
  IF (SELECT count(DISTINCT "globalRiderId") FROM public.race_uci_results WHERE "raceId"='zz-test-result-guards' AND bib='1')<>2 THEN
    RAISE EXCEPTION 'Confunde el dorsal reutilizado';
  END IF;
  IF (SELECT "globalRiderId" FROM public.race_uci_results WHERE "raceId"='zz-test-result-guards' AND bib='4')<>'zz-protected-result-guard' THEN
    RAISE EXCEPTION 'Sobrescribe un enlace existente';
  END IF;
  SELECT * INTO v_seed FROM public.resolve_uci_startlist('zz-test-result-guards','female',v_rows);
  IF v_seed.riders_seeded<>0 OR EXISTS(SELECT 1 FROM public.startlist_teams WHERE "raceId"='zz-test-result-guards') THEN
    RAISE EXCEPTION 'Siembra una lista incompleta';
  END IF;
  v_rows := jsonb_build_array(
    jsonb_set(v_rows->0,'{eventIds}','[-214000003]'),
    jsonb_set(jsonb_set(v_rows->1,'{bib}','"2"'),'{eventIds}','[-214000003]'));
  INSERT INTO public.race_uci_results("stageRef","raceId","eventId",bib,"riderDisplay","globalRiderId")
  SELECT 'zz-seed-stage','zz-test-result-seed',-214000003,
    CASE WHEN "stageRef"='zz-guard-stage' THEN '1' ELSE '2' END,"riderDisplay","globalRiderId"
  FROM public.race_uci_results WHERE "raceId"='zz-test-result-guards' AND bib='1';
  SELECT * INTO v_seed FROM public.resolve_uci_startlist('zz-test-result-seed','female',v_rows);
  IF v_seed.riders_seeded<>2 OR v_seed.teams_seeded<>2 THEN
    RAISE EXCEPTION 'No siembra la lista completa: %',row_to_json(v_seed);
  END IF;
  IF EXISTS(SELECT 1 FROM public.startlist_riders WHERE "raceId"='zz-test-result-seed'
    AND ("firstName"='' OR "lastName"='' OR "countryCode" IS NULL OR "globalRiderId" IS NULL)) THEN
    RAISE EXCEPTION 'Guarda snapshots incompletos';
  END IF;
  IF (SELECT "startlistImportedAt" FROM public.races WHERE id='zz-test-result-seed') IS NOT NULL THEN
    RAISE EXCEPTION 'Publica una lista de soporte';
  END IF;
  SELECT jsonb_agg(to_jsonb(s) ORDER BY id) INTO v_before FROM public.startlist_riders s WHERE "raceId"='zz-test-result-seed';
  PERFORM public.resolve_uci_startlist('zz-test-result-seed','female',jsonb_build_array(v_rows->0));
  IF (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.startlist_riders s WHERE "raceId"='zz-test-result-seed') IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'La siembra sustituye una lista existente';
  END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.ensure_startlist_team('no-autorizado','ZZ No autorizado','female');
    RAISE EXCEPTION 'Permite crear equipos sin administración';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'OK: altas completas, homónimos, dorsales reutilizados, enlaces previos y siembra' AS result;
