-- Retirada automática de carreras enlazadas que no contienen ninguna
-- clasificación principal publicable. El snapshot privado permite rollback
-- dirigido antes de borrar la carrera y sus jornadas.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.repair_invalid_results_race_20260829_backup (
  operation_id text PRIMARY KEY,
  race_id text NOT NULL,
  reason text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS repair_invalid_results_race_20260829_backup_race_idx
  ON private.repair_invalid_results_race_20260829_backup (race_id, captured_at DESC);

COMMENT ON TABLE private.repair_invalid_results_race_20260829_backup IS
  'Snapshots de carreras retiradas automáticamente por no tener resultados UCI publicables; rollback por operation_id.';

REVOKE ALL ON TABLE private.repair_invalid_results_race_20260829_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE private.repair_invalid_results_race_20260829_backup
  TO cc_results_worker;

CREATE OR REPLACE FUNCTION private.delete_invalid_results_race(
  p_race_id text,
  p_operation_id text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb;
  v_race_days_deleted integer;
  v_broadcast_links_deleted integer;
  v_race_deleted integer;
BEGIN
  IF btrim(COALESCE(p_race_id, '')) = '' THEN
    RAISE EXCEPTION 'Falta p_race_id' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_operation_id, '')) = '' THEN
    RAISE EXCEPTION 'Falta p_operation_id' USING ERRCODE = '22023';
  END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Falta p_reason' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.races WHERE id = p_race_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'race_not_found');
  END IF;

  -- No borrar una carrera que ya tenga una llegada válida, aunque el payload
  -- que originó la llamada haya sido parcial o se haya repetido.
  IF EXISTS (
    SELECT 1
    FROM public.race_uci_stages s
    JOIN public.race_uci_results rr ON rr."stageRef" = s.id
    WHERE s."raceId" = p_race_id
      AND s.scope = 'stage'
      AND s."classKind" IN ('stage', 'gc')
      AND rr.rank = 1
      AND NULLIF(btrim(COALESCE(rr.irm, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'La carrera % conserva una clasificación principal válida; no se borra', p_race_id
      USING ERRCODE = '55000';
  END IF;

  SELECT jsonb_build_object(
    'races', COALESCE((SELECT to_jsonb(x) FROM (SELECT * FROM public.races WHERE id = p_race_id) x), '{}'::jsonb),
    'race_days', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.race_days WHERE "raceId" = p_race_id ORDER BY id) x), '[]'::jsonb),
    'race_uci_links', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.race_uci_links WHERE "raceId" = p_race_id) x), '[]'::jsonb),
    'race_uci_stages', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.race_uci_stages WHERE "raceId" = p_race_id ORDER BY id) x), '[]'::jsonb),
    'race_uci_results', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.race_uci_results WHERE "raceId" = p_race_id ORDER BY id) x), '[]'::jsonb),
    'assets', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT a.* FROM public.assets a JOIN public.race_days d ON d.id = a."raceDayId" WHERE d."raceId" = p_race_id ORDER BY a.id) x), '[]'::jsonb),
    'broadcasts', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT b.* FROM public.broadcasts b JOIN public.race_days d ON d.id = b."raceDayId" WHERE d."raceId" = p_race_id ORDER BY b.id) x), '[]'::jsonb),
    'start_order_entries', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT e.* FROM public.start_order_entries e JOIN public.race_days d ON d.id = e."raceDayId" WHERE d."raceId" = p_race_id ORDER BY e.id) x), '[]'::jsonb),
    'startlist_riders', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.startlist_riders WHERE "raceId" = p_race_id ORDER BY id) x), '[]'::jsonb),
    'startlist_teams', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.startlist_teams WHERE "raceId" = p_race_id ORDER BY id) x), '[]'::jsonb),
    'push_race_subscriptions', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.push_race_subscriptions WHERE "raceId" = p_race_id) x), '[]'::jsonb),
    'push_stage_subscriptions', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT p.* FROM public.push_stage_subscriptions p JOIN public.race_days d ON d.id = p."raceDayId" WHERE d."raceId" = p_race_id ORDER BY p.id) x), '[]'::jsonb),
    'today_highlights', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.today_highlights WHERE "raceId" = p_race_id OR "raceDayId" IN (SELECT id FROM public.race_days WHERE "raceId" = p_race_id) ORDER BY id) x), '[]'::jsonb),
    'scheduled_push_notifications', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.scheduled_push_notifications WHERE "raceId" = p_race_id OR "raceDayId" IN (SELECT id FROM public.race_days WHERE "raceId" = p_race_id) ORDER BY id) x), '[]'::jsonb),
    'special_edition_teams', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.teams WHERE "specialEditionRaceId" = p_race_id ORDER BY id) x), '[]'::jsonb),
    'manual_queue', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM private.uci_results_manual_queue WHERE race_id = p_race_id ORDER BY id) x), '[]'::jsonb),
    'broadcast_source_links', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT l.* FROM private.broadcast_source_links l JOIN public.race_days d ON d.id = l.race_day_id WHERE d."raceId" = p_race_id ORDER BY l.id) x), '[]'::jsonb)
  ) INTO v_payload;

  INSERT INTO private.repair_invalid_results_race_20260829_backup (
    operation_id, race_id, reason, payload
  ) VALUES (
    p_operation_id, p_race_id, p_reason, v_payload
  );

  -- broadcast_source_links usa RESTRICT sobre race_days y broadcasts. Es un
  -- vínculo de integración, no la emisión ni la carrera, por lo que se elimina
  -- antes de las filas públicas que referencia.
  DELETE FROM private.broadcast_source_links l
  USING public.race_days d
  WHERE l.race_day_id = d.id
    AND d."raceId" = p_race_id;
  GET DIAGNOSTICS v_broadcast_links_deleted = ROW_COUNT;

  DELETE FROM public.race_days WHERE "raceId" = p_race_id;
  GET DIAGNOSTICS v_race_days_deleted = ROW_COUNT;

  DELETE FROM public.races WHERE id = p_race_id;
  GET DIAGNOSTICS v_race_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted', v_race_deleted = 1,
    'raceId', p_race_id,
    'operationId', p_operation_id,
    'raceDaysDeleted', v_race_days_deleted,
    'broadcastSourceLinksDeleted', v_broadcast_links_deleted,
    'backupTable', 'private.repair_invalid_results_race_20260829_backup'
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.delete_invalid_results_race(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.delete_invalid_results_race(text, text, text)
  TO cc_results_worker;

COMMENT ON FUNCTION private.delete_invalid_results_race(text, text, text) IS
  'Guarda snapshot y retira una carrera UCI sin clasificación principal válida; solo el worker automático puede invocarla.';
