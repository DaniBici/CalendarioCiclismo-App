-- Webs oficiales de carrera A.S.O. con clasificaciones HTML/AJAX.
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS race_uci_links_source_check;
ALTER TABLE public.race_uci_links ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text, 'eqtiming'::text, 'colombia'::text, 'burgos'::text,
    'aso'::text]));

ALTER TABLE public.race_uci_links ADD COLUMN IF NOT EXISTS "asoUrl" text;
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS chk_race_uci_links_aso_url;
ALTER TABLE public.race_uci_links ADD CONSTRAINT chk_race_uci_links_aso_url
  CHECK ((source <> 'aso') OR ("asoUrl" ~ '^https://[^[:space:]]+/[^[:space:]]*$'));

COMMENT ON COLUMN public.race_uci_links."asoUrl" IS
  'URL base de clasificaciones de una carrera A.S.O.; el fetcher deriva /stage-N y descubre sus endpoints AJAX efímeros.';
