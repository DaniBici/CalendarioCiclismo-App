ALTER TABLE public.race_uci_stages
  ADD COLUMN IF NOT EXISTS "sourcePdfUrl" text;

COMMENT ON COLUMN public.race_uci_stages."sourcePdfUrl" IS
  'PDF oficial del cronometraje del que procede la clasificación, cuando la fuente lo publica.';
