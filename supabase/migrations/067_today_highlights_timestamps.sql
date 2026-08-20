-- visibleFrom / visibleUntil pasan de DATE a TIMESTAMPTZ.
-- Conversión retrocompatible: filas existentes con DATE se anclan
-- a 00:00 (from) y 23:59 (until) en hora local del editor que las creó.
-- Aproximamos con UTC porque no guardamos la TZ original; el editor
-- puede afinar la hora desde el panel tras la migración si lo necesita.

ALTER TABLE public.today_highlights
  ALTER COLUMN "visibleFrom" TYPE TIMESTAMPTZ
    USING ("visibleFrom"::timestamp AT TIME ZONE 'UTC');

ALTER TABLE public.today_highlights
  ALTER COLUMN "visibleUntil" TYPE TIMESTAMPTZ
    USING (("visibleUntil" + INTERVAL '23 hours 59 minutes 59 seconds')::timestamp AT TIME ZONE 'UTC');

COMMENT ON COLUMN public.today_highlights."visibleFrom" IS
  'Instante a partir del cual el destacado es visible. NULL = visible desde siempre.';

COMMENT ON COLUMN public.today_highlights."visibleUntil" IS
  'Instante a partir del cual el destacado deja de ser visible. NULL = visible para siempre.';
