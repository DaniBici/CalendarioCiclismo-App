-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260601154802, nombre move_unaccent_to_extensions_schema). Texto aplicado en producción, sin cambios.

-- Fix parcial del advisor 0014: mover unaccent a schema extensions.
-- pg_net NO se puede mover (no soporta SET SCHEMA; requeriría DROP+CREATE, lo que
-- destruiría net.http_request_queue y arriesgaría el cron cada-5-min) — se deja en public.
-- unaccent no lo usa ningún objeto del proyecto (migración 062 lo dejó comentado;
-- sin índices/defaults/constraints), así que mover es seguro y no requiere tocar search_paths.
ALTER EXTENSION unaccent SET SCHEMA extensions;
