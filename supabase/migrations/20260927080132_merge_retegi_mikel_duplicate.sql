-- Unifica la ficha duplicada retegi-goni-mikel-2 (alta automática sin nacimiento
-- del Tour de Langkawi 2026) en retegi-goni-mikel (UCI 437033, 27-04-2001,
-- Equipo Kern Pharma). La ficha verificada es la superviviente.

BEGIN;

CREATE TABLE private.repair_retegi_mikel_20260927_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_retegi_mikel_20260927_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_retegi_mikel_20260927_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_retegi_mikel_20260927_backup
  TO service_role;

COMMENT ON TABLE private.repair_retegi_mikel_20260927_backup IS
  'Estado previo de las dos fichas de Mikel Retegi y del inscrito del Tour de Langkawi 2026 antes de fusionarlas el 27-09-2026.';

DO $$
DECLARE
  v_keep constant text := 'retegi-goni-mikel';
  v_drop constant text := 'retegi-goni-mikel-2';
  v_row constant text := 'a686ec5a-324b-4bc6-9010-7d2b3be1acaa';
  v_backup_count integer;
  v_keep_startlists integer;
BEGIN
  PERFORM id FROM public.riders_men
  WHERE id IN (v_keep, v_drop)
  ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM public.riders_men
      WHERE id = v_keep AND "firstName" = 'Mikel'
        AND "lastName" = 'Retegi' AND "identityKey" = 'mikel-retegi'
        AND "birthDate" = DATE '2001-04-27' AND nationality = 'es'
        AND "uciProfileId" = '437033') <> 1
     OR (SELECT count(*) FROM public.riders_men
      WHERE id = v_drop AND "firstName" = 'Mikel'
        AND "lastName" = 'RETEGI GOÑI' AND "identityKey" = 'goni-mikel-retegi'
        AND "birthDate" IS NULL AND nationality = 'es'
        AND "uciProfileId" IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Las fichas de Retegi han cambiado; no se fusionan';
  END IF;

  SELECT count(*) INTO v_keep_startlists
  FROM public.startlist_riders WHERE "globalRiderId" = v_keep;

  IF (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = v_drop AND id = v_row) <> 1
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE "globalRiderId" = v_drop) <> 1
     OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE "globalRiderId" = v_drop) THEN
    RAISE EXCEPTION 'Las referencias de retegi-goni-mikel-2 han cambiado; no se fusionan';
  END IF;

  IF EXISTS (
    WITH refs AS (
      SELECT "raceId", "globalRiderId" FROM public.startlist_riders
      WHERE "globalRiderId" IN (v_keep, v_drop)
      UNION ALL
      SELECT "raceId", "globalRiderId" FROM public.race_uci_results
      WHERE "globalRiderId" IN (v_keep, v_drop)
    )
    SELECT 1 FROM refs GROUP BY "raceId"
    HAVING count(DISTINCT "globalRiderId") > 1
  ) OR EXISTS (
    SELECT 1 FROM public.rider_identity_aliases
    WHERE gender = 'male' AND "aliasKey" = 'goni-mikel-retegi'
  ) OR EXISTS (
    SELECT 1 FROM public.rider_identity_aliases WHERE "riderId" = v_drop
  ) OR EXISTS (
    SELECT 1 FROM public.rider_team_affiliations WHERE "riderId" = v_drop
  ) OR EXISTS (
    SELECT 1 FROM public.rider_transfers WHERE "riderId" = v_drop
  ) OR EXISTS (
    SELECT 1 FROM private.rider_uci_profile_aliases WHERE "riderId" = v_drop
  ) OR EXISTS (
    SELECT 1 FROM public.cx_results WHERE "globalRiderId" = v_drop
  ) OR EXISTS (
    SELECT 1 FROM public.cx_startlist_riders WHERE "globalRiderId" = v_drop
  ) OR EXISTS (
    SELECT 1 FROM public.cx_tournament_standings WHERE "globalRiderId" = v_drop
  ) THEN
    RAISE EXCEPTION 'Hay una coincidencia o referencia adicional que exige revisión';
  END IF;

  INSERT INTO private.repair_retegi_mikel_20260927_backup(entity, row_key, row_data)
  SELECT 'riders_men', id, to_jsonb(r)
  FROM public.riders_men r WHERE id IN (v_keep, v_drop);

  INSERT INTO private.repair_retegi_mikel_20260927_backup(entity, row_key, row_data)
  SELECT 'startlist_riders', id, to_jsonb(s)
  FROM public.startlist_riders s WHERE id = v_row;

  SELECT count(*) INTO v_backup_count
  FROM private.repair_retegi_mikel_20260927_backup;
  IF v_backup_count <> 3 THEN
    RAISE EXCEPTION 'Backup incompleto: % filas', v_backup_count;
  END IF;

  UPDATE public.startlist_riders
  SET "globalRiderId" = v_keep, "firstName" = 'Mikel', "lastName" = 'Retegi'
  WHERE id = v_row;

  DELETE FROM public.riders_men WHERE id = v_drop;

  INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
  VALUES ('goni-mikel-retegi', 'male', v_keep,
    'Grafía RETEGI GOÑI Mikel del Tour de Langkawi 2026; ficha duplicada unificada el 27-09-2026');

  IF EXISTS (SELECT 1 FROM public.riders_men WHERE id = v_drop)
     OR EXISTS (SELECT 1 FROM public.startlist_riders WHERE "globalRiderId" = v_drop)
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE "globalRiderId" = v_keep) <> v_keep_startlists + 1
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE id = v_row AND "globalRiderId" = v_keep
           AND "lastName" = 'Retegi') <> 1
     OR (SELECT count(*) FROM public.rider_identity_aliases
         WHERE gender = 'male' AND "aliasKey" = 'goni-mikel-retegi'
           AND "riderId" = v_keep) <> 1 THEN
    RAISE EXCEPTION 'La verificación de la fusión de Retegi ha fallado';
  END IF;
END $$;

COMMIT;

-- Rollback dirigido: restaurar la ficha retegi-goni-mikel-2 desde row_data con
-- jsonb_populate_record; restaurar la fila de startlist por row_key; borrar el
-- alias goni-mikel-retegi creado.
