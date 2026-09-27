-- Maneffic Timing & Results publica JSON por jornada y clasificaciones bajo un
-- directorio estable de timing-results.com.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "manefficCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing.ee'::text, 'belgiancycling'::text, 'evodata'::text,
    'chronohr'::text, 'maneffic'::text, 'ASO'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_maneffic_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_maneffic_code
  CHECK (source <> 'maneffic' OR "manefficCode" ~ '^20[0-9]{2}/[A-Z0-9_-]+/[A-Z0-9_-]+$');

COMMENT ON COLUMN public.race_uci_links."manefficCode" IS
  'Directorio público de Maneffic Timing & Results; p. ej. 2026/ROA/NED_78380.';
