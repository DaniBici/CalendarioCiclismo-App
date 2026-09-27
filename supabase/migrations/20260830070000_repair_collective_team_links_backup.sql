-- Backup privado de los enlaces dirigidos de clasificaciones colectivas UCI 2026.
-- La selección usa únicamente la coincidencia exacta y única de la startlist de
-- la misma carrera; no resuelve corredores ni crea equipos.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.repair_collective_team_links_20260830_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_collective_team_links_20260830_backup IS
  'Backup de race_uci_results antes de enlazar teamId en clasificaciones colectivas UCI 2026 el 2026-08-30.';

ALTER TABLE private.repair_collective_team_links_20260830_backup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.repair_collective_team_links_20260830_backup
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.repair_collective_team_links_20260830_backup TO service_role;

WITH target AS (
  SELECT r.id
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  JOIN public.races rc ON rc.id = s."raceId"
  JOIN public.startlist_teams st
    ON st."raceId" = rc.id
   AND public.fold_team_name(st."teamName") = public.fold_team_name(r."riderDisplay")
   AND st."teamId" IS NOT NULL
  JOIN public.teams t ON t.id = st."teamId"
  WHERE rc."year" = 2026
    AND s."classKind" = 'teams'
    AND s."isTeamEvent" = true
    AND r."globalRiderId" IS NULL
    AND r."teamId" IS NULL
  GROUP BY r.id
  HAVING count(DISTINCT st."teamId") = 1
     AND bool_and(t.gender IS NULL OR t.gender = rc.gender)
)
INSERT INTO private.repair_collective_team_links_20260830_backup
  (operation, entity, row_id, recorded_at, row_data)
SELECT
  'repair-collective-team-links-20260830',
  'race_uci_results',
  r.id::text,
  transaction_timestamp(),
  to_jsonb(r)
FROM public.race_uci_results r
JOIN target ON target.id = r.id
ON CONFLICT (operation, entity, row_id) DO NOTHING;
