-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260918191310, nombre retire_vps_belgiancycling_startlist). Texto aplicado en producción, sin cambios.

-- Retirada del carril automático de inscritos Belgian Cycling del VPS:
-- el experimento no alcanzó la fiabilidad exigida (excepciones de identidad
-- y de equipo en cada lista) y las listas vuelven al flujo manual con
-- prepare_startlist_import/apply_startlist_import desde MCP. La captura de
-- RESULTADOS Belgian Cycling (race_uci_links.source='belgiancycling') no se
-- toca.

DROP FUNCTION IF EXISTS public.vps_import_belgiancycling_startlist(jsonb);
