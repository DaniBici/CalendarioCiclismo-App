-- ChronoRace publica los informes de resultados como PDFs dinámicos.
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS race_uci_links_source_check;
ALTER TABLE public.race_uci_links ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'ASO'::text]));

ALTER TABLE public.race_uci_links ADD COLUMN IF NOT EXISTS "chronoraceCode" text;
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS chk_race_uci_links_chronorace_code;
ALTER TABLE public.race_uci_links ADD CONSTRAINT chk_race_uci_links_chronorace_code
  CHECK (source <> 'chronorace' OR "chronoraceCode" ~ '^[0-9]+$');

COMMENT ON COLUMN public.race_uci_links."chronoraceCode" IS
  'eventId de ChronoRace; el fetcher descubre los PDFs E0, E1... desde su listado público.';
