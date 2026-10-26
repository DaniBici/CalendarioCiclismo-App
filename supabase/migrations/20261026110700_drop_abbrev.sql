-- Retirada de la abreviatura de carrera (abbrev). Las apps desde 5.0.14/5.1 no la piden.
-- cx_save_race deja de escribirla; después se eliminan las columnas de races y cx_races.

CREATE OR REPLACE FUNCTION public.cx_save_race(p_race jsonb, p_categories jsonb, p_allow_category_removal boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  INSERT INTO public.cx_races(id,name,"nameEn",slug,"slugEn","seasonKey","seasonStartYear","dateKey","endDateKey",class,"countryCode",venue,"websiteUrl","tournamentId","colorHex","logoUrl","isCancelled","editorialStatus",timezone)
    VALUES(r.id,r.name,r."nameEn",r.slug,r."slugEn",r."seasonKey",r."seasonStartYear",r."dateKey",r."endDateKey",r.class,r."countryCode",r.venue,r."websiteUrl",r."tournamentId",r."colorHex",r."logoUrl",coalesce(r."isCancelled",false),coalesce(r."editorialStatus",'published'),r.timezone)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,"nameEn"=excluded."nameEn",slug=excluded.slug,"slugEn"=excluded."slugEn",
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
END $function$;

REVOKE ALL ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) TO authenticated, cc_agent;

ALTER TABLE public.races DROP COLUMN abbrev;
ALTER TABLE public.cx_races DROP COLUMN abbrev;
