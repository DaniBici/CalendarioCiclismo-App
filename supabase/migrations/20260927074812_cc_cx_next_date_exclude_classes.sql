-- Variante de cx_next_race_date que ignora las clases indicadas (las apps y la
-- web en inglés excluyen 'NAC'). La firma de dos argumentos se conserva para
-- las versiones anteriores de las apps.
CREATE FUNCTION public.cx_next_race_date(p_season_key text,p_date_key date,p_exclude_classes text[])
RETURNS date LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT min(program.date_key) FROM (
    SELECT coalesce(c."dateKey",r."dateKey") AS date_key
    FROM public.cx_races r JOIN public.cx_race_categories c ON c."raceId"=r.id
    WHERE r."seasonKey"=p_season_key AND r."editorialStatus"='published'
      AND NOT r."isCancelled" AND NOT c."isCancelled"
      AND NOT (r.class = ANY(coalesce(p_exclude_classes,'{}'::text[])))
    UNION ALL
    SELECT r."dateKey" FROM public.cx_races r
    WHERE r."seasonKey"=p_season_key AND r."editorialStatus"='published'
      AND NOT r."isCancelled"
      AND NOT (r.class = ANY(coalesce(p_exclude_classes,'{}'::text[])))
      AND NOT EXISTS (SELECT 1 FROM public.cx_race_categories c WHERE c."raceId"=r.id)
  ) program WHERE program.date_key>=p_date_key;
$$;
REVOKE ALL ON FUNCTION public.cx_next_race_date(text,date,text[]) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_next_race_date(text,date,text[]) TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
