-- EQ Timing (live.eqtiming.com): eqtimingCode es el eventId público de la edición.
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS race_uci_links_source_check;
ALTER TABLE public.race_uci_links ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text,
    'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text,
    'domtel'::text, 'livetiming'::text, 'classificacoes'::text, 'infocity'::text,
    'sportsoft'::text,
    'eqtiming'::text]));
ALTER TABLE public.race_uci_links ADD COLUMN IF NOT EXISTS "eqtimingCode" text;
ALTER TABLE public.race_uci_links DROP CONSTRAINT IF EXISTS chk_race_uci_links_eqtiming_code;
ALTER TABLE public.race_uci_links ADD CONSTRAINT chk_race_uci_links_eqtiming_code
  CHECK ((source <> 'eqtiming'::text) OR ("eqtimingCode" ~ '^[1-9][0-9]*$'));
COMMENT ON COLUMN public.race_uci_links."eqtimingCode" IS
  'eventId numérico de live.eqtiming.com (p. ej. 83198 para Arctic Race of Norway 2026).';
