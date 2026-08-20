-- Añadir 'race' al CHECK constraint de targetType.
-- 'race' apunta a la página de competición (vista general de carrera),
-- usa `raceId` (NO `raceDayId`), igual que 'startlist'.

ALTER TABLE public.today_highlights
  DROP CONSTRAINT IF EXISTS today_highlights_targetType_check;

ALTER TABLE public.today_highlights
  ADD CONSTRAINT today_highlights_targetType_check
  CHECK ("targetType" IN ('raceDay','startlist','startOrder','race'));

-- Actualizar también el CHECK combinado de campos obligatorios
ALTER TABLE public.today_highlights
  DROP CONSTRAINT IF EXISTS today_highlights_target_check;

ALTER TABLE public.today_highlights
  ADD CONSTRAINT today_highlights_target_check
  CHECK (
    ("targetType" IN ('startlist','race') AND "raceId" IS NOT NULL) OR
    ("targetType" IN ('raceDay','startOrder') AND "raceDayId" IS NOT NULL)
  );

COMMENT ON COLUMN public.today_highlights."targetType" IS
  'Tipo de destino: raceDay (detalle jornada), startlist (inscritos), startOrder (orden de salida), race (página de competición).';
