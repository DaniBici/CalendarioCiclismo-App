-- Unifica la ficha duplicada soto-jazmin (alta automática de los Juegos
-- Centroamericanos y del Caribe 2026) en soto-jasmin (Jasmin Gabriela Soto
-- López, 11-01-1993, Guatemala, UCI ID 10056296255, Banrural-Tropigas-Paleter).
-- La ficha con nombre completo, fuente UCI y afiliación es la superviviente.

BEGIN;

CREATE TABLE private.repair_soto_jasmin_20260930_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_soto_jasmin_20260930_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_soto_jasmin_20260930_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_soto_jasmin_20260930_backup
  TO service_role;

COMMENT ON TABLE private.repair_soto_jasmin_20260930_backup IS
  'Estado previo de las dos fichas de Jasmin Soto, del inscrito y de los dos resultados de los Juegos Centroamericanos y del Caribe 2026 antes de fusionarlas el 30-09-2026.';

DO $$
DECLARE
  v_keep constant text := 'soto-jasmin';
  v_drop constant text := 'soto-jazmin';
  v_row constant text := 'fe571c6f-d3d8-457b-a87b-285669f56c0e';
  v_res constant bigint[] := ARRAY[1213780, 1124083]::bigint[];
  v_backup_count integer;
  v_keep_startlists integer;
  v_keep_results integer;
BEGIN
  PERFORM id FROM public.riders_women
  WHERE id IN (v_keep, v_drop)
  ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM public.riders_women
      WHERE id = v_keep AND "firstName" = 'Jasmin' AND "lastName" = 'Soto'
        AND "identityKey" = 'jasmin-soto' AND "birthDate" = DATE '1993-01-11'
        AND nationality = 'gt') <> 1
     OR (SELECT count(*) FROM public.riders_women
      WHERE id = v_drop AND "firstName" = 'Jazmín' AND "lastName" = 'Soto'
        AND "identityKey" = 'jazmin-soto' AND "birthDate" = DATE '1993-01-11'
        AND nationality = 'gt' AND "uciProfileId" IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Las fichas de Soto han cambiado; no se fusionan';
  END IF;

  SELECT count(*) INTO v_keep_startlists
  FROM public.startlist_riders WHERE "globalRiderId" = v_keep;
  SELECT count(*) INTO v_keep_results
  FROM public.race_uci_results WHERE "globalRiderId" = v_keep;

  IF (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = v_drop AND id = v_row) <> 1
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE "globalRiderId" = v_drop) <> 1
     OR (SELECT count(*) FROM public.race_uci_results
         WHERE "globalRiderId" = v_drop AND id = ANY (v_res)) <> 2
     OR (SELECT count(*) FROM public.race_uci_results
         WHERE "globalRiderId" = v_drop) <> 2 THEN
    RAISE EXCEPTION 'Las referencias de soto-jazmin han cambiado; no se fusionan';
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
    WHERE gender = 'female' AND "aliasKey" = 'jazmin-soto'
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

  INSERT INTO private.repair_soto_jasmin_20260930_backup(entity, row_key, row_data)
  SELECT 'riders_women', id, to_jsonb(r)
  FROM public.riders_women r WHERE id IN (v_keep, v_drop);

  INSERT INTO private.repair_soto_jasmin_20260930_backup(entity, row_key, row_data)
  SELECT 'startlist_riders', id::text, to_jsonb(s)
  FROM public.startlist_riders s WHERE id::text = v_row;

  INSERT INTO private.repair_soto_jasmin_20260930_backup(entity, row_key, row_data)
  SELECT 'race_uci_results', id::text, to_jsonb(u)
  FROM public.race_uci_results u WHERE id = ANY (v_res);

  SELECT count(*) INTO v_backup_count
  FROM private.repair_soto_jasmin_20260930_backup;
  IF v_backup_count <> 5 THEN
    RAISE EXCEPTION 'Backup incompleto: % filas', v_backup_count;
  END IF;

  UPDATE public.startlist_riders
  SET "globalRiderId" = v_keep, "firstName" = 'Jasmin', "lastName" = 'Soto'
  WHERE id::text = v_row;

  UPDATE public.race_uci_results
  SET "globalRiderId" = v_keep
  WHERE id = ANY (v_res);

  DELETE FROM public.riders_women WHERE id = v_drop;

  INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
  VALUES ('jazmin-soto', 'female', v_keep,
    'Grafía Jazmín Soto de los Juegos Centroamericanos y del Caribe 2026; ficha duplicada unificada el 30-09-2026');

  IF EXISTS (SELECT 1 FROM public.riders_women WHERE id = v_drop)
     OR EXISTS (SELECT 1 FROM public.startlist_riders WHERE "globalRiderId" = v_drop)
     OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE "globalRiderId" = v_drop)
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE "globalRiderId" = v_keep) <> v_keep_startlists + 1
     OR (SELECT count(*) FROM public.race_uci_results
         WHERE "globalRiderId" = v_keep) <> v_keep_results + 2
     OR (SELECT count(*) FROM public.rider_identity_aliases
         WHERE gender = 'female' AND "aliasKey" = 'jazmin-soto'
           AND "riderId" = v_keep) <> 1 THEN
    RAISE EXCEPTION 'La verificación de la fusión de Soto ha fallado';
  END IF;
END $$;

COMMIT;

-- Rollback dirigido: restaurar la ficha soto-jazmin desde row_data con
-- jsonb_populate_record; restaurar la fila de startlist y los dos resultados
-- por row_key; borrar el alias jazmin-soto creado.
