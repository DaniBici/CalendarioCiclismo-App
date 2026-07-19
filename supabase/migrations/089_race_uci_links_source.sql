-- ═══════════════════════════════════════════════════════════════════
--  Fuente de resultados por carrera: UCI DataRide (default) o Tissot Timing.
--
--  Tissot (cronometrador oficial de las carreras ASO + Suiza + Mundial) publica
--  resultados estructurados 5–15 min después de meta — antes que DataRide — vía
--  API REST sin autenticación (prod.server.tissottiming.com, contrato en
--  scripts/results-fetchers/TISSOT-TIMING-API.md). Para esas carreras se
--  puede conmutar la fuente del volcado SIN tocar el resto del pipeline:
--  tissot-results-fetch.mjs emite el MISMO JSON intermedio que
--  uci-results-fetch.mjs → mismo upsert, mismos locks (087), mismo resolve por
--  dorsal (082), web/apps/panel intactos.
--
--  · source     'uci' (default) | 'tissot'. La lee uci-results-cron.mjs para
--               elegir fetcher. Conmutar de vuelta a UCI = UPDATE de esta columna.
--  · tissotCode código de competición Tissot ("ara", "tdf", "vue"…); con el año
--               forma el comp_id ("ara2026"). Obligatorio si source='tissot'.
--
--  ⚠ Al conmutar una carrera CON datos ya volcados: los eventId de Tissot son
--  SINTÉTICOS NEGATIVOS (DataRide usa positivos) → purgar antes las cabeceras
--  de la otra fuente (DELETE race_uci_stages WHERE "raceId"=… — cascade borra
--  las filas) o quedarían clasificaciones duplicadas por etapa.
--
--  Sigue a la 088 (admin_trigger). La siguiente migración es la 090.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'uci'
    CHECK ("source" IN ('uci','tissot'));

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "tissotCode" TEXT;

-- source='tissot' exige tissotCode (el driver no sabría qué pedir a Tissot).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_race_uci_links_tissot_code'
      AND conrelid = 'public.race_uci_links'::regclass
  ) THEN
    ALTER TABLE public.race_uci_links
      ADD CONSTRAINT chk_race_uci_links_tissot_code
      CHECK ("source" <> 'tissot' OR "tissotCode" IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.race_uci_links."source" IS
  'Fuente del volcado de resultados: uci (DataRide, default) | tissot (Tissot Timing, '
  'solo carreras que cronometra: ASO/Suiza/Mundial…). La lee uci-results-cron.mjs.';

COMMENT ON COLUMN public.race_uci_links."tissotCode" IS
  'Código de competición en Tissot Timing ("ara", "tdf", "vue"…); con races.year forma '
  'el comp_id ("ara2026"). Solo con source=tissot.';
