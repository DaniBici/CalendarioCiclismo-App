-- Corrige la identidad del dorsal 105 del Tour of Salalah 2026 y elimina
-- una fila duplicada de la clasificación de la etapa 1.

CREATE TABLE private.repair_tour_salalah_20260908_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_tour_salalah_20260908_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_tour_salalah_20260908_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_tour_salalah_20260908_backup TO service_role;

DO $$
DECLARE
  v_race_id constant text := 'dAZttxJuWg24gdwgfUWM';
  v_result_ids constant bigint[] := ARRAY[4192996, 4193056, 4488432, 4488519, 4488579, 4488935];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.riders_men
    WHERE id = 'fitsumberhan-danyom'
      AND "firstName" = 'Danyom'
      AND "lastName" = 'Fitsumberhan'
      AND nationality = 'er'
  ) THEN
    RAISE EXCEPTION 'No existe la ficha verificada de Danyom Fitsumberhan';
  END IF;

  IF (SELECT count(*) FROM public.startlist_riders
      WHERE id = 'faafc2e7-aa39-4109-9861-178c48244711'
        AND "raceId" = v_race_id AND dorsal = 105
        AND "firstName" = 'Chuanyang' AND "lastName" = 'Lin'
        AND "countryCode" = 'cn' AND "globalRiderId" = 'lin-chuanyang') <> 1 THEN
    RAISE EXCEPTION 'La fila del dorsal 105 ha cambiado desde la auditoría';
  END IF;

  IF (SELECT count(*) FROM public.race_uci_results
      WHERE id = ANY(v_result_ids) AND "raceId" = v_race_id
        AND bib = '105' AND "globalRiderId" = 'lin-chuanyang') <> 6 THEN
    RAISE EXCEPTION 'Los resultados del dorsal 105 han cambiado desde la auditoría';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.race_uci_results a
    JOIN public.race_uci_results b ON b.id = 4192944
    WHERE a.id = 4192943
      AND a."raceId" = v_race_id AND b."raceId" = v_race_id
      AND a."eventId" = 367914 AND b."eventId" = 367914
      AND a.bib = '102' AND b.bib = '102'
      AND a.rank = b.rank AND a."rankText" = b."rankText"
      AND a."resultValue" = b."resultValue" AND a."timeText" = b."timeText"
      AND a."globalRiderId" = b."globalRiderId"
  ) THEN
    RAISE EXCEPTION 'El duplicado del dorsal 102 ha cambiado desde la auditoría';
  END IF;

  IF (SELECT count(*) FROM public.race_uci_stages
      WHERE id = 'ru_367914' AND "eventId" = 367914
        AND "raceId" = v_race_id AND "rowCount" = 87) <> 1 THEN
    RAISE EXCEPTION 'La cabecera de la etapa 1 ha cambiado desde la auditoría';
  END IF;

  INSERT INTO private.repair_tour_salalah_20260908_backup(entity, row_key, row_data)
  SELECT 'startlist_riders', id, to_jsonb(s)
  FROM public.startlist_riders s
  WHERE id = 'faafc2e7-aa39-4109-9861-178c48244711';

  INSERT INTO private.repair_tour_salalah_20260908_backup(entity, row_key, row_data)
  SELECT 'race_uci_results', id::text, to_jsonb(r)
  FROM public.race_uci_results r
  WHERE id = ANY(v_result_ids || ARRAY[4192944::bigint]);

  INSERT INTO private.repair_tour_salalah_20260908_backup(entity, row_key, row_data)
  SELECT 'race_uci_stages', id, to_jsonb(s)
  FROM public.race_uci_stages s
  WHERE id = 'ru_367914';

  UPDATE public.startlist_riders
  SET "firstName" = 'Danyom',
      "lastName" = 'Fitsumberhan',
      "countryCode" = 'er',
      "globalRiderId" = 'fitsumberhan-danyom'
  WHERE id = 'faafc2e7-aa39-4109-9861-178c48244711';

  UPDATE public.race_uci_results
  SET "globalRiderId" = 'fitsumberhan-danyom'
  WHERE id = ANY(v_result_ids);

  DELETE FROM public.race_uci_results WHERE id = 4192944;

  UPDATE public.race_uci_stages
  SET "rowCount" = 86
  WHERE id = 'ru_367914';

  IF (SELECT count(*) FROM private.repair_tour_salalah_20260908_backup) <> 9
     OR (SELECT count(*) FROM public.race_uci_results
         WHERE id = ANY(v_result_ids) AND "globalRiderId" = 'fitsumberhan-danyom') <> 6
     OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE id = 4192944)
     OR EXISTS (
       SELECT bib FROM public.race_uci_results
       WHERE "eventId" = 367914
       GROUP BY bib HAVING count(*) > 1
     )
     OR (SELECT count(*) FROM public.race_uci_results WHERE "eventId" = 367914) <> 86
     OR (SELECT "rowCount" FROM public.race_uci_stages WHERE id = 'ru_367914') <> 86 THEN
    RAISE EXCEPTION 'La verificación transaccional de la reparación ha fallado';
  END IF;
END $$;

COMMENT ON TABLE private.repair_tour_salalah_20260908_backup IS
  'Snapshot previo recuperable de la reparación autorizada del dorsal 105 y el duplicado de la etapa 1 del Tour of Salalah 2026.';

-- Rollback controlado: restaurar cada snapshot con jsonb_populate_record en su
-- tabla de origen, reinsertando primero race_uci_results:4192944 y aplicando
-- después los snapshots de las filas actualizadas.
