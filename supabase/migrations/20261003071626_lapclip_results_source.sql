-- LAPCLIP (Matrix Sports, matrix-sports.jp/lap) publica en directo vueltas y
-- tiempos de transpondedor de las carreras en circuito japonesas.
-- El código es <evento>/<categoría>/<vueltas>; p. ej. 261004_oita/200/13.
-- Solo añade una columna: los privilegios de tabla existentes la cubren.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "lapclipCode" text;

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
    'ASO'::text, 'bornan'::text, 'atresults'::text, 'mikatiming'::text, 'ficr'::text,
    'lapclip'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_lapclip_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_lapclip_code
  CHECK (source <> 'lapclip'
    OR "lapclipCode" ~ '^[0-9]{6}_[A-Za-z0-9_-]+/[0-9]{3}(-[0-9]+)?/[1-9][0-9]{0,2}$');

COMMENT ON COLUMN public.race_uci_links."lapclipCode" IS
  'LAPCLIP: <evento>/<categoría>/<vueltas>; p. ej. 261004_oita/200/13 (Oita Urban Classic Road Race 2026).';
