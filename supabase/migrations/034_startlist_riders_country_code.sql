-- ═══════════════════════════════════════════════════════════════════
--  STARTLIST RIDERS — Nacionalidad del corredor
--  Extracción opcional desde OCR (Gemini) o entrada manual en panel.
--  Solo cosmético: pinta la bandera junto al nombre en la web.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE startlist_riders
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT
  CHECK ("countryCode" IS NULL OR LENGTH("countryCode") <= 5);

-- Índice parcial: solo filas con país asignado.
-- Útil para futuras consultas tipo "corredores españoles inscritos".
CREATE INDEX IF NOT EXISTS idx_startlist_riders_country
  ON startlist_riders ("countryCode")
  WHERE "countryCode" IS NOT NULL;
