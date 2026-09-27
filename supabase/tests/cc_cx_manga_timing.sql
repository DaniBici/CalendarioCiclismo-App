-- Ejecutar vía MCP. No conserva carreras, horarios ni resultados de prueba.
BEGIN;
DO $$ DECLARE admin_id uuid; BEGIN
  SELECT user_id INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',admin_id)::text,true);
  PERFORM set_config('cc.cx_timing_id',gen_random_uuid()::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE r text:=current_setting('cc.cx_timing_id'); race jsonb; cats jsonb; rejected boolean; code text; expected integer;
BEGIN
  race:=jsonb_build_object('id',r,'name','Prueba temporal CX','slug',r,'seasonKey','2026-27','seasonStartYear',2026,'dateKey','2027-01-30','endDateKey','2027-01-31','class','CM','timezone','Europe/Brussels');
  SELECT jsonb_agg(jsonb_build_object('category',category,'dateKey',CASE WHEN category='ME' THEN '2027-01-31' ELSE '2027-01-30' END,
    'startTimeUtc',CASE WHEN category='ME' THEN '2027-01-31T14:00:00Z' ELSE '2027-01-30T14:00:00Z' END,
    'durationFormat','individual','durationRuleVersion','2026-07-01')) INTO cats
    FROM unnest(ARRAY['ME','WE','MU','WU','MJ','WJ']) AS category;
  PERFORM public.cx_save_race(race,cats);
  FOR code,expected IN SELECT * FROM (VALUES ('ME',60),('WE',50),('MU',50),('WU',45),('MJ',40),('WJ',40)) v LOOP
    ASSERT (SELECT "durationMinutes"=expected FROM public.cx_race_categories WHERE "raceId"=r AND category=code),'Duración UCI por categoría';
    ASSERT public.cx_temporal_state('2027-01-30T14:00:00Z',expected,'2027-01-30T13:59:59.999Z')='scheduled','Antes de la salida';
    ASSERT public.cx_temporal_state('2027-01-30T14:00:00Z',expected,'2027-01-30T14:00:00Z')='live','En la salida';
    ASSERT public.cx_temporal_state('2027-01-30T14:00:00Z',expected,'2027-01-30T14:00:00Z'::timestamptz+expected*interval '1 minute'-interval '1 millisecond')='live','Antes del final estimado';
    ASSERT public.cx_temporal_state('2027-01-30T14:00:00Z',expected,'2027-01-30T14:00:00Z'::timestamptz+expected*interval '1 minute')='estimated_finished','En el final estimado';
  END LOOP;
  -- La presencia de WE y WJ con la misma salida no convierte sus mangas en agrupadas.
  ASSERT (SELECT "durationMinutes"=50 FROM public.cx_race_categories WHERE "raceId"=r AND category='WE'),'No inferir agrupación';
  UPDATE public.cx_race_categories SET "durationFormat"='WE_WJ' WHERE "raceId"=r AND category='WE';
  ASSERT (SELECT "durationMinutes"=45 FROM public.cx_race_categories WHERE "raceId"=r AND category='WE'),'Agrupación verificada';
  -- Un cliente anterior que omite las nuevas claves conserva el formato documentado.
  SELECT jsonb_agg(value-'durationFormat'-'durationRuleVersion') INTO cats FROM jsonb_array_elements(cats);
  PERFORM public.cx_save_race(race,cats);
  ASSERT (SELECT "durationFormat"='WE_WJ' AND "durationMinutes"=45 FROM public.cx_race_categories WHERE "raceId"=r AND category='WE'),'No borrar metadatos por omisión';
  ASSERT (SELECT bool_and("resultsStatus"='pending') FROM public.cx_race_categories WHERE "raceId"=r),'La duración no oficializa resultados';
  ASSERT (SELECT count(*)=6 FROM public.cx_category_timing WHERE "raceId"=r),'No crear mangas derivadas';
  ASSERT (SELECT "estimatedEndTimeUtc"='2027-01-31T15:00:00Z'::timestamptz FROM public.cx_category_timing WHERE "raceId"=r AND category='ME'),'Fecha propia de la manga multidía';
  rejected:=false;
  rejected:=false;
  BEGIN UPDATE public.cx_race_categories SET "durationFormat"='WE_WJ' WHERE "raceId"=r AND category='MU'; EXCEPTION WHEN check_violation THEN rejected:=true; END;
  ASSERT rejected,'Formato incompatible rechazado';
  rejected:=false;
  BEGIN UPDATE public.cx_race_categories SET "durationRuleVersion"='2027-07-01' WHERE "raceId"=r AND category='WE'; EXCEPTION WHEN check_violation THEN rejected:=true; END;
  ASSERT rejected,'No reutilizar una edición no revisada';
  UPDATE public.cx_race_categories SET "durationFormat"=NULL,"durationRuleVersion"=NULL WHERE "raceId"=r AND category='MJ';
  ASSERT (SELECT "durationMinutes" IS NULL AND "estimatedEndTimeUtc" IS NULL AND "temporalState"='unknown' FROM public.cx_category_timing WHERE "raceId"=r AND category='MJ'),'Formato desconocido';
  UPDATE public.cx_race_categories SET "startTimeUtc"=NULL WHERE "raceId"=r AND category='WJ';
  ASSERT (SELECT "estimatedEndTimeUtc" IS NULL AND "temporalState"='unknown' FROM public.cx_category_timing WHERE "raceId"=r AND category='WJ'),'Sin hora no estimar';
  UPDATE public.cx_race_categories SET "isCancelled"=true WHERE "raceId"=r AND category='WJ';
  ASSERT (SELECT "temporalState"='cancelled' AND "resultsStatus"='pending' FROM public.cx_category_timing WHERE "raceId"=r AND category='WJ'),'Cancelación antes que estimación';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT (SELECT count(*)=6 FROM public.cx_category_timing WHERE "raceId"=current_setting('cc.cx_timing_id')),'Lectura pública de vista invoker';
  ASSERT public.cx_temporal_state(NULL,40)='unknown','Sin salida';
  ASSERT public.cx_temporal_state(now(),NULL)='unknown','Sin duración';
  ASSERT public.cx_temporal_state('2026-10-25T00:30:00Z',60,'2026-10-25T01:30:00Z')='estimated_finished','Minutos UTC durante DST';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='public.cx_category_timing'::regclass),'Vista SECURITY INVOKER';
  ASSERT NOT has_table_privilege('anon','public.cx_category_timing','UPDATE'),'Vista sin escritura';
  ASSERT NOT has_column_privilege('cc_results_worker','public.cx_race_categories','durationFormat','UPDATE'),'Worker no edita el formato';
  ASSERT NOT has_function_privilege('anon','public.cx_duration_minutes(text,text,text)','EXECUTE'),'GRANT mínimo para la columna generada';
  ASSERT NOT has_function_privilege('cc_results_worker','public.cx_save_race(jsonb,jsonb,boolean)','EXECUTE'),'Worker no edita carreras';
END $$;
ROLLBACK;
