-- Cintillo: nuevo targetType 'championships' (modo Campeonatos).
-- En la WEB enlaza a la página de Campeonatos Nacionales (campUrl según idioma);
-- en las APPS abre la pantalla nativa de Campeonatos. A diferencia de 'custom',
-- no requiere carrera ni URL: el destino es fijo (config ChampionshipsConfig /
-- campeonatos-config.js). Los campos custom (título/detalle/logo) son opcionales,
-- solo para el texto mostrado en el cintillo.

-- Permitir 'championships' en el allowlist de targetType.
ALTER TABLE public.today_highlights
  DROP CONSTRAINT IF EXISTS today_highlights_targettype_check;

ALTER TABLE public.today_highlights
  ADD CONSTRAINT today_highlights_targettype_check
  CHECK ("targetType" IN ('raceDay','startlist','startOrder','race','custom','championships'));

-- CHECK de campos obligatorios por tipo: championships no exige raceId/raceDayId/customUrl.
ALTER TABLE public.today_highlights
  DROP CONSTRAINT IF EXISTS today_highlights_target_check;

ALTER TABLE public.today_highlights
  ADD CONSTRAINT today_highlights_target_check
  CHECK (
    ("targetType" IN ('startlist','race') AND "raceId" IS NOT NULL) OR
    ("targetType" IN ('raceDay','startOrder') AND "raceDayId" IS NOT NULL) OR
    ("targetType" = 'custom' AND "customUrl" IS NOT NULL) OR
    ("targetType" = 'championships')
  );

COMMENT ON COLUMN public.today_highlights."targetType" IS
  'Tipo de destino: raceDay (detalle jornada), startlist (inscritos), startOrder (orden de salida), race (competición), custom (entrada libre solo web), championships (modo Campeonatos: web → página, apps → pantalla nativa).';
