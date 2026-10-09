-- «Independiente» (inscripciones de los Campeonatos de España) y «Unattached» designan
-- corredores sin equipo. Se añaden a los marcadores de inscripción sin equipo: la fila se
-- conserva sin teamId y no crea un club ni afiliaciones de plantilla.
CREATE OR REPLACE FUNCTION public.is_startlist_no_team_placeholder(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT btrim(regexp_replace(replace(lower(coalesce(p_name, '')), '-', ' '), '\s+', ' ', 'g'))
    = ANY (ARRAY[
      'independiente',
      'individual',
      'nationaal',
      'private member',
      'sin equipo',
      'un',
      'un attached leinster',
      'unattached'
    ]::text[]);
$function$;

COMMENT ON FUNCTION public.is_startlist_no_team_placeholder(text) IS
  'Identifica únicamente las etiquetas literales de startlist sin equipo (independiente, individual, nationaal, private member, sin equipo, un, un attached leinster, unattached); no elimina palabras genéricas del nombre.';

REVOKE ALL ON FUNCTION public.is_startlist_no_team_placeholder(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_startlist_no_team_placeholder(text) TO service_role, cc_agent;
