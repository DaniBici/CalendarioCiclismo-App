ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "stsSkipClaxPoints" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.race_uci_links."stsSkipClaxPoints" IS
  'Si es true, el fetcher STS omite la clasificación pts del .clax para esta carrera.';
