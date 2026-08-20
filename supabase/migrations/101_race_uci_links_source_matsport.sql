-- 101 — Cuarta fuente de resultados: MATSPORT
-- ---------------------------------------------------------------------------
-- api.cycling.matsport.com es el cronometrador de muchas carreras francesas
-- (Tour Féminin des Pyrénées, Dunkerque, Morbihan, Denain, Isbergues…). Publica
-- EN VIVO durante la etapa — patrón calcado de tissot, AUTOMÁTICO en el cron:
--   scripts/results-fetchers/matsport-results-fetch.mjs   (fetcher)
--   scripts/results-fetchers/uci-results-cron.mjs          (rama useMatsport)
--   scripts/results-fetchers/uci-results-upsert.mjs         (mismo upsert)
-- Contrato: scripts/results-fetchers/MATSPORT-API.md
--
-- Esta migración:
--   1) amplía el CHECK de race_uci_links.source con 'matsport'.
--   2) añade la columna race_uci_links."matsportCode" = código de 3 letras de
--      Matsport (p. ej. "PYF"); el comp id se compone {year}_{code} ("2026_PYF").
--
-- Reconstruida a partir del DDL real aplicado en prod (2026-06-12); idempotente.

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "matsportCode" text;

COMMENT ON COLUMN public.race_uci_links."matsportCode" IS
  'Código de 3 letras de Matsport (PYF, 4JD...). El comp id es {year}_{code}. Solo con source=''matsport''.';

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_matsport_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_matsport_code
  CHECK ((source <> 'matsport'::text) OR ("matsportCode" IS NOT NULL));
