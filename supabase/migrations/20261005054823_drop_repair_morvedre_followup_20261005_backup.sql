-- Retira la copia previa de repair_morvedre_followup_20261005 tras completar
-- la fusión de garcia-frances-pablo en garcia-pablo
-- (repair_morvedre_followup_delete_20261005).

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM private.repair_morvedre_followup_20261005_backup) <> 12 THEN
    RAISE EXCEPTION 'El backup no contiene las 12 filas esperadas';
  END IF;
  IF EXISTS (SELECT 1 FROM public.riders_men WHERE id = 'garcia-frances-pablo') THEN
    RAISE EXCEPTION 'garcia-frances-pablo sigue existiendo';
  END IF;
END
$preflight$;

DROP TABLE private.repair_morvedre_followup_20261005_backup;
