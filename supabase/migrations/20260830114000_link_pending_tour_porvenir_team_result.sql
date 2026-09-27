-- Completa el caso identificado durante la verificación: la fila colectiva
-- Norway de Tour del Porvenir tenía teamId nulo, mientras la startlist ya había
-- quedado corregida al NTM masculino. Se conserva el valor previo antes de
-- enlazar el resultado.

INSERT INTO private.team_catalog_backfill_20260830_backup
  (operation, entity, row_id, recorded_at, row_data)
SELECT
  'team-catalog-backfill-20260830',
  'race_uci_results',
  r.id::text,
  transaction_timestamp(),
  to_jsonb(r)
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN public.races rc ON rc.id = s."raceId"
WHERE rc."year" = 2026
  AND rc.name = 'Tour del Porvenir'
  AND s."classKind" = 'teams'
  AND s."isTeamEvent" = true
  AND r."globalRiderId" IS NULL
  AND r."teamId" IS NULL
  AND lower(btrim(r."riderDisplay")) = 'norway'
ON CONFLICT (operation, entity, row_id) DO NOTHING;

WITH target AS (
  SELECT r.id, min(st."teamId") AS team_id
  FROM public.race_uci_results r
  JOIN private.team_catalog_backfill_20260830_backup b
    ON b.operation = 'team-catalog-backfill-20260830'
   AND b.entity = 'race_uci_results'
   AND b.row_id = r.id::text
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  JOIN public.startlist_teams st
    ON st."raceId" = s."raceId"
   AND public.fold_team_name(st."teamName") = public.fold_team_name(r."riderDisplay")
   AND st."teamId" IS NOT NULL
  WHERE r."teamId" IS NULL
  GROUP BY r.id
  HAVING count(DISTINCT st."teamId") = 1
)
UPDATE public.race_uci_results r
SET "teamId" = target.team_id
FROM target
WHERE target.id = r.id;
