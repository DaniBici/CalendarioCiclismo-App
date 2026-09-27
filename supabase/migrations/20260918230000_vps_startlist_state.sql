-- Estado del último volcado de inscritos aplicado, para que el sincronizador
-- compare sin releer el esquema `private`. Devuelve el mapa rowKey → ficha/dorsal
-- y los equipos resueltos del documento aplicado, de modo que una segunda pasada
-- idéntica no reescriba la lista aunque el plan reescriba los nombres canónicos.
CREATE OR REPLACE FUNCTION public.vps_startlist_state(p_race_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'provisional', i.provisional,
      'riders', COALESCE((
        SELECT jsonb_object_agg(r->>'rowKey', jsonb_build_object(
          'globalRiderId', r->>'globalRiderId',
          'dorsal', (r->>'dorsal')::int,
          'countryCode', r->>'countryCode'))
          FROM jsonb_array_elements(i.document->'teams') t,
               jsonb_array_elements(t->'riders') r
         WHERE r ? 'rowKey'), '{}'::jsonb),
      'teams', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('teamName', t->>'teamName', 'teamId', t->>'teamId'))
          FROM jsonb_array_elements(i.document->'teams') t), '[]'::jsonb))
      FROM private.startlist_imports i
     WHERE i.race_id = p_race_id AND i.status = 'applied'
     ORDER BY i.updated_at DESC
     LIMIT 1), '{}'::jsonb);
$function$;

REVOKE ALL ON FUNCTION public.vps_startlist_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vps_startlist_state(text) TO cc_results_worker, service_role;
