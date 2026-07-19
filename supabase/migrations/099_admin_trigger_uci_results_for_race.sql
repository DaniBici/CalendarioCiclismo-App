-- 099 — Volcado UCI DIRIGIDO a una carrera concreta desde el panel.
--
-- PROBLEMA (cazado en el Tour de Beauce 2026): el botón "▶ Volcar hoy ahora"
-- (migración 088) dispara uci-results-today.yml con ignore_window=true, que llama
-- a uci-results-cron.mjs --scope today → SOLO procesa carreras con una etapa con
-- dateKey = HOY. Si los resultados que faltan son de AYER (la UCI publicó tarde, o
-- una etapa ya pasada quedó sin volcar), "hoy" no la coge y nunca se vuelca desde
-- el panel.
--
-- SOLUCIÓN: esta RPC pasa un race_id al workflow. El driver lo recibe como
-- input → uci-results-cron.mjs --race-id <id>, que ignora por completo la
-- selección por fecha/ventana/estado y vuelca TODAS las etapas que la UCI tenga
-- publicadas para esa competición (incluidas las de días anteriores). El upsert
-- es idempotente, así que re-volcar lo ya volcado no hace daño.
--
-- Se mantiene la RPC sin argumentos de 088 (el botón global "todo lo de hoy")
-- intacta; esta es una sobrecarga con parámetro. Misma seguridad: SECURITY DEFINER,
-- el PAT vive en Vault, GRANT solo a authenticated/service_role.

CREATE OR REPLACE FUNCTION public.admin_trigger_uci_results_workflow(p_race_id text)
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
  v_inputs  jsonb;
BEGIN
  IF p_race_id IS NULL OR btrim(p_race_id) = '' THEN
    RAISE EXCEPTION 'Falta p_race_id';
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token'
  LIMIT 1;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"';
  END IF;

  -- Con race_id presente el driver llama a --race-id e ignora la ventana/fecha.
  -- ignore_window queda implícito (el modo --race-id no mira la ventana).
  v_inputs := jsonb_build_object('race_id', p_race_id);

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
      'inputs', v_inputs
    ),
    timeout_milliseconds := 15000
  );

  RETURN 'dispatched';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_trigger_uci_results_workflow(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_trigger_uci_results_workflow(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_trigger_uci_results_workflow(text) TO authenticated, service_role;
