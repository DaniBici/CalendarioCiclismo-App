-- InfoCity: cronometrador oficial del Tour de Pologne. `infocityCode` guarda
-- race:test:ced de la primera etapa; el fetcher deriva los ced correlativos.
ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "infocityCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_infocity_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_infocity_code
  CHECK ((source <> 'infocity'::text) OR ("infocityCode" ~ '^[1-9][0-9]*:[1-9][0-9]*:[1-9][0-9]*$'));

COMMENT ON COLUMN public.race_uci_links."infocityCode" IS
  'race:test:ced de la etapa 1 de tdp.infocity.pl (p. ej. 21:21:141); el fetcher deriva los ced correlativos para las etapas siguientes.';
