-- Decisiones manuales posteriores a la auditoría de equipos de club de 2026.
-- BIKE AID e.V. y BIKE AID Südliche Weinstraße se consolidan en Bike Aid (CT).
-- Minimax WB Cycling Team se consolida en Minimax (CTW).
-- Las filas que coaparecen en campeonatos nacionales se agrupan bajo el bloque UCI
-- existente de la misma carrera y conservan todos sus corredores.

BEGIN;

CREATE TABLE private.repair_club_team_manual_decisions_20260903_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_key text NOT NULL,
  change_kind text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (operation, entity, row_key)
);

COMMENT ON TABLE private.repair_club_team_manual_decisions_20260903_backup IS
  'Backup recuperable de las fusiones manuales de BIKE AID y Minimax del 2026-09-03.';

ALTER TABLE private.repair_club_team_manual_decisions_20260903_backup
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.repair_club_team_manual_decisions_20260903_backup
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT
  ON TABLE private.repair_club_team_manual_decisions_20260903_backup
  TO service_role;

CREATE TEMP TABLE _manual_club_team_merge (
  old_id text PRIMARY KEY,
  old_name text NOT NULL,
  old_category text NOT NULL,
  survivor_id text NOT NULL,
  canonical_name text NOT NULL,
  survivor_category text NOT NULL
) ON COMMIT DROP;

INSERT INTO _manual_club_team_merge (
  old_id,
  old_name,
  old_category,
  survivor_id,
  canonical_name,
  survivor_category
)
VALUES
  (
    'team_auto_23def0ee0976f51eff36e30b8353914d',
    'BIKE AID e.V.',
    'CLUBM',
    'team_1777987227167_2bmfik',
    'Bike Aid',
    'CT'
  ),
  (
    'team_auto_7a31d9ccd7d23f8f64175814fdfc11b8',
    'BIKE AID Südliche Weinstraße',
    'CLUBM',
    'team_1777987227167_2bmfik',
    'Bike Aid',
    'CT'
  ),
  (
    'team_auto_f7b0e7c58e63fc5be55e7e22ee2560b0',
    'Minimax WB Cycling Team',
    'CLUBW',
    'team_1776750364347_a9iydp',
    'Minimax',
    'CTW'
  );

CREATE TEMP TABLE _manual_club_team_survivors ON COMMIT DROP AS
SELECT DISTINCT survivor_id, canonical_name, survivor_category
FROM _manual_club_team_merge;

ALTER TABLE _manual_club_team_survivors
  ADD PRIMARY KEY (survivor_id);

CREATE TEMP TABLE _manual_club_team_affected ON COMMIT DROP AS
SELECT
  old_id AS team_id,
  survivor_id,
  canonical_name,
  true AS is_redundant
FROM _manual_club_team_merge
UNION ALL
SELECT
  survivor_id,
  survivor_id,
  canonical_name,
  false
FROM _manual_club_team_survivors;

ALTER TABLE _manual_club_team_affected
  ADD PRIMARY KEY (team_id);

CREATE TEMP TABLE _manual_startlist_collision_plan (
  old_startlist_team_id text PRIMARY KEY,
  target_startlist_team_id text NOT NULL,
  race_id text NOT NULL,
  old_catalog_team_id text NOT NULL,
  survivor_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO _manual_startlist_collision_plan (
  old_startlist_team_id,
  target_startlist_team_id,
  race_id,
  old_catalog_team_id,
  survivor_id
)
VALUES
  (
    'df9b40a4-2940-40b5-b900-c5578b63b2b3',
    '3f35cbd1-263e-4f71-b4a9-4e8334764378',
    'fc92517f-6904-4733-bdb6-2548dace9c48',
    'team_auto_23def0ee0976f51eff36e30b8353914d',
    'team_1777987227167_2bmfik'
  ),
  (
    'ea71cdef-01a6-489a-916a-62332daeafe0',
    '3f35cbd1-263e-4f71-b4a9-4e8334764378',
    'fc92517f-6904-4733-bdb6-2548dace9c48',
    'team_auto_7a31d9ccd7d23f8f64175814fdfc11b8',
    'team_1777987227167_2bmfik'
  ),
  (
    '4073f0f9-b4d8-40c1-a489-d1f1d9180bc6',
    '18fc042f-e83e-4440-91f7-1e371ce6bcea',
    '6fcb3a0c-ca3c-4ecb-a71b-3592e9356844',
    'team_auto_f7b0e7c58e63fc5be55e7e22ee2560b0',
    'team_1776750364347_a9iydp'
  );

CREATE TEMP TABLE _manual_startlist_standalone_plan (
  startlist_team_id text PRIMARY KEY,
  race_id text NOT NULL,
  old_catalog_team_id text NOT NULL,
  survivor_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO _manual_startlist_standalone_plan (
  startlist_team_id,
  race_id,
  old_catalog_team_id,
  survivor_id
)
VALUES (
  'd7d312ae-db63-4918-9bd6-4cc359e1bd44',
  '478d26e2-4836-4e25-b7b8-1981c3ad98d2',
  'team_auto_f7b0e7c58e63fc5be55e7e22ee2560b0',
  'team_1776750364347_a9iydp'
);

DO $preflight$
DECLARE
  v_count integer;
BEGIN
  IF (
    SELECT count(*)
    FROM _manual_club_team_merge m
    JOIN public.teams t
      ON t.id = m.old_id
     AND t.name = m.old_name
     AND t.category = m.old_category
     AND t."specialEdition" = false
  ) <> 3 THEN
    RAISE EXCEPTION 'El preflight no encuentra los tres equipos de club auditados';
  END IF;

  IF (
    SELECT count(*)
    FROM _manual_club_team_survivors s
    JOIN public.teams t
      ON t.id = s.survivor_id
     AND t.name = s.canonical_name
     AND t.category = s.survivor_category
     AND t."specialEdition" = false
  ) <> 2 THEN
    RAISE EXCEPTION 'El preflight no encuentra los dos equipos UCI supervivientes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _manual_club_team_merge m
    JOIN public.teams old_team ON old_team.id = m.old_id
    JOIN public.teams survivor ON survivor.id = m.survivor_id
    WHERE old_team.gender IS DISTINCT FROM survivor.gender
  ) THEN
    RAISE EXCEPTION 'El manifiesto contiene una fusión con género incompatible';
  END IF;

  SELECT count(*) INTO v_count
  FROM _manual_startlist_collision_plan p
  JOIN public.startlist_teams old_st
    ON old_st.id = p.old_startlist_team_id
   AND old_st."raceId" = p.race_id
   AND old_st."teamId" = p.old_catalog_team_id
  JOIN public.startlist_teams target_st
    ON target_st.id = p.target_startlist_team_id
   AND target_st."raceId" = p.race_id
   AND target_st."teamId" = p.survivor_id;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'El preflight no valida los tres bloques de startlist solapados';
  END IF;

  SELECT count(*) INTO v_count
  FROM _manual_startlist_standalone_plan p
  JOIN public.startlist_teams st
    ON st.id = p.startlist_team_id
   AND st."raceId" = p.race_id
   AND st."teamId" = p.old_catalog_team_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'El preflight no valida el bloque independiente de Minimax';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_teams st
  JOIN _manual_club_team_merge m ON m.old_id = st."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % bloques startlist redundantes; se esperaban 4', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_teams st
  JOIN _manual_club_team_affected a ON a.team_id = st."teamId";
  IF v_count <> 66 THEN
    RAISE EXCEPTION 'El preflight encuentra % bloques startlist afectados; se esperaban 66', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_riders sr
  JOIN public.startlist_teams st ON st.id = sr."teamId"
  JOIN _manual_club_team_merge m ON m.old_id = st."teamId";
  IF v_count <> 12 THEN
    RAISE EXCEPTION 'El preflight encuentra % corredores en bloques redundantes; se esperaban 12', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_riders sr
  JOIN _manual_startlist_collision_plan p
    ON p.old_startlist_team_id = sr."teamId";
  IF v_count <> 11 THEN
    RAISE EXCEPTION 'El preflight encuentra % corredores que deben reagruparse; se esperaban 11', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.start_order_entries soe
    JOIN public.startlist_riders sr ON sr.id = soe."riderId"
    JOIN _manual_startlist_collision_plan p
      ON p.old_startlist_team_id = sr."teamId"
  ) THEN
    RAISE EXCEPTION 'Existen entradas de orden de salida dependientes de los corredores que se reagruparán';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_link_decisions d
  JOIN _manual_club_team_merge m ON m.old_id = d."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % decisiones redundantes; se esperaban 4', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_name_aliases a
  JOIN _manual_club_team_merge m ON m.old_id = a."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % alias redundantes; se esperaban 4', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_seasons s
  JOIN _manual_club_team_merge m ON m.old_id = s."teamId";
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'El preflight encuentra % temporadas redundantes; se esperaban 3', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.team_name_aliases old_alias
    JOIN _manual_club_team_merge m ON m.old_id = old_alias."teamId"
    JOIN public.team_name_aliases survivor_alias
      ON survivor_alias."teamId" = m.survivor_id
     AND survivor_alias."foldedName" = old_alias."foldedName"
     AND survivor_alias.year = old_alias.year
  ) THEN
    RAISE EXCEPTION 'Existe una colisión de alias entre una ficha redundante y su equipo UCI';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rider_team_affiliations a
    JOIN _manual_club_team_merge m ON m.old_id = a."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.riders_men r
    JOIN _manual_club_team_merge m ON m.old_id = r."currentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.riders_women r
    JOIN _manual_club_team_merge m ON m.old_id = r."currentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.rider_transfers r
    JOIN _manual_club_team_merge m
      ON m.old_id = r."fromTeamId" OR m.old_id = r."toTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.teams child
    JOIN _manual_club_team_merge m ON m.old_id = child."parentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.uci_team_rankings r
    JOIN _manual_club_team_merge m ON m.old_id = r."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.race_uci_results r
    JOIN _manual_club_team_merge m ON m.old_id = r."teamId"
  ) THEN
    RAISE EXCEPTION 'El preflight detecta referencias no previstas fuera de startlists y decisiones';
  END IF;
END
$preflight$;

INSERT INTO private.repair_club_team_manual_decisions_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-user-decisions-20260903',
  'manifest',
  m.old_id,
  'mapping',
  to_jsonb(m)
FROM _manual_club_team_merge m;

INSERT INTO private.repair_club_team_manual_decisions_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-user-decisions-20260903',
  'teams',
  t.id,
  CASE WHEN a.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(t)
FROM public.teams t
JOIN _manual_club_team_affected a ON a.team_id = t.id;

INSERT INTO private.repair_club_team_manual_decisions_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-user-decisions-20260903',
  'team_seasons',
  s.id,
  CASE WHEN a.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(s)
FROM public.team_seasons s
JOIN _manual_club_team_affected a ON a.team_id = s."teamId";

INSERT INTO private.repair_club_team_manual_decisions_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-user-decisions-20260903',
  'team_name_aliases',
  a.id,
  CASE WHEN af.is_redundant THEN 'update' ELSE 'unchanged' END,
  to_jsonb(a)
FROM public.team_name_aliases a
JOIN _manual_club_team_affected af ON af.team_id = a."teamId";

INSERT INTO private.repair_club_team_manual_decisions_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-user-decisions-20260903',
  'startlist_teams',
  st.id,
  CASE
    WHEN p.old_startlist_team_id IS NOT NULL THEN 'delete'
    ELSE 'update'
  END,
  to_jsonb(st)
FROM public.startlist_teams st
JOIN _manual_club_team_affected a ON a.team_id = st."teamId"
LEFT JOIN _manual_startlist_collision_plan p
  ON p.old_startlist_team_id = st.id;

INSERT INTO private.repair_club_team_manual_decisions_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-user-decisions-20260903',
  'startlist_riders',
  sr.id,
  'update',
  to_jsonb(sr)
FROM public.startlist_riders sr
JOIN _manual_startlist_collision_plan p
  ON p.old_startlist_team_id = sr."teamId";

INSERT INTO private.repair_club_team_manual_decisions_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-user-decisions-20260903',
  'team_link_decisions',
  d.id,
  'update',
  to_jsonb(d)
FROM public.team_link_decisions d
JOIN _manual_club_team_merge m ON m.old_id = d."teamId";

UPDATE public.team_name_aliases a
SET "teamId" = m.survivor_id
FROM _manual_club_team_merge m
WHERE a."teamId" = m.old_id;

WITH distinct_aliases AS (
  SELECT DISTINCT
    s.survivor_id,
    s.canonical_name,
    a.alias
  FROM _manual_club_team_survivors s
  JOIN public.team_name_aliases a ON a."teamId" = s.survivor_id
  WHERE public.fold_team_name(a.alias)
    IS DISTINCT FROM public.fold_team_name(s.canonical_name)
),
aliases_by_team AS (
  SELECT
    survivor_id,
    string_agg(alias, E'\n' ORDER BY lower(alias), alias) AS name_aliases
  FROM distinct_aliases
  GROUP BY survivor_id
)
UPDATE public.teams t
SET
  "nameAliases" = NULLIF(a.name_aliases, ''),
  "updatedAt" = now()
FROM aliases_by_team a
WHERE t.id = a.survivor_id;

UPDATE public.team_link_decisions d
SET
  "teamId" = m.survivor_id,
  "updatedAt" = now()
FROM _manual_club_team_merge m
WHERE d."teamId" = m.old_id;

UPDATE public.startlist_riders sr
SET "teamId" = p.target_startlist_team_id
FROM _manual_startlist_collision_plan p
WHERE sr."teamId" = p.old_startlist_team_id;

DELETE FROM public.startlist_teams st
USING _manual_startlist_collision_plan p
WHERE st.id = p.old_startlist_team_id;

ALTER TABLE public.startlist_teams
  DISABLE TRIGGER auto_link_startlist_team_trg;

UPDATE public.startlist_teams st
SET
  "teamId" = m.survivor_id,
  "teamName" = m.canonical_name
FROM _manual_club_team_merge m
WHERE st."teamId" = m.old_id;

UPDATE public.startlist_teams st
SET "teamName" = s.canonical_name
FROM _manual_club_team_survivors s
WHERE st."teamId" = s.survivor_id
  AND st."teamName" IS DISTINCT FROM s.canonical_name;

ALTER TABLE public.startlist_teams
  ENABLE TRIGGER auto_link_startlist_team_trg;

DELETE FROM public.teams t
USING _manual_club_team_merge m
WHERE t.id = m.old_id;

DO $verify$
DECLARE
  v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.teams t
    JOIN _manual_club_team_merge m ON m.old_id = t.id
  ) OR EXISTS (
    SELECT 1 FROM public.startlist_teams st
    JOIN _manual_club_team_merge m ON m.old_id = st."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.team_link_decisions d
    JOIN _manual_club_team_merge m ON m.old_id = d."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.team_name_aliases a
    JOIN _manual_club_team_merge m ON m.old_id = a."teamId"
  ) THEN
    RAISE EXCEPTION 'Persisten equipos o referencias redundantes de la reparación manual';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.startlist_teams st
    JOIN _manual_club_team_survivors s ON s.survivor_id = st."teamId"
    WHERE st."teamName" IS DISTINCT FROM s.canonical_name
  ) THEN
    RAISE EXCEPTION 'Alguna startlist de BIKE AID o Minimax conserva un nombre no canónico';
  END IF;

  IF (
    SELECT count(*)
    FROM public.startlist_teams
    WHERE "teamId" = 'team_1777987227167_2bmfik'
  ) <> 25 THEN
    RAISE EXCEPTION 'BIKE AID no conserva las 25 participaciones esperadas';
  END IF;

  IF (
    SELECT count(*)
    FROM public.startlist_riders sr
    JOIN public.startlist_teams st ON st.id = sr."teamId"
    WHERE st."teamId" = 'team_1777987227167_2bmfik'
  ) <> 151 THEN
    RAISE EXCEPTION 'BIKE AID no conserva los 151 corredores de startlist esperados';
  END IF;

  IF (
    SELECT count(*)
    FROM public.startlist_teams
    WHERE "teamId" = 'team_1776750364347_a9iydp'
  ) <> 38 THEN
    RAISE EXCEPTION 'Minimax no conserva las 38 participaciones esperadas';
  END IF;

  IF (
    SELECT count(*)
    FROM public.startlist_riders sr
    JOIN public.startlist_teams st ON st.id = sr."teamId"
    WHERE st."teamId" = 'team_1776750364347_a9iydp'
  ) <> 218 THEN
    RAISE EXCEPTION 'Minimax no conserva los 218 corredores de startlist esperados';
  END IF;

  IF (
    SELECT count(*)
    FROM public.startlist_riders
    WHERE "teamId" = '3f35cbd1-263e-4f71-b4a9-4e8334764378'
  ) <> 12 THEN
    RAISE EXCEPTION 'El bloque de BIKE AID del Campeonato de Alemania no contiene 12 corredores';
  END IF;

  IF (
    SELECT count(*)
    FROM public.startlist_riders
    WHERE "teamId" = '18fc042f-e83e-4440-91f7-1e371ce6bcea'
  ) <> 8 THEN
    RAISE EXCEPTION 'El bloque de Minimax del Campeonato de Bélgica no contiene 8 corredoras';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.startlist_teams st
    JOIN public.startlist_riders sr ON sr."teamId" = st.id
    WHERE st."teamId" IN (
      'team_1777987227167_2bmfik',
      'team_1776750364347_a9iydp'
    )
      AND sr."globalRiderId" IS NOT NULL
    GROUP BY st."raceId", st."teamId", sr."globalRiderId"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'La consolidación ha creado corredores duplicados dentro de una carrera';
  END IF;

  IF (
    SELECT count(*)
    FROM _manual_club_team_merge m
    JOIN public.teams t ON t.id = m.survivor_id
    WHERE public.fold_team_name(m.old_name) = ANY(t."foldedNames")
  ) <> 3 THEN
    RAISE EXCEPTION 'Algún nombre retirado no quedó preservado como alias';
  END IF;

  SELECT count(*) INTO v_count
  FROM private.repair_club_team_manual_decisions_20260903_backup
  WHERE operation = 'merge-club-team-user-decisions-20260903'
    AND entity = 'manifest';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'El backup no contiene las tres filas del manifiesto';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.startlist_riders sr
    LEFT JOIN public.startlist_teams st ON st.id = sr."teamId"
    WHERE st.id IS NULL
  ) THEN
    RAISE EXCEPTION 'La reparación ha dejado corredores con equipo de startlist colgante';
  END IF;
END
$verify$;

COMMIT;
