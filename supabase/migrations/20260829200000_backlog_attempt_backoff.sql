-- El backlog no puede volver a seleccionar indefinidamente la misma carrera
-- cuando DataRide aún no ofrece una clasificación publicable. Estos campos
-- registran únicamente los intentos del drenaje automático; no cambian el
-- estado editorial ni el resultado persistido.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "backlogLastAttemptAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "backlogAttemptCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "backlogNextAttemptAt" timestamptz;

COMMENT ON COLUMN public.race_uci_links."backlogLastAttemptAt" IS
  'Último intento del drenaje automático de backlog, incluidos fetches vacíos o rechazados.';

COMMENT ON COLUMN public.race_uci_links."backlogAttemptCount" IS
  'Número acumulado de intentos del drenaje automático de backlog.';

COMMENT ON COLUMN public.race_uci_links."backlogNextAttemptAt" IS
  'Instante UTC anterior al cual el drenaje automático no debe reintentar esta carrera.';
