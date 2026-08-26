-- timing.ee publica resultados JSON y PDFs oficiales por evento y jornada.
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS race_uci_links_source_check;
ALTER TABLE public.race_uci_links ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing'::text, 'ASO'::text]));

ALTER TABLE public.race_uci_links ADD COLUMN IF NOT EXISTS "timingCode" text;
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS chk_race_uci_links_timing_code;
ALTER TABLE public.race_uci_links ADD CONSTRAINT chk_race_uci_links_timing_code
  CHECK (source <> 'timing' OR "timingCode" ~ '^[0-9]+$');

COMMENT ON COLUMN public.race_uci_links."timingCode" IS
  'event numérico de timing.ee; el fetcher descubre jornadas, clasificaciones y PDFs oficiales.';
