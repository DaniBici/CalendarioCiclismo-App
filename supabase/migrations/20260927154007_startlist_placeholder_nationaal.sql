-- «Nationaal» es la etiqueta con la que las inscripciones de los campeonatos belgas agrupan
-- a corredores sin equipo con licencia nacional (sin comité provincial). Se añade a los
-- marcadores de inscripción sin equipo: la fila se conserva sin teamId y no crea un club.
CREATE OR REPLACE FUNCTION public.is_startlist_no_team_placeholder(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT btrim(regexp_replace(replace(lower(coalesce(p_name, '')), '-', ' '), '\s+', ' ', 'g'))
    = ANY (ARRAY[
      'individual',
      'nationaal',
      'private member',
      'sin equipo',
      'un',
      'un attached leinster'
    ]::text[]);
$function$;

COMMENT ON FUNCTION public.is_startlist_no_team_placeholder(text) IS
  'Identifica únicamente las etiquetas literales de startlist sin equipo (individual, nationaal, private member, sin equipo, un, un attached leinster); no elimina palabras genéricas del nombre.';

REVOKE ALL ON FUNCTION public.is_startlist_no_team_placeholder(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_startlist_no_team_placeholder(text) TO service_role;
