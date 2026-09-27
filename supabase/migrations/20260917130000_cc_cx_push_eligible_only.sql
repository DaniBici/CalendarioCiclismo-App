-- Avisos de ciclocross solo para pruebas con resultados en directo.
--
-- El indicador de espera de resultados y los avisos automáticos comparten el
-- mismo criterio: Mundiales (CM), Continentales (CC) y Copa del Mundo (CDM),
-- más las pruebas de los torneos Copa del Mundo, Superprestige y X2O. El resto
-- de carreras (NAC, C1/C2 sueltas) no generan avisos: ni de salida ni de
-- resultados.
--
-- Se añade la elegibilidad al resolutor de la fuente automática, de modo que
-- `cx_enqueue_automatic_pushes` no programa nada para el resto y cancela las
-- programaciones automáticas pendientes que ya no cumplen el criterio.
CREATE OR REPLACE FUNCTION private.cx_auto_push_source(p_race_id text, p_category text, p_event_type text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
  FROM public.cx_races r
  JOIN public.cx_race_categories c ON c."raceId"=r.id AND c.category=p_category
  LEFT JOIN public.cx_tournaments t ON t.id=r."tournamentId"
  WHERE r.id=p_race_id AND r."editorialStatus"='published' AND NOT r."isCancelled" AND NOT c."isCancelled"
    AND (
      r.class IN('CM','CC','CDM')
      OR regexp_replace(lower(coalesce(t.slug,'')||' '||coalesce(t.name,'')),'[^a-z0-9]','','g')
         ~ '(superprestige|x2o|worldcup|copadelmundo)'
    )
    AND r."dateKey">=make_date(r."seasonStartYear",8,1) AND coalesce(r."endDateKey",r."dateKey")<make_date(r."seasonStartYear"+1,3,1)
    AND extract(month FROM r."dateKey") IN(8,9,10,11,12,1,2)
    AND extract(month FROM coalesce(r."endDateKey",r."dateKey")) IN(8,9,10,11,12,1,2)
    AND coalesce(c."dateKey",r."dateKey") BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey")
    AND extract(month FROM coalesce(c."dateKey",r."dateKey")) IN(8,9,10,11,12,1,2);
$function$;
REVOKE ALL ON FUNCTION private.cx_auto_push_source(text,text,text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION private.cx_auto_push_source(text,text,text) TO service_role;
