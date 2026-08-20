-- ═══════════════════════════════════════════════════════════════════
--  Fix keepForWeb: incluir las clasificaciones FINALES de puntos/montaña/
--  jóvenes (no solo la GC final).
--
--  BUG. keepForWeb estaba definido como:
--      classKind IN ('stage','gc') OR scope = 'overall'
--  Pero la UCI publica las clasificaciones de la pseudo-etapa "Final
--  Classification" con scope='stage' (las nombra "Stage …" aunque sean
--  acumulados finales — quirk documentado). Resultado: la General final
--  (classKind='gc') entraba, pero la Montaña / Puntos / Jóvenes FINALES
--  (classKind kom/points/youth, scope='stage') quedaban FUERA. Verificado en
--  el Giro Women 2026: salía la general final pero no puntos/montaña/jóvenes.
--
--  FIX. La señal correcta para "es una clasificación final mostrable" es
--  isFinalClassification (lo marca el stage padre "Final Classification"), NO
--  el scope. Añadimos esa rama:
--      classKind IN ('stage','gc') OR scope = 'overall' OR isFinalClassification
--  Comprobado que isFinalClassification=true SOLO lo tienen gc/kom/points/youth
--  finales (0 'teams' espurios, 0 secundarias de etapa intermedia: esas son
--  isFinalClassification=false) → el fix incluye EXACTAMENTE las finales que
--  faltaban, sin ruido.
--
--  NOTA (fidelidad a la fuente): este fix solo rescata las finales que la UCI
--  SÍ marca como final. Cuando la UCI NO publica una clasificación final para
--  una categoría (p. ej. el Giro femenino 2026 no da "Youth Classification" en
--  su "Final Classification", aunque hubo maglia bianca), NO se inventa ni se
--  deduce de la última "Overall" — la pestaña simplemente no aparece en la
--  clasificación final (sí en la etapa donde su Overall exista). Es un hueco de
--  datos de la UCI, no nuestro; decisión de producto (Dani): no fabricar finales.
--
--  keepForWeb es una columna GENERADA → no se puede ALTER; hay que DROP+ADD.
--  El índice parcial idx_race_uci_stages_web depende de ella → se recrea.
--
--  Sigue a la 084. La siguiente migración es la 086.
-- ═══════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_race_uci_stages_web;

ALTER TABLE public.race_uci_stages DROP COLUMN IF EXISTS "keepForWeb";

ALTER TABLE public.race_uci_stages
  ADD COLUMN "keepForWeb" BOOLEAN GENERATED ALWAYS AS (
    "classKind" IN ('stage','gc') OR scope = 'overall' OR "isFinalClassification"
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_race_uci_stages_web
  ON public.race_uci_stages ("raceId", "stageNumber")
  WHERE "keepForWeb";

COMMENT ON COLUMN public.race_uci_stages."keepForWeb" IS
  'Subconjunto que pinta la web: clasificación de etapa (stage) + GC del día (gc) + generales acumuladas (scope=overall) + TODAS las clasificaciones de la Final Classification (isFinalClassification: GC/puntos/montaña/jóvenes finales, que la UCI marca scope=stage). Fuera: las secundarias DE etapa intermedia (Stage Points/Mountain/Youth, scope=stage, isFinalClassification=false).';
