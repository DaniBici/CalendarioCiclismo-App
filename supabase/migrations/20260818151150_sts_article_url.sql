-- URL opcional del artículo STSport que añade los PDFs oficiales por etapa.
-- La fuente sigue siendo STS/.clax: el fetcher usa el PDF, si está publicado y
-- es consistente, como clasificación de etapa prioritaria.
ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "stsArticleUrl" text;

COMMENT ON COLUMN public.race_uci_links."stsArticleUrl" IS
  'URL absoluta del artículo STSport con PDFs oficiales por etapa. Opcional; el fetcher STS prioriza cada PDF validado sobre el .clax.';
