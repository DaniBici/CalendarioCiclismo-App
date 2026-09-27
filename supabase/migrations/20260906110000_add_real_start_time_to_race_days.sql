ALTER TABLE public.race_days
  ADD COLUMN IF NOT EXISTS "realStartTimeUtc" timestamptz;

COMMENT ON COLUMN public.race_days."realStartTimeUtc" IS
  'Instante UTC de la salida real de la jornada, calculado desde dateKey y la zona IANA de la jornada.';
