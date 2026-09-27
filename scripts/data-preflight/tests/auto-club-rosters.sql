-- Regla futura de clubes: ejecutar íntegra mediante MCP; siempre ROLLBACK.
BEGIN;
DO $test$
DECLARE
  club_id text := gen_random_uuid()::text;
  other_club text := gen_random_uuid()::text;
  uci_team text := gen_random_uuid()::text;
  female_club text := gen_random_uuid()::text;
  selection_id text := gen_random_uuid()::text;
  man_id text := gen_random_uuid()::text;
  woman_id text := gen_random_uuid()::text;
  race_id text := gen_random_uuid()::text;
  next_race text := gen_random_uuid()::text;
  female_race text := gen_random_uuid()::text;
  team_entry text := gen_random_uuid()::text;
  next_entry text := gen_random_uuid()::text;
  female_entry text := gen_random_uuid()::text;
  rider_entry text := gen_random_uuid()::text;
  season integer := extract(year FROM now())::integer;
  before_aff jsonb;
BEGIN
  INSERT INTO public.teams(id,name,category,gender,"teamKind")
  VALUES(club_id,'ZZ club '||club_id,'CLUBM','male','club'),
        (other_club,'ZZ otro club '||other_club,'CLUBM','male','club'),
        (uci_team,'ZZ UCI '||uci_team,'CT','male','club'),
        (female_club,'ZZ club femenino '||female_club,'CLUBW','female','club'),
        (selection_id,'ZZ selección '||selection_id,'NTM','male','selection');
  INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate")
    VALUES(man_id,'Zzroster','Prueba '||man_id,'es','2000-01-02');
  INSERT INTO public.riders_women(id,"firstName","lastName",nationality,"birthDate")
    VALUES(woman_id,'Zzroster','Prueba '||woman_id,'es','2000-01-02');
  INSERT INTO public.races(id,name,gender,year,"startDate","endDate")
  VALUES(race_id,'ZZ carrera '||race_id,'male',season,CURRENT_DATE,CURRENT_DATE),
        (next_race,'ZZ carrera futura '||next_race,'male',season+1,make_date(season+1,1,1),make_date(season+1,1,1)),
        (female_race,'ZZ carrera femenina '||female_race,'female',season,CURRENT_DATE,CURRENT_DATE);
  INSERT INTO public.startlist_teams(id,"raceId","teamId","teamName")
    SELECT team_entry,race_id,id,name FROM public.teams WHERE id=club_id;
  INSERT INTO public.startlist_teams(id,"raceId","teamId","teamName")
    SELECT next_entry,next_race,id,name FROM public.teams WHERE id=other_club;
  INSERT INTO public.startlist_teams(id,"raceId","teamId","teamName")
    SELECT female_entry,female_race,id,name FROM public.teams WHERE id=female_club;

  -- Permite enlazar la ficha después de importar el snapshot.
  INSERT INTO public.startlist_riders(id,"raceId","teamId",dorsal,"firstName","lastName")
    VALUES(rider_entry,race_id,team_entry,1,'Zzroster','Prueba '||man_id);
  UPDATE public.startlist_riders SET "globalRiderId"=man_id WHERE id=rider_entry;
  IF NOT EXISTS(SELECT 1 FROM public.rider_team_affiliations
                WHERE "riderId"=man_id AND "teamId"=club_id AND year=season
                  AND source='startlist_club' AND NOT verified)
     OR NOT EXISTS(SELECT 1 FROM public.riders_men WHERE id=man_id AND "currentTeamId"=club_id) THEN
    RAISE EXCEPTION 'El enlace posterior no añadió la plantilla ni su equipo actual';
  END IF;
  SELECT to_jsonb(a) INTO before_aff FROM public.rider_team_affiliations a
    WHERE "riderId"=man_id AND "teamId"=club_id;
  UPDATE public.startlist_riders SET "globalRiderId"=man_id WHERE id=rider_entry;
  IF (SELECT count(*) FROM public.rider_team_affiliations WHERE "riderId"=man_id AND "teamId"=club_id) <> 1
     OR before_aff IS DISTINCT FROM (SELECT to_jsonb(a) FROM public.rider_team_affiliations a
                                    WHERE "riderId"=man_id AND "teamId"=club_id) THEN
    RAISE EXCEPTION 'El reintento no es idempotente';
  END IF;

  INSERT INTO public.startlist_riders(id,"raceId","teamId",dorsal,"firstName","lastName","globalRiderId")
    VALUES(gen_random_uuid()::text,female_race,female_entry,1,'Zzroster','Prueba '||woman_id,woman_id);
  IF NOT EXISTS(SELECT 1 FROM public.rider_team_affiliations
                WHERE "riderId"=woman_id AND "riderGender"='female' AND "teamId"=female_club) THEN
    RAISE EXCEPTION 'No se incorporó la corredora al club femenino';
  END IF;

  INSERT INTO public.startlist_riders(id,"raceId","teamId",dorsal,"firstName","lastName","globalRiderId")
    VALUES(gen_random_uuid()::text,next_race,next_entry,1,'Zzroster','Prueba '||man_id,man_id);
  IF NOT EXISTS(SELECT 1 FROM public.rider_team_affiliations
                WHERE "riderId"=man_id AND "teamId"=other_club AND year=season+1)
     OR NOT EXISTS(SELECT 1 FROM public.riders_men WHERE id=man_id AND "currentTeamId"=club_id) THEN
    RAISE EXCEPTION 'No se respetó la temporada futura';
  END IF;

  -- La afiliación curada conserva sus fechas y prioridad como equipo actual.
  INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,source,"dateFrom")
    VALUES(gen_random_uuid()::text,man_id,'male',uci_team,season,'manual',make_date(season,1,1));
  UPDATE public.startlist_teams SET "teamId"=other_club,"teamName"='ZZ otro club '||other_club WHERE id=team_entry;
  IF NOT EXISTS(SELECT 1 FROM public.rider_team_affiliations
                WHERE "riderId"=man_id AND "teamId"=other_club AND year=season)
     OR NOT EXISTS(SELECT 1 FROM public.riders_men WHERE id=man_id AND "currentTeamId"=uci_team)
     OR NOT EXISTS(SELECT 1 FROM public.rider_team_affiliations
                    WHERE "riderId"=man_id AND "teamId"=uci_team AND "dateFrom"=make_date(season,1,1)) THEN
    RAISE EXCEPTION 'No se añadió el club o se sobrescribió la afiliación curada';
  END IF;

  UPDATE public.startlist_teams SET "teamId"=selection_id,"teamName"='ZZ selección '||selection_id WHERE id=team_entry;
  IF EXISTS(SELECT 1 FROM public.rider_team_affiliations WHERE "riderId"=man_id AND "teamId"=selection_id) THEN
    RAISE EXCEPTION 'Una selección recibió plantilla';
  END IF;
END;
$test$;
ROLLBACK;
