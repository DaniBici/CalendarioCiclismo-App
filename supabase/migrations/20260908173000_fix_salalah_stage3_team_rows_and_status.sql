-- Completa el nombre visible de las filas por equipos y oficializa los cinco
-- cuadros publicados tras la etapa 3 del Tour of Salalah 2026.

CREATE TABLE private.repair_salalah_stage3_publication_20260908_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_salalah_stage3_publication_20260908_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_salalah_stage3_publication_20260908_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_salalah_stage3_publication_20260908_backup TO service_role;

DO $$
DECLARE
  v_race_id constant text := 'dAZttxJuWg24gdwgfUWM';
  v_event_ids constant integer[] := ARRAY[-778220300, -778220301, -778220302, -778220304, -778220305];
BEGIN
  IF (SELECT count(*) FROM public.race_uci_stages
      WHERE "raceId" = v_race_id
        AND "eventId" = ANY(v_event_ids)
        AND "stageNumber" = 3
        AND "publicationStatus" = 'provisional') <> 5 THEN
    RAISE EXCEPTION 'Las cabeceras de la etapa 3 han cambiado desde la comprobación';
  END IF;

  IF (SELECT count(*) FROM public.race_uci_results
      WHERE "raceId" = v_race_id
        AND "eventId" = -778220305
        AND "riderDisplay" IS NULL
        AND "sourceTeamName" IS NOT NULL
        AND "teamId" IS NOT NULL) <> 15 THEN
    RAISE EXCEPTION 'Las filas por equipos han cambiado desde la comprobación';
  END IF;

  INSERT INTO private.repair_salalah_stage3_publication_20260908_backup(entity, row_key, row_data)
  SELECT 'race_uci_stages', id, to_jsonb(s)
  FROM public.race_uci_stages s
  WHERE s."raceId" = v_race_id AND s."eventId" = ANY(v_event_ids);

  INSERT INTO private.repair_salalah_stage3_publication_20260908_backup(entity, row_key, row_data)
  SELECT 'race_uci_results', id::text, to_jsonb(r)
  FROM public.race_uci_results r
  WHERE r."raceId" = v_race_id AND r."eventId" = -778220305;

  UPDATE public.race_uci_results
  SET "riderDisplay" = "sourceTeamName"
  WHERE "raceId" = v_race_id
    AND "eventId" = -778220305
    AND "riderDisplay" IS NULL
    AND "sourceTeamName" IS NOT NULL;

  UPDATE public.race_uci_stages
  SET "publicationStatus" = 'official'
  WHERE "raceId" = v_race_id
    AND "eventId" = ANY(v_event_ids)
    AND "stageNumber" = 3;

  IF (SELECT count(*) FROM private.repair_salalah_stage3_publication_20260908_backup) <> 20
     OR (SELECT count(*) FROM public.race_uci_results
         WHERE "raceId" = v_race_id AND "eventId" = -778220305
           AND "riderDisplay" = "sourceTeamName" AND "riderDisplay" IS NOT NULL) <> 15
     OR (SELECT count(*) FROM public.race_uci_stages
         WHERE "raceId" = v_race_id AND "eventId" = ANY(v_event_ids)
           AND "stageNumber" = 3 AND "publicationStatus" = 'official') <> 5 THEN
    RAISE EXCEPTION 'La verificación transaccional de la publicación ha fallado';
  END IF;
END $$;

COMMENT ON TABLE private.repair_salalah_stage3_publication_20260908_backup IS
  'Snapshot previo recuperable de los nombres por equipos y estados de publicación de la etapa 3 del Tour of Salalah 2026.';

-- Rollback controlado: restaurar los veinte snapshots con jsonb_populate_record
-- sobre sus tablas de origen, identificando cada fila por row_key.
