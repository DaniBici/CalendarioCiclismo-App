-- 086 — Disparador externo y FIABLE del workflow GitHub "uci-results-today.yml".
--
-- CONTEXTO / MOTIVO
--   El `schedule: '*/15'` de GitHub Actions NO es fiable en este repo. GitHub hace
--   "best-effort" con los crons y, bajo carga, colapsa los de alta frecuencia.
--   Verificado 2026-06-09: el `*/15` de uci-results-today saltó UNA sola vez en 2 h,
--   y el `*/5` de scheduled-push se comporta igual (~cada 2 h). Resultado: los
--   resultados UCI del día no se volcaban a tiempo.
--
--   Solución: sacar el disparo de GitHub y meterlo en pg_cron (que SÍ respeta la
--   cadencia, al vivir dentro de Postgres). Mismo patrón que ya usa este proyecto en
--   public.process_scheduled_push_notifications (pg_cron -> función -> net.http_post).
--
-- FLUJO
--   pg_cron job 'trigger-uci-results-today' (*/15)
--     -> public.trigger_uci_results_today_workflow()   [SECURITY DEFINER]
--     -> net.http_post (pg_net)
--     -> POST https://api.github.com/repos/DaniBici/calendario-ciclismo/
--             actions/workflows/uci-results-today.yml/dispatches   {"ref":"main"}
--   GitHub responde 204 y arranca el workflow (que ya solo tiene `workflow_dispatch:`;
--   se le quitó el `schedule:` en el mismo cambio — ver .github/workflows/uci-results-today.yml).
--
-- SECRETO
--   El PAT de GitHub (fine-grained, permiso Actions: Read and write SOLO en este repo)
--   se guarda en Supabase Vault con el nombre 'github_dispatch_token'. La función lo
--   lee de vault.decrypted_secrets. Si el secret no existe, AVISA (RAISE WARNING) y
--   hace RETURN sin fallar — el cron no se rompe mientras falte el token.
--
-- ROTACIÓN DEL PAT
--   Si el token caduca/se rota: actualizar SOLO el secret de Vault 'github_dispatch_token'
--   (Dashboard -> Project Settings -> Vault). No hace falta tocar esta función ni el cron.
--
-- IDEMPOTENTE: re-aplicar este archivo no duplica el job (unschedule previo por nombre).

CREATE OR REPLACE FUNCTION public.trigger_uci_results_today_workflow()
RETURNS void
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
  BEGIN
    SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
    WHERE name = 'github_dispatch_token'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[uci-cron] no pude leer vault.decrypted_secrets: %', SQLERRM;
    RETURN;
  END;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE WARNING '[uci-cron] falta el secret de Vault "github_dispatch_token" — no disparo el workflow';
    RETURN;
  END IF;

  -- Disparar workflow_dispatch en GitHub (fire-and-forget; la respuesta 204 va al
  -- log de net._http_response). El body indica la rama por defecto.
  PERFORM net.http_post(
    url := format('https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches',
                  v_owner, v_repo, v_wf),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'supabase-pg-cron',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'main'),
    timeout_milliseconds := 15000
  );

  RAISE LOG '[uci-cron] workflow_dispatch enviado a %/% (%).', v_owner, v_repo, v_wf;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[uci-cron] trigger_uci_results_today_workflow error: %', SQLERRM;
END;
$function$;

-- Cerrar la función al público: solo el rol de pg_cron (postgres) la ejecuta.
REVOKE ALL ON FUNCTION public.trigger_uci_results_today_workflow() FROM PUBLIC;

-- Programar cada 15 minutos. unschedule previo por idempotencia.
DO $$
BEGIN
  PERFORM cron.unschedule('trigger-uci-results-today')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trigger-uci-results-today');
END $$;

SELECT cron.schedule(
  'trigger-uci-results-today',
  '*/15 * * * *',
  $$SELECT public.trigger_uci_results_today_workflow();$$
);
