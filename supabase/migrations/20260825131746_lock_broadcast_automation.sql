-- Bloqueo editorial por emisión para impedir que el sincronizador del VPS
-- adopte o sobrescriba una fila curada manualmente desde el panel.

ALTER TABLE public.broadcasts
  ADD COLUMN "automationLocked" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.broadcasts."automationLocked" IS
  'Impide que la automatización de emisiones del VPS adopte o modifique esta fila.';
