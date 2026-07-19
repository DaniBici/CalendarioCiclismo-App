-- ═══════════════════════════════════════════════════════════════════
--  CALENDARIO CICLISMO — Identificación del remitente en reportes
--  Añade nombre y email del usuario que envía el reporte.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS reporter_name  TEXT,
  ADD COLUMN IF NOT EXISTS reporter_email TEXT;
