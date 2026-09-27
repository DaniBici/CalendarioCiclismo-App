-- Ejecutar íntegramente por MCP. Todas las escrituras son reversibles: ROLLBACK.
BEGIN;
DO $test$
DECLARE
  club_id text := gen_random_uuid()::text;
  selection_id text := gen_random_uuid()::text;
  regional_id text := gen_random_uuid()::text;
  woman_id text := gen_random_uuid()::text;
  race_id text := gen_random_uuid()::text;
  club_entry text := gen_random_uuid()::text;
  selection_entry text := gen_random_uuid()::text;
  affiliation_id text := gen_random_uuid()::text;
  rider_id text;
  chosen_team text;
  constraint_name text;
  season integer := extract(year FROM now())::integer;
BEGIN
  INSERT INTO public.teams(id,name,category,gender,"teamKind","selectionScope")
  VALUES (club_id, 'ZZ prueba plantilla club ' || club_id, 'CLUBM','male','club',NULL),
         (selection_id,'ZZ prueba selección ' || selection_id,'NTM','male','club',NULL),
         (regional_id,'ZZ prueba región ' || regional_id,'CLUBM','male','selection','regional');
  INSERT INTO public.riders_women(id,"firstName","lastName")
    VALUES(woman_id,'Prueba','Selecciones ' || woman_id);

  FOREACH chosen_team IN ARRAY ARRAY[selection_id, regional_id] LOOP
    BEGIN
      INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateFrom")
      VALUES(gen_random_uuid()::text,'ouattara-allassane','male',chosen_team,season+1,make_date(season+1,7,1));
      RAISE EXCEPTION 'Se aceptó una afiliación futura de selección';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      IF constraint_name <> 'regular_team_roster_only' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.riders_men SET "currentTeamId"=chosen_team WHERE id='ouattara-allassane';
      RAISE EXCEPTION 'Se aceptó una selección como equipo actual masculino';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      IF constraint_name <> 'regular_team_roster_only' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.riders_women SET "currentTeamId"=chosen_team WHERE id=woman_id;
      RAISE EXCEPTION 'Se aceptó una selección como equipo actual femenino';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      IF constraint_name <> 'regular_team_roster_only' THEN RAISE; END IF;
    END;
  END LOOP;

  -- Ambos corredores reparados pueden ser convocados por un club o selección.
  INSERT INTO public.races(id,name,gender,year,"startDate","endDate")
    VALUES(race_id,'ZZ prueba convocatorias ' || race_id,'male',season,CURRENT_DATE,CURRENT_DATE);
  INSERT INTO public.startlist_teams(id,"raceId","teamName","teamId")
    SELECT club_entry,race_id,name,id FROM public.teams WHERE id=club_id;
  INSERT INTO public.startlist_teams(id,"raceId","teamName","teamId")
    SELECT selection_entry,race_id,name,id FROM public.teams WHERE id=regional_id;
  INSERT INTO public.startlist_riders(id,"raceId","teamId",dorsal,"firstName","lastName","globalRiderId")
    SELECT gen_random_uuid()::text,race_id,selection_entry,row_number() OVER (ORDER BY id),
           "firstName","lastName",id FROM public.riders_men
    WHERE id IN ('ouattara-allassane','tchumthoua-mouaffo-marc-didier');
  IF (SELECT count(*) FROM public.startlist_riders WHERE "raceId"=race_id) <> 2 THEN
    RAISE EXCEPTION 'No se conservaron las identidades de los dos corredores';
  END IF;
  IF EXISTS(SELECT 1 FROM public.riders_men WHERE id IN ('ouattara-allassane','tchumthoua-mouaffo-marc-didier')
            AND "currentTeamId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Una convocatoria modificó el equipo actual';
  END IF;
  UPDATE public.startlist_riders SET "teamId"=club_entry WHERE "raceId"=race_id;
  IF (SELECT count(*) FROM public.rider_team_affiliations
      WHERE "teamId"=club_id AND source='startlist_club') <> 2 THEN
    RAISE EXCEPTION 'Los dos corredores no se incorporaron automáticamente al club';
  END IF;
  DELETE FROM public.rider_team_affiliations WHERE "teamId"=club_id;

  -- La prohibición recae sobre la selección; ambos pueden tener un club regular.
  FOREACH rider_id IN ARRAY ARRAY['ouattara-allassane','tchumthoua-mouaffo-marc-didier'] LOOP
    INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year)
      VALUES(gen_random_uuid()::text,rider_id,'male',club_id,season);
    IF NOT EXISTS(SELECT 1 FROM public.riders_men WHERE id=rider_id AND "currentTeamId"=club_id) THEN
      RAISE EXCEPTION 'No se permite una afiliación posterior a un club';
    END IF;
  END LOOP;
  BEGIN
    UPDATE public.teams SET category='NTM' WHERE id=club_id;
    RAISE EXCEPTION 'Se permitió convertir una plantilla en selección';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'selection_without_roster' THEN RAISE; END IF;
  END;

  DELETE FROM public.rider_team_affiliations WHERE "teamId"=club_id;
  INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year)
    VALUES(affiliation_id,'ouattara-allassane','male',club_id,season+1);
  BEGIN
    UPDATE public.rider_team_affiliations SET "teamId"=selection_id WHERE id=affiliation_id;
    RAISE EXCEPTION 'Se aceptó trasladar una afiliación a una selección';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'regular_team_roster_only' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.teams SET "teamKind"='selection',"selectionScope"='regional' WHERE id=club_id;
    RAISE EXCEPTION 'Se ignoró la plantilla futura al reclasificar';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
    IF constraint_name <> 'selection_without_roster' THEN RAISE; END IF;
  END;
  DELETE FROM public.rider_team_affiliations WHERE id=affiliation_id;
  UPDATE public.teams SET category='NTM',"teamKind"='selection' WHERE id=club_id;
END;
$test$;
ROLLBACK;
