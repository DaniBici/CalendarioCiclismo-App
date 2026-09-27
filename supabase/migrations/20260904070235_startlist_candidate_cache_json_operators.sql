-- Los operadores JSON requieren paréntesis al combinarse con contención.
DO $migration$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('private.plan_startlist_import(text,jsonb)'::regprocedure);
  definition := replace(definition,
    $old$c->'tokens' @> to_jsonb(v_tokens) OR to_jsonb(v_tokens) @> c->'tokens'$old$,
    $new$(c->'tokens') @> to_jsonb(v_tokens) OR to_jsonb(v_tokens) @> (c->'tokens')$new$);
  EXECUTE definition;
END;
$migration$;
REVOKE ALL ON FUNCTION private.plan_startlist_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.plan_startlist_import(text,jsonb) TO service_role;
