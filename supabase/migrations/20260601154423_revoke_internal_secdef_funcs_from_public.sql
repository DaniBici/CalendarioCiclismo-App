-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260601154423, nombre revoke_internal_secdef_funcs_from_public). Texto aplicado en producción, sin cambios.

-- Continuación del fix 0028/0029. El REVOKE previo a anon/authenticated no bastó
-- porque estas funciones tienen EXECUTE concedido a PUBLIC ('=X/...' en el ACL),
-- del que anon/authenticated heredan. Revocamos de PUBLIC.
-- postgres y service_role conservan EXECUTE por su grant DIRECTO en el ACL, así que:
--   * pg_cron (corre como postgres) sigue funcionando
--   * send-push (service_role) sigue funcionando
--   * los triggers se ejecutan en su propio contexto, ajenos a estos grants
-- Las set_push_subscription_*/get_race_filter_keys NO se tocan: su grant PUBLIC es
-- intencional (la web/apps sin login registran suscripciones).

REVOKE EXECUTE ON FUNCTION public.get_unrestricted_push_subscribers(text, text[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_scheduled_push_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_push_fail_count(text[], integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_push_fail_count(text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_default_push_category() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.today_highlights_set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_workflows_for_start_order() FROM PUBLIC;
