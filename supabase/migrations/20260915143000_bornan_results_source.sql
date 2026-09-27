-- Sistema Bornan de cronometraje de unos Juegos (p. ej. Santa Fe 2026): el
-- cuadro Results por unidad se publica como PDF cuando la prueba queda
-- OFFICIAL. El código combina despliegue, campeonato, disciplina y clave de
-- evento: https://back.results.santafe2026.org|JSUD2026|CRD|W.TT----------------
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "bornanCode" text;

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
    'ASO'::text, 'bornan'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_bornan_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_bornan_code
  CHECK (source <> 'bornan' OR "bornanCode" ~ '^https://[^\|]+\|[A-Za-z0-9_-]+\|[A-Za-z0-9_-]+\|[A-Za-z0-9.\-]+$');

COMMENT ON COLUMN public.race_uci_links."bornanCode" IS
  'Despliegue Bornan, campeonato, disciplina y clave de evento; p. ej. https://back.results.santafe2026.org|JSUD2026|CRD|W.TT----------------.';
