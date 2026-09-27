-- Las fuentes oficiales pueden publicar varias horas después de la meta. El
-- valor anterior (+180 min) dejó fuera South Bohemia y Flanders Tomorrow Tour
-- antes de que aparecieran sus resultados. Las excepciones exactas por carrera
-- o jornada se conservan; solo cambia la ventana heredada predeterminada.

ALTER TABLE public.race_uci_links
  ALTER COLUMN "syncStopOffsetMinutes" SET DEFAULT 720;

UPDATE public.race_uci_links AS l
SET "syncStopOffsetMinutes" = 720
FROM public.races AS r
WHERE r.id = l."raceId"
  AND r."endDate" >= '2026-09-04'
  AND l."source" NOT IN ('pdf', 'sportstiming')
  AND l."syncStartOffsetMinutes" = -15
  AND l."syncStopOffsetMinutes" = 180
  AND l."syncStartTime" IS NULL
  AND l."syncStopTime" IS NULL;

COMMENT ON COLUMN public.race_uci_links."syncStopOffsetMinutes" IS
  'Cierre heredado en minutos respecto a la meta; por defecto +720 para admitir publicaciones oficiales tardías.';
