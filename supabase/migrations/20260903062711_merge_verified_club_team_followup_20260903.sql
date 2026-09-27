-- Segunda pasada de la auditoría de equipos de club duplicados.
-- La evidencia de organizadores, equipos y solapamiento de plantillas confirma
-- cuatro identidades adicionales que no se resolvieron por similitud nominal sola.

BEGIN;

CREATE TEMP TABLE _club_team_followup (
  old_id text PRIMARY KEY,
  old_name text NOT NULL,
  survivor_id text UNIQUE NOT NULL,
  canonical_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO _club_team_followup (old_id, old_name, survivor_id, canonical_name)
VALUES
  (
    'team_auto_c8988ec698228ea99c05fed4e35f8c0e',
    'Aegis Cycling Foundation',
    'team_auto_4572c6a2ba2356334c17fc8668474e53',
    'Aegis x Leaders of Enchantment'
  ),
  (
    'team_auto_25c8faa9c3b632887af86bff438b73cd',
    'Milton Women''s Pro Cycling Team',
    'team_auto_5cd0502e8063e2289294958b650a4be8',
    'Milton Revolution Women''s U23 Project'
  ),
  (
    'team_auto_088b66a06fbc2cf227915fc62c871525',
    'Québec en Vélo',
    'team_auto_32b4054d5fb2d35b278eedd2e0d0dea1',
    'Entreposage Bluebird Québec en Vélo'
  ),
  (
    'team_auto_fede540fe3ae70bcb32ba74e99b2f52e',
    'Team Wallonie',
    'team_auto_872d7e6c142e276a99c8c729d5c47fcb',
    'Team Wallonie Espoirs'
  );

CREATE TEMP TABLE _club_team_followup_affected ON COMMIT DROP AS
SELECT old_id AS team_id, survivor_id, canonical_name, true AS is_redundant
FROM _club_team_followup
UNION ALL
SELECT survivor_id, survivor_id, canonical_name, false
FROM _club_team_followup;

ALTER TABLE _club_team_followup_affected
  ADD PRIMARY KEY (team_id);

DO $preflight$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('private.repair_club_team_duplicates_20260903_backup') IS NULL THEN
    RAISE EXCEPTION 'Falta la tabla de backup de la primera pasada';
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_followup m
    JOIN public.teams t
      ON t.id = m.old_id
     AND t.name = m.old_name
     AND t.category IN ('CLUBM', 'CLUBW')
     AND t."specialEdition" = false
  ) <> 4 THEN
    RAISE EXCEPTION 'El preflight no encuentra los cuatro equipos redundantes auditados';
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_followup m
    JOIN public.teams t
      ON t.id = m.survivor_id
     AND t."specialEdition" = false
  ) <> 4 THEN
    RAISE EXCEPTION 'El preflight no encuentra los cuatro equipos canónicos';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _club_team_followup m
    JOIN public.teams old_team ON old_team.id = m.old_id
    JOIN public.teams survivor ON survivor.id = m.survivor_id
    WHERE old_team.gender IS DISTINCT FROM survivor.gender
  ) THEN
    RAISE EXCEPTION 'La segunda pasada contiene una fusión con género incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.startlist_teams st
    JOIN _club_team_followup_affected a ON a.team_id = st."teamId"
    GROUP BY st."raceId", a.survivor_id
    HAVING count(*) > 1 AND bool_or(a.is_redundant)
  ) THEN
    RAISE EXCEPTION 'Dos equipos del mismo grupo aparecen simultáneamente en una carrera';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_teams st
  JOIN _club_team_followup m ON m.old_id = st."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % referencias startlist redundantes; se esperaban 4', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_teams st
  JOIN _club_team_followup_affected a ON a.team_id = st."teamId";
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'El preflight encuentra % filas startlist afectadas; se esperaban 9', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_link_decisions d
  JOIN _club_team_followup m ON m.old_id = d."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % decisiones redundantes; se esperaban 4', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.race_uci_results r
  JOIN _club_team_followup m ON m.old_id = r."teamId";
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'El preflight encuentra % resultados redundantes; se esperaba 1', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_name_aliases a
  JOIN _club_team_followup m ON m.old_id = a."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % alias redundantes; se esperaban 4', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_seasons s
  JOIN _club_team_followup m ON m.old_id = s."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % temporadas redundantes; se esperaban 4', v_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rider_team_affiliations a
    JOIN _club_team_followup m ON m.old_id = a."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.riders_men r
    JOIN _club_team_followup m ON m.old_id = r."currentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.riders_women r
    JOIN _club_team_followup m ON m.old_id = r."currentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.rider_transfers r
    JOIN _club_team_followup m
      ON m.old_id = r."fromTeamId" OR m.old_id = r."toTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.teams child
    JOIN _club_team_followup m ON m.old_id = child."parentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.uci_team_rankings r
    JOIN _club_team_followup m ON m.old_id = r."teamId"
  ) THEN
    RAISE EXCEPTION 'El preflight detecta referencias no previstas fuera de startlists, decisiones y resultados';
  END IF;
END
$preflight$;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'manifest',
  m.old_id,
  'mapping',
  to_jsonb(m)
FROM _club_team_followup m
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'teams',
  t.id,
  CASE WHEN a.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(t)
FROM public.teams t
JOIN _club_team_followup_affected a ON a.team_id = t.id
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'team_seasons',
  s.id,
  CASE WHEN a.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(s)
FROM public.team_seasons s
JOIN _club_team_followup_affected a ON a.team_id = s."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'team_name_aliases',
  a.id,
  CASE WHEN af.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(a)
FROM public.team_name_aliases a
JOIN _club_team_followup_affected af ON af.team_id = a."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'startlist_teams',
  st.id,
  'update',
  to_jsonb(st)
FROM public.startlist_teams st
JOIN _club_team_followup_affected a ON a.team_id = st."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'team_link_decisions',
  d.id,
  'update',
  to_jsonb(d)
FROM public.team_link_decisions d
JOIN _club_team_followup_affected a ON a.team_id = d."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'race_uci_results',
  r.id::text,
  'update',
  to_jsonb(r)
FROM public.race_uci_results r
JOIN _club_team_followup m ON m.old_id = r."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

CREATE TEMP TABLE _club_team_followup_aliases ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    a.survivor_id,
    t.name AS alias,
    2026::smallint AS year,
    'club_team_merge_20260903'::text AS source,
    NULL::text AS source_url,
    false AS verified
  FROM _club_team_followup_affected a
  JOIN public.teams t ON t.id = a.team_id

  UNION ALL

  SELECT
    a.survivor_id,
    line.alias,
    2026::smallint,
    'club_team_merge_20260903',
    NULL::text,
    false
  FROM _club_team_followup_affected a
  JOIN public.teams t ON t.id = a.team_id
  CROSS JOIN LATERAL unnest(string_to_array(COALESCE(t."nameAliases", ''), E'\n')) AS line(alias)
  WHERE btrim(line.alias) <> ''

  UNION ALL

  SELECT
    af.survivor_id,
    a.alias,
    a.year,
    a.source,
    a."sourceUrl",
    a.verified
  FROM _club_team_followup_affected af
  JOIN public.team_name_aliases a ON a."teamId" = af.team_id

  UNION ALL

  SELECT
    m.survivor_id,
    m.canonical_name,
    2026::smallint,
    'club_team_merge_20260903',
    NULL::text,
    true
  FROM _club_team_followup m
),
ranked AS (
  SELECT
    survivor_id,
    btrim(alias) AS alias,
    public.fold_team_name(alias) AS folded_name,
    year,
    source,
    source_url,
    verified,
    row_number() OVER (
      PARTITION BY survivor_id, public.fold_team_name(alias), year
      ORDER BY verified DESC, (source_url IS NOT NULL) DESC, length(alias) DESC, alias
    ) AS priority
  FROM candidates
  WHERE btrim(alias) <> ''
    AND public.fold_team_name(alias) IS NOT NULL
)
SELECT survivor_id, alias, folded_name, year, source, source_url, verified
FROM ranked
WHERE priority = 1;

INSERT INTO public.team_name_aliases (
  id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
)
SELECT
  'tna_merge_' || md5(
    s.survivor_id || '|' || s.year::text || '|' || s.folded_name
  ),
  s.survivor_id,
  s.alias,
  s.folded_name,
  s.year,
  s.source,
  s.source_url,
  s.verified
FROM _club_team_followup_aliases s
ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
  alias = CASE
    WHEN public.team_name_aliases.verified AND NOT EXCLUDED.verified
      THEN public.team_name_aliases.alias
    ELSE EXCLUDED.alias
  END,
  source = CASE
    WHEN public.team_name_aliases.verified AND NOT EXCLUDED.verified
      THEN public.team_name_aliases.source
    ELSE EXCLUDED.source
  END,
  "sourceUrl" = CASE
    WHEN public.team_name_aliases.verified AND NOT EXCLUDED.verified
      THEN public.team_name_aliases."sourceUrl"
    ELSE COALESCE(EXCLUDED."sourceUrl", public.team_name_aliases."sourceUrl")
  END,
  verified = public.team_name_aliases.verified OR EXCLUDED.verified,
  "updatedAt" = now();

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-followup-20260903',
  'team_name_aliases_after',
  a.id,
  CASE WHEN before_alias.row_key IS NULL THEN 'created' ELSE 'updated' END,
  to_jsonb(a)
FROM public.team_name_aliases a
JOIN _club_team_followup m ON m.survivor_id = a."teamId"
LEFT JOIN private.repair_club_team_duplicates_20260903_backup before_alias
  ON before_alias.operation = 'merge-club-team-followup-20260903'
 AND before_alias.entity = 'team_name_aliases'
 AND before_alias.row_key = a.id
ON CONFLICT (operation, entity, row_key) DO NOTHING;

WITH aliases_by_team AS (
  SELECT
    s.survivor_id,
    string_agg(s.alias, E'\n' ORDER BY lower(s.alias), s.alias)
      FILTER (WHERE s.alias IS DISTINCT FROM m.canonical_name) AS name_aliases
  FROM _club_team_followup_aliases s
  JOIN _club_team_followup m ON m.survivor_id = s.survivor_id
  GROUP BY s.survivor_id
)
UPDATE public.teams t
SET
  name = m.canonical_name,
  "nameAliases" = NULLIF(a.name_aliases, ''),
  "updatedAt" = now()
FROM _club_team_followup m
JOIN aliases_by_team a ON a.survivor_id = m.survivor_id
WHERE t.id = m.survivor_id;

ALTER TABLE public.startlist_teams
  DISABLE TRIGGER auto_link_startlist_team_trg;

UPDATE public.startlist_teams st
SET
  "teamId" = a.survivor_id,
  "teamName" = a.canonical_name
FROM _club_team_followup_affected a
WHERE st."teamId" = a.team_id
  AND (
    st."teamId" IS DISTINCT FROM a.survivor_id
    OR st."teamName" IS DISTINCT FROM a.canonical_name
  );

ALTER TABLE public.startlist_teams
  ENABLE TRIGGER auto_link_startlist_team_trg;

UPDATE public.team_link_decisions d
SET
  "teamId" = m.survivor_id,
  "updatedAt" = now()
FROM _club_team_followup m
WHERE d."teamId" = m.old_id;

UPDATE public.race_uci_results r
SET "teamId" = m.survivor_id
FROM _club_team_followup m
WHERE r."teamId" = m.old_id;

DELETE FROM public.teams t
USING _club_team_followup m
WHERE t.id = m.old_id;

DO $verify$
DECLARE
  v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.teams t
    JOIN _club_team_followup m ON m.old_id = t.id
  ) OR EXISTS (
    SELECT 1 FROM public.startlist_teams st
    JOIN _club_team_followup m ON m.old_id = st."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.team_link_decisions d
    JOIN _club_team_followup m ON m.old_id = d."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.race_uci_results r
    JOIN _club_team_followup m ON m.old_id = r."teamId"
  ) THEN
    RAISE EXCEPTION 'Persisten equipos o referencias redundantes de la segunda pasada';
  END IF;

  SELECT count(*) INTO v_count
  FROM private.repair_club_team_duplicates_20260903_backup b
  JOIN public.startlist_teams st ON st.id = b.row_key
  JOIN _club_team_followup_affected a ON a.team_id = b.row_data ->> 'teamId'
  WHERE b.operation = 'merge-club-team-followup-20260903'
    AND b.entity = 'startlist_teams'
    AND st."teamId" = a.survivor_id
    AND st."teamName" = a.canonical_name;
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'Solo % de las nueve filas startlist quedaron normalizadas', v_count;
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_followup m
    JOIN public.teams t
      ON t.id = m.survivor_id
     AND t.name = m.canonical_name
  ) <> 4 THEN
    RAISE EXCEPTION 'No quedaron normalizados los cuatro nombres canónicos';
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_followup m
    JOIN public.team_seasons s
      ON s."teamId" = m.survivor_id
     AND s.year = 2026
     AND s.name = m.canonical_name
  ) <> 4 THEN
    RAISE EXCEPTION 'No quedaron normalizadas las cuatro temporadas de 2026';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _club_team_followup m
    JOIN public.teams t ON t.id = m.survivor_id
    WHERE NOT (public.fold_team_name(m.old_name) = ANY(t."foldedNames"))
  ) THEN
    RAISE EXCEPTION 'Algún nombre redundante de la segunda pasada no quedó preservado';
  END IF;

  IF (
    SELECT count(*)
    FROM private.repair_club_team_duplicates_20260903_backup
    WHERE operation = 'merge-club-team-followup-20260903'
      AND entity = 'manifest'
  ) <> 4 THEN
    RAISE EXCEPTION 'El backup no contiene las cuatro filas del manifiesto adicional';
  END IF;
END
$verify$;

COMMIT;
