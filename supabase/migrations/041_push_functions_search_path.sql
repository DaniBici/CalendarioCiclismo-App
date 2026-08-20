-- ─────────────────────────────────────────────────────────────────
--  041_push_functions_search_path.sql
--
--  Limpia el warning function_search_path_mutable del database linter
--  añadiendo SET search_path = public, pg_temp a las 3 funciones
--  PL/pgSQL antiguas que no lo declaraban explícitamente.
--
--  Las funciones ya usan calificación de schema (public.pg_cron_config,
--  net.http_post, etc.) o solo tablas del schema public, así que el
--  search_path explícito no cambia su comportamiento — solo cierra la
--  superficie de ataque (search_path mutable permite a un atacante con
--  permisos de creación de schemas hijackear nombres no calificados).
--
--  Funciones nuevas creadas en migraciones 036+ ya incluyen el SET
--  search_path en la propia definición (ver 040_push_subscription_categories.sql).
-- ─────────────────────────────────────────────────────────────────

ALTER FUNCTION public.increment_push_fail_count(text[], integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.reset_push_fail_count(text[])
  SET search_path = public, pg_temp;

ALTER FUNCTION public.process_scheduled_push_notifications()
  SET search_path = public, pg_temp;
