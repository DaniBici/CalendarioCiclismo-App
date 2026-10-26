-- Copia del orden (sortOrder) de todas las clasificaciones con IRM, previa a ordenarlas
-- por IRM y equipo (private.order_uci_irm_results).
CREATE TABLE private.race_uci_results_irm_order_20261017_backup (
  "resultId"  bigint PRIMARY KEY,
  "stageRef"  text NOT NULL,
  "sortOrder" integer
);

INSERT INTO private.race_uci_results_irm_order_20261017_backup ("resultId", "stageRef", "sortOrder")
SELECT r.id::bigint, r."stageRef", r."sortOrder"
FROM public.race_uci_results r
WHERE r."stageRef" IN (
  SELECT "stageRef" FROM public.race_uci_results
  WHERE irm IS NOT NULL AND NOT (irm IN ('LAP','OVL','REL') AND rank IS NOT NULL)
);

REVOKE ALL ON private.race_uci_results_irm_order_20261017_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.race_uci_results_irm_order_20261017_backup TO cc_agent;
