-- EvoData CIS agrupa las jornadas de una vuelta bajo un eventId padre estable.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "evodataCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing.ee'::text, 'belgiancycling'::text, 'evodata'::text,
    'ASO'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_evodata_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_evodata_code
  CHECK (source <> 'evodata' OR "evodataCode" ~ '^[1-9][0-9]*$');

COMMENT ON COLUMN public.race_uci_links."evodataCode" IS
  'eventId padre público de EvoData CIS; p. ej. 107849.';
