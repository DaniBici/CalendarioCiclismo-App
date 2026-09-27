-- Manifiesto dirigido: Mundial 2026, ruta sub-23 femenina, dorsal 52.
-- Tissot /results da rank=0 y time=OK pese a registrar Finish; el PDF oficial
-- (https://prod.server.tissottiming.com/file/0003190212020201FFFFFFFFFFFFFF03)
-- la clasifica OTL con 4:10:08. La lista de salida incluye el dorsal 52.
-- La corrección afecta solo al cuadro final ru_-502519902.

CREATE TABLE private.repair_tissot_wu23_road_otl_20260924_backup (
  entity text NOT NULL,
  row_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  row_data jsonb NOT NULL,
  PRIMARY KEY (entity, row_id)
);

COMMENT ON TABLE private.repair_tissot_wu23_road_otl_20260924_backup IS
  'Estado previo de la cabecera y de las 48 filas cuyo orden cambia al insertar el OTL 52; rollback dirigido.';

ALTER TABLE private.repair_tissot_wu23_road_otl_20260924_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_tissot_wu23_road_otl_20260924_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_tissot_wu23_road_otl_20260924_backup
  TO service_role;

DO $repair$
DECLARE
  v_stage public.race_uci_stages%ROWTYPE;
  v_riders integer;
BEGIN
  SELECT * INTO v_stage
  FROM public.race_uci_stages
  WHERE id = 'ru_-502519902'
    AND "raceId" = '31911bfb-2e80-41a7-8ccd-54a38ec72cb3'
  FOR UPDATE;

  IF NOT FOUND OR v_stage."rowCount" <> 112
    OR v_stage."publicationStatus" <> 'official'
    OR v_stage."lockedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'El cuadro final cambió antes de reparar el OTL 52';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.startlist_riders
    WHERE "raceId" = v_stage."raceId" AND dorsal = 52
      AND "globalRiderId" = 'xu-xiaoyan'
  ) OR EXISTS (
    SELECT 1 FROM public.race_uci_results
    WHERE "stageRef" = v_stage.id AND bib = '52'
  ) THEN
    RAISE EXCEPTION 'El dorsal 52 ya no coincide con la auditoría';
  END IF;

  SELECT count(*) INTO v_riders
  FROM public.race_uci_results
  WHERE "stageRef" = v_stage.id;
  IF v_riders <> 112 OR (
    SELECT count(*) FROM public.race_uci_results
    WHERE "stageRef" = v_stage.id AND "sortOrder" >= 64
  ) <> 48 THEN
    RAISE EXCEPTION 'El número o el orden de las filas cambió antes de reparar';
  END IF;

  INSERT INTO private.repair_tissot_wu23_road_otl_20260924_backup
    (entity, row_id, row_data)
  VALUES ('stage', v_stage.id, to_jsonb(v_stage));

  INSERT INTO private.repair_tissot_wu23_road_otl_20260924_backup
    (entity, row_id, row_data)
  SELECT 'result', id::text, to_jsonb(r)
  FROM public.race_uci_results r
  WHERE r."stageRef" = v_stage.id AND r."sortOrder" >= 64;

  UPDATE public.race_uci_results
  SET "sortOrder" = "sortOrder" + 1
  WHERE "stageRef" = v_stage.id AND "sortOrder" >= 64;

  INSERT INTO public.race_uci_results
    ("stageRef", "raceId", "eventId", rank, "rankText", bib,
     "globalRiderId", "resultValue", "timeText", irm, "sortOrder")
  VALUES
    (v_stage.id, v_stage."raceId", v_stage."eventId", NULL, 'OTL', '52',
     'xu-xiaoyan', '4:10:08', '4:10:08', 'OTL', 64);

  UPDATE public.race_uci_stages
  SET "rowCount" = 113, "lockedAt" = now()
  WHERE id = v_stage.id;

  IF (SELECT count(*) FROM public.race_uci_results WHERE "stageRef" = v_stage.id) <> 113
    OR (SELECT count(*) FROM public.race_uci_results
        WHERE "stageRef" = v_stage.id AND rank = 1 AND irm IS NULL) <> 1 THEN
    RAISE EXCEPTION 'La clasificación reparada no conserva 113 filas y una ganadora';
  END IF;
END;
$repair$;
