-- IDs de ficha CX únicos entre géneros.
--
-- cx_riders_men y cx_riders_women tenían espacios de id independientes: la ingesta
-- (cx_ingest_results) solo comprobaba la tabla de su género al generar el id, y el panel
-- y las escrituras por MCP tampoco lo impedían. Un id compartido hace ambiguas las
-- referencias sin género. Hoy no existe ninguno.
--
-- 1. Guarda en ambas tablas: rechaza insertar o renombrar a un id presente en la otra.
--    Un bloqueo consultivo por id serializa altas concurrentes del mismo id en tablas
--    distintas.
-- 2. La ingesta busca un id libre en las dos tablas y añade el sufijo numérico habitual.

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cx_riders_men m JOIN public.cx_riders_women w USING (id)) THEN
    RAISE EXCEPTION 'Existen ids CX compartidos entre géneros; resolverlos antes de activar la guarda';
  END IF;
END
$check$;

CREATE OR REPLACE FUNCTION private.cx_rider_id_unique_across_genders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_otra boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id IS NOT DISTINCT FROM OLD.id THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cx-rider-id:' || NEW.id, 0));
  IF TG_TABLE_NAME = 'cx_riders_men' THEN
    SELECT EXISTS (SELECT 1 FROM public.cx_riders_women WHERE id = NEW.id) INTO v_otra;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.cx_riders_men WHERE id = NEW.id) INTO v_otra;
  END IF;
  IF v_otra THEN
    RAISE EXCEPTION 'El id % ya pertenece a una ficha CX del otro género', NEW.id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.cx_rider_id_unique_across_genders()
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;

DROP TRIGGER IF EXISTS cx_rider_id_unique_across_genders ON public.cx_riders_men;
CREATE TRIGGER cx_rider_id_unique_across_genders
  BEFORE INSERT OR UPDATE OF id ON public.cx_riders_men
  FOR EACH ROW EXECUTE FUNCTION private.cx_rider_id_unique_across_genders();

DROP TRIGGER IF EXISTS cx_rider_id_unique_across_genders ON public.cx_riders_women;
CREATE TRIGGER cx_rider_id_unique_across_genders
  BEFORE INSERT OR UPDATE OF id ON public.cx_riders_women
  FOR EACH ROW EXECUTE FUNCTION private.cx_rider_id_unique_across_genders();

DO $patch$
DECLARE
  v_def text; v_count integer;
  v_old_men text:='WHILE EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=new_id) LOOP';
  v_old_women text:='WHILE EXISTS(SELECT 1 FROM public.cx_riders_women WHERE id=new_id) LOOP';
  v_new text:='WHILE EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=new_id) OR EXISTS(SELECT 1 FROM public.cx_riders_women WHERE id=new_id) LOOP';
BEGIN
  v_def:=pg_get_functiondef('public.cx_ingest_results(text,text,jsonb,text,jsonb)'::regprocedure);
  v_count:=(length(v_def)-length(replace(v_def,v_old_men,'')))/length(v_old_men);
  IF v_count<>1 THEN
    RAISE EXCEPTION 'cx_ingest_results: se esperaba 1 generador de id masculino y hay %',v_count;
  END IF;
  v_count:=(length(v_def)-length(replace(v_def,v_old_women,'')))/length(v_old_women);
  IF v_count<>1 THEN
    RAISE EXCEPTION 'cx_ingest_results: se esperaba 1 generador de id femenino y hay %',v_count;
  END IF;
  EXECUTE replace(replace(v_def,v_old_men,v_new),v_old_women,v_new);
END
$patch$;
