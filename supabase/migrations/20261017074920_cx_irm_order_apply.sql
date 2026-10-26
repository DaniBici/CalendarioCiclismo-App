-- Ordena por IRM y equipo las categorías CX existentes. Copia previa del orden en
-- private.cx_results_irm_order_20261017_backup.
DO $fix$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT "raceId", category FROM public.cx_results LOOP
    PERFORM private.order_cx_irm_results(r."raceId", r.category);
  END LOOP;
END $fix$;
