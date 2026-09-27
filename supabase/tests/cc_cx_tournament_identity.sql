BEGIN;
DO $$ DECLARE admin_id uuid;
BEGIN
  SELECT user_id INTO STRICT admin_id FROM private.admin_users LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',admin_id)::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE fixture_id text:=gen_random_uuid()::text; payload jsonb; original jsonb; current_rule jsonb; saved public.cx_tournaments; rejected boolean;
BEGIN
  payload:=jsonb_build_object('id',fixture_id,'name','Fixture identidad','slug',fixture_id,'seasonKey','2026-27');
  PERFORM public.cx_save_tournament(payload);
  SELECT * INTO saved FROM public.cx_tournaments t WHERE t.id=fixture_id;
  IF saved."pointsScheme"->'categories'<>'{}'::jsonb OR saved.translations<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Alta de identidad sin reglamento inválida';
  END IF;
  original:='{"categories":{"ME":{"mode":"time"},"WE":{"mode":"points","perRank":[25,20]}}}'::jsonb;
  PERFORM public.cx_save_tournament(payload||jsonb_build_object('pointsScheme',original,'translations','{"en":{"name":{"value":"Fixture EN","status":"manual"}}}'::jsonb));
  current_rule:=jsonb_set(original,'{categories,WE,perRank}','[40,30]'::jsonb);
  -- Simula reglas modificadas por LLM después de abrir el editor de identidad.
  PERFORM public.cx_save_tournament(payload||jsonb_build_object('pointsScheme',current_rule));
  PERFORM public.cx_save_tournament(payload||jsonb_build_object('name','Identidad actualizada','colorHex','#123456'));
  SELECT * INTO saved FROM public.cx_tournaments t WHERE t.id=fixture_id;
  IF saved.name<>'Identidad actualizada' OR saved."pointsScheme" IS DISTINCT FROM current_rule
    OR saved.translations#>>'{en,name,value}'<>'Fixture EN' THEN
    RAISE EXCEPTION 'Edición de identidad destruye reglamento/traducción vigente';
  END IF;
  rejected:=false;
  BEGIN
    PERFORM public.cx_save_tournament(payload||jsonb_build_object('pointsScheme','{"categories":{"ME":{"mode":"time","perRank":[25]}}}'::jsonb));
  EXCEPTION WHEN invalid_parameter_value THEN rejected:=true;
  END;
  IF NOT rejected OR (SELECT "pointsScheme" FROM public.cx_tournaments t WHERE t.id=fixture_id) IS DISTINCT FROM current_rule THEN
    RAISE EXCEPTION 'Reglamento inválido aceptado o cambio no atómico';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon','public.cx_save_tournament(jsonb)','EXECUTE')
    OR has_function_privilege('cc_results_worker','public.cx_save_tournament(jsonb)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.cx_save_tournament(jsonb)','EXECUTE')
    OR (SELECT prosecdef FROM pg_proc WHERE oid='public.cx_save_tournament(jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'ACL o SECURITY INVOKER modificados';
  END IF;
END $$;
ROLLBACK;
