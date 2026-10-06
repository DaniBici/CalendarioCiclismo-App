-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260731141235, nombre allow_admin_route_gpx_upsert). Texto aplicado en producción, sin cambios.

CREATE POLICY route_gpx_auth_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'route-gpx' AND (SELECT private.is_admin()));
