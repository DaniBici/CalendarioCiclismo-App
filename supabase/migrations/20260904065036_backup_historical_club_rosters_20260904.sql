-- Congela los 3.570 candidatos autorizados y sus datos antes de la asignación.
-- Las altas se aplican después, por lotes, mediante el mecanismo de clubes vigente.
BEGIN;
CREATE TABLE private.historical_club_rosters_20260904_backup (
  entity text NOT NULL CHECK (entity IN ('manifest','applied','control')),
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity,row_id)
);
ALTER TABLE private.historical_club_rosters_20260904_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.historical_club_rosters_20260904_backup
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON TABLE private.historical_club_rosters_20260904_backup TO service_role;
CREATE POLICY private_backup_deny_api ON private.historical_club_rosters_20260904_backup
  FOR ALL TO anon,authenticated USING (false) WITH CHECK (false);

WITH audit AS (
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
ORDER BY verdict,o.team_name,o.gender,o.rider_id
), candidates AS (
  SELECT * FROM audit WHERE verdict IN ('candidate_repeated','candidate_single_race')
)
INSERT INTO private.historical_club_rosters_20260904_backup(entity,row_id,row_data)
SELECT 'manifest',c.rider_id || '__' || c.team_id || '__' || c.year,
       to_jsonb(c) || jsonb_build_object(
         'riderBefore',CASE WHEN c.gender='male' THEN to_jsonb(rm) ELSE to_jsonb(rw) END,
         'affiliationsBefore',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)
            FROM public.rider_team_affiliations a
            WHERE a."riderId"=c.rider_id AND a."riderGender"=c.gender),'[]'::jsonb),
         'sourceStartlistId',sr.id,'sourceStartlistBefore',to_jsonb(sr))
FROM candidates c
LEFT JOIN public.riders_men rm ON c.gender='male' AND rm.id=c.rider_id
LEFT JOIN public.riders_women rw ON c.gender='female' AND rw.id=c.rider_id
JOIN LATERAL (
  SELECT sr.* FROM public.startlist_riders sr
  JOIN public.startlist_teams st ON st.id=sr."teamId" AND st."raceId"=sr."raceId"
  JOIN public.races rc ON rc.id=st."raceId"
  WHERE sr."globalRiderId"=c.rider_id AND st."teamId"=c.team_id
    AND rc.gender=c.gender AND rc.year=c.year ORDER BY sr.id LIMIT 1
) sr ON true;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM private.historical_club_rosters_20260904_backup WHERE entity='manifest') <> 3570 THEN
    RAISE EXCEPTION 'El lote de candidatos cambió respecto al manifiesto autorizado';
  END IF;
  IF EXISTS (SELECT 1 FROM private.historical_club_rosters_20260904_backup b
             JOIN public.rider_team_affiliations a ON a.id=b.row_id WHERE b.entity='manifest') THEN
    RAISE EXCEPTION 'Una afiliación del lote ya existe; actualizar el diagnóstico';
  END IF;
END;
$preflight$;

INSERT INTO private.historical_club_rosters_20260904_backup(entity,row_id,row_data)
SELECT 'control','before',jsonb_build_object(
  'startlists',(SELECT jsonb_build_object('count',count(*),'hash',md5(string_agg(md5(to_jsonb(s)::text),'' ORDER BY s.id)))
    FROM public.startlist_riders s
    WHERE s."globalRiderId" IN (SELECT row_data->>'rider_id' FROM private.historical_club_rosters_20260904_backup WHERE entity='manifest')),
  'results',(SELECT jsonb_build_object('count',count(*),'hash',md5(string_agg(md5(to_jsonb(r)::text),'' ORDER BY r.id)))
    FROM public.race_uci_results r
    WHERE r."globalRiderId" IN (SELECT row_data->>'rider_id' FROM private.historical_club_rosters_20260904_backup WHERE entity='manifest')),
  'existingAffiliations',(SELECT jsonb_build_object('count',count(*),'hash',md5(string_agg(md5(to_jsonb(a)::text),'' ORDER BY a.id)))
    FROM public.rider_team_affiliations a),
  'candidates',3570,'clubs',768,'year',2026
);
COMMENT ON TABLE private.historical_club_rosters_20260904_backup IS
  'Manifiesto de asignación histórica autorizada: 3.570 corredores de 768 clubes en 2026; conserva fichas y afiliaciones previas, altas exactas y controles de inscritos/resultados.';
COMMIT;
