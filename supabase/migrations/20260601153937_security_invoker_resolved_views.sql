-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260601153937, nombre security_invoker_resolved_views). Texto aplicado en producción, sin cambios.

-- Fix Supabase advisor 0010 (security_definer_view).
-- Ambas vistas son owned por postgres; sin security_invoker ejecutan las
-- consultas con permisos del creador (superuser, salta RLS).
-- Las 8 tablas base tienen política public_read_* (SELECT, public, USING true),
-- por lo que anon/authenticated leen igual con invoker => cambio seguro.
ALTER VIEW public.startlist_riders_resolved SET (security_invoker = true);
ALTER VIEW public.start_order_entries_resolved SET (security_invoker = true);
