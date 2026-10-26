-- Copia del orden (sortOrder) de las categorías CX con IRM, previa a ordenarlas por IRM y equipo
-- (private.order_cx_irm_results).
CREATE TABLE private.cx_results_irm_order_20261017_backup (
  "resultId"  bigint PRIMARY KEY,
  "raceId"    text NOT NULL,
  category    text NOT NULL,
  "sortOrder" integer
);

INSERT INTO private.cx_results_irm_order_20261017_backup ("resultId", "raceId", category, "sortOrder")
SELECT r.id, r."raceId", r.category, r."sortOrder"
FROM public.cx_results r
WHERE (r."raceId", r.category) IN (
  SELECT "raceId", category FROM public.cx_results
  WHERE irm IS NOT NULL AND NOT (irm = 'LAP' AND rank IS NOT NULL)
);

REVOKE ALL ON private.cx_results_irm_order_20261017_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.cx_results_irm_order_20261017_backup TO cc_agent;
