-- Fichajes efectivos durante la temporada en curso. Se conservan en el mismo
-- mercado, pero el feed los identifica visualmente sin sobrecargarlo con el
-- año de contrato.
ALTER TABLE rider_transfers
  ADD COLUMN IF NOT EXISTS "midSeason" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN rider_transfers."midSeason" IS
  'El fichaje se incorpora durante la temporada en curso; muestra el badge Mid-Season en el feed.';
