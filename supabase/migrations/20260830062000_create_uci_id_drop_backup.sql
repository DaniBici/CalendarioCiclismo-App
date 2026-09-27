-- Backup previo y recuperable de la retirada de las columnas uciId de las fichas.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.uci_id_drop_20260830_backup (
  operation text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('men', 'women')),
  rider_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, gender, rider_id)
);

COMMENT ON TABLE private.uci_id_drop_20260830_backup IS
  'Backup completo de riders_men/riders_women antes de retirar uciId el 2026-08-30.';

REVOKE ALL ON TABLE private.uci_id_drop_20260830_backup
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.uci_id_drop_20260830_backup TO service_role;

INSERT INTO private.uci_id_drop_20260830_backup
  (operation, gender, rider_id, recorded_at, row_data)
SELECT
  'drop-uci-license-column-20260830',
  'men',
  r.id::text,
  transaction_timestamp(),
  to_jsonb(r)
FROM public.riders_men r
ON CONFLICT (operation, gender, rider_id) DO NOTHING;

INSERT INTO private.uci_id_drop_20260830_backup
  (operation, gender, rider_id, recorded_at, row_data)
SELECT
  'drop-uci-license-column-20260830',
  'women',
  r.id::text,
  transaction_timestamp(),
  to_jsonb(r)
FROM public.riders_women r
ON CONFLICT (operation, gender, rider_id) DO NOTHING;
