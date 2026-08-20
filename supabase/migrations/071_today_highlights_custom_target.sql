-- Cintillo: nuevo targetType 'custom' (solo web). Una entrada totalmente
-- personalizable: título/subtítulo/URL/logo propios, sin carrera asociada.
-- Las apps lo ignoran automáticamente (no resuelven carrera → descartan el slide).

-- Columnas nuevas para entradas custom.
ALTER TABLE public.today_highlights
  ADD COLUMN IF NOT EXISTS "customUrl"   TEXT,  -- URL de destino (ES o única)
  ADD COLUMN IF NOT EXISTS "customUrlEn" TEXT,  -- URL de destino para EN (opcional)
  ADD COLUMN IF NOT EXISTS "customLogo"  TEXT;  -- URL del logo (opcional)

-- Permitir 'custom' en el allowlist de targetType.
ALTER TABLE public.today_highlights
  DROP CONSTRAINT IF EXISTS today_highlights_targettype_check;

ALTER TABLE public.today_highlights
  ADD CONSTRAINT today_highlights_targettype_check
  CHECK ("targetType" IN ('raceDay','startlist','startOrder','race','custom'));

-- CHECK de campos obligatorios por tipo: custom requiere customUrl (no raceId/raceDayId).
ALTER TABLE public.today_highlights
  DROP CONSTRAINT IF EXISTS today_highlights_target_check;

ALTER TABLE public.today_highlights
  ADD CONSTRAINT today_highlights_target_check
  CHECK (
    ("targetType" IN ('startlist','race') AND "raceId" IS NOT NULL) OR
    ("targetType" IN ('raceDay','startOrder') AND "raceDayId" IS NOT NULL) OR
    ("targetType" = 'custom' AND "customUrl" IS NOT NULL)
  );

COMMENT ON COLUMN public.today_highlights."targetType" IS
  'Tipo de destino: raceDay (detalle jornada), startlist (inscritos), startOrder (orden de salida), race (página de competición), custom (entrada libre solo web: customUrl/customLogo + customTitle).';
COMMENT ON COLUMN public.today_highlights."customUrl" IS 'URL de destino de una entrada custom (ES o única). Requerida si targetType=custom.';
COMMENT ON COLUMN public.today_highlights."customUrlEn" IS 'URL de destino para la versión EN de una entrada custom (opcional; si falta se usa customUrl).';
COMMENT ON COLUMN public.today_highlights."customLogo" IS 'URL del logo de una entrada custom (opcional).';
