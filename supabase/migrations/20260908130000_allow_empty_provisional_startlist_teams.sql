-- Conserva en las listas provisionales los equipos confirmados que todavía no
-- han publicado corredores. La aplicación seguirá reconciliando el documento
-- completo cuando llegue una alineación.
DO $$
DECLARE
  definition text;
  previous_check text := $check$IF NULLIF(btrim(v_team->>'teamName'),'') IS NULL
       OR jsonb_typeof(v_team->'riders') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_team->'riders') = 0 THEN$check$;
  current_check text := $check$IF NULLIF(btrim(v_team->>'teamName'),'') IS NULL
       OR jsonb_typeof(v_team->'riders') IS DISTINCT FROM 'array' THEN$check$;
BEGIN
  definition := pg_get_functiondef('private.plan_startlist_import(text,jsonb)'::regprocedure);
  IF strpos(definition, previous_check) = 0 THEN
    RAISE EXCEPTION 'No se encontró la validación esperada en plan_startlist_import';
  END IF;
  definition := replace(definition, previous_check, current_check);
  EXECUTE definition;
END;
$$;

REVOKE ALL ON FUNCTION private.plan_startlist_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.plan_startlist_import(text,jsonb) TO service_role;
