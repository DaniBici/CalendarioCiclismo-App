-- Contrato UCI v2: separar el código de licencia de 11 cifras del perfil público.
--
-- uciId      = código oficial UCI de licencia, exactamente 11 cifras.
-- uciProfileId = identificador interno de /rider-details/<id>.
--
-- Los checks se crean NOT VALID porque el saneo de los valores históricos se ejecuta
-- inmediatamente después, con backup previo. NOT VALID sigue bloqueando nuevas filas y
-- nuevas actualizaciones inválidas mientras permite completar la limpieza dirigida.

ALTER TABLE public.riders_men
  ADD COLUMN IF NOT EXISTS "uciProfileId" text;

ALTER TABLE public.riders_women
  ADD COLUMN IF NOT EXISTS "uciProfileId" text;

COMMENT ON COLUMN public.riders_men."uciId" IS
  'Código oficial UCI de licencia de 11 cifras. NULL si no se ha verificado.';

COMMENT ON COLUMN public.riders_women."uciId" IS
  'Código oficial UCI de licencia de 11 cifras. NULL si no se ha verificado.';

COMMENT ON COLUMN public.riders_men."uciProfileId" IS
  'Identificador interno numérico del perfil público UCI (/rider-details/<id>). No es el código de licencia.';

COMMENT ON COLUMN public.riders_women."uciProfileId" IS
  'Identificador interno numérico del perfil público UCI (/rider-details/<id>). No es el código de licencia.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_riders_men_uci_profile_id
  ON public.riders_men ("uciProfileId")
  WHERE "uciProfileId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_riders_women_uci_profile_id
  ON public.riders_women ("uciProfileId")
  WHERE "uciProfileId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.riders_men'::regclass
      AND conname = 'riders_men_uci_license_11_check'
  ) THEN
    ALTER TABLE public.riders_men
      ADD CONSTRAINT riders_men_uci_license_11_check
      CHECK ("uciId" IS NULL OR "uciId" ~ '^[0-9]{11}$')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.riders_women'::regclass
      AND conname = 'riders_women_uci_license_11_check'
  ) THEN
    ALTER TABLE public.riders_women
      ADD CONSTRAINT riders_women_uci_license_11_check
      CHECK ("uciId" IS NULL OR "uciId" ~ '^[0-9]{11}$')
      NOT VALID;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.uci_license_cleanup_20260830_backup (
  operation text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('men', 'women')),
  rider_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, gender, rider_id)
);

COMMENT ON TABLE private.uci_license_cleanup_20260830_backup IS
  'Backup dirigido de la limpieza global del contrato UCI de licencias 2026-08-30.';

REVOKE ALL ON TABLE private.uci_license_cleanup_20260830_backup
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.uci_license_cleanup_20260830_backup TO service_role;
