CREATE TABLE private.repair_sauerland_riders_20260903_backup (
  table_name text NOT NULL,
  row_id text NOT NULL,
  payload jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, row_id)
);
ALTER TABLE private.repair_sauerland_riders_20260903_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_sauerland_riders_20260903_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_sauerland_riders_20260903_backup TO service_role;
COMMENT ON TABLE private.repair_sauerland_riders_20260903_backup IS 'Snapshot dirigido previo al enlace de fichas autorizado para Sauerlandrundfahrt 2026; incluye el registro de las fichas creadas.';
