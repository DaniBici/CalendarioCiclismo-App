WITH exact_matches AS (
  SELECT
    r.id AS result_id,
    min(st."teamId") AS team_id,
    count(DISTINCT st."teamId") AS team_count,
    rc.gender AS race_gender
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  JOIN public.races rc ON rc.id = s."raceId"
  JOIN public.startlist_teams st
    ON st."raceId" = s."raceId"
   AND lower(regexp_replace(trim(st."teamName"), '[^[:alnum:]]+', '', 'g'))
       = lower(regexp_replace(trim(r."riderDisplay"), '[^[:alnum:]]+', '', 'g'))
  WHERE (s."classKind" = 'teams' OR s."isTeamEvent" IS TRUE)
    AND r."teamId" IS NULL
    AND st."teamId" IS NOT NULL
  GROUP BY r.id, rc.gender
), eligible AS (
  SELECT em.result_id, em.team_id
  FROM exact_matches em
  JOIN public.teams t ON t.id = em.team_id
  WHERE em.team_count = 1
    AND t.gender = em.race_gender
)
INSERT INTO private.team_catalog_backfill_20260830_backup
  (operation, entity, row_id, recorded_at, row_data)
SELECT
  'link_collective_exact_startlist',
  'race_uci_results',
  r.id::text,
  now(),
  to_jsonb(r)
FROM public.race_uci_results r
JOIN eligible e ON e.result_id = r.id
WHERE NOT EXISTS (
  SELECT 1
  FROM private.team_catalog_backfill_20260830_backup b
  WHERE b.operation = 'link_collective_exact_startlist'
    AND b.entity = 'race_uci_results'
    AND b.row_id = r.id::text
);

WITH exact_matches AS (
  SELECT
    r.id AS result_id,
    min(st."teamId") AS team_id,
    count(DISTINCT st."teamId") AS team_count,
    rc.gender AS race_gender
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  JOIN public.races rc ON rc.id = s."raceId"
  JOIN public.startlist_teams st
    ON st."raceId" = s."raceId"
   AND lower(regexp_replace(trim(st."teamName"), '[^[:alnum:]]+', '', 'g'))
       = lower(regexp_replace(trim(r."riderDisplay"), '[^[:alnum:]]+', '', 'g'))
  WHERE (s."classKind" = 'teams' OR s."isTeamEvent" IS TRUE)
    AND r."teamId" IS NULL
    AND st."teamId" IS NOT NULL
  GROUP BY r.id, rc.gender
), eligible AS (
  SELECT em.result_id, em.team_id
  FROM exact_matches em
  JOIN public.teams t ON t.id = em.team_id
  WHERE em.team_count = 1
    AND t.gender = em.race_gender
)
UPDATE public.race_uci_results r
SET "teamId" = e.team_id
FROM eligible e
WHERE r.id = e.result_id
  AND r."teamId" IS NULL;
