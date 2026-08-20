-- ═══════════════════════════════════════════════════════════════════
--  092 — race_uci_stages.keepForWeb: WHITELIST de classKind.
--
--  PROBLEMA (detectado por Dani 2026-06-10, Tour de Lituania): la UCI publica
--  clasificaciones secundarias que no modelamos (Sprint/metas volantes:
--  "Stage/Overall Sprint Classification"). El catch-all de classifyEvent las
--  dejaba en classKind='stage' → keepForWeb=true → se colaban en la página de
--  resultados como si fueran el resultado de etapa (tabla de puntos junto a la
--  etapa real). Y aunque el fetcher las mapee a un kind propio ('sprint', fix
--  del mismo día), la definición vieja de keepForWeb las mantendría visibles
--  cuando scope='overall' o isFinalClassification.
--
--  FIX: keepForWeb exige ADEMÁS que el classKind sea uno de los 6 que la
--  web/apps saben pintar (pestañas Etapa/General/Puntos/Montaña/Jóvenes/
--  Equipos). 'sprint', 'other' y cualquier kind futuro desconocido quedan
--  ingeridos pero invisibles, en cualquier scope y también en finales.
--
--  La columna es GENERATED STORED → no se puede ALTER la expresión: se
--  recrea (DROP+ADD) junto con su único dependiente (el índice parcial
--  idx_race_uci_stages_web). Los clientes no notan nada (mismo nombre).
--
--  Sigue a la 091. La siguiente migración es la 093.
-- ═══════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_race_uci_stages_web;

ALTER TABLE public.race_uci_stages DROP COLUMN "keepForWeb";

ALTER TABLE public.race_uci_stages ADD COLUMN "keepForWeb" boolean
  GENERATED ALWAYS AS (
    ("classKind" = ANY (ARRAY['stage'::text, 'gc'::text])
      OR scope = 'overall'::text
      OR "isFinalClassification")
    AND "classKind" = ANY (ARRAY['stage'::text, 'gc'::text, 'points'::text,
                                 'kom'::text, 'youth'::text, 'teams'::text])
  ) STORED;

CREATE INDEX idx_race_uci_stages_web ON public.race_uci_stages
  USING btree ("raceId", "stageNumber") WHERE "keepForWeb";
