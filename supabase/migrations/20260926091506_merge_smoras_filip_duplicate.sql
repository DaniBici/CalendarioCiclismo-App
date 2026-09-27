-- Unifica la ficha duplicada smoras-fillip (alta automática sin nacimiento del
-- Campeonato de Noruega 2026) en smoras-filip-andre (UCI 812061, 10-11-2007,
-- NSN Development Team). La ficha verificada es la superviviente.

BEGIN;

CREATE TABLE private.repair_smoras_filip_20260926_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_smoras_filip_20260926_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_smoras_filip_20260926_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_smoras_filip_20260926_backup
  TO service_role;

COMMENT ON TABLE private.repair_smoras_filip_20260926_backup IS
  'Estado previo de las dos fichas de Filip-André Smørås y del inscrito del Campeonato de Noruega 2026 antes de fusionarlas el 26-09-2026.';

DO $$
DECLARE
  v_keep constant text := 'smoras-filip-andre';
  v_drop constant text := 'smoras-fillip';
  v_row constant text := '6e54e4a7-7663-47b4-a96c-0c3efe208dd1';
  v_backup_count integer;
  v_keep_startlists integer;
BEGIN
  PERFORM id FROM public.riders_men
  WHERE id IN (v_keep, v_drop)
  ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM public.riders_men
      WHERE id = v_keep AND "firstName" = 'Filip-André'
        AND "lastName" = 'Smørås' AND "identityKey" = 'andre-filip-smoras'
        AND "birthDate" = DATE '2007-11-10' AND nationality = 'no'
        AND "uciProfileId" = '812061') <> 1
     OR (SELECT count(*) FROM public.riders_men
      WHERE id = v_drop AND "firstName" = 'Fillip'
        AND "lastName" = 'Smørås' AND "identityKey" = 'fillip-smoras'
        AND "birthDate" IS NULL AND nationality = 'no'
        AND "uciProfileId" IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Las fichas de Smørås han cambiado; no se fusionan';
  END IF;

  SELECT count(*) INTO v_keep_startlists
  FROM public.startlist_riders WHERE "globalRiderId" = v_keep;

  IF (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = v_drop AND id = v_row) <> 1
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE "globalRiderId" = v_drop) <> 1
     OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE "globalRiderId" = v_drop) THEN
    RAISE EXCEPTION 'Las referencias de smoras-fillip han cambiado; no se fusionan';
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
    WHERE gender = 'male' AND "aliasKey" = 'fillip-smoras'
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

  INSERT INTO private.repair_smoras_filip_20260926_backup(entity, row_key, row_data)
  SELECT 'riders_men', id, to_jsonb(r)
  FROM public.riders_men r WHERE id IN (v_keep, v_drop);

  INSERT INTO private.repair_smoras_filip_20260926_backup(entity, row_key, row_data)
  SELECT 'startlist_riders', id, to_jsonb(s)
  FROM public.startlist_riders s WHERE id = v_row;

  SELECT count(*) INTO v_backup_count
  FROM private.repair_smoras_filip_20260926_backup;
  IF v_backup_count <> 3 THEN
    RAISE EXCEPTION 'Backup incompleto: % filas', v_backup_count;
  END IF;

  UPDATE public.startlist_riders
  SET "globalRiderId" = v_keep, "firstName" = 'Filip-André', "lastName" = 'Smørås'
  WHERE id = v_row;

  DELETE FROM public.riders_men WHERE id = v_drop;

  INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
  VALUES ('fillip-smoras', 'male', v_keep,
    'Grafía Fillip Smørås del Campeonato de Noruega 2026; ficha duplicada unificada el 26-09-2026');

  IF EXISTS (SELECT 1 FROM public.riders_men WHERE id = v_drop)
     OR EXISTS (SELECT 1 FROM public.startlist_riders WHERE "globalRiderId" = v_drop)
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE "globalRiderId" = v_keep) <> v_keep_startlists + 1
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE id = v_row AND "globalRiderId" = v_keep
           AND "firstName" = 'Filip-André') <> 1
     OR (SELECT count(*) FROM public.rider_identity_aliases
         WHERE gender = 'male' AND "aliasKey" = 'fillip-smoras'
           AND "riderId" = v_keep) <> 1 THEN
    RAISE EXCEPTION 'La verificación de la fusión de Smørås ha fallado';
  END IF;
END $$;

COMMIT;

-- Rollback dirigido: restaurar la ficha smoras-fillip desde row_data con
-- jsonb_populate_record; restaurar la fila de startlist por row_key; borrar el
-- alias fillip-smoras creado.
