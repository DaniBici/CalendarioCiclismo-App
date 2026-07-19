-- 120_admin_trigger_web_pages_workflow.sql
--
-- Al publicar una jornada nueva desde el panel (editorialStatus='published' con
-- slug) sus páginas estáticas /jornada/<slug>/ (+ inscritos/perfil/mapa/orden-salida/
-- resultados y las EN) NO existen todavía: solo las genera `og-pages.yml` (cron 05:00
-- UTC) y el sitemap `sitemap.yml` (cron 05:20). Hasta el siguiente cron, GitHub Pages
-- devuelve 404. Antes había que disparar los workflows a mano.
--
-- Esta RPC replica el patrón de `admin_trigger_uci_results_workflow` (migs. 088/099):
-- lee el PAT de GitHub desde Vault (cifrado en reposo) y encola vía pg_net un
-- workflow_dispatch de AMBOS workflows (páginas OG + sitemap). El panel la llama
-- fire-and-forget tras guardar una jornada como publicada. pg_net es asíncrono: la
-- RPC solo confirma el encolado; los runs tardan ~1-3 min en reflejarse en la web.
--
-- Ambos workflows ya toleran pushes concurrentes a main (fetch+rebase -X ours en
-- bucle) y tocan ficheros disjuntos (jornada/… vs sitemap.xml/atom.xml), así que
-- dispararlos juntos es seguro.

CREATE OR REPLACE FUNCTION public.admin_trigger_web_pages_workflow()
  RETURNS text
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
  -- Leer el PAT desde Vault (mismo secret que el volcado UCI).
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_dispatch_token'
  LIMIT 1;

  IF v_token IS NULL OR btrim(v_token) = '' THEN
    RAISE EXCEPTION 'Falta el secret de Vault "github_dispatch_token"';
  END IF;

  -- Encolar workflow_dispatch para páginas OG + sitemap. Ninguno declara inputs
  -- obligatorios; basta con el ref.
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

  RETURN 'dispatched';
END;
$function$;

-- Mismos grants que admin_trigger_uci_results_workflow: el panel se autentica como
-- `authenticated`. `anon` NO recibe EXECUTE (solo lo llama un admin logueado).
REVOKE ALL ON FUNCTION public.admin_trigger_web_pages_workflow() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_trigger_web_pages_workflow() TO authenticated, service_role;
