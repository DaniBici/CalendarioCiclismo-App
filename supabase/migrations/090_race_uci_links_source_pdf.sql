-- ═══════════════════════════════════════════════════════════════════
--  090 — race_uci_links.source admite 'pdf' (skill cc-resultados-pdf)
--
--  Tercera fuente de resultados in-house: volcados manuales desde PDFs
--  de organizadores/cronometradores (Claude extrae el PDF → mismo JSON
--  intermedio → mismo uci-results-upsert.mjs). Para carreras SIN fuente
--  automática (DataRide no publica o tarda días).
--
--  source='pdf' ⇒ uci-results-cron.mjs SALTA la carrera (no existe
--  fetcher automático; con el competitionId sintético NEGATIVO del
--  volcado PDF el fetcher de DataRide devolvería 0 etapas y marcaría
--  error). El upsert lo fija con el flag --source pdf.
--
--  'pdf' NO exige tissotCode (chk_race_uci_links_tissot_code solo
--  ata a 'tissot').
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.race_uci_links
  DROP CONSTRAINT IF EXISTS race_uci_links_source_check;

ALTER TABLE public.race_uci_links
  ADD CONSTRAINT race_uci_links_source_check
  CHECK ("source" IN ('uci', 'tissot', 'pdf'));

COMMENT ON COLUMN public.race_uci_links."source" IS
  'Fuente del volcado de resultados: uci (DataRide, default) | tissot '
  '(API Tissot Timing, exige tissotCode) | pdf (volcado manual desde PDF '
  'del organizador vía skill cc-resultados-pdf; el cron la salta — '
  'competitionId sintético negativo, sin fetcher automático).';
