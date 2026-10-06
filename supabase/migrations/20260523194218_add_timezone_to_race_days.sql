-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260523194218, nombre add_timezone_to_race_days). Texto aplicado en producción, sin cambios.

ALTER TABLE race_days ADD COLUMN timezone text;
COMMENT ON COLUMN race_days.timezone IS 'IANA timezone of the stage start location (e.g. Asia/Tokyo, Europe/Rome). Used by the start-order page to convert race-local times to the visitor''s timezone.';
