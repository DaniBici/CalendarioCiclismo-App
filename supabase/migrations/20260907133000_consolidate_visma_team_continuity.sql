-- Consolida la continuidad histórica de las tres matrices Visma bajo los
-- identificadores actuales. Los cuatro identificadores antiguos se conservan
-- como registros ocultos para no invalidar cachés de aplicaciones publicadas.

BEGIN;

CREATE TABLE private.repair_visma_continuity_20260907_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_visma_continuity_20260907_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_visma_continuity_20260907_backup
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.repair_visma_continuity_20260907_backup
  TO service_role;

COMMENT ON TABLE private.repair_visma_continuity_20260907_backup IS
  'Backup recuperable previo a consolidar la continuidad de Visma el 2026-09-07.';

CREATE TEMP TABLE _visma_team_merge (
  source_id text PRIMARY KEY,
  target_id text NOT NULL,
  expected_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO _visma_team_merge (source_id, target_id, expected_name) VALUES
  ('uci-hist-male-2020-15149',   'team_1776702578134_2wdzno', 'JUMBO - VISMA'),
  ('uci-hist-female-2021-15418', 'team_female_visma',          'JUMBO-VISMA WOMEN TEAM'),
  ('uci-hist-male-2020-14090',   'team_devo_visma',            'JUMBO - VISMA DEVELOPMENT TEAM'),
  ('uci-hist-male-2024-19779',   'team_devo_visma',            'TEAM VISMA | LEASE A BIKE DEVELOPMENT');

DO $preflight$
BEGIN
  IF (
    SELECT count(*)
    FROM _visma_team_merge m
    JOIN public.teams source
      ON source.id = m.source_id
     AND source.name = m.expected_name
     AND source."historicalCatalogOnly" = true
     AND source."specialEdition" = false
    JOIN public.teams target
      ON target.id = m.target_id
     AND target."historicalCatalogOnly" = false
     AND target."specialEdition" = false
     AND target.gender = source.gender
  ) <> 4 THEN
    RAISE EXCEPTION 'El preflight no encuentra las cuatro relaciones Visma auditadas';
  END IF;

  IF (SELECT count(*) FROM public.team_seasons s JOIN _visma_team_merge m ON m.source_id = s."teamId") <> 12 THEN
    RAISE EXCEPTION 'El preflight no encuentra las 12 temporadas históricas de Visma';
  END IF;

  IF (SELECT count(*) FROM private.uci_catalog_team_links l JOIN _visma_team_merge m ON m.source_id = l.team_id) <> 12 THEN
    RAISE EXCEPTION 'El preflight no encuentra los 12 enlaces UCI históricos de Visma';
  END IF;

  IF (SELECT count(*) FROM private.historical_team_roster_observations o JOIN _visma_team_merge m ON m.source_id = o."teamId") <> 223 THEN
    RAISE EXCEPTION 'El preflight no encuentra las 223 observaciones históricas de Visma';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.team_seasons source
    JOIN _visma_team_merge m ON m.source_id = source."teamId"
    JOIN public.team_seasons target
      ON target."teamId" = m.target_id
     AND target.year = source.year
  ) THEN
    RAISE EXCEPTION 'Una temporada Visma histórica colisiona con su matriz actual';
  END IF;
END
$preflight$;

INSERT INTO private.repair_visma_continuity_20260907_backup (entity, row_key, row_data)
SELECT 'teams', t.id, to_jsonb(t)
FROM public.teams t
WHERE t.id IN (
  SELECT source_id FROM _visma_team_merge
  UNION
  SELECT target_id FROM _visma_team_merge
);

INSERT INTO private.repair_visma_continuity_20260907_backup (entity, row_key, row_data)
SELECT 'team_seasons', s.id, to_jsonb(s)
FROM public.team_seasons s
WHERE s."teamId" IN (
  SELECT source_id FROM _visma_team_merge
  UNION
  SELECT target_id FROM _visma_team_merge
);

INSERT INTO private.repair_visma_continuity_20260907_backup (entity, row_key, row_data)
SELECT 'uci_catalog_team_links', jsonb_build_array(l.season, l.profile)::text, to_jsonb(l)
FROM private.uci_catalog_team_links l
WHERE l.team_id IN (
  SELECT source_id FROM _visma_team_merge
  UNION
  SELECT target_id FROM _visma_team_merge
);

INSERT INTO private.repair_visma_continuity_20260907_backup (entity, row_key, row_data)
SELECT 'historical_team_roster_observations',
       jsonb_build_array(o.year, o."uciTeamProfileId", o."uciRiderProfileId", o."observationType")::text,
       to_jsonb(o)
FROM private.historical_team_roster_observations o
WHERE o."teamId" IN (
  SELECT source_id FROM _visma_team_merge
  UNION
  SELECT target_id FROM _visma_team_merge
);

UPDATE public.team_seasons s
SET "teamId" = m.target_id,
    "updatedAt" = transaction_timestamp()
FROM _visma_team_merge m
WHERE s."teamId" = m.source_id;

UPDATE private.uci_catalog_team_links l
SET team_id = m.target_id,
    reviewed_at = transaction_timestamp()
FROM _visma_team_merge m
WHERE l.team_id = m.source_id;

UPDATE private.historical_team_roster_observations o
SET "teamId" = m.target_id
FROM _visma_team_merge m
WHERE o."teamId" = m.source_id;

UPDATE public.teams
SET "firstSeason" = 2020,
    "nameAliases" = E'Visma\nJumbo-Visma\nJumbo - Visma\nTeam Visma | Lease a Bike\nTEAM VISMA|LEASE A BIKE',
    "updatedAt" = transaction_timestamp()
WHERE id = 'team_1776702578134_2wdzno';

UPDATE public.teams
SET "firstSeason" = 2021,
    "nameAliases" = E'Visma Women\nJumbo-Visma Women Team\nTeam Visma | Lease a Bike Women',
    "updatedAt" = transaction_timestamp()
WHERE id = 'team_female_visma';

UPDATE public.teams
SET "firstSeason" = 2020,
    "nameAliases" = E'Jumbo-Visma Development Team\nJumbo - Visma Development Team\nVisma Development\nVisma Lease a Bike Development\nVisma | Lease a Bike Development',
    "updatedAt" = transaction_timestamp()
WHERE id = 'team_devo_visma';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.team_seasons WHERE "teamId" IN (SELECT source_id FROM _visma_team_merge))
     OR EXISTS (SELECT 1 FROM private.uci_catalog_team_links WHERE team_id IN (SELECT source_id FROM _visma_team_merge))
     OR EXISTS (SELECT 1 FROM private.historical_team_roster_observations WHERE "teamId" IN (SELECT source_id FROM _visma_team_merge)) THEN
    RAISE EXCEPTION 'Quedan relaciones históricas de Visma sin repuntar';
  END IF;

  IF (SELECT count(*) FROM public.team_seasons WHERE "teamId" = 'team_1776702578134_2wdzno' AND year BETWEEN 2020 AND 2027) <> 8
     OR (SELECT count(*) FROM public.team_seasons WHERE "teamId" = 'team_female_visma' AND year BETWEEN 2021 AND 2027) <> 7
     OR (SELECT count(*) FROM public.team_seasons WHERE "teamId" = 'team_devo_visma' AND year BETWEEN 2020 AND 2026) <> 7 THEN
    RAISE EXCEPTION 'Los rangos consolidados de temporadas Visma no son continuos';
  END IF;

  IF (SELECT count(*) FROM public.teams WHERE id IN (SELECT source_id FROM _visma_team_merge) AND "historicalCatalogOnly" = true) <> 4 THEN
    RAISE EXCEPTION 'No se conservaron los cuatro identificadores históricos de compatibilidad';
  END IF;

  IF (SELECT count(*) FROM private.repair_visma_continuity_20260907_backup) <> 376 THEN
    RAISE EXCEPTION 'El backup Visma no contiene las 376 filas previstas';
  END IF;
END
$verify$;

COMMIT;

-- Rollback dirigido: restaurar cada entidad desde row_data dentro de una
-- transacción, empezando por teams y team_seasons y continuando por los dos
-- catálogos privados. El backup conserva las claves y filas completas previas.
