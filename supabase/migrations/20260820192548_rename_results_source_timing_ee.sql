-- El identificador público del origen coincide con el dominio del cronometrador.
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS chk_race_uci_links_timing_code;
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

UPDATE public.race_uci_links
SET source = 'timing.ee'
WHERE source = 'timing';

ALTER TABLE public.race_uci_links ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing.ee'::text, 'ASO'::text]));

ALTER TABLE public.race_uci_links ADD CONSTRAINT chk_race_uci_links_timing_code
  CHECK (source <> 'timing.ee' OR "timingCode" ~ '^[0-9]+$');

COMMENT ON COLUMN public.race_uci_links.source IS
  'Origen activo de resultados; timing.ee identifica el feed y los PDFs oficiales de ese dominio.';
