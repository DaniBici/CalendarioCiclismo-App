-- Duraciones UCI aproximadas: Parte V 01.07.2026, art. 5.1.048.
-- El calendario no aporta por sí solo el formato ni el programa de una manga.
CREATE FUNCTION public.cx_duration_minutes(p_category text,p_format text,p_version text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN p_version='2026-07-01' THEN
    CASE WHEN p_format='individual' THEN CASE p_category
      WHEN 'ME' THEN 60 WHEN 'WE' THEN 50 WHEN 'MU' THEN 50
      WHEN 'WU' THEN 45 WHEN 'MJ' THEN 40 WHEN 'WJ' THEN 40 END
    WHEN p_format='WE_WJ' AND p_category IN ('WE','WJ') THEN 45 END END;
$$;
REVOKE ALL ON FUNCTION public.cx_duration_minutes(text,text,text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_duration_minutes(text,text,text) TO authenticated,service_role;

ALTER TABLE public.cx_race_categories
  ADD COLUMN "durationFormat" text,
  ADD COLUMN "durationRuleVersion" text,
  ADD COLUMN "scheduleSourceUrl" text,
  ADD COLUMN "durationMinutes" integer GENERATED ALWAYS AS (public.cx_duration_minutes(category,"durationFormat","durationRuleVersion")) STORED,
  ADD COLUMN "durationRuleSourceUrl" text GENERATED ALWAYS AS (CASE WHEN "durationRuleVersion"='2026-07-01' THEN 'https://assets.ctfassets.net/761l7gh5x5an/3X0PPNdbWNAhMGaZzKly8J/c1ffde19720611fa2fddae4e4601845b/5-CRO-20260701-E.pdf' END) STORED,
  ADD CONSTRAINT cx_category_duration_format_check CHECK (
    ("durationFormat" IS NULL AND "durationRuleVersion" IS NULL)
    OR ("durationFormat" IS NOT NULL AND "durationRuleVersion" IS NOT NULL AND "scheduleSourceUrl" IS NOT NULL
      AND "durationRuleVersion"='2026-07-01'
      AND ("durationFormat"='individual' OR ("durationFormat"='WE_WJ' AND category IN ('WE','WJ'))))
  ),
  ADD CONSTRAINT cx_category_schedule_source_check CHECK ("scheduleSourceUrl" IS NULL OR "scheduleSourceUrl" ~ '^https?://[^[:space:]]+$');
-- Los GRANT de tabla y sus políticas RLS endurecidas de F1 se conservan.
-- El worker puede leer el programa, pero no editarlo ni escribir columnas generadas.

CREATE FUNCTION public.cx_temporal_state(p_start timestamptz,p_minutes integer,p_at timestamptz DEFAULT now(),p_cancelled boolean DEFAULT false) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN p_cancelled THEN 'cancelled'
    WHEN p_start IS NULL OR p_minutes IS NULL OR p_minutes<=0 OR p_at IS NULL THEN 'unknown'
    WHEN p_at<p_start THEN 'scheduled'
    WHEN p_at<p_start+p_minutes*interval '1 minute' THEN 'live'
    ELSE 'estimated_finished' END;
$$;
REVOKE ALL ON FUNCTION public.cx_temporal_state(timestamptz,integer,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_temporal_state(timestamptz,integer,timestamptz,boolean) TO anon,authenticated,service_role,cc_results_worker;

CREATE VIEW public.cx_category_timing WITH (security_invoker=true) AS
SELECT c."raceId",c.category,coalesce(c."dateKey",r."dateKey") AS "dateKey",c."startTimeUtc",
  c."durationFormat",c."durationRuleVersion",c."durationMinutes",c."durationRuleSourceUrl",c."scheduleSourceUrl",
  c."startTimeUtc"+c."durationMinutes"*interval '1 minute' AS "estimatedEndTimeUtc",
  public.cx_temporal_state(c."startTimeUtc",c."durationMinutes",now(),r."isCancelled" OR c."isCancelled") AS "temporalState",
  c."resultsStatus",r."isCancelled" OR c."isCancelled" AS "isCancelled"
FROM public.cx_race_categories c JOIN public.cx_races r ON r.id=c."raceId"
WHERE r."editorialStatus"='published';
REVOKE ALL ON public.cx_category_timing FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT SELECT ON public.cx_category_timing TO anon,authenticated,service_role,cc_results_worker;

CREATE OR REPLACE FUNCTION public.cx_save_race(p_race jsonb,p_categories jsonb,p_allow_category_removal boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.cx_races; c public.cx_race_categories; payload jsonb; previous jsonb;
BEGIN
  PERFORM public.cx_require_admin();
  r:=jsonb_populate_record(NULL::public.cx_races,p_race);
  IF jsonb_typeof(p_categories) IS DISTINCT FROM 'array' OR jsonb_array_length(p_categories)=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_categories) v GROUP BY v->>'category' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Seleccionar categorías únicas' USING ERRCODE='22023';
  END IF;
  IF r.timezone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=r.timezone) THEN
    RAISE EXCEPTION 'Zona IANA no reconocida' USING ERRCODE='22023';
  END IF;
  r.id:=coalesce(r.id,gen_random_uuid()::text);
  SELECT to_jsonb(x)||jsonb_build_object('categories',coalesce((SELECT jsonb_agg(to_jsonb(y)) FROM public.cx_race_categories y WHERE y."raceId"=r.id),'[]'::jsonb)) INTO previous FROM public.cx_races x WHERE id=r.id FOR UPDATE;
  INSERT INTO public.cx_races(id,name,"nameEn",abbrev,slug,"slugEn","seasonKey","seasonStartYear","dateKey","endDateKey",class,"countryCode",venue,"websiteUrl","tournamentId","colorHex","logoUrl","isCancelled","editorialStatus",timezone)
    VALUES(r.id,r.name,r."nameEn",r.abbrev,r.slug,r."slugEn",r."seasonKey",r."seasonStartYear",r."dateKey",r."endDateKey",r.class,r."countryCode",r.venue,r."websiteUrl",r."tournamentId",r."colorHex",r."logoUrl",coalesce(r."isCancelled",false),coalesce(r."editorialStatus",'published'),r.timezone)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,"nameEn"=excluded."nameEn",abbrev=excluded.abbrev,slug=excluded.slug,"slugEn"=excluded."slugEn",
      "seasonKey"=excluded."seasonKey","seasonStartYear"=excluded."seasonStartYear","dateKey"=excluded."dateKey","endDateKey"=excluded."endDateKey",class=excluded.class,
      "countryCode"=excluded."countryCode",venue=excluded.venue,"websiteUrl"=excluded."websiteUrl","tournamentId"=excluded."tournamentId","colorHex"=excluded."colorHex","logoUrl"=excluded."logoUrl",
      "isCancelled"=excluded."isCancelled","editorialStatus"=excluded."editorialStatus",timezone=excluded.timezone,"updatedAt"=now();
  IF EXISTS(SELECT 1 FROM public.cx_race_categories x WHERE "raceId"=r.id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_categories) v WHERE v->>'category'=x.category)) THEN
    IF NOT coalesce(p_allow_category_removal,false) THEN
      RAISE EXCEPTION 'Eliminar categorías requiere confirmación explícita; elimina sus datos asociados' USING ERRCODE='22023';
    END IF;
    DELETE FROM public.cx_race_categories x WHERE "raceId"=r.id
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_categories) v WHERE v->>'category'=x.category);
  END IF;
  FOR payload IN SELECT value FROM jsonb_array_elements(p_categories) LOOP
    c:=jsonb_populate_record(NULL::public.cx_race_categories,payload);
    IF coalesce(c."dateKey",r."dateKey") NOT BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey")
      OR (c."startTimeUtc" IS NOT NULL AND (r.timezone IS NULL OR (c."startTimeUtc" AT TIME ZONE r.timezone)::date<>coalesce(c."dateKey",r."dateKey"))) THEN
      RAISE EXCEPTION 'Horario/fecha de categoría fuera de la carrera o sin zona verificada' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.cx_race_categories("raceId",category,"startTimeUtc","dateKey","sortOrder","isCancelled","durationFormat","durationRuleVersion","scheduleSourceUrl")
      VALUES(r.id,c.category,c."startTimeUtc",c."dateKey",coalesce(c."sortOrder",0),coalesce(c."isCancelled",false),c."durationFormat",c."durationRuleVersion",c."scheduleSourceUrl")
      ON CONFLICT("raceId",category) DO UPDATE SET "startTimeUtc"=excluded."startTimeUtc","dateKey"=excluded."dateKey","sortOrder"=excluded."sortOrder","isCancelled"=excluded."isCancelled",
        "durationFormat"=CASE WHEN payload?'durationFormat' THEN excluded."durationFormat" ELSE cx_race_categories."durationFormat" END,
        "durationRuleVersion"=CASE WHEN payload?'durationRuleVersion' THEN excluded."durationRuleVersion" ELSE cx_race_categories."durationRuleVersion" END,
        "scheduleSourceUrl"=CASE WHEN payload?'scheduleSourceUrl' THEN excluded."scheduleSourceUrl" ELSE cx_race_categories."scheduleSourceUrl" END;
  END LOOP;
  INSERT INTO private.cx_change_log(operation,"raceId",before,after) VALUES('save_race',r.id,previous,jsonb_build_object('race',p_race,'categories',p_categories,'allowCategoryRemoval',p_allow_category_removal));
  RETURN r.id;
END $$;

REVOKE ALL ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
