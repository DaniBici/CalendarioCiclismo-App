-- ─────────────────────────────────────────────────────────────────
--  Disparar og-pages.yml + sitemap.yml automáticamente cuando
--  cambia el orden de salida, venga el cambio del panel, de un
--  script o de SQL directo.
--
--  Triggers:
--    - race_days  → AFTER UPDATE OF "startOrderImportedAt"
--    - start_order_entries → AFTER INSERT / UPDATE / DELETE
--
--  El coalescing de 30s vive en la edge function trigger-workflows,
--  así que un INSERT masivo de 200 corredores no genera 200 dispatches.
--
--  Secreto compartido: vault.secrets('internal_trigger_token').
-- ─────────────────────────────────────────────────────────────────

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
  -- Leer secreto del vault. Si no existe, log y salir limpiamente.
  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'internal_trigger_token'
  LIMIT 1;

  IF v_token IS NULL THEN
    RAISE WARNING 'trigger_workflows_for_start_order: vault secret internal_trigger_token no encontrado';
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Fire and forget. pg_net es asíncrono, no bloquea el INSERT/UPDATE.
  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-Internal-Token', v_token
    ),
    body    := jsonb_build_object(
      'workflows', jsonb_build_array('og-pages.yml', 'sitemap.yml')
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── race_days: solo cuando startOrderImportedAt cambia ──
DROP TRIGGER IF EXISTS trigger_workflows_on_race_days_so ON public.race_days;
CREATE TRIGGER trigger_workflows_on_race_days_so
AFTER UPDATE OF "startOrderImportedAt" ON public.race_days
FOR EACH ROW
WHEN (NEW."startOrderImportedAt" IS DISTINCT FROM OLD."startOrderImportedAt")
EXECUTE FUNCTION public.trigger_workflows_for_start_order();

-- ── start_order_entries: cualquier cambio ──
DROP TRIGGER IF EXISTS trigger_workflows_on_start_order_entries ON public.start_order_entries;
CREATE TRIGGER trigger_workflows_on_start_order_entries
AFTER INSERT OR UPDATE OR DELETE ON public.start_order_entries
FOR EACH ROW
EXECUTE FUNCTION public.trigger_workflows_for_start_order();
