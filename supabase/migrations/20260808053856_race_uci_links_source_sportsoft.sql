-- SportSoft Timing: `sportsoftCode` es el identificador numérico de la carrera
-- en vysledky.sportsoft.cz. El fetcher descubre las competiciones variables.
ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "sportsoftCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_sportsoft_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_sportsoft_code
  CHECK ((source <> 'sportsoft'::text) OR ("sportsoftCode" ~ '^[1-9][0-9]*$'));

COMMENT ON COLUMN public.race_uci_links."sportsoftCode" IS
  'ID numérico de carrera en vysledky.sportsoft.cz; el fetcher descubre sus competitionId variables.';
