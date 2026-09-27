-- Selección editorial por edición; false permite retirar también una automática.
CREATE TABLE public.race_featured_overrides (
  "raceId" text PRIMARY KEY REFERENCES public.races(id) ON DELETE CASCADE,
  "isFeatured" boolean NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.race_featured_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY race_featured_read ON public.race_featured_overrides
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY race_featured_admin ON public.race_featured_overrides
  FOR ALL TO authenticated USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));
-- Los importadores necesitan leer esta validación al actualizar fechas.
GRANT SELECT ON public.race_featured_overrides TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.race_featured_overrides TO authenticated;

CREATE FUNCTION public.validate_race_featured_overrides() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE conflict_date text; invalid_race text;
BEGIN
  IF TG_TABLE_NAME = 'races' THEN
    IF NOT EXISTS (SELECT 1 FROM public.race_featured_overrides f WHERE f."raceId"=NEW.id AND f."isFeatured")
      THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('race_featured_overrides',0));

  SELECT r.name INTO invalid_race
  FROM public.race_featured_overrides f JOIN public.races r ON r.id=f."raceId"
  WHERE f."isFeatured" AND (r."startDate" IS NULL OR r."endDate" IS NULL
    OR r."startDate" !~ '^\d{4}-\d{2}-\d{2}$' OR r."endDate" !~ '^\d{4}-\d{2}-\d{2}$'
    OR r."endDate" < r."startDate") LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'La carrera debe tener fechas de inicio y fin válidas: %',invalid_race; END IF;

  -- El máximo de solapamientos cambia al comenzar una de las carreras.
  WITH ranges AS MATERIALIZED (
    SELECT r.id,r."startDate",r."endDate"
    FROM public.race_featured_overrides f JOIN public.races r ON r.id=f."raceId"
    WHERE f."isFeatured"
  )
  SELECT p."startDate" INTO conflict_date FROM ranges p
  JOIN ranges r ON p."startDate" BETWEEN r."startDate" AND r."endDate"
  GROUP BY p."startDate" HAVING count(DISTINCT r.id)>2
  ORDER BY p."startDate" LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Ya hay dos carreras destacadas el %. Desmarca una corona antes de añadir otra.',conflict_date;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_race_featured_overrides() FROM PUBLIC;
CREATE TRIGGER validate_race_featured_overrides
  AFTER INSERT OR UPDATE ON public.race_featured_overrides
  FOR EACH ROW EXECUTE FUNCTION public.validate_race_featured_overrides();
CREATE TRIGGER validate_featured_race_dates
  AFTER UPDATE OF "startDate","endDate" ON public.races
  FOR EACH ROW WHEN (OLD."startDate" IS DISTINCT FROM NEW."startDate" OR OLD."endDate" IS DISTINCT FROM NEW."endDate")
  EXECUTE FUNCTION public.validate_race_featured_overrides();

-- Conservar selecciones anteriores sin seguir escribiendo excepciones diarias.
INSERT INTO public.race_featured_overrides ("raceId","isFeatured","updatedAt")
SELECT "raceId",true,max("updatedAt") FROM public.daily_featured_races GROUP BY "raceId";
REVOKE INSERT, UPDATE, DELETE ON public.daily_featured_races FROM authenticated;

CREATE OR REPLACE FUNCTION public.featured_races_for_dates(date_keys text[])
RETURNS TABLE("dateKey" text,"raceId" text,manual boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT dates.day,pick.id,pick.manual
  FROM (SELECT DISTINCT unnest(date_keys) AS day) dates
  CROSS JOIN LATERAL (
    WITH candidates AS MATERIALIZED (
      SELECT DISTINCT r.id,f."isFeatured",s."featuredPriority",r.gender
      FROM public.races r
      JOIN public.race_days d ON d."raceId"=r.id AND d."dateKey"=dates.day
      LEFT JOIN public.race_featured_overrides f ON f."raceId"=r.id
      LEFT JOIN public.race_series s ON s.id=r."raceSeriesId"
      WHERE d."editorialStatus"='published'
    ), chosen AS (
      SELECT id FROM candidates WHERE "isFeatured" IS TRUE
    ), automatic AS (
      SELECT id FROM candidates WHERE "isFeatured" IS DISTINCT FROM false
        AND "featuredPriority" IS NOT NULL AND gender='male'
      ORDER BY "featuredPriority",id LIMIT 1
    )
    SELECT id,true AS manual FROM chosen
    UNION ALL
    SELECT id,false FROM automatic WHERE (SELECT count(*) FROM chosen)<2
      AND NOT EXISTS (SELECT 1 FROM chosen WHERE chosen.id=automatic.id)
    ORDER BY manual DESC,id LIMIT 2
  ) pick
$$;
REVOKE ALL ON FUNCTION public.featured_races_for_dates(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.featured_races_for_dates(text[]) TO anon, authenticated;
