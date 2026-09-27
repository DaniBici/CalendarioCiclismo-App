-- Reparación dirigida de las dos únicas fichas teams.gender NULL del catálogo.
-- No modifica resultados, startlists, afiliaciones ni nombres de equipo.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.repair_team_gender_null_20260830_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  backedUpAt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_team_gender_null_20260830_backup IS
  'Backup recuperable previo a la reparación de los dos equipos con gender NULL de 2026.';

ALTER TABLE private.repair_team_gender_null_20260830_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_team_gender_null_20260830_backup
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.repair_team_gender_null_20260830_backup TO service_role;

CREATE TEMP TABLE _repair_team_gender_null_20260830_targets (
  team_id text PRIMARY KEY,
  expected_gender text NOT NULL,
  expected_category text NOT NULL,
  expected_parent_team_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO _repair_team_gender_null_20260830_targets
  (team_id, expected_gender, expected_category, expected_parent_team_id) VALUES
  ('team_mayenne_monbana_my_pie_tdf_femmes_2026', 'female', 'PRW',
   'team_1776715672148_9njdjy'),
  ('team_trex_quickstep_tdp_2026', 'male', 'WT',
   'team_1776703755811_lbaphb');

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.teams t
    JOIN _repair_team_gender_null_20260830_targets x ON x.team_id=t.id
    WHERE t.gender IS NULL
      AND t.category=x.expected_category
      AND t."parentTeamId"=x.expected_parent_team_id
      AND t."specialEdition" IS TRUE
  ) <> 2 THEN
    RAISE EXCEPTION 'El preflight de gender NULL no encuentra exactamente las dos fichas auditadas';
  END IF;
END $$;

INSERT INTO private.repair_team_gender_null_20260830_backup
  (operation, entity, row_id, row_data)
SELECT
  'repair-team-gender-null-20260830',
  'teams',
  t.id,
  to_jsonb(t)
FROM public.teams t
JOIN _repair_team_gender_null_20260830_targets x ON x.team_id=t.id
ON CONFLICT (operation, entity, row_id) DO NOTHING;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM private.repair_team_gender_null_20260830_backup
    WHERE operation='repair-team-gender-null-20260830'
      AND entity='teams'
  ) <> 2 THEN
    RAISE EXCEPTION 'El backup no contiene las dos fichas teams previstas';
  END IF;
END $$;

UPDATE public.teams t
SET gender=x.expected_gender,
    "updatedAt"=now()
FROM _repair_team_gender_null_20260830_targets x
WHERE t.id=x.team_id
  AND t.gender IS NULL
  AND t.category=x.expected_category
  AND t."parentTeamId"=x.expected_parent_team_id
  AND t."specialEdition" IS TRUE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.teams t
    JOIN _repair_team_gender_null_20260830_targets x ON x.team_id=t.id
    WHERE t.gender IS DISTINCT FROM x.expected_gender
  ) THEN
    RAISE EXCEPTION 'La reparación no dejó el sexo esperado en las dos fichas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.gender IS NULL
  ) THEN
    RAISE EXCEPTION 'Persisten equipos con gender NULL tras la reparación';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE (t.category IN ('WT','PT','CLUBM','NTM') AND t.gender <> 'male')
       OR (t.category IN ('WWT','PRW','CTW','CLUBW','NTW') AND t.gender <> 'female')
  ) THEN
    RAISE EXCEPTION 'La reparación ha dejado una incompatibilidad entre categoría y sexo';
  END IF;
END $$;
