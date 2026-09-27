-- Fecha mínima del programa individual; no confundir el día de relevos de un
-- campeonato multidía con una manga ni descargar meses vacíos hasta hallarla.
CREATE FUNCTION public.cx_next_race_date(p_season_key text,p_date_key date)
RETURNS date LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT min(program.date_key) FROM (
    SELECT coalesce(c."dateKey",r."dateKey") AS date_key
    FROM public.cx_races r JOIN public.cx_race_categories c ON c."raceId"=r.id
    WHERE r."seasonKey"=p_season_key AND r."editorialStatus"='published'
      AND NOT r."isCancelled" AND NOT c."isCancelled"
    UNION ALL
    SELECT r."dateKey" FROM public.cx_races r
    WHERE r."seasonKey"=p_season_key AND r."editorialStatus"='published'
      AND NOT r."isCancelled"
      AND NOT EXISTS (SELECT 1 FROM public.cx_race_categories c WHERE c."raceId"=r.id)
  ) program WHERE program.date_key>=p_date_key;
$$;
REVOKE ALL ON FUNCTION public.cx_next_race_date(text,date) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_next_race_date(text,date) TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
