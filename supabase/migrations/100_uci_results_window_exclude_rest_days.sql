-- 100 — El guard de ventana de meta (087) NO debe abrir ventana por una JORNADA DE
--        DESCANSO de hoy.
--
-- BUG (cazado 2026-06-12, Vuelta a Camerún): el cron de resultados del día
-- (trigger_uci_results_today_workflow, migración 087) disparaba el workflow cada
-- 30 min TODA la noche pese a no haber ninguna prueba activa.
--
-- CAUSA. El guard de 087 abre ventana "todo el día" para una jornada de HOY sin
-- hora de meta (rama: estimatedFinishTimeUtc IS NULL AND dateKey = hoy). Esa rama
-- se diseñó para no perder cobertura cuando a una ETAPA REAL le falta el dato
-- curado de meta. Pero NO distinguía una etapa sin hora de un DÍA DE DESCANSO: la
-- Vuelta a Camerún (stage_race enlazada a UCI) tiene jornadas de descanso con
-- stageNumber NULL y sin horas (06-06 y 06-12); al ser "hoy" el 12, abrían ventana
-- todo el día → 48 disparos inútiles de Actions, sin nada que volcar.
--
-- FIX. La rama "hoy sin hora de meta" solo abre ventana si la jornada es una
-- COMPETICIÓN REAL:
--   · carrera de un día (raceFormat = 'one_day'; su jornada ES la prueba), o
--   · una etapa numerada (stageNumber >= 1).
-- Un día de descanso de una vuelta (stageNumber NULL o 0 en un stage_race) ya NO
-- abre ventana — no hay resultados que volcar. Las etapas reales a las que les
-- falte la hora de meta siguen cubiertas (stageNumber >= 1 entra igual).
--
-- ESPEJO: el mismo criterio va en uci-results-cron.mjs (predicado IN_WINDOW, mismo
-- commit). Cambiar la ventana aquí = cambiarla también allí.
--
-- Solo cambia el predicado del guard; el resto de la función (Vault, http_post,
-- cadencia */30) es idéntico a 087. IDEMPOTENTE.

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
  -- Guard de ventana de meta (087 + 100): disparar solo si alguna jornada de una
  -- carrera enlazada está en [meta+15min, meta+3h] (o es de hoy, sin hora de meta,
  -- Y es competición real: un-día o etapa numerada — NO un día de descanso).
  IF NOT EXISTS (
    SELECT 1
    FROM race_uci_links l
    JOIN races r ON r.id = l."raceId"
    JOIN race_days d ON d."raceId" = l."raceId"
    WHERE (
      d."estimatedFinishTimeUtc" IS NOT NULL
      AND now() >= d."estimatedFinishTimeUtc" + interval '15 minutes'
      AND now() <= d."estimatedFinishTimeUtc" + interval '3 hours'
    ) OR (
      d."estimatedFinishTimeUtc" IS NULL
      AND d."dateKey" = to_char(now(), 'YYYY-MM-DD')
      AND (r."raceFormat" = 'one_day' OR d."stageNumber" >= 1)
    )
  ) THEN
    RAISE LOG '[uci-cron] fuera de ventana de meta (ninguna llegada hace 15min–3h ni etapa real hoy) — no disparo el workflow';
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

REVOKE ALL ON FUNCTION public.trigger_uci_results_today_workflow() FROM PUBLIC;
