-- Añade orden manual a las emisiones de una jornada.
-- sortOrder es la posición 0-indexed dentro de la jornada.
-- Se persiste desde el panel admin; las tres plataformas leen
-- ya ordenado desde Supabase y no necesitan lógica de sort propia.

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill: asignar orden cronológico a los datos existentes.
-- Dentro de cada jornada, las emisiones con hora van primero
-- (por startTimeUtc ascendente); las sin hora van al final.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "raceDayId"
      ORDER BY
        CASE WHEN "startTimeUtc" IS NULL THEN 1 ELSE 0 END,
        "startTimeUtc" ASC NULLS LAST
    ) - 1 AS rn
  FROM broadcasts
)
UPDATE broadcasts
SET "sortOrder" = ranked.rn
FROM ranked
WHERE broadcasts.id = ranked.id;
