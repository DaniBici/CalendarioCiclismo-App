-- Belgian Cycling mantiene una URL PDF estable por prueba y sustituye en ella
-- un marcador por la clasificación definitiva.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "belgianCyclingCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing.ee'::text, 'belgiancycling'::text, 'ASO'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_belgiancycling_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_belgiancycling_code
  CHECK (source <> 'belgiancycling' OR "belgianCyclingCode" ~ '^20[0-9]{5,6}$');

COMMENT ON COLUMN public.race_uci_links."belgianCyclingCode" IS
  'Identificador del PDF oficial de Belgian Cycling, incluido el año; p. ej. 2026236.';
