-- Fusiona la ficha automática y no verificada «NIL GIMENO FERRER» en la
-- ficha canónica «Nil Gimeno». La grafía larga se conserva como variante y
-- como alias de identidad para impedir que una ingesta futura recree el
-- duplicado.

BEGIN;

CREATE TABLE IF NOT EXISTS private.repair_nil_gimeno_merge_20260903_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_key text NOT NULL,
  change_kind text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_key)
);

COMMENT ON TABLE private.repair_nil_gimeno_merge_20260903_backup IS
  'Backup privado y recuperable de la fusión dirigida de gimeno-ferrer-nil en gimeno-nil.';

REVOKE ALL ON TABLE private.repair_nil_gimeno_merge_20260903_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE private.repair_nil_gimeno_merge_20260903_backup
  TO service_role;

ALTER TABLE private.repair_nil_gimeno_merge_20260903_backup
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS private_backup_deny_api
  ON private.repair_nil_gimeno_merge_20260903_backup;
CREATE POLICY private_backup_deny_api
  ON private.repair_nil_gimeno_merge_20260903_backup
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DO $preflight$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.riders_men r
    WHERE r.id = 'gimeno-ferrer-nil'
      AND r."firstName" = 'Nil'
      AND r."lastName" = 'GIMENO FERRER'
      AND r."otherNames" IS NULL
      AND r.nationality = 'es'
      AND r."birthDate" IS NULL
      AND r."currentTeamId" IS NULL
      AND r.source = 'startlist_resolve'
      AND r.verified = false
      AND r."identityKey" = 'ferrer-gimeno-nil'
      AND r."contractUntil" IS NULL
      AND r."uciProfileId" IS NULL
      AND r."createdAt" = '2026-08-15T14:39:04.980809+00:00'::timestamptz
      AND r."updatedAt" = '2026-08-15T14:39:04.980809+00:00'::timestamptz
  ) THEN
    RAISE EXCEPTION 'La ficha origen cambió desde la auditoría';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.riders_men r
    WHERE r.id = 'gimeno-nil'
      AND r."firstName" = 'Nil'
      AND r."lastName" = 'Gimeno'
      AND r."otherNames" IS NULL
      AND r.nationality = 'es'
      AND r."birthDate" = '2004-04-21'::date
      AND r."currentTeamId" = 'team_1776714278457_r96u02'
      AND r.source = 'startlist_auto'
      AND r.verified = true
      AND r."identityKey" = 'gimeno-nil'
      AND r."contractUntil" = 2027
      AND r."uciProfileId" = '1077325'
      AND r."createdAt" = '2026-05-21T12:21:46.884846+00:00'::timestamptz
      AND r."updatedAt" = '2026-08-30T05:46:05.31057+00:00'::timestamptz
  ) THEN
    RAISE EXCEPTION 'La ficha superviviente cambió desde la auditoría';
  END IF;

  SELECT
    (SELECT count(*) FROM public.race_uci_results
      WHERE "globalRiderId" = 'gimeno-ferrer-nil')
    + (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = 'gimeno-ferrer-nil')
    + (SELECT count(*) FROM public.rider_team_affiliations
      WHERE "riderId" = 'gimeno-ferrer-nil')
    + (SELECT count(*) FROM public.rider_transfers
      WHERE "riderId" = 'gimeno-ferrer-nil')
    + (SELECT count(*) FROM public.rider_identity_aliases
      WHERE "riderId" = 'gimeno-ferrer-nil')
  INTO v_count;

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'La ficha origen recibió % referencias después de la auditoría', v_count;
  END IF;

  IF (SELECT count(*) FROM public.race_uci_results
      WHERE "globalRiderId" = 'gimeno-nil') <> 139
    OR (SELECT count(*) FROM public.startlist_riders
      WHERE "globalRiderId" = 'gimeno-nil') <> 21
    OR (SELECT count(*) FROM public.rider_team_affiliations
      WHERE "riderId" = 'gimeno-nil') <> 1
    OR (SELECT count(*) FROM public.rider_transfers
      WHERE "riderId" = 'gimeno-nil') <> 1
    OR (SELECT count(*) FROM public.rider_identity_aliases
      WHERE "riderId" = 'gimeno-nil') <> 0
  THEN
    RAISE EXCEPTION 'Las referencias de la ficha superviviente cambiaron desde la auditoría';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.rider_identity_aliases a
    WHERE a."aliasKey" = 'ferrer-gimeno-nil'
      AND a.gender = 'male'
  ) THEN
    RAISE EXCEPTION 'El alias ferrer-gimeno-nil ya existe';
  END IF;
END
$preflight$;

INSERT INTO private.repair_nil_gimeno_merge_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-nil-gimeno-duplicate-20260903',
  'manifest',
  'gimeno-ferrer-nil',
  'mapping',
  jsonb_build_object(
    'sourceId', 'gimeno-ferrer-nil',
    'targetId', 'gimeno-nil',
    'sourceIdentityKey', 'ferrer-gimeno-nil',
    'gender', 'male'
  )
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_nil_gimeno_merge_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-nil-gimeno-duplicate-20260903',
  'riders_men',
  r.id,
  CASE WHEN r.id = 'gimeno-ferrer-nil' THEN 'delete' ELSE 'update' END,
  to_jsonb(r)
FROM public.riders_men r
WHERE r.id IN ('gimeno-ferrer-nil', 'gimeno-nil')
ON CONFLICT (operation, entity, row_key) DO NOTHING;

UPDATE public.riders_men
SET
  "otherNames" = 'GIMENO FERRER',
  "updatedAt" = now()
WHERE id = 'gimeno-nil';

INSERT INTO public.rider_identity_aliases
  ("aliasKey", gender, "riderId", note)
VALUES
  (
    'ferrer-gimeno-nil',
    'male',
    'gimeno-nil',
    'Ficha gimeno-ferrer-nil fusionada en gimeno-nil el 2026-09-03'
  );

DELETE FROM public.riders_men
WHERE id = 'gimeno-ferrer-nil';

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.riders_men WHERE id = 'gimeno-ferrer-nil'
  ) THEN
    RAISE EXCEPTION 'La ficha duplicada no se eliminó';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.riders_men r
    WHERE r.id = 'gimeno-nil'
      AND r."firstName" = 'Nil'
      AND r."lastName" = 'Gimeno'
      AND r."otherNames" = 'GIMENO FERRER'
      AND r.verified = true
      AND r."uciProfileId" = '1077325'
  ) THEN
    RAISE EXCEPTION 'La ficha superviviente no conserva el estado esperado';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.rider_identity_aliases a
    WHERE a."aliasKey" = 'ferrer-gimeno-nil'
      AND a.gender = 'male'
      AND a."riderId" = 'gimeno-nil'
  ) THEN
    RAISE EXCEPTION 'No se creó el alias de identidad de la ficha retirada';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.race_uci_results
    WHERE "globalRiderId" = 'gimeno-ferrer-nil'
  ) OR EXISTS (
    SELECT 1 FROM public.startlist_riders
    WHERE "globalRiderId" = 'gimeno-ferrer-nil'
  ) OR EXISTS (
    SELECT 1 FROM public.rider_team_affiliations
    WHERE "riderId" = 'gimeno-ferrer-nil'
  ) OR EXISTS (
    SELECT 1 FROM public.rider_transfers
    WHERE "riderId" = 'gimeno-ferrer-nil'
  ) OR EXISTS (
    SELECT 1 FROM public.rider_identity_aliases
    WHERE "riderId" = 'gimeno-ferrer-nil'
  ) THEN
    RAISE EXCEPTION 'Persisten referencias a la ficha retirada';
  END IF;

  IF (SELECT count(*) FROM private.repair_nil_gimeno_merge_20260903_backup
      WHERE operation = 'merge-nil-gimeno-duplicate-20260903') <> 3
  THEN
    RAISE EXCEPTION 'El backup no contiene las tres filas esperadas';
  END IF;
END
$verify$;

COMMIT;
