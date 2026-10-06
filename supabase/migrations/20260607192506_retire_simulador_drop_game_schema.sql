-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260607192506, nombre retire_simulador_drop_game_schema). Texto aplicado en producción, sin cambios.

-- Retirar el simulador de ciclismo (proyecto pospuesto 2026-06-07).
-- Elimina el schema game (ratings + roles + sim cacheado) y la vista pública del sim.
-- La app principal (riders_men/women, startlists) NO depende de estos objetos.
DROP VIEW IF EXISTS public.sim_rider_ratings;
DROP TABLE IF EXISTS game.race_sim;
DROP TABLE IF EXISTS game.race_roles;
DROP TABLE IF EXISTS game.rider_ratings;
DROP SCHEMA IF EXISTS game;
