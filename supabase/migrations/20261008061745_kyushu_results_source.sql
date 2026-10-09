-- Tour de Kyushu: comunicados oficiales del organizador por etapa, con la
-- llegada provisional de LAPCLIP (lapclipCode) mientras no se publican.
-- Solo cambia un CHECK: sin objetos nuevos ni GRANT.
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
    'lapclip'::text, 'kyushu'::text]));
