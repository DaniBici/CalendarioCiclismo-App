-- Retira los identificadores de las fuentes externas de resultados
-- (fuentes externas) de `races`. La web y las apps dejan de
-- enlazar a esas fuentes: los resultados se sirven solo desde las
-- clasificaciones propias (race_uci_*).
ALTER TABLE races DROP COLUMN IF EXISTS "extId";
ALTER TABLE races DROP COLUMN IF EXISTS "extSlug";
