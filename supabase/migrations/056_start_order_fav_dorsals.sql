-- 056: Dorsales favoritos en orden de salida
-- Permite al admin marcar un subconjunto de dorsales como "favoritos/GC"
-- para mostrar un filtro Todos / Favoritos en la página pública de orden de salida.
ALTER TABLE race_days
  ADD COLUMN "startOrderFavDorsals" INTEGER[] DEFAULT NULL;
