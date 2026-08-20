-- ═══════════════════════════════════════════════════════════════════
--  CALENDARIO CICLISMO — Protección antifraude en reportes
--  Añade columnas de auditoría y un índice para rate-limiting por IP.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Índice para consultas de rate-limit: (ip_address, created_at)
CREATE INDEX IF NOT EXISTS reports_ip_created_idx
  ON reports (ip_address, created_at DESC);
