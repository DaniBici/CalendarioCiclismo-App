-- Backup privado del backfill dirigido del catálogo de equipos 2026.
-- Incluye las filas de startlist y resultados colectivamente identificadas antes
-- de crear/reutilizar equipos o corregir enlaces incompatibles.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.team_catalog_backfill_20260830_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.team_catalog_backfill_20260830_backup IS
  'Backup de startlist_teams y race_uci_results antes del backfill dirigido del catálogo de equipos 2026 del 2026-08-30.';

ALTER TABLE private.team_catalog_backfill_20260830_backup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.team_catalog_backfill_20260830_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.team_catalog_backfill_20260830_backup TO service_role;

WITH target_startlists AS (
  SELECT DISTINCT st.id
  FROM public.startlist_teams st
  JOIN public.races rc ON rc.id = st."raceId"
  WHERE rc."year" = 2026
    AND (
      (st."teamId" IS NULL AND EXISTS (
        SELECT 1
        FROM public.race_uci_results r
        JOIN public.race_uci_stages s ON s.id = r."stageRef"
        WHERE s."raceId" = rc.id
          AND s."classKind" = 'teams'
          AND s."isTeamEvent" = true
          AND r."globalRiderId" IS NULL
          AND r."teamId" IS NULL
          AND public.fold_team_name(r."riderDisplay") = public.fold_team_name(st."teamName")
      ))
      OR EXISTS (
        SELECT 1
        FROM public.race_uci_results r
        JOIN public.race_uci_stages s ON s.id = r."stageRef"
        JOIN public.teams t ON t.id = st."teamId"
        WHERE s."raceId" = rc.id
          AND s."classKind" = 'teams'
          AND s."isTeamEvent" = true
          AND r."globalRiderId" IS NULL
          AND r."teamId" = st."teamId"
          AND t.gender IS NOT NULL
          AND rc.gender IS NOT NULL
          AND t.gender <> rc.gender
          AND public.fold_team_name(r."riderDisplay") = public.fold_team_name(st."teamName")
      )
      OR EXISTS (
        SELECT 1
        FROM public.race_uci_results r
        JOIN public.race_uci_stages s ON s.id = r."stageRef"
        JOIN public.teams t ON t.id = st."teamId"
        WHERE s."raceId" = rc.id
          AND s."classKind" = 'teams'
          AND s."isTeamEvent" = true
          AND r."globalRiderId" IS NULL
          AND r."teamId" IS NULL
          AND t.gender IS NOT NULL
          AND rc.gender IS NOT NULL
          AND t.gender <> rc.gender
          AND public.fold_team_name(r."riderDisplay") = public.fold_team_name(st."teamName")
      )
    )
)
INSERT INTO private.team_catalog_backfill_20260830_backup
  (operation, entity, row_id, recorded_at, row_data)
SELECT
  'team-catalog-backfill-20260830',
  'startlist_teams',
  st.id,
  transaction_timestamp(),
  to_jsonb(st)
FROM public.startlist_teams st
JOIN target_startlists target ON target.id = st.id
ON CONFLICT (operation, entity, row_id) DO NOTHING;

WITH target_results AS (
  SELECT DISTINCT r.id
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  JOIN public.races rc ON rc.id = s."raceId"
  WHERE rc."year" = 2026
    AND s."classKind" = 'teams'
    AND s."isTeamEvent" = true
    AND r."globalRiderId" IS NULL
    AND (
      (r."teamId" IS NULL AND EXISTS (
        SELECT 1
        FROM public.startlist_teams st
        WHERE st."raceId" = rc.id
          AND st."teamId" IS NULL
          AND public.fold_team_name(st."teamName") = public.fold_team_name(r."riderDisplay")
      ))
      OR EXISTS (
        SELECT 1
        FROM public.startlist_teams st
        JOIN public.teams t ON t.id = st."teamId"
        WHERE st."raceId" = rc.id
          AND st."teamId" = r."teamId"
          AND t.gender IS NOT NULL
          AND rc.gender IS NOT NULL
          AND t.gender <> rc.gender
          AND public.fold_team_name(st."teamName") = public.fold_team_name(r."riderDisplay")
      )
      OR EXISTS (
        SELECT 1
        FROM public.startlist_teams st
        JOIN public.teams t ON t.id = st."teamId"
        WHERE st."raceId" = rc.id
          AND st."teamId" IS NOT NULL
          AND r."teamId" IS NULL
          AND t.gender IS NOT NULL
          AND rc.gender IS NOT NULL
          AND t.gender <> rc.gender
          AND public.fold_team_name(st."teamName") = public.fold_team_name(r."riderDisplay")
      )
    )
)
INSERT INTO private.team_catalog_backfill_20260830_backup
  (operation, entity, row_id, recorded_at, row_data)
SELECT
  'team-catalog-backfill-20260830',
  'race_uci_results',
  r.id::text,
  transaction_timestamp(),
  to_jsonb(r)
FROM public.race_uci_results r
JOIN target_results target ON target.id = r.id
ON CONFLICT (operation, entity, row_id) DO NOTHING;
