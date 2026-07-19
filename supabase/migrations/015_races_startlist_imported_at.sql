-- ═══════════════════════════════════════════════════════════════════
--  races.startlistImportedAt — marca temporal de la última importación
--  de lista de inscritos para esa carrera.
--
--  La vista "Últimas listas" del panel filtra races por esta columna
--  (`IS NOT NULL`) y ordena por startDate, evitando tener que escanear
--  `startlist_teams` (miles de filas) solo para sacar raceIds distintos.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS "startlistImportedAt" TIMESTAMPTZ;

-- Backfill: para cada carrera que ya tenga lista importada pero aún
-- no tiene fecha, asignar `startDate - 1 día a las 14:00 UTC` (víspera
-- por la tarde — coincide con el flujo real: la UCI publica los
-- inscritos la tarde anterior al arranque de la carrera).
UPDATE races r
SET "startlistImportedAt" = (
  (r."startDate" || 'T14:00:00Z')::timestamptz - interval '1 day'
)
WHERE r."startlistImportedAt" IS NULL
  AND r."startDate" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM startlist_teams t WHERE t."raceId" = r.id
  );
