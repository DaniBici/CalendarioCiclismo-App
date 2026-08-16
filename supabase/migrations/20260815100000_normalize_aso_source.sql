-- Normaliza el identificador del origen de las webs de carrera de A.S.O.
-- La URL histórica asoUrl se conserva; solo cambia el valor del discriminador.
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS race_uci_links_source_check;
UPDATE public.race_uci_links
SET source = 'ASO'
WHERE source = 'aso';

ALTER TABLE public.race_uci_links ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'ASO'::text]));

ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS chk_race_uci_links_aso_url;
ALTER TABLE public.race_uci_links ADD CONSTRAINT chk_race_uci_links_aso_url
  CHECK ((source <> 'ASO') OR ("asoUrl" ~ '^https://[^[:space:]]+/[^[:space:]]*$'));
