-- FICR (Federazione Italiana Cronometristi) publica los resultados de ciclismo
-- en una API JSON indexada por año, equipo cronometrador y carrera.
-- El código es <año>/<equipo>/<carrera>; p. ej. 2026/102/10.
-- Solo añade una columna: los privilegios de tabla existentes la cubren.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "ficrCode" text;

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
    'ASO'::text, 'bornan'::text, 'atresults'::text, 'mikatiming'::text, 'ficr'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_ficr_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_ficr_code
  CHECK (source <> 'ficr' OR "ficrCode" ~ '^20[0-9]{2}/[1-9][0-9]{0,3}/[1-9][0-9]{0,5}$');

COMMENT ON COLUMN public.race_uci_links."ficrCode" IS
  'FICR: <año>/<equipo cronometrador>/<carrera>; p. ej. 2026/102/10 (Il Lombardia sub23 2026).';
