-- El endpoint REST sigue siendo público (schema public) pero ya no es una
-- función SECURITY DEFINER. La operación privilegiada vive en private y exige
-- administrador también allí, por lo que no depende del hook pre-request.

GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.dispatch_uci_results_workflow(
  p_race_id text,
  p_stage integer,
  p_ignore_window boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token text;
  v_inputs jsonb;
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_race_id IS NOT NULL AND btrim(p_race_id) = '' THEN RAISE EXCEPTION 'Falta p_race_id'; END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token' LIMIT 1;
  IF v_token IS NULL OR btrim(v_token) = '' THEN RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"'; END IF;

  v_inputs := CASE WHEN p_race_id IS NULL
    THEN jsonb_build_object('ignore_window', CASE WHEN p_ignore_window THEN 'true' ELSE 'false' END)
    ELSE jsonb_build_object('race_id', p_race_id)
  END;
  IF p_stage IS NOT NULL THEN v_inputs := v_inputs || jsonb_build_object('stage_number', p_stage::text); END IF;

  PERFORM net.http_post(
    url := 'https://api.github.com/repos/DaniBici/calendario-ciclismo/actions/workflows/uci-results-today.yml/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'supabase-panel-admin', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', v_inputs), timeout_milliseconds := 15000
  );
  RETURN 'dispatched';
END;
$function$;

CREATE OR REPLACE FUNCTION private.dispatch_web_pages_workflow()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;
  PERFORM public._dispatch_web_pages_workflows();
  UPDATE public.web_pages_regen_state SET dirty_since = NULL, last_dispatched = now() WHERE id = true;
  RETURN 'dispatched';
END;
$function$;

REVOKE ALL ON FUNCTION private.dispatch_uci_results_workflow(text, integer, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.dispatch_web_pages_workflow() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.dispatch_uci_results_workflow(text, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.dispatch_web_pages_workflow() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow()
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501'; END IF;
  RETURN private.dispatch_uci_results_workflow(NULL, NULL, true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow(p_race_id text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501'; END IF;
  RETURN private.dispatch_uci_results_workflow(p_race_id, NULL, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow(p_race_id text, p_stage integer)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501'; END IF;
  RETURN private.dispatch_uci_results_workflow(p_race_id, p_stage, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_trigger_web_pages_workflow()
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501'; END IF;
  RETURN private.dispatch_web_pages_workflow();
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_trigger_uci_results_workflow() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_trigger_uci_results_workflow(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_trigger_uci_results_workflow(text, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_trigger_web_pages_workflow() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_trigger_uci_results_workflow() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_trigger_uci_results_workflow(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_trigger_uci_results_workflow(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_trigger_web_pages_workflow() TO authenticated, service_role;
