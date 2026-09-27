-- Se retira el programa oficial por manga. El final estimado queda verificado
-- por el formato de la manga y la versión de la regla UCI.
CREATE OR REPLACE FUNCTION private.cx_auto_push_source(p_race_id text,p_category text,p_event_type text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE
    WHEN p_event_type='start' AND c."startTimeUtc" IS NOT NULL AND c."durationMinutes" IS NOT NULL
      AND c."durationRuleVersion"='2026-07-01' THEN
      jsonb_build_object('sourceTimeUtc',to_char(c."startTimeUtc" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'format',c."durationFormat",'rule',c."durationRuleVersion")
    WHEN p_event_type='results' AND c."resultsStatus"='official' AND c."resultsImportedAt" IS NOT NULL
      AND c."resultsSourceUrl" ~ '^https?://' AND EXISTS(SELECT 1 FROM public.cx_results x WHERE x."raceId"=r.id
        AND x.category=c.category AND x.rank=1 AND x.irm IS NULL) THEN
      jsonb_build_object('sourceTimeUtc',to_char(c."resultsImportedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'sourceUrl',c."resultsSourceUrl",'resultsDigest',(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder",x.id),'[]')::text)
          FROM public.cx_results x WHERE x."raceId"=r.id AND x.category=c.category))
    ELSE NULL END || jsonb_build_object('raceId',r.id,'category',c.category,'eventType',p_event_type,
      'dateKey',coalesce(c."dateKey",r."dateKey"),'name',r.name,'nameEn',coalesce(nullif(btrim(r."nameEn"),''),r.name))
  FROM public.cx_races r JOIN public.cx_race_categories c ON c."raceId"=r.id AND c.category=p_category
  WHERE r.id=p_race_id AND r."editorialStatus"='published' AND NOT r."isCancelled" AND NOT c."isCancelled"
    AND r."dateKey">=make_date(r."seasonStartYear",8,1) AND coalesce(r."endDateKey",r."dateKey")<make_date(r."seasonStartYear"+1,3,1)
    AND extract(month FROM r."dateKey") IN(8,9,10,11,12,1,2)
    AND extract(month FROM coalesce(r."endDateKey",r."dateKey")) IN(8,9,10,11,12,1,2)
    AND coalesce(c."dateKey",r."dateKey") BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey")
    AND extract(month FROM coalesce(c."dateKey",r."dateKey")) IN(8,9,10,11,12,1,2);
$$;

-- CREATE OR REPLACE no permite quitar columnas de una vista.
DROP VIEW IF EXISTS public.cx_category_timing;
CREATE VIEW public.cx_category_timing WITH (security_invoker=true) AS
SELECT c."raceId",c.category,coalesce(c."dateKey",r."dateKey") AS "dateKey",c."startTimeUtc",
  c."durationFormat",c."durationRuleVersion",c."durationMinutes",c."durationRuleSourceUrl",
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
    INSERT INTO public.cx_race_categories("raceId",category,"startTimeUtc","dateKey","sortOrder","isCancelled","durationFormat","durationRuleVersion")
      VALUES(r.id,c.category,c."startTimeUtc",c."dateKey",coalesce(c."sortOrder",0),coalesce(c."isCancelled",false),c."durationFormat",c."durationRuleVersion")
      ON CONFLICT("raceId",category) DO UPDATE SET "startTimeUtc"=excluded."startTimeUtc","dateKey"=excluded."dateKey","sortOrder"=excluded."sortOrder","isCancelled"=excluded."isCancelled",
        "durationFormat"=CASE WHEN payload?'durationFormat' THEN excluded."durationFormat" ELSE cx_race_categories."durationFormat" END,
        "durationRuleVersion"=CASE WHEN payload?'durationRuleVersion' THEN excluded."durationRuleVersion" ELSE cx_race_categories."durationRuleVersion" END;
  END LOOP;
  INSERT INTO private.cx_change_log(operation,"raceId",before,after) VALUES('save_race',r.id,previous,jsonb_build_object('race',p_race,'categories',p_categories,'allowCategoryRemoval',p_allow_category_removal));
  RETURN r.id;
END $$;

ALTER TABLE public.cx_race_categories
  DROP CONSTRAINT cx_category_duration_format_check,
  DROP CONSTRAINT cx_category_schedule_source_check,
  DROP COLUMN "scheduleSourceUrl",
  ADD CONSTRAINT cx_category_duration_format_check CHECK (
    ("durationFormat" IS NULL AND "durationRuleVersion" IS NULL)
    OR ("durationFormat" IS NOT NULL AND "durationRuleVersion" IS NOT NULL
      AND "durationRuleVersion"='2026-07-01'
      AND ("durationFormat"='individual' OR ("durationFormat"='WE_WJ' AND category IN ('WE','WJ'))))
  );

NOTIFY pgrst,'reload schema';
