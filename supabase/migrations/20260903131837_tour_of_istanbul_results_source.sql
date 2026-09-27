-- El Tour of Istanbul publica un dossier PDF por etapa desde una página estable.
-- La fuente no necesita código por carrera: el año y las jornadas ya pertenecen
-- a races/race_days, y el fetcher descubre los enlaces publicados en /results/.
ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'chronorace'::text, 'timing.ee'::text, 'belgiancycling'::text, 'evodata'::text,
    'chronohr'::text, 'maneffic'::text, 'istanbul'::text, 'ASO'::text]));
