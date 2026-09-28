-- IDs de ficha de carretera únicos entre géneros (mismo contrato que CX).
--
-- riders_men y riders_women llegaron a compartir 104 ids, casi todos copias de corredoras
-- creadas en la tabla masculina por los Campeonatos de Asia, Panamericanos y de Oceanía
-- 2026 modelados como carreras paraguas masculinas. Tras la reestructuración y el
-- renombrado de zhang-hao-2005 no queda ninguno.
--
-- 1. Guarda en ambas tablas: rechaza insertar o renombrar a un id presente en la otra,
--    con bloqueo consultivo por id para altas concurrentes.
-- 2. resolve_riders, resolve_uci_results_by_name y resolve_historical_uci_results_by_name
--    buscan un id libre en las dos tablas (upsert_historical_rider_profile ya lo hacía).

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.riders_men m JOIN public.riders_women w USING (id)) THEN
    RAISE EXCEPTION 'Existen ids de carretera compartidos entre géneros; resolverlos antes de activar la guarda';
  END IF;
END
$check$;

CREATE OR REPLACE FUNCTION private.road_rider_id_unique_across_genders()
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('road-rider-id:' || NEW.id, 0));
  IF TG_TABLE_NAME = 'riders_men' THEN
    SELECT EXISTS (SELECT 1 FROM public.riders_women WHERE id = NEW.id) INTO v_otra;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public.riders_men WHERE id = NEW.id) INTO v_otra;
  END IF;
  IF v_otra THEN
    RAISE EXCEPTION 'El id % ya pertenece a una ficha de carretera del otro género', NEW.id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.road_rider_id_unique_across_genders()
  FROM PUBLIC, anon, authenticated, service_role, cc_results_worker;

DROP TRIGGER IF EXISTS a01_rider_id_unique_across_genders ON public.riders_men;
CREATE TRIGGER a01_rider_id_unique_across_genders
  BEFORE INSERT OR UPDATE OF id ON public.riders_men
  FOR EACH ROW EXECUTE FUNCTION private.road_rider_id_unique_across_genders();

DROP TRIGGER IF EXISTS a01_rider_id_unique_across_genders ON public.riders_women;
CREATE TRIGGER a01_rider_id_unique_across_genders
  BEFORE INSERT OR UPDATE OF id ON public.riders_women
  FOR EACH ROW EXECUTE FUNCTION private.road_rider_id_unique_across_genders();

DO $patch$
DECLARE
  v_fn regprocedure;
  v_def text;
  v_count integer;
  v_pattern text := 'PERFORM 1 FROM public\.riders_(men|women) +WHERE id *= *v_candidate';
  v_new text := 'PERFORM 1 FROM (SELECT id FROM public.riders_men UNION ALL SELECT id FROM public.riders_women) ids WHERE ids.id = v_candidate';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.resolve_riders(text,jsonb)'::regprocedure,
    'public.resolve_uci_results_by_name(text,text,jsonb)'::regprocedure,
    'public.resolve_historical_uci_results_by_name(text,text,jsonb)'::regprocedure]
  LOOP
    v_def := pg_get_functiondef(v_fn);
    SELECT count(*) INTO v_count FROM regexp_matches(v_def, v_pattern, 'g');
    IF v_count <> 2 THEN
      RAISE EXCEPTION '%: se esperaban 2 comprobaciones de id por género y hay %', v_fn, v_count;
    END IF;
    EXECUTE regexp_replace(v_def, v_pattern, v_new, 'g');
  END LOOP;
END
$patch$;
