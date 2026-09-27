BEGIN;

CREATE TABLE private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup (
  entity text NOT NULL,
  "rowKey" text NOT NULL,
  "rowData" jsonb,
  "backedUpAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, "rowKey")
);

COMMENT ON TABLE private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup IS
  'Estado previo y equipos de los dorsales 33 y 136 añadidos a la startlist de la Vuelta al Ecuador 2026.';

ALTER TABLE private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup
  TO service_role;

INSERT INTO private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup
  (entity, "rowKey", "rowData")
VALUES
  ('startlist_riders_absent', '9dsfkpQh9q25AHX9Zlpy:33', NULL),
  ('startlist_riders_absent', '9dsfkpQh9q25AHX9Zlpy:136', NULL);

INSERT INTO private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup
  (entity, "rowKey", "rowData")
SELECT 'startlist_teams', st.id, to_jsonb(st)
FROM public.startlist_teams st
WHERE st."raceId" = '9dsfkpQh9q25AHX9Zlpy'
  AND st."teamName" IN ('Wielerploeg Groot Amsterdam', 'Liga de Ciclismo de Nariño');

DO $$
DECLARE
  v_amsterdam_team_row_id text;
  v_narino_team_row_id text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.startlist_riders
    WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy' AND dorsal IN (33, 136)
  ) THEN
    RAISE EXCEPTION 'Alguno de los dos dorsales ya existe en la startlist';
  END IF;

  SELECT min(id) INTO v_amsterdam_team_row_id
  FROM public.startlist_teams
  WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy'
    AND "teamName" = 'Wielerploeg Groot Amsterdam';

  SELECT min(id) INTO v_narino_team_row_id
  FROM public.startlist_teams
  WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy'
    AND "teamName" = 'Liga de Ciclismo de Nariño';

  IF v_amsterdam_team_row_id IS NULL OR v_narino_team_row_id IS NULL
     OR (SELECT count(*) FROM private.add_vuelta_ecuador_missing_startlist_riders_20260908_backup
         WHERE entity = 'startlist_teams') <> 2 THEN
    RAISE EXCEPTION 'No se han identificado y respaldado los dos equipos exactos';
  END IF;

  IF (SELECT array_agg(dorsal ORDER BY dorsal)
      FROM public.startlist_riders
      WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy' AND "teamId" = v_amsterdam_team_row_id
        AND dorsal BETWEEN 31 AND 36)
       IS DISTINCT FROM ARRAY[31,32,34,35,36]
     OR (SELECT array_agg(dorsal ORDER BY dorsal)
         FROM public.startlist_riders
         WHERE "raceId" = '9dsfkpQh9q25AHX9Zlpy' AND "teamId" = v_narino_team_row_id
           AND dorsal BETWEEN 131 AND 136)
       IS DISTINCT FROM ARRAY[131,132,133,134,135] THEN
    RAISE EXCEPTION 'Los bloques de dorsales auditados han cambiado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.riders_men
    WHERE id = 'zijlstra-youri' AND "firstName" = 'Youri' AND "lastName" = 'Zijlstra'
      AND nationality = 'nl' AND "birthDate" = date '2007-02-06'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.riders_men
    WHERE id = 'lopez-salcedo-juan-jose' AND "firstName" = 'Juan José'
      AND "lastName" = 'López Salcedo' AND nationality = 'co'
      AND "birthDate" = date '2005-07-22'
  ) THEN
    RAISE EXCEPTION 'Las fichas verificadas de los dos corredores han cambiado';
  END IF;

  INSERT INTO public.startlist_riders
    (id, "teamId", "raceId", dorsal, "firstName", "lastName", "countryCode", "globalRiderId")
  VALUES
    (gen_random_uuid()::text, v_amsterdam_team_row_id, '9dsfkpQh9q25AHX9Zlpy',
     33, 'Youri', 'Zijlstra', 'nl', 'zijlstra-youri'),
    (gen_random_uuid()::text, v_narino_team_row_id, '9dsfkpQh9q25AHX9Zlpy',
     136, 'Juan José', 'López Salcedo', 'co', 'lopez-salcedo-juan-jose');
END;
$$;

COMMIT;

-- Rollback dirigido: eliminar únicamente las filas de startlist_riders de esta
-- carrera con dorsales 33 y 136, después de comprobar que sus datos coinciden
-- con esta migración. Las fichas globales y los resultados no se eliminan.
