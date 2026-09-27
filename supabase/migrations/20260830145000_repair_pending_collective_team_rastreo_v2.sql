-- Segunda pasada dirigida sobre las 39 filas colectivas UCI 2026 que seguían
-- sin teamId. Mantiene las filas colectivas como equipos y no toca globalRiderId.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.pending_collective_team_rastreo_v2_20260830_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  row_data jsonb NOT NULL,
  backedUpAt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.pending_collective_team_rastreo_v2_20260830_backup IS
  'Backup recuperable previo a la segunda pasada de enlaces colectivos UCI 2026.';

ALTER TABLE private.pending_collective_team_rastreo_v2_20260830_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.pending_collective_team_rastreo_v2_20260830_backup
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.pending_collective_team_rastreo_v2_20260830_backup TO service_role;

CREATE TEMP TABLE _pending_collective_team_rastreo_v2_map (
  race_id text NOT NULL,
  raw_name text NOT NULL,
  canonical_team_name text NOT NULL,
  gender text NOT NULL,
  source_url text NOT NULL,
  PRIMARY KEY (race_id, raw_name)
) ON COMMIT DROP;

INSERT INTO _pending_collective_team_rastreo_v2_map
  (race_id, raw_name, canonical_team_name, gender, source_url) VALUES
  ('WiGrn1y70EH7spikAOGW', 'NATIONAL TEAM ALGERIA', 'Algeria', 'male',
    'https://balticchaintour.com/teams-2026/'),
  ('WiGrn1y70EH7spikAOGW', 'NATIONAL TEAM POLAND', 'Poland', 'male',
    'https://balticchaintour.com/teams-2026/'),
  ('yCUZx212nhhYZKLx14F5', 'NETCOMPANY INEOS RACING ACADEMY',
    'INEOS Grenadiers Racing Academy', 'male',
    'https://tourdelavenir.com/en/teams-riders/'),
  ('Vlx28y8lZf5PWnHhBUit', 'ASO SOLOLÁ-INTERCOP', 'Aso Sololá-Intercop', 'female',
    'https://fedeciclismogua.org/asociaciones/asociacion-departamental-de-ciclismo-de-solola/'),
  ('kRRClsEOAXjGigmhHvFn', 'AG INSURANCE SOUDAL DEVO TEAM',
    'AG Insurance-Soudal Development', 'female',
    'https://lottobelgiumcupwomen.be/leidster-dina-scavone-wint-dwars-door-het-hageland/'),
  ('kRRClsEOAXjGigmhHvFn', 'CARBONBIKE GIORDANA BY GEN Z',
    'Carbonbike Giordana Giofré by Gen Z', 'female',
    'https://lottobelgiumcupwomen.be/leidster-dina-scavone-wint-dwars-door-het-hageland/'),
  ('kRRClsEOAXjGigmhHvFn', 'CITYMESH - CUSTOMM PRO CYCLING TEAM',
    'Citymesh-Customm', 'female',
    'https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'CYCLINGTEAM VAN EYCK/ BELCO',
    'Belco-Van Eyck', 'female',
    'https://lottobelgiumcupwomen.be/leidster-dina-scavone-wint-dwars-door-het-hageland/'),
  ('kRRClsEOAXjGigmhHvFn', 'DE CEUSTER-ACROG',
    'De Ceuster - Acrog', 'female',
    'https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'FENIX-PREMIER TECH DEVELOPMENT TEAM',
    'Fenix-Premier Tech Development', 'female',
    'https://lottobelgiumcupwomen.be/leidster-dina-scavone-wint-dwars-door-het-hageland/'),
  ('kRRClsEOAXjGigmhHvFn', 'HANDSLING ALBA DEVELOPMENT ROAD TEAM',
    'Handsling Alba', 'female',
    'https://lottobelgiumcupwomen.be/leidster-dina-scavone-wint-dwars-door-het-hageland/'),
  ('kRRClsEOAXjGigmhHvFn', 'JAN VAN ARCKEL WOMEN',
    'Jan van Arckel Women', 'female',
    'https://www.belgiancycling.be/news/voorbeschouwing-women-cycling-series-2026/'),
  ('kRRClsEOAXjGigmhHvFn', 'KDM-PACK CYCLING TEAM',
    'KDM-Pack', 'female',
    'https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'KEUKENS REDANT CYCLING TEAM',
    'Keukens Redant', 'female',
    'https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'LOTTO INTERMARCHE LADIES',
    'Lotto Intermarché', 'female',
    'https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'MINIMAX CYCLING TEAM',
    'Minimax', 'female',
    'https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'O''SHEA RED CHILLI BIKES',
    'O''Shea Red Chilli Bikes', 'female',
    'https://lottobelgiumcupwomen.be/wp-content/uploads/2026/04/2026-04-06-MOUSCRON-5-7-PARTICIPANTS-udpate-01-04.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'REVVI EGS GROUP - VELOPRO',
    'Révvi-EGS Group-Velopro', 'female',
    'https://www.revvi-egsgroup-velopro.be/'),
  ('kRRClsEOAXjGigmhHvFn', 'SMURFIT WESTROCK CYCLING TEAM',
    'Smurfit Westrock Cycling Team', 'female',
    'https://smurfitwestrockcyclingteam.com/race-schedule'),
  ('kRRClsEOAXjGigmhHvFn', 'THE LEAD OUT CYCLING ACADEMY',
    'The Lead Out Cycling Academy', 'female',
    'https://www.belgiancycling.be/app/uploads/2022/06/overzicht-deelnemende-ploegen-lotto-belgium-cup-women-2026.pdf'),
  ('kRRClsEOAXjGigmhHvFn', 'VOLKERWESSELS CYCLING TEAM WOMEN',
    'VolkerWessels', 'female',
    'https://lottobelgiumcupwomen.be/leidster-dina-scavone-wint-dwars-door-het-hageland/'),
  ('kRRClsEOAXjGigmhHvFn', 'WV BREDA WOMEN CYCLING TEAM',
    'WV Breda Women Cycling Team', 'female',
    'https://www.wvbreda.nl/disciplines/vrouwen');

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.race_uci_results r
    JOIN public.race_uci_stages s ON s.id = r."stageRef"
    JOIN _pending_collective_team_rastreo_v2_map m
      ON m.race_id = s."raceId"
     AND public.fold_team_name(m.raw_name) = public.fold_team_name(r."riderDisplay")
    WHERE r."teamId" IS NULL
      AND r."globalRiderId" IS NULL
      AND (s."classKind" = 'teams' OR s."isTeamEvent" IS TRUE)
  ) <> 39 THEN
    RAISE EXCEPTION 'La segunda pasada no encuentra exactamente las 39 filas previstas';
  END IF;
END $$;

INSERT INTO private.pending_collective_team_rastreo_v2_20260830_backup
  (operation, entity, row_id, row_data)
SELECT
  'pending-collective-team-rastreo-v2-20260830',
  'race_uci_results',
  r.id::text,
  to_jsonb(r)
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN _pending_collective_team_rastreo_v2_map m
  ON m.race_id = s."raceId"
 AND public.fold_team_name(m.raw_name) = public.fold_team_name(r."riderDisplay")
WHERE r."teamId" IS NULL
  AND r."globalRiderId" IS NULL
  AND (s."classKind" = 'teams' OR s."isTeamEvent" IS TRUE)
ON CONFLICT (operation, entity, row_id) DO NOTHING;

INSERT INTO private.pending_collective_team_rastreo_v2_20260830_backup
  (operation, entity, row_id, row_data)
SELECT
  'pending-collective-team-rastreo-v2-20260830',
  'startlist_teams',
  st.id,
  to_jsonb(st)
FROM public.startlist_teams st
WHERE st.id = '244bde14-5890-4a0b-93e4-0ef53b69d021'
ON CONFLICT (operation, entity, row_id) DO NOTHING;

CREATE TEMP TABLE _pending_collective_team_rastreo_v2_created_teams (
  canonical_team_name text PRIMARY KEY,
  team_id text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_team_id text;
BEGIN
  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'Vlx28y8lZf5PWnHhBUit', 'Aso Sololá-Intercop', 'female'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo introducir Aso Sololá-Intercop';
  END IF;
  UPDATE public.teams
  SET "countryCode" = 'gt'
  WHERE id = v_team_id AND gender = 'female' AND "teamKind" = 'club';
  INSERT INTO _pending_collective_team_rastreo_v2_created_teams
    VALUES ('Aso Sololá-Intercop', v_team_id)
    ON CONFLICT (canonical_team_name) DO UPDATE SET team_id = EXCLUDED.team_id;

  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'kRRClsEOAXjGigmhHvFn', 'Jan van Arckel Women', 'female'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo introducir Jan van Arckel Women';
  END IF;
  UPDATE public.teams
  SET "countryCode" = 'nl'
  WHERE id = v_team_id AND gender = 'female' AND "teamKind" = 'club';
  INSERT INTO _pending_collective_team_rastreo_v2_created_teams
    VALUES ('Jan van Arckel Women', v_team_id)
    ON CONFLICT (canonical_team_name) DO UPDATE SET team_id = EXCLUDED.team_id;

  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'kRRClsEOAXjGigmhHvFn', 'Révvi-EGS Group-Velopro', 'female'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo introducir Révvi-EGS Group-Velopro';
  END IF;
  UPDATE public.teams
  SET "countryCode" = 'be'
  WHERE id = v_team_id AND gender = 'female' AND "teamKind" = 'club';
  INSERT INTO _pending_collective_team_rastreo_v2_created_teams
    VALUES ('Révvi-EGS Group-Velopro', v_team_id)
    ON CONFLICT (canonical_team_name) DO UPDATE SET team_id = EXCLUDED.team_id;

  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'kRRClsEOAXjGigmhHvFn', 'The Lead Out Cycling Academy', 'female'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo introducir The Lead Out Cycling Academy femenino';
  END IF;
  UPDATE public.teams
  SET "countryCode" = 'be'
  WHERE id = v_team_id AND gender = 'female' AND "teamKind" = 'club';
  INSERT INTO _pending_collective_team_rastreo_v2_created_teams
    VALUES ('The Lead Out Cycling Academy', v_team_id)
    ON CONFLICT (canonical_team_name) DO UPDATE SET team_id = EXCLUDED.team_id;

  SELECT r.team_id
  INTO v_team_id
  FROM public.ensure_startlist_team(
    'kRRClsEOAXjGigmhHvFn', 'WV Breda Women Cycling Team', 'female'
  ) r
  WHERE r.team_id IS NOT NULL
  LIMIT 1;
  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo introducir WV Breda Women Cycling Team';
  END IF;
  UPDATE public.teams
  SET "countryCode" = 'nl'
  WHERE id = v_team_id AND gender = 'female' AND "teamKind" = 'club';
  INSERT INTO _pending_collective_team_rastreo_v2_created_teams
    VALUES ('WV Breda Women Cycling Team', v_team_id)
    ON CONFLICT (canonical_team_name) DO UPDATE SET team_id = EXCLUDED.team_id;
END $$;

INSERT INTO private.pending_collective_team_rastreo_v2_20260830_backup
  (operation, entity, row_id, row_data)
SELECT
  'pending-collective-team-rastreo-v2-20260830',
  'teams',
  t.id,
  to_jsonb(t)
FROM public.teams t
JOIN _pending_collective_team_rastreo_v2_created_teams c ON c.team_id = t.id
ON CONFLICT (operation, entity, row_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _pending_collective_team_rastreo_v2_map m
    LEFT JOIN public.teams t
      ON t.name = m.canonical_team_name
     AND t.gender = m.gender
     AND t."specialEdition" IS NOT TRUE
    LEFT JOIN _pending_collective_team_rastreo_v2_created_teams c
      ON c.canonical_team_name = m.canonical_team_name
    GROUP BY m.race_id, m.raw_name
    HAVING count(DISTINCT t.id) <> 1
       AND count(DISTINCT c.team_id) <> 1
  ) THEN
    RAISE EXCEPTION 'El manifiesto v2 no tiene exactamente un equipo compatible por ocurrencia';
  END IF;
END $$;

INSERT INTO public.team_name_aliases (
  id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
)
SELECT DISTINCT ON (t.id, public.fold_team_name(m.raw_name))
  'tna_rastreo_v2_' || md5(t.id || '|' || public.fold_team_name(m.raw_name) || '|2026'),
  t.id,
  m.raw_name,
  public.fold_team_name(m.raw_name),
  2026,
  'official_collective_2026_v2',
  m.source_url,
  true
FROM _pending_collective_team_rastreo_v2_map m
LEFT JOIN _pending_collective_team_rastreo_v2_created_teams c
  ON c.canonical_team_name = m.canonical_team_name
JOIN public.teams t
  ON t.id = COALESCE(
    c.team_id,
    (
      SELECT t2.id
      FROM public.teams t2
      WHERE t2.name = m.canonical_team_name
        AND t2.gender = m.gender
        AND t2."specialEdition" IS NOT TRUE
      ORDER BY t2.id
      LIMIT 1
    )
  )
ORDER BY t.id, public.fold_team_name(m.raw_name), m.source_url
ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
  alias = EXCLUDED.alias,
  source = EXCLUDED.source,
  "sourceUrl" = EXCLUDED."sourceUrl",
  verified = EXCLUDED.verified,
  "updatedAt" = now();

UPDATE public.team_name_aliases a
SET source = 'official_collective_2026_v2',
    "sourceUrl" = m.source_url,
    verified = true,
    "updatedAt" = now()
FROM _pending_collective_team_rastreo_v2_map m
JOIN public.teams t
  ON t.name = m.canonical_team_name
 AND t.gender = m.gender
 AND t."specialEdition" IS NOT TRUE
WHERE a."teamId" = t.id
  AND a.year = 2026
  AND a."foldedName" = public.fold_team_name(m.canonical_team_name);

UPDATE public.startlist_teams st
SET "teamId" = c.team_id
FROM _pending_collective_team_rastreo_v2_created_teams c
WHERE st.id = '244bde14-5890-4a0b-93e4-0ef53b69d021'
  AND c.canonical_team_name = 'Aso Sololá-Intercop'
  AND st."teamId" IS NULL;

INSERT INTO public.team_name_aliases (
  id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
)
SELECT
  'tna_rastreo_v2_' || md5(c.team_id || '|asociacion de solola|2026'),
  c.team_id,
  'Asociación de Sololá',
  public.fold_team_name('Asociación de Sololá'),
  2026,
  'official_collective_2026_v2',
  'https://fedeciclismogua.org/asociaciones/asociacion-departamental-de-ciclismo-de-solola/',
  true
FROM _pending_collective_team_rastreo_v2_created_teams c
WHERE c.canonical_team_name = 'Aso Sololá-Intercop'
ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
  alias = EXCLUDED.alias,
  source = EXCLUDED.source,
  "sourceUrl" = EXCLUDED."sourceUrl",
  verified = EXCLUDED.verified,
  "updatedAt" = now();

UPDATE public.race_uci_results r
SET "teamId" = COALESCE(
  (
    SELECT c.team_id
    FROM _pending_collective_team_rastreo_v2_created_teams c
    WHERE c.canonical_team_name = m.canonical_team_name
  ),
  (
    SELECT t.id
    FROM public.teams t
    WHERE t.name = m.canonical_team_name
      AND t.gender = m.gender
      AND t."specialEdition" IS NOT TRUE
    ORDER BY t.id
    LIMIT 1
  )
)
FROM public.race_uci_stages s,
     _pending_collective_team_rastreo_v2_map m,
     private.pending_collective_team_rastreo_v2_20260830_backup b
WHERE s.id = r."stageRef"
  AND m.race_id = s."raceId"
  AND b.operation = 'pending-collective-team-rastreo-v2-20260830'
  AND b.entity = 'race_uci_results'
  AND b.row_id = r.id::text
  AND public.fold_team_name(m.raw_name) = public.fold_team_name(r."riderDisplay")
  AND r."teamId" IS NULL
  AND r."globalRiderId" IS NULL;

INSERT INTO public.team_link_decisions (
  id, "raceId", "occurrenceType", "occurrenceId", "rawName", "foldedName",
  "teamId", action, "matchMethod", source, "sourceUrl", year
)
SELECT
  'tld_' || md5('race_uci_result|' || r.id::text),
  s."raceId",
  'race_uci_result',
  r.id::text,
  r."riderDisplay",
  public.fold_team_name(r."riderDisplay"),
  r."teamId",
  CASE WHEN c.team_id IS NOT NULL THEN 'created' ELSE 'reused' END,
  'official_source_directed',
  'official_collective_2026_v2',
  m.source_url,
  2026
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN _pending_collective_team_rastreo_v2_map m
  ON m.race_id = s."raceId"
 AND public.fold_team_name(m.raw_name) = public.fold_team_name(r."riderDisplay")
JOIN private.pending_collective_team_rastreo_v2_20260830_backup b
  ON b.operation = 'pending-collective-team-rastreo-v2-20260830'
 AND b.entity = 'race_uci_results'
 AND b.row_id = r.id::text
LEFT JOIN _pending_collective_team_rastreo_v2_created_teams c
  ON c.team_id = r."teamId"
WHERE r."teamId" IS NOT NULL
  AND r."globalRiderId" IS NULL
ON CONFLICT ("occurrenceType", "occurrenceId") DO UPDATE SET
  "teamId" = EXCLUDED."teamId",
  action = EXCLUDED.action,
  "matchMethod" = EXCLUDED."matchMethod",
  source = EXCLUDED.source,
  "sourceUrl" = EXCLUDED."sourceUrl",
  year = EXCLUDED.year,
  "updatedAt" = now();

INSERT INTO public.team_link_decisions (
  id, "raceId", "occurrenceType", "occurrenceId", "rawName", "foldedName",
  "teamId", action, "matchMethod", source, "sourceUrl", year
)
SELECT
  'tld_' || md5('startlist_team|' || st.id),
  st."raceId",
  'startlist_team',
  st.id,
  st."teamName",
  public.fold_team_name(st."teamName"),
  st."teamId",
  'created',
  'official_source_directed',
  'official_collective_2026_v2',
  'https://fedeciclismogua.org/asociaciones/asociacion-departamental-de-ciclismo-de-solola/',
  2026
FROM public.startlist_teams st
WHERE st.id = '244bde14-5890-4a0b-93e4-0ef53b69d021'
  AND st."teamId" IS NOT NULL
ON CONFLICT ("occurrenceType", "occurrenceId") DO UPDATE SET
  "teamId" = EXCLUDED."teamId",
  action = EXCLUDED.action,
  "matchMethod" = EXCLUDED."matchMethod",
  source = EXCLUDED.source,
  "sourceUrl" = EXCLUDED."sourceUrl",
  year = EXCLUDED.year,
  "updatedAt" = now();

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.race_uci_results r
    JOIN private.pending_collective_team_rastreo_v2_20260830_backup b
      ON b.operation = 'pending-collective-team-rastreo-v2-20260830'
     AND b.entity = 'race_uci_results'
     AND b.row_id = r.id::text
    WHERE r."teamId" IS NOT NULL
  ) <> 39 THEN
    RAISE EXCEPTION 'La segunda pasada no ha enlazado las 39 filas respaldadas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.race_uci_results r
    JOIN private.pending_collective_team_rastreo_v2_20260830_backup b
      ON b.operation = 'pending-collective-team-rastreo-v2-20260830'
     AND b.entity = 'race_uci_results'
     AND b.row_id = r.id::text
    JOIN public.teams t ON t.id = r."teamId"
    WHERE r."globalRiderId" IS NOT NULL
       OR r.bib IS NOT NULL
       OR t.gender <> (
         SELECT rc.gender
         FROM public.race_uci_stages s
         JOIN public.races rc ON rc.id=s."raceId"
         WHERE s.id=r."stageRef"
       )
  ) THEN
    RAISE EXCEPTION 'La segunda pasada ha introducido una incompatibilidad de corredor, dorsal o sexo';
  END IF;
END $$;
