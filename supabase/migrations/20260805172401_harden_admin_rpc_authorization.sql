-- Las RPC administrativas conservan SECURITY DEFINER porque leen Vault y
-- despachan workflows. El pre-request de PostgREST ya bloquea a quien no es
-- administrador, pero la autorización debe vivir también EN la propia función:
-- así queda protegida ante llamadas no HTTP y cambios futuros del hook global.

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token text;
  v_owner text := 'DaniBici';
  v_repo text := 'calendario-ciclismo';
  v_wf text := 'uci-results-today.yml';
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token' LIMIT 1;
  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"';
  END IF;

  PERFORM net.http_post(
    url := format('https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches', v_owner, v_repo, v_wf),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'supabase-panel-admin', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('ignore_window', 'true')),
    timeout_milliseconds := 15000
  );
  RETURN 'dispatched';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow(p_race_id text, p_stage integer)
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
  IF p_race_id IS NULL OR btrim(p_race_id) = '' THEN RAISE EXCEPTION 'Falta p_race_id'; END IF;

  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token' LIMIT 1;
  IF v_token IS NULL OR btrim(v_token) = '' THEN RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"'; END IF;

  v_inputs := jsonb_build_object('race_id', p_race_id);
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

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow(p_race_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;
  RETURN public.admin_trigger_uci_results_workflow(p_race_id, NULL::integer);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_trigger_web_pages_workflow()
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
