-- Classificações.net: fuente automática de resultados de ciclismo portugués.
ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "classificacoesCode" text;

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_classificacoes_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_classificacoes_code
  CHECK ((source <> 'classificacoes'::text) OR ("classificacoesCode" IS NOT NULL AND btrim("classificacoesCode") <> ''));

COMMENT ON COLUMN public.race_uci_links."classificacoesCode" IS
  'Slug de la prueba en classificacoes.net, sin la ruta /modalidades/ciclismo/. El fetcher descubre desde él los ids de etapa y clasificación.';
