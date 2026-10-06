-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260601154212, nombre revoke_internal_secdef_funcs_from_api_roles). Texto aplicado en producción, sin cambios.

-- Fix advisors 0028/0029: SECURITY DEFINER functions ejecutables por anon/authenticated.
-- Estas funciones son internas (las invoca pg_cron como postgres, la edge function
-- send-push como service_role, o son funciones-trigger). No deben ser llamables vía
-- la API REST por anon/authenticated. Revocar EXECUTE NO afecta:
--   * a pg_cron (corre como postgres, dueño)
--   * a send-push (usa adminClient = service_role)
--   * a los triggers (se ejecutan en el contexto del trigger, no por grant de EXECUTE)
-- Se mantienen abiertas a anon las funciones que la web/apps SIN login usan para
-- registrar suscripciones (set_push_subscription_*, get_race_filter_keys) y a
-- authenticated sync_startlist_riders_to_canonical (la llama el panel admin logueado).

-- Fuga de device tokens de todos los suscriptores — la más sensible.
REVOKE EXECUTE ON FUNCTION public.get_unrestricted_push_subscribers(text, text[], text[]) FROM anon, authenticated;

-- Disparan/gestionan la cola de push (pg_net / pg_cron).
REVOKE EXECUTE ON FUNCTION public.process_scheduled_push_notifications() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_dispatch_premium_pushes(integer) FROM anon, authenticated;

-- Contadores de fallo de envío — anon podría desactivar suscripciones ajenas. Las usa send-push.
REVOKE EXECUTE ON FUNCTION public.increment_push_fail_count(text[], integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_push_fail_count(text[]) FROM anon, authenticated;

-- Funciones-trigger: sin uso legítimo como RPC.
REVOKE EXECUTE ON FUNCTION public.ensure_default_push_category() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.today_highlights_set_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_workflows_for_start_order() FROM anon, authenticated;
