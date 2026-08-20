-- 109 — Octava fuente de resultados: STS / WICLAX
-- ---------------------------------------------------------------------------
-- stsport.fr es el cronometrador francés STS (La Route d'Occitanie, Andorra
-- Clàssica, Tour du Piémont Pyrénéen, pruebas/campeonatos FFC). STS publica el
-- LIVE con el motor Wiclax, que expone un fichero de datos .clax (XML) PÚBLICO
-- SIN AUTH — patrón calcado de tissot/matsport, AUTOMÁTICO en el cron:
--   scripts/results-fetchers/sts-results-fetch.mjs   (fetcher)
--   scripts/results-fetchers/uci-results-cron.mjs     (rama useSts)
--   scripts/results-fetchers/uci-results-upsert.mjs    (mismo upsert)
-- Contrato: scripts/results-fetchers/STS-TIMING-API.md
--
-- Esta migración:
--   1) amplía el CHECK de race_uci_links.source con 'sts'.
--   2) añade la columna race_uci_links."stsCode" = path del .clax tras /LIVE/
--      sin extensión (p. ej. "LAROUTEDOCCITANIE/2026-RDO"); el .clax vive en
--      https://www.stsport.fr/LIVE/<stsCode>.clax
--
-- Reconstruida a partir del DDL real aplicado en prod (2026-06-17); idempotente.

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text, 'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "stsCode" text;

COMMENT ON COLUMN public.race_uci_links."stsCode" IS
  'Identificador de la edición en STS/Wiclax = path del .clax tras /LIVE/ sin extensión (p. ej. LAROUTEDOCCITANIE/2026-RDO). Solo con source=''sts''. El .clax vive en https://www.stsport.fr/LIVE/<stsCode>.clax';

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_sts_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_sts_code
  CHECK ((source <> 'sts'::text) OR ("stsCode" IS NOT NULL));
