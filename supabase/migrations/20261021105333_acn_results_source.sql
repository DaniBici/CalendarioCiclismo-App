-- ACN Timing (acn-timing.com, cronometrador Chronorace) publica en JSON las
-- tablas de resultados de cada prueba de un evento. El código es
-- <eventId>/<ctx>/<clave>; p. ej. 2156365640493136/20261021_cac/ITTRES1 (CRI
-- Elite masculina de los Campeonatos de África 2026). Solo añade una columna:
-- los privilegios de tabla existentes la cubren.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "acnCode" text;

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
    'lapclip'::text, 'kyushu'::text, 'acn'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_acn_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_acn_code
  CHECK (source <> 'acn'
    OR "acnCode" ~ '^[0-9]{6,20}/[0-9]{8}_[A-Za-z0-9_-]+/[A-Za-z0-9_]+$');

COMMENT ON COLUMN public.race_uci_links."acnCode" IS
  'ACN Timing: <eventId>/<ctx>/<clave de la tabla>; p. ej. 2156365640493136/20261021_cac/ITTRES1 (Campeonato de África CRI masculino 2026).';
