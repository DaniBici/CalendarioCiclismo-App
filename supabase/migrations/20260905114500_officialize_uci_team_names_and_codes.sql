-- Adopta para 2026 las denominaciones y códigos de la última captura UCI
-- completa, vinculada y revisada. Los nombres anteriores se conservan como
-- aliases para no degradar la resolución de fuentes históricas.

ALTER TABLE public.team_seasons
  ADD COLUMN "uciCode" text;

ALTER TABLE public.team_seasons
  ADD CONSTRAINT team_seasons_uci_code_format
  CHECK (
    "uciCode" IS NULL
    OR (char_length("uciCode") = 3 AND "uciCode" !~ '[[:space:]]')
  );

COMMENT ON COLUMN public.team_seasons."uciCode" IS
  'Código UCI oficial de tres caracteres para esta temporada; puede repetirse entre géneros o entidades.';

CREATE TABLE private.uci_team_officialization_20260905_backup (
  team_id text PRIMARY KEY,
  season integer NOT NULL,
  uci_profile text NOT NULL,
  source_run_id uuid NOT NULL,
  source_observed_at timestamptz NOT NULL,
  official_name text NOT NULL,
  official_code text NOT NULL,
  teams_row jsonb NOT NULL,
  team_season_row jsonb NOT NULL,
  catalog_link_row jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.uci_team_officialization_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.uci_team_officialization_20260905_backup
  TO service_role;

CREATE TEMP TABLE uci_team_officialization_targets
ON COMMIT DROP
AS
WITH latest AS (
  SELECT id, observed_at, snapshot
  FROM private.uci_catalog_runs
  WHERE status = 'success'
    AND snapshot IS NOT NULL
    AND snapshot->>'year' = '2026'
    AND snapshot->>'complete' = 'true'
  ORDER BY observed_at DESC
  LIMIT 1
), official AS (
  SELECT
    e.key AS profile,
    btrim(regexp_replace(e.value->>'name', '[[:space:]]+', ' ', 'g')) AS official_name,
    e.value->>'code' AS official_code,
    e.value->>'category' AS official_category,
    e.value->>'gender' AS official_gender
  FROM latest
  CROSS JOIN LATERAL jsonb_each(latest.snapshot->'teams') AS e
)
SELECT
  l.team_id,
  l.season,
  o.profile,
  latest.id AS source_run_id,
  latest.observed_at AS source_observed_at,
  o.official_name,
  o.official_code,
  o.official_category,
  o.official_gender
FROM latest
CROSS JOIN official o
JOIN private.uci_catalog_team_links l
  ON l.season = 2026
 AND l.profile = o.profile;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM uci_team_officialization_targets;
  IF v_count <> 277 THEN
    RAISE EXCEPTION 'Catálogo UCI incompleto: esperados 277 equipos, obtenidos %', v_count;
  END IF;

  SELECT count(DISTINCT team_id) INTO v_count
  FROM uci_team_officialization_targets;
  IF v_count <> 277 THEN
    RAISE EXCEPTION 'El mapa UCI no es uno a uno: % entidades distintas', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uci_team_officialization_targets
    WHERE official_name IS NULL
       OR official_name = ''
       OR official_code IS NULL
       OR char_length(official_code) <> 3
       OR official_code ~ '[[:space:]]'
  ) THEN
    RAISE EXCEPTION 'La fuente contiene nombres o códigos UCI incompatibles';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uci_team_officialization_targets x
    JOIN private.uci_catalog_team_links l
      ON l.season = x.season
     AND l.profile = x.profile
    WHERE l.team_id IS DISTINCT FROM x.team_id
       OR l.source_code IS DISTINCT FROM x.official_code
       OR l.category IS DISTINCT FROM x.official_category
       OR l.gender IS DISTINCT FROM x.official_gender
  ) THEN
    RAISE EXCEPTION 'El mapa revisado ya no coincide con la captura oficial';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uci_team_officialization_targets x
    LEFT JOIN public.teams t ON t.id = x.team_id
    LEFT JOIN public.team_seasons s
      ON s."teamId" = x.team_id
     AND s.year = x.season
    WHERE t.id IS NULL
       OR s.id IS NULL
       OR t."specialEdition" IS TRUE
  ) THEN
    RAISE EXCEPTION 'Falta una entidad/temporada vinculada o el vínculo apunta a una edición especial';
  END IF;
END $$;

INSERT INTO private.uci_team_officialization_20260905_backup (
  team_id,
  season,
  uci_profile,
  source_run_id,
  source_observed_at,
  official_name,
  official_code,
  teams_row,
  team_season_row,
  catalog_link_row
)
SELECT
  x.team_id,
  x.season,
  x.profile,
  x.source_run_id,
  x.source_observed_at,
  x.official_name,
  x.official_code,
  to_jsonb(t),
  to_jsonb(s),
  to_jsonb(l)
FROM uci_team_officialization_targets x
JOIN public.teams t ON t.id = x.team_id
JOIN public.team_seasons s
  ON s."teamId" = x.team_id
 AND s.year = x.season
JOIN private.uci_catalog_team_links l
  ON l.season = x.season
 AND l.profile = x.profile;

UPDATE public.teams t
SET
  "nameAliases" = CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM regexp_split_to_table(COALESCE(t."nameAliases", ''), E'\n') AS a(alias)
      WHERE btrim(a.alias) = t.name
    )
      THEN concat_ws(E'\n', NULLIF(btrim(t."nameAliases"), ''), t.name)
    ELSE t."nameAliases"
  END,
  name = x.official_name,
  "updatedAt" = now()
FROM uci_team_officialization_targets x
WHERE t.id = x.team_id
  AND t.name IS DISTINCT FROM x.official_name;

UPDATE public.team_seasons s
SET
  name = t.name,
  "nameAliases" = t."nameAliases",
  "uciCode" = x.official_code,
  "updatedAt" = now()
FROM uci_team_officialization_targets x
JOIN public.teams t ON t.id = x.team_id
WHERE s."teamId" = x.team_id
  AND s.year = x.season
  AND (s.name, s."nameAliases", s."uciCode")
      IS DISTINCT FROM (t.name, t."nameAliases", x.official_code);

UPDATE private.uci_catalog_team_links l
SET
  source_name = x.official_name,
  source_code = x.official_code
FROM uci_team_officialization_targets x
WHERE l.season = x.season
  AND l.profile = x.profile
  AND (l.source_name, l.source_code)
      IS DISTINCT FROM (x.official_name, x.official_code);

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM private.uci_team_officialization_20260905_backup;
  IF v_count <> 277 THEN
    RAISE EXCEPTION 'Backup incompleto: esperadas 277 filas, obtenidas %', v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM uci_team_officialization_targets x
    JOIN public.teams t ON t.id = x.team_id
    JOIN public.team_seasons s
      ON s."teamId" = x.team_id
     AND s.year = x.season
    JOIN private.uci_catalog_team_links l
      ON l.season = x.season
     AND l.profile = x.profile
    WHERE t.name IS DISTINCT FROM x.official_name
       OR s.name IS DISTINCT FROM x.official_name
       OR s."uciCode" IS DISTINCT FROM x.official_code
       OR l.source_name IS DISTINCT FROM x.official_name
       OR l.source_code IS DISTINCT FROM x.official_code
       OR NOT (public.fold_team_name(x.official_name) = ANY(t."foldedNames"))
  ) THEN
    RAISE EXCEPTION 'La comprobación posterior de nombres, códigos o aliases ha fallado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.uci_team_officialization_20260905_backup b
    JOIN public.teams t ON t.id = b.team_id
    WHERE b.teams_row->>'name' IS DISTINCT FROM t.name
      AND NOT EXISTS (
        SELECT 1
        FROM regexp_split_to_table(COALESCE(t."nameAliases", ''), E'\n') AS a(alias)
        WHERE btrim(a.alias) = b.teams_row->>'name'
      )
  ) THEN
    RAISE EXCEPTION 'Alguna denominación canónica anterior no quedó preservada como alias';
  END IF;
END $$;
