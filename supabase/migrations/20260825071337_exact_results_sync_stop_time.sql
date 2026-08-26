-- La ventana de captación se configura con horas civiles de apertura y cierre.
-- La regla de carrera se hereda por todas sus jornadas; una jornada puede guardar
-- instantes exactos como excepción. Un cierre igual o anterior a la apertura de la
-- regla global se interpreta como el día siguiente.

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "syncStopTime" time without time zone;

ALTER TABLE public.race_days
  ADD COLUMN IF NOT EXISTS "resultsSyncStopAt" timestamptz;

COMMENT ON COLUMN public.race_uci_links."syncStopTime" IS
  'Hora exacta de cierre de la captación para cada jornada de la carrera, interpretada en Europe/Madrid.';
COMMENT ON COLUMN public.race_days."resultsSyncStopAt" IS
  'Override por jornada del instante UTC exacto en que termina la captación de resultados.';
