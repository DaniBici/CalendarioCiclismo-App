-- Permite forzar un país (y por tanto bandera) específico en una jornada,
-- distinto al de la carrera. Pensado para jornadas de Grandes Vueltas
-- celebradas en el extranjero (p.ej., etapas del Tour de Francia en Italia).
-- Es PURAMENTE COSMÉTICO: solo cambia la bandera mostrada al usuario,
-- no afecta a los filtros de país de las distintas vistas.

ALTER TABLE race_days
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT DEFAULT NULL;
