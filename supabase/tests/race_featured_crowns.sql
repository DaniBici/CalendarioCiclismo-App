-- Ejecutar mediante MCP después de la migración. No conserva datos de prueba.
BEGIN;
DO $$
DECLARE
  auto_id text := gen_random_uuid()::text;
  a_id text := gen_random_uuid()::text;
  b_id text := gen_random_uuid()::text;
  c_id text := gen_random_uuid()::text;
  series_id text;
  rejected boolean;
BEGIN
  SELECT id INTO STRICT series_id FROM public.race_series WHERE "featuredPriority"=1 LIMIT 1;
  INSERT INTO public.races (id,name,gender,"startDate","endDate","raceSeriesId") VALUES
    (auto_id,'Prueba transaccional automática','male','2099-07-01','2099-07-03',series_id),
    (a_id,'Prueba transaccional A','male','2099-07-01','2099-07-03',NULL),
    (b_id,'Prueba transaccional B','female','2099-07-02','2099-07-04',NULL),
    (c_id,'Prueba transaccional C','male','2099-07-02','2099-07-03',NULL);
  INSERT INTO public.race_days (id,"raceId","dateKey","editorialStatus")
  SELECT gen_random_uuid()::text,r.id,d.day,'published'
  FROM public.races r CROSS JOIN (VALUES ('2099-07-01'),('2099-07-02'),('2099-07-03'),('2099-07-04')) d(day)
  WHERE r.id IN (auto_id,a_id,b_id) AND d.day BETWEEN r."startDate" AND r."endDate";
  INSERT INTO public.race_days (id,"raceId","dateKey","editorialStatus") VALUES
    (gen_random_uuid()::text,b_id,'2099-07-02','published'),
    (gen_random_uuid()::text,c_id,'2099-07-02','draft');

  IF (SELECT array_agg("raceId") FROM public.featured_races_for_dates(ARRAY['2099-07-01'])) IS DISTINCT FROM ARRAY[auto_id]
    THEN RAISE EXCEPTION 'Falta la selección automática inicial'; END IF;
  INSERT INTO public.race_featured_overrides ("raceId","isFeatured") VALUES (a_id,true);
  IF (SELECT count(*) FROM public.featured_races_for_dates(ARRAY['2099-07-01']))<>2
    THEN RAISE EXCEPTION 'La primera manual debe convivir con la automática'; END IF;
  INSERT INTO public.race_featured_overrides ("raceId","isFeatured") VALUES (b_id,true);
  IF (SELECT count(*) FROM public.featured_races_for_dates(ARRAY['2099-07-02','2099-07-03']) WHERE manual AND "raceId" IN (a_id,b_id))<>4
    THEN RAISE EXCEPTION 'Las dos manuales deben persistir en ambos días'; END IF;
  IF (SELECT count(*) FROM public.featured_races_for_dates(ARRAY['2099-07-02','2099-07-02']))<>2
    THEN RAISE EXCEPTION 'Fechas y sectores no deben duplicar la selección'; END IF;
  IF (SELECT array_agg("raceId") FROM public.featured_races_for_dates(ARRAY['2099-07-04'])) IS DISTINCT FROM ARRAY[b_id]
    THEN RAISE EXCEPTION 'La selección debe durar hasta el último día de cada carrera'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.race_featured_overrides ("raceId","isFeatured") VALUES (c_id,true);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Ya hay dos carreras destacadas%' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se ha permitido una tercera carrera solapada'; END IF;
  IF EXISTS (SELECT 1 FROM public.race_featured_overrides WHERE "raceId"=c_id)
    THEN RAISE EXCEPTION 'El rechazo dejó una selección parcial'; END IF;

  UPDATE public.races SET "startDate"='2099-07-04',"endDate"='2099-07-05' WHERE id=c_id;
  INSERT INTO public.race_featured_overrides ("raceId","isFeatured") VALUES (c_id,true);
  rejected := false;
  BEGIN
    UPDATE public.races SET "startDate"='2099-07-02' WHERE id=c_id;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Ya hay dos carreras destacadas%' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cambiar las fechas permitió tres carreras solapadas'; END IF;
  rejected := false;
  BEGIN
    UPDATE public.races SET "endDate"='2099-07-03' WHERE id=c_id;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'La carrera debe tener fechas%' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Se aceptaron fechas invertidas'; END IF;
  IF EXISTS (SELECT 1 FROM public.featured_races_for_dates(ARRAY['2099-07-02']) WHERE "raceId"=c_id)
    THEN RAISE EXCEPTION 'Una jornada en borrador se ha publicado como destacada'; END IF;

  UPDATE public.race_featured_overrides SET "isFeatured"=false WHERE "raceId"=b_id;
  INSERT INTO public.race_featured_overrides ("raceId","isFeatured") VALUES (auto_id,false);
  IF (SELECT count(*) FROM public.featured_races_for_dates(ARRAY['2099-07-01','2099-07-02','2099-07-03']))<>3
    OR EXISTS (SELECT 1 FROM public.featured_races_for_dates(ARRAY['2099-07-01','2099-07-02','2099-07-03']) WHERE "raceId"<>a_id)
    THEN RAISE EXCEPTION 'Desmarcar debe retirar la carrera durante toda la edición'; END IF;
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE race_id text := gen_random_uuid()::text; admin_id text;
BEGIN
  SELECT user_id::text INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  INSERT INTO public.races (id,name,"startDate","endDate")
    VALUES (race_id,'Prueba transaccional de permisos','2099-07-01','2099-07-02');
  INSERT INTO public.race_featured_overrides ("raceId","isFeatured") VALUES (race_id,false);
  PERFORM set_config('cc.featured_test_race',race_id,true);
  PERFORM set_config('cc.featured_test_admin',admin_id,true);
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
END;
$$;
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM * FROM public.featured_races_for_dates(ARRAY['2099-07-01']);
  IF has_table_privilege(current_user,'public.race_featured_overrides','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN RAISE EXCEPTION 'Permisos públicos excesivos'; END IF;
END;
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE rejected boolean := false; changed integer;
BEGIN
  IF private.is_admin() THEN RAISE EXCEPTION 'La identidad de prueba debe ser ajena al administrador'; END IF;
  IF has_table_privilege(current_user,'public.race_featured_overrides','TRUNCATE,REFERENCES,TRIGGER')
    THEN RAISE EXCEPTION 'Permisos autenticados excesivos'; END IF;
  BEGIN
    INSERT INTO public.race_featured_overrides ("raceId","isFeatured")
      VALUES (current_setting('cc.featured_test_race'),true)
      ON CONFLICT ("raceId") DO UPDATE SET "isFeatured"=true;
  EXCEPTION WHEN insufficient_privilege THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Un usuario ordinario ha guardado una corona'; END IF;
  UPDATE public.race_featured_overrides SET "isFeatured"=true WHERE "raceId"=current_setting('cc.featured_test_race');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Un usuario ordinario ha modificado una corona'; END IF;
  DELETE FROM public.race_featured_overrides WHERE "raceId"=current_setting('cc.featured_test_race');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>0 THEN RAISE EXCEPTION 'Un usuario ordinario ha borrado una corona'; END IF;
END;
$$;
RESET ROLE;
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub',current_setting('cc.featured_test_admin'),true); END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE changed integer;
BEGIN
  IF NOT private.is_admin() THEN RAISE EXCEPTION 'Falta la identidad administradora de prueba'; END IF;
  INSERT INTO public.race_featured_overrides ("raceId","isFeatured")
    VALUES (current_setting('cc.featured_test_race'),true)
    ON CONFLICT ("raceId") DO UPDATE SET "isFeatured"=true;
  IF NOT (SELECT "isFeatured" FROM public.race_featured_overrides WHERE "raceId"=current_setting('cc.featured_test_race'))
    THEN RAISE EXCEPTION 'El administrador no pudo guardar'; END IF;
  DELETE FROM public.race_featured_overrides WHERE "raceId"=current_setting('cc.featured_test_race');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed<>1 THEN RAISE EXCEPTION 'El administrador no pudo borrar'; END IF;
  INSERT INTO public.race_featured_overrides ("raceId","isFeatured")
    VALUES (current_setting('cc.featured_test_race'),false);
END;
$$;
ROLLBACK;
SELECT 'Selección por edición, doble selección, sectores, fechas, borradores y permisos: comprobados sin conservar fixtures' AS result;
