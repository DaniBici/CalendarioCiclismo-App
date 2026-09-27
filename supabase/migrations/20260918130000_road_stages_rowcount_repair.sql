-- ─────────────────────────────────────────────────────────────────
--  20260918130000_road_stages_rowcount_repair.sql
--
--  race_uci_stages."rowCount" debe coincidir con las filas reales de
--  race_uci_results (lo exige la integridad de los runbooks y es la
--  señal que usa el gate de resultados de la web y el trigger
--  private.trg_road_results_push()). Se recalcula donde difiere:
--    · cabeceras con filas → count(race_uci_results)
--    · cabeceras sin filas → 0
--
--  No transiciona ningún rowCount de 0 a >0 (las 5 desviaciones tienen
--  rowCount>0), así que no dispara avisos de resultados.
-- ─────────────────────────────────────────────────────────────────

UPDATE public.race_uci_stages s
SET "rowCount" = x.cnt
FROM (
  SELECT "stageRef", count(*)::integer AS cnt
  FROM public.race_uci_results
  GROUP BY "stageRef"
) x
WHERE s.id = x."stageRef"
  AND COALESCE(s."rowCount", 0) IS DISTINCT FROM x.cnt;

UPDATE public.race_uci_stages s
SET "rowCount" = 0
WHERE COALESCE(s."rowCount", 0) <> 0
  AND NOT EXISTS (SELECT 1 FROM public.race_uci_results r WHERE r."stageRef" = s.id);
