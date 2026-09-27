-- La migración de listas sin dorsal volvió a introducir los operadores JSON
-- sin paréntesis. PostgreSQL interpreta `c->'tokens' @>` con una precedencia
-- incorrecta y bloquea la preparación de listas que necesitan candidatos.
DO $migration$
DECLARE
  definition text;
  previous_definition text;
BEGIN
  definition := pg_get_functiondef('private.plan_startlist_import(text,jsonb)'::regprocedure);
  previous_definition := definition;
  definition := replace(definition,
    $old$c->'tokens' @> to_jsonb(v_tokens) OR to_jsonb(v_tokens) @> c->'tokens'$old$,
    $new$(c->'tokens') @> to_jsonb(v_tokens) OR to_jsonb(v_tokens) @> (c->'tokens')$new$);

  IF definition = previous_definition THEN
    RAISE EXCEPTION 'No se encontró la expresión JSON esperada en plan_startlist_import';
  END IF;

  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION private.plan_startlist_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.plan_startlist_import(text,jsonb) TO service_role;
