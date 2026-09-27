-- Unifica las dos identidades de Adrià Regada y conserva el nombre completo
-- documentado como variante. La ficha breve es la superviviente.

BEGIN;

CREATE TABLE private.repair_adria_regada_20260924_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_adria_regada_20260924_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_adria_regada_20260924_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_adria_regada_20260924_backup
  TO service_role;

COMMENT ON TABLE private.repair_adria_regada_20260924_backup IS
  'Estado previo de las dos fichas de Adrià Regada, sus seis inscritos y catorce resultados antes de fusionarlas el 24-09-2026.';

DO $$
DECLARE
  v_short constant text := 'regada-adria';
  v_long constant text := 'regada-hierro-adria';
  v_backup_count integer;
BEGIN
  PERFORM id FROM public.riders_men
  WHERE id IN (v_short, v_long)
  ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM public.riders_men
      WHERE id = v_short AND "firstName" = 'Adrià'
        AND "lastName" = 'Regada' AND "otherNames" IS NULL
        AND "identityKey" = 'adria-regada'
        AND "birthDate" = DATE '2005-03-01' AND nationality = 'ad') <> 1
     OR (SELECT count(*) FROM public.riders_men
      WHERE id = v_long AND "firstName" = 'Adriá'
        AND "lastName" = 'Regada Hierro' AND "otherNames" IS NULL
        AND "identityKey" = 'adria-hierro-regada'
        AND "birthDate" = DATE '2005-03-01' AND nationality = 'ad') <> 1 THEN
    RAISE EXCEPTION 'Las fichas de Regada han cambiado; no se fusionan';
  END IF;

  IF (SELECT count(*) FROM public.startlist_riders WHERE "globalRiderId" = v_short) <> 2
     OR (SELECT count(*) FROM public.startlist_riders WHERE "globalRiderId" = v_long
           AND "firstName" = 'Adriá' AND "lastName" = 'Regada Hierro') <> 4
     OR (SELECT count(*) FROM public.race_uci_results WHERE "globalRiderId" = v_short) <> 2
     OR (SELECT count(*) FROM public.race_uci_results WHERE "globalRiderId" = v_long) <> 12 THEN
    RAISE EXCEPTION 'Las referencias de Regada han cambiado; no se fusionan';
  END IF;

  IF EXISTS (
    WITH refs AS (
      SELECT "raceId", "globalRiderId" FROM public.startlist_riders
      WHERE "globalRiderId" IN (v_short, v_long)
      UNION ALL
      SELECT "raceId", "globalRiderId" FROM public.race_uci_results
      WHERE "globalRiderId" IN (v_short, v_long)
    )
    SELECT 1 FROM refs GROUP BY "raceId"
    HAVING count(DISTINCT "globalRiderId") > 1
  ) OR EXISTS (
    SELECT 1 FROM public.rider_identity_aliases
    WHERE gender = 'male' AND "aliasKey" = 'adria-hierro-regada'
  ) OR EXISTS (
    SELECT 1 FROM public.rider_team_affiliations WHERE "riderId" IN (v_short, v_long)
  ) OR EXISTS (
    SELECT 1 FROM public.rider_transfers WHERE "riderId" IN (v_short, v_long)
  ) OR EXISTS (
    SELECT 1 FROM public.start_order_entries WHERE "riderId" IN (v_short, v_long)
  ) OR EXISTS (
    SELECT 1 FROM public.cx_results WHERE "globalRiderId" IN (v_short, v_long)
  ) OR EXISTS (
    SELECT 1 FROM public.cx_startlist_riders WHERE "globalRiderId" IN (v_short, v_long)
  ) OR EXISTS (
    SELECT 1 FROM public.cx_tournament_standings WHERE "globalRiderId" IN (v_short, v_long)
  ) THEN
    RAISE EXCEPTION 'Hay una coincidencia o referencia adicional que exige revisión';
  END IF;

  INSERT INTO private.repair_adria_regada_20260924_backup(entity, row_key, row_data)
  SELECT 'riders_men', id, to_jsonb(r)
  FROM public.riders_men r WHERE id IN (v_short, v_long);

  INSERT INTO private.repair_adria_regada_20260924_backup(entity, row_key, row_data)
  SELECT 'startlist_riders', id, to_jsonb(s)
  FROM public.startlist_riders s WHERE "globalRiderId" IN (v_short, v_long);

  INSERT INTO private.repair_adria_regada_20260924_backup(entity, row_key, row_data)
  SELECT 'race_uci_results', id::text, to_jsonb(r)
  FROM public.race_uci_results r WHERE "globalRiderId" IN (v_short, v_long);

  SELECT count(*) INTO v_backup_count
  FROM private.repair_adria_regada_20260924_backup;
  IF v_backup_count <> 22 THEN
    RAISE EXCEPTION 'Backup incompleto: % filas', v_backup_count;
  END IF;

  UPDATE public.riders_men
  SET "otherNames" = 'Adrià Regada Hierro', "updatedAt" = now()
  WHERE id = v_short;

  UPDATE public.startlist_riders
  SET "globalRiderId" = v_short, "firstName" = 'Adrià', "lastName" = 'Regada'
  WHERE "globalRiderId" = v_long;

  UPDATE public.race_uci_results
  SET "globalRiderId" = v_short
  WHERE "globalRiderId" = v_long;

  DELETE FROM public.riders_men WHERE id = v_long;

  INSERT INTO public.rider_identity_aliases("aliasKey", gender, "riderId", note)
  VALUES ('adria-hierro-regada', 'male', v_short,
    'Nombre completo Adrià Regada Hierro; ficha duplicada unificada el 24-09-2026');

  IF (SELECT count(*) FROM public.riders_men
      WHERE id = v_short AND "firstName" = 'Adrià'
        AND "lastName" = 'Regada'
        AND "otherNames" = 'Adrià Regada Hierro') <> 1
     OR EXISTS (SELECT 1 FROM public.riders_men WHERE id = v_long)
     OR (SELECT count(*) FROM public.startlist_riders
         WHERE "globalRiderId" = v_short) <> 6
     OR (SELECT count(*) FROM public.race_uci_results
         WHERE "globalRiderId" = v_short) <> 14
     OR EXISTS (SELECT 1 FROM public.startlist_riders WHERE "globalRiderId" = v_long)
     OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE "globalRiderId" = v_long)
     OR (SELECT count(*) FROM public.rider_identity_aliases
         WHERE gender = 'male' AND "aliasKey" = 'adria-hierro-regada'
           AND "riderId" = v_short) <> 1
     OR (SELECT count(*) FROM public.startlist_riders s
         JOIN public.races r ON r.id = s."raceId"
         WHERE r.slug = 'campeonato-del-mundo-linea-sub23-masculino-2026'
           AND s.dorsal = 165 AND s."globalRiderId" = v_short
           AND s."firstName" = 'Adrià' AND s."lastName" = 'Regada') <> 1 THEN
    RAISE EXCEPTION 'La verificación de la fusión de Regada ha fallado';
  END IF;
END $$;

COMMIT;

-- Rollback dirigido: restaurar primero la ficha retirada desde row_data con
-- jsonb_populate_record; restaurar las seis startlists y catorce resultados
-- por row_key; restaurar la ficha superviviente; borrar el alias creado.
-- Si el trigger de la startlist CLUBM creó la afiliación de 2026, retirarla
-- tras restaurar referencias y recalcular el equipo actual.
