-- «INDIVIDUEEL» (neerlandés, usado por ACN Timing/Chronorace en HG Cross y Exact Cross)
-- es el marcador de corredor independiente: no es un equipo y no debe crear un club
-- automático. Se añade a la lista de marcadores de private.cx_is_no_team.
CREATE OR REPLACE FUNCTION private.cx_is_no_team(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT public.is_startlist_no_team_placeholder(p_name)
    OR btrim(regexp_replace(replace(lower(coalesce(p_name,'')),'-',' '),'\s+',' ','g')) = ANY (ARRAY[
      '','individual','individuel','individuell','individueel','independent','independiente','indep','ind',
      'unattached','no team','none','n a','na','sans club','sans equipe','sin club',
      'geen','geen team','geen ploeg','privat','privé','prive','einzelfahrer','einzelstarter',
      'lizenzfrei','free','open'
    ]::text[])
    OR lower(coalesce(p_name,'')) ~ '(national team|nationalmannschaft|nationalteam|selecci[oó]n|s[eé]lection|equipe nationale|équipe nationale|nationale ploeg)';
$function$;
