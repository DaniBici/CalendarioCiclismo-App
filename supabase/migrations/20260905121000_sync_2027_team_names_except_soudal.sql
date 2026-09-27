-- Sincroniza los nombres visibles de 2027 y de las ediciones especiales con
-- las denominaciones canónicas curadas para 2026. Soudal Safety Jogger conserva
-- su nombre específico de 2027.

CREATE TABLE private.team_season_2027_name_sync_20260905_backup (
  team_id text PRIMARY KEY,
  expected_name text NOT NULL,
  desired_name text NOT NULL,
  team_season_row jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.team_season_2027_name_sync_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.team_season_2027_name_sync_20260905_backup
  TO service_role;

CREATE TABLE private.special_edition_team_name_sync_20260905_backup (
  team_id text PRIMARY KEY,
  parent_team_id text NOT NULL,
  expected_name text NOT NULL,
  desired_name text NOT NULL,
  teams_row jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE private.special_edition_team_name_sync_20260905_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.special_edition_team_name_sync_20260905_backup
  TO service_role;

CREATE TEMP TABLE team_season_2027_name_targets (
  team_id text PRIMARY KEY,
  expected_name text NOT NULL,
  desired_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO team_season_2027_name_targets (
  team_id,
  expected_name,
  desired_name
) VALUES
  ('team_1776702163218_ebmy3d', 'Movistar', 'Movistar Team'),
  ('team_1776702578134_2wdzno', 'Visma | Lease a Bike', 'Team Visma | Lease a Bike'),
  ('team_1776702951716_ezxsdy', 'UAE Team Emirates-XRG', 'UAE Team Emirates XRG'),
  ('team_1776703052816_uexbsk', 'Red Bull-BORA-hansgrohe', 'Red Bull - BORA - hansgrohe'),
  ('team_1776703256882_74u3ve', 'Decathlon CMA CGM', 'Decathlon CMA CGM Team'),
  ('team_1776703309015_k4ixyq', 'EF Education-EasyPost', 'EF Education - EasyPost'),
  ('team_1776703625379_kbsull', 'NSN', 'NSN Cycling Team'),
  ('team_1776703840961_zz7puu', 'Jayco Alula', 'Team Jayco AlUla'),
  ('team_1776703895660_c8mgkk', 'Picnic PostNL', 'Team Picnic PostNL'),
  ('team_1776704087509_e6azyq', 'XDS Astana', 'XDS Astana Team'),
  ('team_1776704474025_wuq3wr', 'Pinarello-Q36.5', 'Pinarello-Q36.5 Pro Cycling Team'),
  ('team_1776704584941_aeypqm', 'Tudor', 'Tudor Pro Cycling Team'),
  ('team_1776705783470_ii0i0m', 'Polti VisitMalta', 'Team Polti VisitMalta'),
  ('team_1776714278457_r96u02', 'Kern Pharma', 'Equipo Kern Pharma'),
  ('team_1776714380056_7kzbtn', 'Burgos Burpellet BH', 'Burgos-Burpellet-BH'),
  ('team_1776714541189_3v5tpl', 'Novo Nordisk', 'Team Novo Nordisk'),
  ('team_1776714655588_6ae9cr', 'AG Insurance-Soudal', 'AG Insurance - Soudal Team'),
  ('team_1776714955304_ng13hf', 'EF Education-Oatly', 'EF Education - Oatly'),
  ('team_1776715017170_w96ftz', 'FDJ United-SUEZ', 'FDJ United - SUEZ'),
  ('team_1776715134951_nufhxh', 'Liv AlUla Jayco', 'Liv-AlUla-Jayco'),
  ('team_1776715284567_76xqkf', 'SD Worx-Protime', 'Team SD Worx - Protime'),
  ('team_1776715516916_9d8gwc', 'Laboral Kutxa-Euskadi', 'Laboral Kutxa - Fundacion Euskadi'),
  ('team_1776715791581_5z1fd7', 'VolkerWessels', 'VolkerWessels Cycling Team'),
  ('team_1776750124382_p457m5', 'Modern Adventure', 'Modern Adventure Pro Cycling'),
  ('team_47f82f2c644743bd', 'Lotto Intermarché', 'Lotto Intermarche Ladies'),
  ('team_52caa8d69d274529', 'Cofidis', 'Cofidis Women Team'),
  ('team_devo_movistar', 'Movistar Academy', 'Movistar Team Academy'),
  ('team_female_lidl_trek', 'Lidl-Trek', 'Lidl - Trek'),
  ('team_female_movistar', 'Movistar', 'Movistar Team'),
  ('team_female_picnic_postnl', 'Picnic PostNL', 'Team Picnic PostNL'),
  ('team_female_st_michel_auber93', 'St Michel-Preference Home-Auber 93', 'St Michel - Preference Home - Auber93'),
  ('team_female_visma', 'Visma | Lease a Bike', 'Team Visma | Lease a Bike');

CREATE TEMP TABLE special_edition_team_name_targets (
  team_id text PRIMARY KEY,
  parent_team_id text NOT NULL,
  expected_name text NOT NULL,
  desired_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO special_edition_team_name_targets (
  team_id,
  parent_team_id,
  expected_name,
  desired_name
) VALUES
  ('team_1777914109731_q6z1ve', 'team_1776703309015_k4ixyq', 'EF Education-EasyPost', 'EF Education - EasyPost'),
  ('team_fdj_united_suez_tdf_femmes_2026', 'team_1776715017170_w96ftz', 'FDJ United-SUEZ', 'FDJ United - SUEZ'),
  ('team_f936baf7eb1f4abe', 'team_47f82f2c644743bd', 'Lotto Intermarché', 'Lotto Intermarche Ladies'),
  ('team_1782732531101_z1nsiu', 'team_1776702163218_ebmy3d', 'Movistar', 'Movistar Team'),
  ('team_1787073923785_drtqah', 'team_1776702163218_ebmy3d', 'Movistar', 'Movistar Team'),
  ('team_female_movistar_tdf_femmes_2026', 'team_female_movistar', 'Movistar', 'Movistar Team'),
  ('team_1782810729608_dfwlah', 'team_1776704474025_wuq3wr', 'Pinarello-Q36.5', 'Pinarello-Q36.5 Pro Cycling Team'),
  ('team_1782732765218_qomw11', 'team_1776703840961_zz7puu', 'Jayco AlUla', 'Team Jayco AlUla'),
  ('team_1782732898167_jrs178', 'team_1776702578134_2wdzno', 'Visma | Lease a Bike', 'Team Visma | Lease a Bike'),
  ('team_1785146105252_dq8up9', 'team_female_visma', 'Visma | Lease a Bike', 'Team Visma | Lease a Bike');

CREATE TEMP TABLE excluded_soudal_2027_snapshot ON COMMIT DROP AS
SELECT to_jsonb(s) AS team_season_row
FROM public.team_seasons s
WHERE s.year = 2027
  AND s."teamId" = 'team_1776703755811_lbaphb';

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM team_season_2027_name_targets;
  IF v_count <> 32 THEN
    RAISE EXCEPTION 'Mapa 2027 incompleto: esperadas 32 filas, obtenidas %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM special_edition_team_name_targets;
  IF v_count <> 10 THEN
    RAISE EXCEPTION 'Mapa de ediciones especiales incompleto: esperadas 10 filas, obtenidas %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM excluded_soudal_2027_snapshot;
  IF v_count <> 1 OR EXISTS (
    SELECT 1
    FROM excluded_soudal_2027_snapshot
    WHERE team_season_row->>'name' IS DISTINCT FROM 'Soudal Safety Jogger'
  ) THEN
    RAISE EXCEPTION 'No se localizó la excepción Soudal 2027 en el estado esperado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM team_season_2027_name_targets x
    LEFT JOIN public.teams t ON t.id = x.team_id
    LEFT JOIN public.team_seasons s
      ON s."teamId" = x.team_id
     AND s.year = 2027
    WHERE x.team_id = 'team_1776703755811_lbaphb'
       OR t.id IS NULL
       OR s.id IS NULL
       OR t.name IS DISTINCT FROM x.desired_name
       OR s.name IS DISTINCT FROM x.expected_name
  ) THEN
    RAISE EXCEPTION 'El mapa 2027 no coincide con el estado actual de equipos y temporadas';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM special_edition_team_name_targets x
    LEFT JOIN public.teams child ON child.id = x.team_id
    LEFT JOIN public.teams parent ON parent.id = x.parent_team_id
    WHERE x.parent_team_id = 'team_1776703755811_lbaphb'
       OR child.id IS NULL
       OR parent.id IS NULL
       OR child."specialEdition" IS DISTINCT FROM true
       OR child."parentTeamId" IS DISTINCT FROM x.parent_team_id
       OR child.name IS DISTINCT FROM x.expected_name
       OR parent.name IS DISTINCT FROM x.desired_name
  ) THEN
    RAISE EXCEPTION 'El mapa de ediciones especiales no coincide con su estado actual';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.team_seasons s
    JOIN public.teams t ON t.id = s."teamId"
    WHERE s.year = 2027
      AND s."teamId" <> 'team_1776703755811_lbaphb'
      AND s.name IS DISTINCT FROM t.name
      AND NOT EXISTS (
        SELECT 1
        FROM team_season_2027_name_targets x
        WHERE x.team_id = s."teamId"
      )
  ) THEN
    RAISE EXCEPTION 'Existen diferencias 2027 no incluidas en el alcance autorizado';
  END IF;
END $$;

INSERT INTO private.team_season_2027_name_sync_20260905_backup (
  team_id,
  expected_name,
  desired_name,
  team_season_row
)
SELECT
  x.team_id,
  x.expected_name,
  x.desired_name,
  to_jsonb(s)
FROM team_season_2027_name_targets x
JOIN public.team_seasons s
  ON s."teamId" = x.team_id
 AND s.year = 2027;

INSERT INTO private.special_edition_team_name_sync_20260905_backup (
  team_id,
  parent_team_id,
  expected_name,
  desired_name,
  teams_row
)
SELECT
  x.team_id,
  x.parent_team_id,
  x.expected_name,
  x.desired_name,
  to_jsonb(t)
FROM special_edition_team_name_targets x
JOIN public.teams t ON t.id = x.team_id;

UPDATE public.team_seasons s
SET
  name = b.desired_name,
  "nameAliases" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM regexp_split_to_table(COALESCE(s."nameAliases", ''), E'\n') AS a(alias)
      WHERE btrim(a.alias) = b.expected_name
    ) THEN s."nameAliases"
    ELSE concat_ws(E'\n', NULLIF(btrim(s."nameAliases"), ''), b.expected_name)
  END,
  "updatedAt" = now()
FROM private.team_season_2027_name_sync_20260905_backup b
WHERE s."teamId" = b.team_id
  AND s.year = 2027;

UPDATE public.teams t
SET
  name = b.desired_name,
  "nameAliases" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM regexp_split_to_table(COALESCE(t."nameAliases", ''), E'\n') AS a(alias)
      WHERE btrim(a.alias) = b.expected_name
    ) THEN t."nameAliases"
    ELSE concat_ws(E'\n', NULLIF(btrim(t."nameAliases"), ''), b.expected_name)
  END,
  "updatedAt" = now()
FROM private.special_edition_team_name_sync_20260905_backup b
WHERE t.id = b.team_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.team_season_2027_name_sync_20260905_backup b
    JOIN public.team_seasons s
      ON s."teamId" = b.team_id
     AND s.year = 2027
    WHERE s.name IS DISTINCT FROM b.desired_name
       OR NOT EXISTS (
         SELECT 1
         FROM regexp_split_to_table(COALESCE(s."nameAliases", ''), E'\n') AS a(alias)
         WHERE btrim(a.alias) = b.expected_name
       )
       OR (
         to_jsonb(s) - ARRAY['name', 'nameAliases', 'updatedAt']
       ) IS DISTINCT FROM (
         b.team_season_row - ARRAY['name', 'nameAliases', 'updatedAt']
       )
  ) THEN
    RAISE EXCEPTION 'Falló la comprobación de nombres, aliases o integridad de las filas 2027';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.team_seasons s
    JOIN public.teams t ON t.id = s."teamId"
    WHERE s.year = 2027
      AND s."teamId" <> 'team_1776703755811_lbaphb'
      AND s.name IS DISTINCT FROM t.name
  ) THEN
    RAISE EXCEPTION 'Algún nombre 2027 no quedó sincronizado con su equipo canónico';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.special_edition_team_name_sync_20260905_backup b
    JOIN public.teams t ON t.id = b.team_id
    WHERE t.name IS DISTINCT FROM b.desired_name
       OR NOT (public.fold_team_name(b.desired_name) = ANY(t."foldedNames"))
       OR NOT EXISTS (
         SELECT 1
         FROM regexp_split_to_table(COALESCE(t."nameAliases", ''), E'\n') AS a(alias)
         WHERE btrim(a.alias) = b.expected_name
       )
       OR (
         to_jsonb(t) - ARRAY['name', 'nameAliases', 'foldedNames', 'updatedAt']
       ) IS DISTINCT FROM (
         b.teams_row - ARRAY['name', 'nameAliases', 'foldedNames', 'updatedAt']
       )
  ) THEN
    RAISE EXCEPTION 'Falló la comprobación de nombres, aliases o integridad de las ediciones especiales';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM excluded_soudal_2027_snapshot x
    JOIN public.team_seasons s
      ON s."teamId" = 'team_1776703755811_lbaphb'
     AND s.year = 2027
    WHERE to_jsonb(s) IS DISTINCT FROM x.team_season_row
  ) THEN
    RAISE EXCEPTION 'La fila excluida de Soudal 2027 fue modificada';
  END IF;
END $$;
