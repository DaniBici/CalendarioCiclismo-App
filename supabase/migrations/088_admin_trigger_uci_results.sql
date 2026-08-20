-- 088 — RPC para disparar A MANO el cron de resultados UCI del día desde el panel.
--
-- La pestaña «Resultados UCI» del panel (js/panel.js, setupUciView) gana el botón
-- "▶ Volcar hoy ahora": llama a esta RPC, que hace el MISMO workflow_dispatch que
-- el disparador de pg_cron (migraciones 086/087) PERO con el input
-- ignore_window=true → el driver procesa TODO lo que tenga etapa hoy, sin esperar
-- la ventana de meta (087). Para cuando se acaba de corregir/enlazar algo en el
-- panel y se quiere el volcado YA.
--
-- Seguridad:
--   · SECURITY DEFINER + GRANT a authenticated (el panel tiene UN solo usuario
--     admin; mismo patrón que resolve_riders / sync_startlist_riders_to_canonical).
--     El PAT de GitHub NUNCA llega al navegador: vive en Vault
--     ('github_dispatch_token') y solo lo lee esta función en el servidor.
--   · A diferencia de la función del cron (que nunca lanza, para no romper
--     pg_cron), esta SÍ lanza excepción si algo falla → el panel muestra el error.
--   · net.http_post es ASÍNCRONO (encola la petición): la RPC devuelve
--     'dispatched' = encolado. La respuesta 204 de GitHub va a net._http_response;
--     el run se ve en GitHub Actions en ~1-3 min. Fire-and-forget consciente.

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token   text;
  v_owner   text := 'DaniBici';
  v_repo    text := 'calendario-ciclismo';
  v_wf      text := 'uci-results-today.yml';
BEGIN
  -- Leer el PAT desde Vault (cifrado en reposo).
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token'
  LIMIT 1;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"';
  END IF;

  -- workflow_dispatch con ignore_window=true (la API exige los inputs como
  -- strings, también los de tipo boolean).
  PERFORM net.http_post(
    url := format('https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches',
                  v_owner, v_repo, v_wf),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'supabase-panel-admin',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'ref', 'main',
      'inputs', jsonb_build_object('ignore_window', 'true')
    ),
    timeout_milliseconds := 15000
  );

  RETURN 'dispatched';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_trigger_uci_results_workflow() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_trigger_uci_results_workflow() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_trigger_uci_results_workflow() TO authenticated, service_role;
