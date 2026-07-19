-- ═══════════════════════════════════════════════════════════════════
--  CALENDARIO CICLISMO — Tabla de reportes de usuarios
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reports (
  id              BIGSERIAL PRIMARY KEY,
  race_day_id     TEXT        NOT NULL,
  race_day_name   TEXT        NOT NULL,
  report_type     TEXT        NOT NULL
                  CHECK (report_type IN ('horario','tv','recorrido','cancelacion','otro')),
  message         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para consultar reportes por jornada
CREATE INDEX IF NOT EXISTS reports_race_day_id_idx ON reports (race_day_id);

-- ── Row Level Security ───────────────────────────────────────────
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Cualquier visitante puede insertar un reporte
CREATE POLICY "public_insert_reports"
  ON reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Solo usuarios autenticados (admin) pueden leer reportes
CREATE POLICY "auth_select_reports"
  ON reports FOR SELECT
  TO authenticated
  USING (true);
