-- Manifiesto de solo lectura: clubes 2026 tras la regularización y las fusiones.
-- Clave estable de cada ítem: (gender, rider_id, team_id, year).
-- Una candidatura es evidencia para revisión, no autorización de afiliación.
WITH riders AS (
  SELECT 'male' AS gender, id, "firstName", "lastName", "currentTeamId" FROM public.riders_men
  UNION ALL
  SELECT 'female', id, "firstName", "lastName", "currentTeamId" FROM public.riders_women
),
observations AS (
  SELECT t.id AS team_id, t.name AS team_name, t.category, t.gender AS team_gender,
         rc.gender, rc.year, sr."globalRiderId" AS rider_id,
         count(DISTINCT rc.id) AS race_count,
         min(rc."startDate") AS first_race, max(rc."startDate") AS last_race,
         jsonb_agg(DISTINCT jsonb_build_object('raceId',rc.id,'name',rc.name,'date',rc."startDate")) AS races
  FROM public.startlist_riders sr
  JOIN public.startlist_teams st ON st.id = sr."teamId"
  JOIN public.teams t ON t.id = st."teamId"
  JOIN public.races rc ON rc.id = st."raceId"
  WHERE rc.year = 2026 AND t."teamKind" = 'club'
    AND t.category NOT IN ('NTM','NTW') AND NOT t."specialEdition"
  GROUP BY t.id,t.name,t.category,t.gender,rc.gender,rc.year,sr."globalRiderId"
),
regular_counts AS (
  SELECT gender,rider_id,count(DISTINCT team_id) AS regular_teams
  FROM observations GROUP BY gender,rider_id
),
affiliations AS (
  SELECT a."riderGender" AS gender,a."riderId" AS rider_id,
         jsonb_agg(to_jsonb(a) ORDER BY a.id) AS rows
  FROM public.rider_team_affiliations a WHERE a.year = 2026
  GROUP BY a."riderGender",a."riderId"
)
SELECT o.*,r."firstName",r."lastName",r."currentTeamId",c.regular_teams,
       COALESCE(a.rows,'[]'::jsonb) AS affiliations,
       CASE
         WHEN r.id IS NULL THEN 'pending_identity'
         WHEN o.team_gender IS DISTINCT FROM o.gender THEN 'pending_gender'
         WHEN r."currentTeamId" = o.team_id THEN 'already_current'
         WHEN r."currentTeamId" IS NOT NULL THEN 'pending_other_current'
         WHEN a.rows IS NOT NULL THEN 'pending_existing_affiliation'
         WHEN c.regular_teams > 1 THEN 'pending_multiple_regular_teams'
         WHEN o.race_count >= 2 THEN 'candidate_repeated'
         ELSE 'candidate_single_race'
       END AS verdict,
       'pending'::text AS status
FROM observations o
LEFT JOIN riders r ON r.id=o.rider_id AND r.gender=o.gender
JOIN regular_counts c ON c.gender=o.gender AND c.rider_id=o.rider_id
LEFT JOIN affiliations a ON a.rider_id=o.rider_id AND a.gender=o.gender
WHERE o.category IN ('CLUBM','CLUBW')
ORDER BY verdict,o.team_name,o.gender,o.rider_id;
