-- La activación por carrera deja de ser un dato configurable. Un enlace a una
-- fuente con fetcher automático entra siempre en las ventanas y cadencias del
-- watcher del VPS; las fuentes manuales siguen excluidas por `source`.

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_always_active,
  DROP COLUMN IF EXISTS "autoSyncEnabled";
