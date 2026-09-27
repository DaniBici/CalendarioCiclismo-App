-- AT Results Service (cronometrador de carreras asiáticas, p. ej. Le Tour de
-- Langkawi) publica un dossier PDF por etapa en atresult.synology.me/PDF.
-- El código es <carpeta>/<prefijo> del archivo «<prefijo> Results Stage N.pdf»,
-- o un único segmento cuando carpeta y prefijo coinciden.
-- Solo añade una columna: los privilegios de tabla existentes la cubren.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "atresultsCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing.ee'::text, 'belgiancycling'::text, 'evodata'::text,
    'chronohr'::text, 'maneffic'::text, 'istanbul'::text, 'southbohemia'::text,
    'ASO'::text, 'bornan'::text, 'atresults'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_atresults_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_atresults_code
  CHECK (source <> 'atresults' OR "atresultsCode" ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?$');

COMMENT ON COLUMN public.race_uci_links."atresultsCode" IS
  'AT Results Service: <carpeta>/<prefijo> del dossier «<prefijo> Results Stage N.pdf»; p. ej. 26ltdl/26LTDL.';
