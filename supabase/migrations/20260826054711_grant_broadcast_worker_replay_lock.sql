-- Permite que el sincronizador cierre una emisión cuando RTVE publica la etapa
-- íntegra: fija el enlace Revive y bloquea futuras modificaciones automáticas.

GRANT UPDATE ("automationLocked")
  ON public.broadcasts TO cc_broadcasts_worker;
