-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260818143301, nombre document_startlist_rider_country_code_iso2). Texto aplicado en producción, sin cambios.

comment on column public.startlist_riders."countryCode"
is 'Nationality country code for a race startlist rider. Use lowercase ISO 3166-1 alpha-2 codes (for example ES, BE, NL stored as es, be, nl).';
