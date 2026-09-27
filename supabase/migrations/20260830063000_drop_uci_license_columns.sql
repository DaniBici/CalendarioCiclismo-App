-- Retirada dirigida de las columnas de licencia UCI de las fichas.
-- El backup completo debe existir en private.uci_id_drop_20260830_backup antes de aplicar.

ALTER TABLE public.riders_men
  DROP CONSTRAINT IF EXISTS riders_men_uci_license_11_check;

ALTER TABLE public.riders_women
  DROP CONSTRAINT IF EXISTS riders_women_uci_license_11_check;

DROP INDEX IF EXISTS public.uq_riders_men_uci_id;
DROP INDEX IF EXISTS public.uq_riders_women_uci_id;

ALTER TABLE public.riders_men
  DROP COLUMN IF EXISTS "uciId";

ALTER TABLE public.riders_women
  DROP COLUMN IF EXISTS "uciId";
