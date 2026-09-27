-- Fixtures efímeros. Ejecutar completo mediante Supabase MCP.
BEGIN;
DO $test$
DECLARE
  host text := gen_random_uuid()::text;
  related text := gen_random_uuid()::text;
  home text := gen_random_uuid()::text;
  female_host text := gen_random_uuid()::text;
  edition text := gen_random_uuid()::text;
  man text := gen_random_uuid()::text;
  woman text := gen_random_uuid()::text;
  race text := gen_random_uuid()::text;
  season integer := extract(year FROM current_date)::integer;
  aff text; again text; snapshot jsonb; old_aff text;
BEGIN
  INSERT INTO public.teams(id,name,gender,category) VALUES
    (host,'ZZ anfitrión '||host,'male','WT'),
    (related,'ZZ relacionado '||related,'male','CT'),
    (home,'ZZ habitual '||home,'male','CLUBM'),
    (female_host,'ZZ femenino '||female_host,'female','WWT');
  INSERT INTO public.teams(id,name,gender,category,"specialEdition","parentTeamId")
    VALUES(edition,'ZZ maillot '||edition,'male','WT',true,host);
  INSERT INTO public.team_development_links("mainTeamId","developmentTeamId",year,"sourceUrl")
    VALUES(host,related,season,'https://example.test/official');
  INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate","currentTeamId")
    VALUES(man,'Zzprueba',man,'es','2002-01-01',home);
  INSERT INTO public.riders_women(id,"firstName","lastName",nationality,"birthDate","currentTeamId")
    VALUES(woman,'Zzprueba',woman,'es','2002-01-01',female_host);
  INSERT INTO public.races(id,name,gender,year,"startDate","endDate")
    VALUES(race,'ZZ prueba '||race,'male',season,make_date(season,8,1),make_date(season,8,3));
  SELECT to_jsonb(m) INTO snapshot FROM public.riders_men m WHERE id=man;
  aff := public.upsert_rider_trainee(man,'male',host,season,make_date(season,8,1),
    make_date(season,12,31),'https://www.uci.org/team-details/123',123,'regulatory_window',now());
  again := public.upsert_rider_trainee(man,'male',host,season,make_date(season,8,1),
    make_date(season,12,31),'https://www.uci.org/team-details/123',123,'regulatory_window',now());
  IF aff <> again OR (SELECT count(*) FROM public.rider_team_affiliations
    WHERE "riderId"=man AND "affiliationType"='trainee') <> 1 THEN
    RAISE EXCEPTION 'Duplicación en el reintento';
  END IF;
  IF snapshot IS DISTINCT FROM (SELECT to_jsonb(m) FROM public.riders_men m WHERE id=man) THEN
    RAISE EXCEPTION 'La prueba alteró la ficha o el equipo habitual';
  END IF;
  IF NOT public.startlist_team_roster(race,host) @> jsonb_build_array(jsonb_build_object('id',man,'affiliationType','trainee'))
    OR NOT public.startlist_team_roster(race,edition) @> jsonb_build_array(jsonb_build_object('id',man)) THEN
    RAISE EXCEPTION 'Falta autómatch directo o normalización del maillot';
  END IF;
  IF public.startlist_team_roster(race,related) @> jsonb_build_array(jsonb_build_object('id',man)) THEN
    RAISE EXCEPTION 'La prueba se propagó a otro equipo';
  END IF;
  UPDATE public.races SET "startDate"=make_date(season,7,31) WHERE id=race;
  IF public.startlist_team_roster(race,host) @> jsonb_build_array(jsonb_build_object('id',man)) THEN
    RAISE EXCEPTION 'Basta solapar agosto para activar la prueba';
  END IF;
  UPDATE public.races SET "startDate"=NULL WHERE id=race;
  IF public.startlist_team_roster(race,host) @> jsonb_build_array(jsonb_build_object('id',man)) THEN
    RAISE EXCEPTION 'Se activó la prueba sin fecha de inicio de carrera';
  END IF;
  UPDATE public.races SET "startDate"=make_date(season,12,31),"endDate"=make_date(season+1,1,1) WHERE id=race;
  IF public.startlist_team_roster(race,host) @> jsonb_build_array(jsonb_build_object('id',man)) THEN
    RAISE EXCEPTION 'La prueba excede su fecha final';
  END IF;
  UPDATE public.races SET "startDate"=make_date(season,12,31),"endDate"=make_date(season,12,31) WHERE id=race;
  IF NOT public.startlist_team_roster(race,host) @> jsonb_build_array(jsonb_build_object('id',man)) THEN
    RAISE EXCEPTION 'Se excluye incorrectamente el límite inclusivo';
  END IF;
  -- El trigger de ficha conserva la prueba y permite una afiliación habitual
  -- posterior al mismo anfitrión, con otra identidad de fila.
  UPDATE public.riders_men SET "currentTeamId"=host WHERE id=man;
  IF NOT EXISTS(SELECT 1 FROM public.rider_team_affiliations WHERE id=aff)
    OR (SELECT count(*) FROM public.rider_team_affiliations WHERE "riderId"=man AND "teamId"=host)<>2 THEN
    RAISE EXCEPTION 'La afiliación habitual sobrescribió la prueba';
  END IF;
  DELETE FROM public.rider_team_affiliations WHERE id=aff;
  IF (SELECT "currentTeamId" FROM public.riders_men WHERE id=man) IS DISTINCT FROM host THEN
    RAISE EXCEPTION 'Eliminar la prueba altera el equipo habitual';
  END IF;
  -- Reclasificación explícita de un falso vínculo habitual.
  SELECT id INTO old_aff FROM public.rider_team_affiliations WHERE "riderId"=woman;
  UPDATE public.rider_team_affiliations SET id=gen_random_uuid()::text,"affiliationType"='trainee',
    "dateFrom"=make_date(season,8,1),"dateTo"=make_date(season,12,31),
    "sourceUrl"='https://www.uci.org/team-details/124',"uciTeamProfileId"=124,
    "dateBasis"='regulatory_window',"verifiedAt"=now(),verified=true WHERE id=old_aff;
  IF (SELECT "currentTeamId" FROM public.riders_women WHERE id=woman) IS NOT NULL THEN
    RAISE EXCEPTION 'Reclasificar no retiró el equipo habitual incorrecto';
  END IF;
  BEGIN
    PERFORM public.upsert_rider_trainee(man,'male',female_host,season,make_date(season,8,1),
      make_date(season,12,31),'https://example.test/source',124,'regulatory_window',now());
    RAISE EXCEPTION 'Admite anfitrión de otro género';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.upsert_rider_trainee(man,'male',home,season,make_date(season,8,1),
      make_date(season,12,31),'https://example.test/source',124,'regulatory_window',now());
    RAISE EXCEPTION 'Admite club como anfitrión UCI';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.upsert_rider_trainee(man,'male',host,season,make_date(season,7,31),
      make_date(season,12,31),'https://example.test/source',124,'regulatory_window',now());
    RAISE EXCEPTION 'Ventana reglamentaria sin base para julio';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    PERFORM public.upsert_rider_trainee(man,'male',host,season,make_date(season,8,1),
      make_date(season,12,31),NULL,124,'regulatory_window',now());
    RAISE EXCEPTION 'Admite vínculo sin evidencia';
  EXCEPTION WHEN check_violation THEN NULL; END;
END;
$test$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.upsert_rider_trainee('none','male','none',2026,'2026-08-01',
      '2026-12-31','https://example.test/source',1,'regulatory_window',now());
    RAISE EXCEPTION 'RPC abierta sin administración';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
ROLLBACK;
SELECT 'OK: stagiaires, fechas, equipo habitual, aislamiento y permisos' AS result;
