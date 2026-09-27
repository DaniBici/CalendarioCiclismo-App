BEGIN;
INSERT INTO public.cx_races(id,name,slug,"seasonKey","seasonStartYear","dateKey","endDateKey",class,"editorialStatus","isCancelled") VALUES
('cx-next-world','Mundial de prueba','cx-next-world','2000-01',2000,'2001-01-29','2001-01-31','CM','published',false),
('cx-next-draft','Borrador','cx-next-draft','2000-01',2000,'2001-01-29',NULL,'C2','draft',false),
('cx-next-cancelled','Cancelada','cx-next-cancelled','2000-01',2000,'2001-01-29',NULL,'C2','published',true),
('cx-next-no-program','Sin programa','cx-next-no-program','2000-01',2000,'2001-02-10',NULL,'C2','published',false);
INSERT INTO public.cx_race_categories("raceId",category,"dateKey","isCancelled") VALUES
('cx-next-world','WE','2001-01-30',false),('cx-next-world','ME','2001-01-31',false),
('cx-next-world','MU','2001-01-29',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT public.cx_next_race_date('2000-01','2001-01-29')='2001-01-30'::date,'No saltar al relevo ni a una categoría cancelada';
  ASSERT public.cx_next_race_date('2000-01','2001-01-31')='2001-01-31'::date,'Fecha individual del último día';
  ASSERT public.cx_next_race_date('2000-01','2001-02-01')='2001-02-10'::date,'Fecha oficial sin programa';
  ASSERT public.cx_next_race_date('2000-01','2001-02-11') IS NULL,'No quedan carreras';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('cc_results_worker','public.cx_next_race_date(text,date)','EXECUTE'),'Privilegios mínimos';
  ASSERT (SELECT NOT prosecdef FROM pg_proc WHERE oid='public.cx_next_race_date(text,date)'::regprocedure),'SECURITY INVOKER';
END $$;
ROLLBACK;
