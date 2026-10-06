-- 103 — Quinta fuente de resultados: SPORTSTIMING.DK
-- ---------------------------------------------------------------------------
-- sportstiming.dk es el cronometrador danés (Copenhagen Sprint, UCI WT/WWT y
-- otras carreras nórdicas). NO tiene API JSON: la clasificación de meta se
-- lee del HTML por query param (?cat=) — patrón calcado de tissot/matsport,
-- pero el volcado se ejecuta EN LOCAL (sin GitHub Actions):
--   scripts/results-fetchers/sportstiming-results-fetch.mjs  (fetcher)
--   scripts/results-fetchers/uci-results-upsert.mjs --apply   (mismo upsert)
--
-- Esta migración:
--   1) amplía el CHECK de race_uci_links.source con 'sportstiming'.
--   2) añade la columna race_uci_links."sportstimingCode" = "{eventId}|{catLabel}"
--      (p. ej. "18776|Elite Women (13. June)"): un evento sportstiming agrupa
--      varias carreras (masc/fem), así que el código identifica la tabla exacta.
--
-- Idempotente (refleja lo ya aplicado en prod el 2026-06-13 vía pg local).

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text, 'sportstiming'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "sportstimingCode" text;

COMMENT ON COLUMN public.race_uci_links."sportstimingCode" IS
  'Código de la carrera en sportstiming.dk: "{eventId}|{catLabel}" (p. ej. "18776|Elite Women (13. June)"). Lo consume sportstiming-results-fetch.mjs. Solo con source=''sportstiming''.';
