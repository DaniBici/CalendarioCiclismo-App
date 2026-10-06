-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260914191816, nombre broadcasts_country_remove_sk). Texto aplicado en producción, sin cambios.

ALTER TABLE public.broadcasts DROP CONSTRAINT broadcasts_country_check;
ALTER TABLE public.broadcasts ADD CONSTRAINT broadcasts_country_check CHECK ((country = ANY (ARRAY['ALL'::text, 'ES'::text, 'EUROPA'::text, 'PT'::text, 'FR'::text, 'BE'::text, 'NL'::text, 'IT'::text, 'DE_AT_CH'::text, 'UK_IE'::text, 'SCANDI'::text, 'EE'::text, 'LATAM'::text, 'NORTEAM'::text, 'ASIAPAC'::text, 'AFRICA'::text, 'MENA'::text])));
