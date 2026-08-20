-- 121_web_pages_regen_debounce_server_side.sql
--
-- Traslada el DEBOUNCE de la regeneración de páginas estáticas del CLIENTE al
-- SERVIDOR. El diseño anterior (mig. 120 + js/panel.js `_triggerWebPagesRegen`)
-- programaba un `setTimeout(8s)` en el navegador que, al vencer, llamaba a
-- `admin_trigger_web_pages_workflow()`. Dos defectos:
--
--   1. FIABILIDAD: el timer vive en el navegador. Si tras guardar el usuario
--      cambia de jornada, cierra el editor, recarga o la pestaña pasa a segundo
--      plano (el navegador congela sus timers), el dispatch NUNCA sale y la
--      página queda en 404 hasta el cron diario. Cazado con la Clásica Castilla
--      y León 2026: se guardó publicada pero su dispatch de 8s no llegó a
--      ejecutarse (0 filas en net._http_response entre el guardado y el disparo
--      manual de rescate).
--   2. COALESCENCIA: un `setTimeout` por navegador no colapsa guardados
--      espaciados >8s ni ráfagas repartidas entre pestañas/recargas. En una
--      sesión de edición se llegaron a disparar ~15 runs de og-pages + 15 de
--      sitemap en 30 min (cada run regenera las ~3.300 páginas del sitio).
--
-- Nuevo modelo: el panel solo MARCA "hay cambios pendientes" (RPC barata
-- `admin_mark_web_pages_dirty()`, va garantizada dentro del mismo guardado). Un
-- pg_cron cada minuto (`web_pages_regen_tick()`) mira la marca y, si pasó el
-- periodo de reposo (QUIET_PERIOD desde el ÚLTIMO cambio → colapsa ráfagas),
-- dispara UN run de og-pages + sitemap y limpia la marca. Latencia máxima
-- ~1-2 min vs los 8s de antes, pero SIN pérdidas y con coalescencia real.
--
-- `admin_trigger_web_pages_workflow()` (mig. 120) SE CONSERVA intacta para
-- disparos manuales inmediatos (seeding ad-hoc por MCP/SQL, rescates).

-- ── Estado del debounce (fila única) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.web_pages_regen_state (
  id              boolean     PRIMARY KEY DEFAULT true,  -- singleton: siempre true
  dirty_since     timestamptz,   -- 1er cambio pendiente desde el último dispatch (NULL = limpio)
  last_touched    timestamptz,   -- cambio pendiente más reciente (para el quiet period)
  last_dispatched timestamptz,   -- último dispatch efectivo (auditoría)
  CONSTRAINT web_pages_regen_state_singleton CHECK (id = true)
);

INSERT INTO public.web_pages_regen_state (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

-- Solo el backend (service_role) y el cron tocan esta tabla; el panel escribe
-- vía la RPC SECURITY DEFINER. Sin políticas de lectura pública.
ALTER TABLE public.web_pages_regen_state ENABLE ROW LEVEL SECURITY;

-- ── RPC que llama el panel al guardar: marca pendiente (barata, idempotente) ─
CREATE OR REPLACE FUNCTION public.admin_mark_web_pages_dirty()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.web_pages_regen_state
  SET dirty_since  = COALESCE(dirty_since, now()),  -- fija el 1er cambio; no lo pisa
      last_touched = now()                          -- reinicia el quiet period
  WHERE id = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_web_pages_dirty() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_web_pages_dirty() TO authenticated, service_role;

-- ── Disparo interno de los workflows (extraído de mig. 120 para reutilizar) ──
-- Idéntico cuerpo que admin_trigger_web_pages_workflow(); privado (no lo llama
-- el panel). Separado para que el tick lo invoque sin duplicar el POST.
CREATE OR REPLACE FUNCTION public._dispatch_web_pages_workflows()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_token text;
  v_owner text := 'DaniBici';
  v_repo  text := 'calendario-ciclismo';
  v_wf    text;
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token'
  LIMIT 1;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"';
  END IF;

  FOREACH v_wf IN ARRAY ARRAY['og-pages.yml', 'sitemap.yml'] LOOP
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
      body := jsonb_build_object('ref', 'main'),
      timeout_milliseconds := 15000
    );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public._dispatch_web_pages_workflows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._dispatch_web_pages_workflows() TO service_role;

-- Reapuntar la RPC pública de disparo manual (mig. 120) a la lógica compartida
-- + marcar como despachado (para no re-disparar por el cron acto seguido).
CREATE OR REPLACE FUNCTION public.admin_trigger_web_pages_workflow()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public._dispatch_web_pages_workflows();
  -- Un disparo manual satisface cualquier marca pendiente: limpiar el debounce.
  UPDATE public.web_pages_regen_state
  SET dirty_since = NULL, last_dispatched = now()
  WHERE id = true;
  RETURN 'dispatched';
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_trigger_web_pages_workflow() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_trigger_web_pages_workflow() TO authenticated, service_role;

-- ── Tick del debounce (lo llama pg_cron cada minuto) ────────────────────────
-- Dispara SOLO si hay marca pendiente Y pasó QUIET_PERIOD desde el último
-- cambio (colapsa la ráfaga de edición en un único run tras el último guardado).
CREATE OR REPLACE FUNCTION public.web_pages_regen_tick()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  QUIET_PERIOD constant interval := interval '45 seconds';
  v_state public.web_pages_regen_state%ROWTYPE;
BEGIN
  SELECT * INTO v_state FROM public.web_pages_regen_state WHERE id = true FOR UPDATE;

  -- Sin marca pendiente: nada que hacer.
  IF v_state.dirty_since IS NULL THEN
    RETURN 'idle';
  END IF;

  -- Aún dentro del periodo de reposo: esperar (la ráfaga puede seguir).
  IF v_state.last_touched > now() - QUIET_PERIOD THEN
    RETURN 'waiting';
  END IF;

  -- Reposo cumplido: disparar y limpiar la marca.
  PERFORM public._dispatch_web_pages_workflows();
  UPDATE public.web_pages_regen_state
  SET dirty_since = NULL, last_dispatched = now()
  WHERE id = true;
  RETURN 'dispatched';
END;
$function$;

REVOKE ALL ON FUNCTION public.web_pages_regen_tick() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.web_pages_regen_tick() TO service_role;

-- ── Programar el tick cada minuto ───────────────────────────────────────────
SELECT cron.schedule('web-pages-regen-tick', '* * * * *',
                     'SELECT public.web_pages_regen_tick();');
