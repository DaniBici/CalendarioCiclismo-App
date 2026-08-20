-- 108 — Séptima fuente de resultados: RACE|RESULT
-- ---------------------------------------------------------------------------
-- my.raceresult.com es la plataforma de cronometraje de muchas carreras nórdicas
-- y de Europa central (Tour of Slovenia, Tour of Norway…). Expone una API JSON
-- PÚBLICA SIN AUTH (config + list) — patrón calcado de tissot/matsport,
-- AUTOMÁTICO en el cron:
--   scripts/results-fetchers/raceresult-results-fetch.mjs  (fetcher)
--   scripts/results-fetchers/uci-results-cron.mjs           (rama useRaceresult)
--   scripts/results-fetchers/uci-results-upsert.mjs          (mismo upsert)
-- Contrato: scripts/results-fetchers/RACERESULT-TIMING-API.md
--
-- Esta migración:
--   1) amplía el CHECK de race_uci_links.source con 'raceresult'.
--   2) añade la columna race_uci_links."raceresultCode" = eventId numérico de
--      race|result (p. ej. "402988"); el fetcher resuelve key+server del /config.
--
-- Reconstruida a partir del DDL real aplicado en prod (2026-06-17); idempotente.

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text, 'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "raceresultCode" text;

COMMENT ON COLUMN public.race_uci_links."raceresultCode" IS
  'eventId numérico de race|result (my.raceresult.com), p. ej. "402988". Solo si source=raceresult. El fetcher resuelve key+server del /config.';

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_raceresult_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_raceresult_code
  CHECK ((source <> 'raceresult'::text) OR ("raceresultCode" IS NOT NULL));
