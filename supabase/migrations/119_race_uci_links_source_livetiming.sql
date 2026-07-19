-- 119 — Décima fuente de resultados: LIVETIMING.AT
-- ---------------------------------------------------------------------------
-- livetiming.at es el cronometrador austriaco (LIDL Tour of Austria y otras
-- pruebas de Austria). Expone dos endpoints JSON PÚBLICOS SIN AUTH que publican
-- EN VIVO durante la etapa — patrón calcado de tissot/matsport/raceresult/sts/
-- domtel, AUTOMÁTICO en el cron:
--   GET  livetiming.at/live_links.php?V_ID=<vid>       (metadatos del día)
--   POST livetiming.at/live_data_all.php  (V_ID=<vid>&lynx=1&tour=1)
--                                                      (clasificaciones)
--   scripts/results-fetchers/livetiming-results-fetch.mjs   (fetcher)
--   scripts/results-fetchers/uci-results-cron.mjs            (rama useLivetiming)
--   scripts/results-fetchers/uci-results-upsert.mjs          (mismo upsert)
-- Contrato: scripts/results-fetchers/LIVETIMING-API.md
--
-- Esta migración:
--   1) amplía el CHECK de race_uci_links.source con 'livetiming'.
--   2) añade la columna race_uci_links."livetimingCode" = el V_ID de la ETAPA 1
--      (base), con formato AAMMDD (p. ej. "260708" = 2026-07-08). En livetiming
--      cada etapa es un V_ID distinto (uno por día); el fetcher DERIVA los V_ID
--      de las etapas siguientes sumando días al base (260708 → 260709 → …), así
--      que basta guardar el V_ID de la primera etapa.
--   3) añade el CHECK per-columna chk_race_uci_links_livetiming_code (source
--      'livetiming' exige livetimingCode NOT NULL), en línea con las fuentes
--      tissot/matsport/raceresult/sts/domtel.
--
-- Idempotente.

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text, 'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text, 'domtel'::text, 'livetiming'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "livetimingCode" text;

COMMENT ON COLUMN public.race_uci_links."livetimingCode" IS
  'V_ID de la ETAPA 1 (base) en livetiming.at, formato AAMMDD (p. ej. "260708" = 2026-07-08). En livetiming cada etapa es un V_ID distinto (uno por día); livetiming-results-fetch.mjs deriva los V_ID de las etapas siguientes sumando días al base. Ancla los IDs sintéticos negativos del fetcher. Solo con source=''livetiming''.';

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_livetiming_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_livetiming_code
  CHECK ((source <> 'livetiming'::text) OR ("livetimingCode" IS NOT NULL));
