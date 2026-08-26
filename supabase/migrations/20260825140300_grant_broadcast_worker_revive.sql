-- Permite al sincronizador materializar la capacidad Revive declarada por una
-- fuente, sin ampliar sus permisos sobre el resto de columnas de broadcasts.

GRANT INSERT ("showInRevive")
  ON public.broadcasts TO cc_broadcasts_worker;

GRANT UPDATE ("showInRevive")
  ON public.broadcasts TO cc_broadcasts_worker;
