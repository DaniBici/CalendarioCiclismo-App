-- Clasificaciones del Ciclismo Colombiano: colombiaCode es el slug de la carrera.
-- El fetcher descubre los PDF de etapa desde esa página y los interpreta con
-- pdftotext -layout; no se expone ningún objeto nuevo ni se requieren GRANT.
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS race_uci_links_source_check;
ALTER TABLE public.race_uci_links ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text]));
ALTER TABLE public.race_uci_links ADD COLUMN IF NOT EXISTS "colombiaCode" text;
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS chk_race_uci_links_colombia_code;
ALTER TABLE public.race_uci_links ADD CONSTRAINT chk_race_uci_links_colombia_code
  CHECK ((source <> 'colombia'::text) OR ("colombiaCode" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'));
COMMENT ON COLUMN public.race_uci_links."colombiaCode" IS
  'Slug de carrera en clasificacionesdelciclismocolombiano.com; el fetcher descubre sus PDFs de etapa.';
