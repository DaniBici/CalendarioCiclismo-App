-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260629124936, nombre 116b_revoke_execute_on_internal_team_sync_funcs). Texto aplicado en producción, sin cambios.

-- Las funciones de sincronización del modelo temporal de equipos son INTERNAS (solo
-- las invocan los triggers, como el dueño de la tabla). No deben ser ejecutables vía
-- API por anon/authenticated. Mismo endurecimiento que resolve_riders (revoke_internal_*).
REVOKE EXECUTE ON FUNCTION public.recompute_current_team(text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sync_affiliation_to_current_team() FROM anon, authenticated, public;
