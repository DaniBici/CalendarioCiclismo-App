-- ─────────────────────────────────────────────────────────────────────────────
--  130 — Los dispatches de regeneración apuntan a build-site.yml
--
--  CONTEXTO: la web pasa a desplegarse por artifact de GitHub Pages. Los cuatro
--  generadores (og-pages, sitemap, feeds-ical, build-i18n-pages) se funden en un
--  único workflow `build-site.yml`, que compone el sitio entero y lo publica sin
--  commitear nada a main.
--
--  POR QUÉ ESTA MIGRACIÓN ES OBLIGATORIA: dos funciones vivas disparan los
--  workflows POR NOMBRE vía la API de GitHub:
--    · _dispatch_web_pages_workflows()  (mig. 121 — debounce del panel)
--    · trigger_workflows_for_start_order()  (mig. 102 — órdenes de salida)
--  Al retirar og-pages.yml/sitemap.yml, esas llamadas devolverían 404 y la
--  regeneración moriría EN SILENCIO (net.http_post no comprueba el status):
--  publicar una jornada dejaría de generar su página y volveríamos al 404 que
--  arregló la migración 120.
--
--  Cambio: array de 2 workflows → 1 solo ('build-site.yml'). El resto de la
--  lógica (Vault, debounce, quiet period) no se toca.
--
--  ⚠️ ORDEN: aplicar esta migración DESPUÉS de que build-site.yml exista en main
--  (si no, se dispara un workflow inexistente), y ANTES de borrar los antiguos.
--  En la ventana intermedia ambos existen y el peor caso es una regeneración de
--  más, que es idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- search_path VERBATIM del original (public, pg_temp): las referencias a
-- vault.decrypted_secrets y net.http_post van cualificadas por esquema, así que
-- no necesita más. Cambiarlo aquí sería un efecto colateral no pedido.
CREATE OR REPLACE FUNCTION public._dispatch_web_pages_workflows()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- Antes: ARRAY['og-pages.yml', 'sitemap.yml'] (dos runs, dos commits).
  -- Ahora: un único build que compone el sitio entero y lo despliega.
  FOREACH v_wf IN ARRAY ARRAY['build-site.yml'] LOOP
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
$$;

-- Órdenes de salida (mig. 064 → 102, a nivel STATEMENT).
-- Alimenta DOS triggers: trigger_workflows_on_race_days_so (race_days) y
-- trigger_workflows_on_start_order_entries (start_order_entries).
--
-- ⚠️ Esta función NO llama a la API de GitHub: pasa por la Edge Function
-- `trigger-workflows` con `internal_trigger_token`. El cuerpo se reproduce
-- VERBATIM del que hay en producción y lo ÚNICO que cambia es el array de
-- workflows; se conservan tal cual el search_path (public, extensions, vault),
-- el RETURN COALESCE(NEW, OLD) y el RAISE WARNING (no EXCEPTION: un fallo del
-- dispatch no debe tumbar la escritura del orden de salida).
CREATE OR REPLACE FUNCTION public.trigger_workflows_for_start_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  v_token  text;
  v_url    text := 'https://bcecwlkynpgovnzhbpah.supabase.co/functions/v1/trigger-workflows';
BEGIN
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'internal_trigger_token'
  LIMIT 1;

  IF v_token IS NULL THEN
    RAISE WARNING 'trigger_workflows_for_start_order: vault secret internal_trigger_token no encontrado';
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-Internal-Token', v_token
    ),
    body    := jsonb_build_object(
      -- Antes: jsonb_build_array('og-pages.yml', 'sitemap.yml')
      'workflows', jsonb_build_array('build-site.yml')
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
