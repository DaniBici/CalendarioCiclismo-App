-- 087 — Ventana por hora de meta + cadencia 30 min para el cron de resultados UCI
--        del día (uci-results-today.yml). Ajusta el disparador de la migración 086,
--        que corría cada 15 min TODO el día.
--
-- MOTIVO (no gastar minutos de GitHub Actions a lo bestia)
--   El workflow corría 96 veces/día aunque no hubiera nada que volcar: la UCI solo
--   publica resultados al acabar cada prueba. Las horas de meta YA están en la BD
--   (race_days."estimatedFinishTimeUtc", timestamptz) → el disparador puede saber
--   si "toca" sin arrancar ningún runner.
--
-- REGLA (Dani, 2026-06-10)
--   Una jornada está "en ventana" desde 15 min después de su hora de meta hasta
--   3 h después:   now() ∈ [meta+15min, meta+3h].
--   · Ej.: meta en Corea a las 03:45 UTC → activo 04:00–06:45 UTC.
--   · Varias carreras solapadas (Europa) → unión de ventanas: desde la primera
--     meta+15min hasta la última meta+3h (las ventanas se encadenan).
--   · Jornada de HOY sin hora de meta (dato curado, no debería faltar) → ventana
--     todo el día, para no perder cobertura.
--   · La ventana NO mira dateKey: una meta a las 23:50 UTC sigue viva de madrugada
--     (etapas americanas), aunque su dateKey ya sea "ayer".
--
-- FLUJO (igual que 086, con guard delante)
--   pg_cron 'trigger-uci-results-today' (*/30, antes */15)
--     -> public.trigger_uci_results_today_workflow()   [SECURITY DEFINER]
--        · guard: ¿alguna jornada de carrera ENLAZADA (race_uci_links) en ventana?
--          NO → RAISE LOG y RETURN (ni Vault, ni http_post, ni runner de Actions).
--          SÍ → net.http_post -> workflow_dispatch de uci-results-today.yml.
--   El driver (uci-results-cron.mjs --scope today) aplica EL MISMO criterio POR
--   CARRERA (solo fetchea las que están en su propia ventana). ESPEJO: cambiar la
--   ventana aquí = cambiarla también allí (y viceversa).
--
-- SECRETO / ROTACIÓN: sin cambios — PAT en Vault 'github_dispatch_token' (ver 086).
-- IDEMPOTENTE: re-aplicar no duplica el job (unschedule previo por nombre).

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
  -- Guard de ventana de meta (087): solo disparar si alguna jornada de una carrera
  -- enlazada está en [meta+15min, meta+3h] (o es de hoy y no tiene hora de meta).
  -- Espejo del predicado IN_WINDOW de uci-results-cron.mjs.
  IF NOT EXISTS (
    SELECT 1
    FROM race_uci_links l
    JOIN race_days d ON d."raceId" = l."raceId"
    WHERE (
      d."estimatedFinishTimeUtc" IS NOT NULL
      AND now() >= d."estimatedFinishTimeUtc" + interval '15 minutes'
      AND now() <= d."estimatedFinishTimeUtc" + interval '3 hours'
    ) OR (
      d."estimatedFinishTimeUtc" IS NULL
      AND d."dateKey" = to_char(now(), 'YYYY-MM-DD')
    )
  ) THEN
    RAISE LOG '[uci-cron] fuera de ventana de meta (ninguna llegada hace 15min–3h) — no disparo el workflow';
    RETURN;
  END IF;

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
-- (CREATE OR REPLACE conserva los privilegios, pero se re-declara por claridad.)
REVOKE ALL ON FUNCTION public.trigger_uci_results_today_workflow() FROM PUBLIC;

-- Reprogramar a cada 30 minutos. unschedule previo por idempotencia.
DO $$
BEGIN
  PERFORM cron.unschedule('trigger-uci-results-today')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trigger-uci-results-today');
END $$;

SELECT cron.schedule(
  'trigger-uci-results-today',
  '*/30 * * * *',
  $$SELECT public.trigger_uci_results_today_workflow();$$
);
