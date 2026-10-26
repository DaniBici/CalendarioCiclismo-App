-- Ordena por IRM y equipo las clasificaciones existentes. Copia previa del orden en
-- private.race_uci_results_irm_order_20261017_backup.
DO $fix$
DECLARE rid text;
BEGIN
  FOR rid IN SELECT DISTINCT "raceId" FROM public.race_uci_results LOOP
    PERFORM private.order_uci_irm_results(rid);
  END LOOP;
END $fix$;
