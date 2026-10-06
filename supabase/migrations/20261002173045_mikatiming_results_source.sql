-- mika:timing (cronometrador alemán, p. ej. Sparkassen Münsterland Giro)
-- publica la clasificación HTML de cada evento en
-- <host>.mikatiming.com/<edición>/?pid=list&event=<evento>.
-- El código es <host>/<ruta de edición>/<evento>.
-- Solo añade una columna: los privilegios de tabla existentes la cubren.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "mikatimingCode" text;

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
    'ASO'::text, 'bornan'::text, 'atresults'::text, 'mikatiming'::text]));

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_mikatiming_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_mikatiming_code
  CHECK (source <> 'mikatiming'
    OR "mikatimingCode" ~ '^([a-z0-9-]+\.)+mikatiming\.(com|de)(/[A-Za-z0-9_-]+)*/[A-Za-z0-9_]+$');

COMMENT ON COLUMN public.race_uci_links."mikatimingCode" IS
  'mika:timing: <host>/<ruta de edición>/<evento>; p. ej. muensterland-giro.r.mikatiming.com/2026/P200_9TGOTQ702E5.';
