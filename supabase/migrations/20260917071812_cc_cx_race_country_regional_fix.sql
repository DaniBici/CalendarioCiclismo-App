-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260917071812, nombre cc_cx_race_country_regional_fix). Texto aplicado en producción, sin cambios.

ALTER TABLE public.cx_races DROP CONSTRAINT IF EXISTS "cx_races_countryCode_check";
ALTER TABLE public.cx_races DROP CONSTRAINT IF EXISTS cx_races_countrycode_check;
ALTER TABLE public.cx_races ADD CONSTRAINT cx_races_country_code_check
    CHECK ("countryCode" ~ '^[A-Z]{2}(-[A-Z]{2})?$');
