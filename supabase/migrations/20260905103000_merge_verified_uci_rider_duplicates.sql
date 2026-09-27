-- Fusiona cuatro fichas femeninas duplicadas detectadas al verificar las
-- plantillas UCI de carretera 2026. Las tres supervivientes ya contienen el
-- perfil UCI, nacimiento, nacionalidad y equipo oficiales.
BEGIN;

CREATE TABLE private.rider_identity_merge_backup_20260905 (
  source_id text PRIMARY KEY,
  target_id text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male', 'female')),
  source_rider jsonb NOT NULL,
  target_rider jsonb NOT NULL,
  startlist_rows jsonb NOT NULL,
  result_rows jsonb NOT NULL,
  source_affiliations jsonb NOT NULL,
  target_affiliations jsonb NOT NULL,
  source_transfers jsonb NOT NULL,
  target_transfers jsonb NOT NULL,
  aliases_before jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.rider_identity_merge_backup_20260905
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.rider_identity_merge_backup_20260905 IS
  'Rollback dirigido de la fusión de zanko-petra, knave-britt, knavem-britt y hussain-mohammad-huss aplicada el 05/09/2026.';

DO $$
DECLARE
  v_sources integer;
  v_targets integer;
  v_coappear_startlists integer;
  v_coappear_results integer;
BEGIN
  WITH pairs(source_id, target_id, profile, birth_date, nationality) AS (VALUES
    ('zanko-petra', 'zsanko-petra', '1137947', date '2001-02-18', 'hu'),
    ('knave-britt', 'knaven-britt', '233357', date '2000-07-29', 'be'),
    ('knavem-britt', 'knaven-britt', '233357', date '2000-07-29', 'be'),
    ('hussain-mohammad-huss', 'hussain-zahra', '1221535', date '2001-07-08', 'ae')
  )
  SELECT
    count(*) FILTER (WHERE s.id IS NOT NULL),
    count(*) FILTER (WHERE t.id IS NOT NULL AND t."uciProfileId" = p.profile
      AND t."birthDate" = p.birth_date AND t.nationality = p.nationality
      AND t.verified),
    count(*) FILTER (WHERE EXISTS (
      SELECT 1
      FROM public.startlist_riders a
      JOIN public.startlist_riders b ON b."raceId" = a."raceId"
      WHERE a."globalRiderId" = p.source_id
        AND b."globalRiderId" = p.target_id
    )),
    count(*) FILTER (WHERE EXISTS (
      SELECT 1
      FROM public.race_uci_results a
      JOIN public.race_uci_results b ON b."stageRef" = a."stageRef"
      WHERE a."globalRiderId" = p.source_id
        AND b."globalRiderId" = p.target_id
    ))
  INTO v_sources, v_targets, v_coappear_startlists, v_coappear_results
  FROM pairs p
  LEFT JOIN public.riders_women s ON s.id = p.source_id
    AND s."uciProfileId" IS NULL AND NOT s.verified
    AND s."birthDate" = p.birth_date
  LEFT JOIN public.riders_women t ON t.id = p.target_id;

  IF v_sources <> 4 OR v_targets <> 4 THEN
    RAISE EXCEPTION 'rider_merge_precondition_changed: sources %, targets %', v_sources, v_targets;
  END IF;
  IF v_coappear_startlists <> 0 OR v_coappear_results <> 0 THEN
    RAISE EXCEPTION 'rider_merge_coappearance: startlists %, results %', v_coappear_startlists, v_coappear_results;
  END IF;
END;
$$;

WITH pairs(source_id, target_id, gender) AS (VALUES
  ('zanko-petra', 'zsanko-petra', 'female'),
  ('knave-britt', 'knaven-britt', 'female'),
  ('knavem-britt', 'knaven-britt', 'female'),
  ('hussain-mohammad-huss', 'hussain-zahra', 'female')
)
INSERT INTO private.rider_identity_merge_backup_20260905 (
  source_id, target_id, gender, source_rider, target_rider,
  startlist_rows, result_rows, source_affiliations, target_affiliations,
  source_transfers, target_transfers, aliases_before
)
SELECT
  p.source_id,
  p.target_id,
  p.gender,
  to_jsonb(s),
  to_jsonb(t),
  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
    FROM public.startlist_riders x WHERE x."globalRiderId" = p.source_id), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x."stageRef", x.id)
    FROM public.race_uci_results x WHERE x."globalRiderId" = p.source_id), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
    FROM public.rider_team_affiliations x
    WHERE x."riderId" = p.source_id AND x."riderGender" = p.gender), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
    FROM public.rider_team_affiliations x
    WHERE x."riderId" = p.target_id AND x."riderGender" = p.gender), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
    FROM public.rider_transfers x
    WHERE x."riderId" = p.source_id AND x."riderGender" = p.gender), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)
    FROM public.rider_transfers x
    WHERE x."riderId" = p.target_id AND x."riderGender" = p.gender), '[]'::jsonb),
  COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x."aliasKey")
    FROM public.rider_identity_aliases x
    WHERE x.gender = p.gender AND x."riderId" IN (p.source_id, p.target_id)), '[]'::jsonb)
FROM pairs p
JOIN public.riders_women s ON s.id = p.source_id
JOIN public.riders_women t ON t.id = p.target_id;

WITH pairs(source_id, target_id) AS (VALUES
  ('zanko-petra', 'zsanko-petra'),
  ('knave-britt', 'knaven-britt'),
  ('knavem-britt', 'knaven-britt'),
  ('hussain-mohammad-huss', 'hussain-zahra')
)
UPDATE public.startlist_riders row SET
  "globalRiderId" = p.target_id,
  "firstName" = target."firstName",
  "lastName" = target."lastName"
FROM pairs p
JOIN public.riders_women target ON target.id = p.target_id
WHERE row."globalRiderId" = p.source_id;

WITH pairs(source_id, target_id) AS (VALUES
  ('zanko-petra', 'zsanko-petra'),
  ('knave-britt', 'knaven-britt'),
  ('knavem-britt', 'knaven-britt'),
  ('hussain-mohammad-huss', 'hussain-zahra')
)
UPDATE public.race_uci_results row
SET "globalRiderId" = p.target_id
FROM pairs p
WHERE row."globalRiderId" = p.source_id;

WITH pairs(source_id, target_id) AS (VALUES
  ('zanko-petra', 'zsanko-petra'),
  ('knave-britt', 'knaven-britt'),
  ('knavem-britt', 'knaven-britt'),
  ('hussain-mohammad-huss', 'hussain-zahra')
)
UPDATE public.rider_transfers row
SET "riderId" = p.target_id, "updatedAt" = now()
FROM pairs p
WHERE row."riderGender" = 'female' AND row."riderId" = p.source_id;

WITH pairs(source_id, target_id) AS (VALUES
  ('zanko-petra', 'zsanko-petra'),
  ('knave-britt', 'knaven-britt'),
  ('knavem-britt', 'knaven-britt'),
  ('hussain-mohammad-huss', 'hussain-zahra')
)
INSERT INTO public.rider_team_affiliations (
  id, "riderId", "riderGender", "teamId", year, "dateFrom", "dateTo",
  source, verified, "createdAt", "updatedAt", "affiliationType",
  "sourceUrl", "uciTeamProfileId", "dateBasis", "verifiedAt"
)
SELECT
  CASE WHEN a."affiliationType" = 'trainee' THEN gen_random_uuid()::text
    ELSE p.target_id || '__' || a."teamId" || '__' || a.year END,
  p.target_id, a."riderGender", a."teamId", a.year, a."dateFrom", a."dateTo",
  a.source, a.verified, a."createdAt", now(), a."affiliationType",
  a."sourceUrl", a."uciTeamProfileId", a."dateBasis", a."verifiedAt"
FROM public.rider_team_affiliations a
JOIN pairs p ON p.source_id = a."riderId"
WHERE a."riderGender" = 'female'
  AND NOT EXISTS (
    SELECT 1 FROM public.rider_team_affiliations current
    WHERE current."riderId" = p.target_id
      AND current."riderGender" = 'female'
      AND current."teamId" = a."teamId"
      AND current.year = a.year
      AND current."affiliationType" = a."affiliationType"
  );

DELETE FROM public.rider_team_affiliations
WHERE "riderGender" = 'female'
  AND "riderId" IN ('zanko-petra', 'knave-britt', 'knavem-britt', 'hussain-mohammad-huss');

INSERT INTO public.rider_identity_aliases ("aliasKey", gender, "riderId", note)
SELECT s."identityKey", 'female', p.target_id,
  'Fusión verificada contra perfil y plantilla UCI 2026 el 05/09/2026'
FROM (VALUES
  ('zanko-petra', 'zsanko-petra'),
  ('knave-britt', 'knaven-britt'),
  ('knavem-britt', 'knaven-britt'),
  ('hussain-mohammad-huss', 'hussain-zahra')
) p(source_id, target_id)
JOIN public.riders_women s ON s.id = p.source_id;

UPDATE public.riders_women SET
  "otherNames" = concat_ws(', ', nullif("otherNames", ''), 'Petra Zanko'),
  "updatedAt" = now()
WHERE id = 'zsanko-petra';

UPDATE public.riders_women SET
  "otherNames" = concat_ws(', ', nullif("otherNames", ''), 'Britt Knave', 'Britt Knavem'),
  "updatedAt" = now()
WHERE id = 'knaven-britt';

UPDATE public.riders_women SET
  "otherNames" = concat_ws(', ', nullif("otherNames", ''), 'Mohammad Huss Hussain'),
  "updatedAt" = now()
WHERE id = 'hussain-zahra';

DELETE FROM public.riders_women
WHERE id IN ('zanko-petra', 'knave-britt', 'knavem-britt', 'hussain-mohammad-huss');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.startlist_riders
    WHERE "globalRiderId" IN ('zanko-petra', 'knave-britt', 'knavem-britt', 'hussain-mohammad-huss')
  ) OR EXISTS (
    SELECT 1 FROM public.race_uci_results
    WHERE "globalRiderId" IN ('zanko-petra', 'knave-britt', 'knavem-britt', 'hussain-mohammad-huss')
  ) OR EXISTS (
    SELECT 1 FROM public.rider_team_affiliations
    WHERE "riderGender" = 'female'
      AND "riderId" IN ('zanko-petra', 'knave-britt', 'knavem-britt', 'hussain-mohammad-huss')
  ) OR EXISTS (
    SELECT 1 FROM public.rider_transfers
    WHERE "riderGender" = 'female'
      AND "riderId" IN ('zanko-petra', 'knave-britt', 'knavem-britt', 'hussain-mohammad-huss')
  ) THEN
    RAISE EXCEPTION 'rider_merge_dangling_reference';
  END IF;

  IF (SELECT count(*) FROM private.rider_identity_merge_backup_20260905) <> 4
    OR (SELECT count(*) FROM public.rider_identity_aliases
      WHERE gender = 'female'
        AND "aliasKey" IN ('petra-zanko', 'britt-knave', 'britt-knavem', 'huss-hussain-mohammad')) <> 4
  THEN
    RAISE EXCEPTION 'rider_merge_postcondition_failed';
  END IF;
END;
$$;

COMMIT;
