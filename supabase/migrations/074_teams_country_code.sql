-- ═══════════════════════════════════════════════════════════════════
--  NACIONALIDAD DEL EQUIPO — teams.countryCode
--
--  Hasta ahora la nacionalidad solo existía a nivel de CORREDOR
--  (riders_*.nationality, ISO 3166-1 alpha-2 en minúscula: 'fr', 'es'…).
--  Los EQUIPOS no tenían país. Esto añade el país del equipo.
--
--  Va SOLO en `teams` (la identidad estable), NO en `team_seasons`:
--  la nacionalidad de un equipo es un dato permanente que no cambia de
--  temporada a temporada (a diferencia de nombre/colores/categoría, que
--  sí pueden variar y por eso viven en team_seasons). Modelarlo en teams
--  evita duplicar un valor estable e incoherencias año a año.
--
--  Convención: mismo formato que riders_*.nationality →
--  código ISO 3166-1 alpha-2 en MINÚSCULA ('fr', 'be', 'it', 'es'…).
--  NULL = país desconocido / sin asignar.
--
--  Nota: las 320 filas existentes quedan con NULL; el poblado masivo se
--  hace por separado. Para altas nuevas, el ingestor de catálogo
--  (scripts/ingest-catalog.js) captura el país del equipo en origen.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT;

COMMENT ON COLUMN teams."countryCode" IS
  'Nacionalidad del equipo. ISO 3166-1 alpha-2 en minúscula (fr, es, it…), '
  'misma convención que riders_*.nationality. NULL = sin asignar.';

-- Índice: filtrar/agrupar equipos por país (panel admin, futuras vistas).
CREATE INDEX IF NOT EXISTS idx_teams_country_code
  ON teams ("countryCode");
