-- Añade columnas source/verified a riders_men/women y crea índices para acelerar
-- el linking entre startlist_riders y la BD canónica de riders.
-- Cero-downtime: solo añade columnas con default, marca los 775 riders existentes
-- como pcs_import + verified=true, y crea índices nuevos.

ALTER TABLE public.riders_men
  ADD COLUMN IF NOT EXISTS source   text    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT true;

ALTER TABLE public.riders_women
  ADD COLUMN IF NOT EXISTS source   text    NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT true;

-- Los riders ya existentes vienen de una importación previa, no son
-- creaciones manuales: corregimos su source. Las altas futuras quedarán con
-- el default 'manual' o lo que asigne el flujo correspondiente.
UPDATE public.riders_men   SET source = 'pcs_import' WHERE source = 'manual';
UPDATE public.riders_women SET source = 'pcs_import' WHERE source = 'manual';

CREATE INDEX IF NOT EXISTS idx_startlist_riders_global_rider_id
  ON public.startlist_riders ("globalRiderId")
  WHERE "globalRiderId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_riders_men_lastname_lower
  ON public.riders_men (lower("lastName"));
CREATE INDEX IF NOT EXISTS idx_riders_women_lastname_lower
  ON public.riders_women (lower("lastName"));
CREATE INDEX IF NOT EXISTS idx_startlist_riders_lastname_lower
  ON public.startlist_riders (lower("lastName"));
