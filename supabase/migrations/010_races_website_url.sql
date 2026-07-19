-- Añade la URL de la web oficial a la tabla races.
-- Se propaga a todas las jornadas de la carrera en tiempo de consulta
-- (la app lee race.websiteUrl y lo muestra en la pantalla de jornada).

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT DEFAULT NULL;
