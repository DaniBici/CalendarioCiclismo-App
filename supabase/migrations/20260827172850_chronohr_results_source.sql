-- CH:RO:NO publica índices HTML progresivos por carrera y por jornada.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "chronoHrCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing.ee'::text, 'belgiancycling'::text, 'evodata'::text,
    'chronohr'::text, 'ASO'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_chronohr_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_chronohr_code
  CHECK (source <> 'chronohr' OR "chronoHrCode" ~ '^20[0-9]{6}_[a-z0-9._-]+$');

COMMENT ON COLUMN public.race_uci_links."chronoHrCode" IS
  'Código público de carrera CH:RO:NO; p. ej. 20260829_tour_of_bulgaria.';
