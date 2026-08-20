-- 118 — Novena fuente de resultados: DOMTEL SPORT TIMING
-- ---------------------------------------------------------------------------
-- domtel-sport.pl es el cronometrador polaco (Course de Solidarność i
-- Olimpijczyków / UCI Europe Tour y otras carreras de Polonia). Su capa de
-- resultados expone JSON PÚBLICO SIN AUTH vía un endpoint del plugin WordPress
-- "prosta-tabela-csv" (ptc), que publica EN VIVO durante la etapa — patrón
-- calcado de tissot/matsport/sts, AUTOMÁTICO en el cron:
--   POST wyniki.domtel-sport.pl/wp-admin/admin-ajax.php
--        (action=ptc_front_refresh&pid=<domtelCode>)
--   scripts/results-fetchers/domtel-results-fetch.mjs   (fetcher)
--   scripts/results-fetchers/uci-results-cron.mjs        (rama useDomtel)
--   scripts/results-fetchers/uci-results-upsert.mjs       (mismo upsert)
-- Contrato: scripts/results-fetchers/DOMTEL-TIMING-API.md
--
-- Esta migración:
--   1) amplía el CHECK de race_uci_links.source con 'domtel'.
--   2) añade la columna race_uci_links."domtelCode" = id de post WordPress del
--      evento (p. ej. "8850"); es el `pid` del POST. Un pid acumula todas las
--      etapas + GENERAL, así que el code basta para identificar la carrera.
--   3) añade el CHECK per-columna chk_race_uci_links_domtel_code (source
--      'domtel' exige domtelCode NOT NULL), en línea con las fuentes
--      tissot/matsport/raceresult/sts.
--
-- Idempotente.

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK (source = ANY (ARRAY['uci'::text, 'tissot'::text, 'pdf'::text, 'matsport'::text, 'sportstiming'::text, 'manual_timing'::text, 'raceresult'::text, 'sts'::text, 'domtel'::text]));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "domtelCode" text;

COMMENT ON COLUMN public.race_uci_links."domtelCode" IS
  'Id de post WordPress del evento en Domtel Sport Timing (p. ej. "8850"); es el pid del POST a wp-admin/admin-ajax.php (action=ptc_front_refresh). Un pid acumula todas las etapas + GENERAL. Ancla los IDs sintéticos de domtel-results-fetch.mjs. Solo con source=''domtel''.';

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS chk_race_uci_links_domtel_code;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT chk_race_uci_links_domtel_code
  CHECK ((source <> 'domtel'::text) OR ("domtelCode" IS NOT NULL));
