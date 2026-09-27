-- Marcas de carreras creadas para conservar únicamente ficha, jornadas y resultados.
-- El watcher usa esta marca para no sembrar startlists desde DataRide.
ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS "resultsOnly" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.races."resultsOnly" IS
  'La carrera no debe generar inscritos ni equipos por el pipeline automático de resultados.';
