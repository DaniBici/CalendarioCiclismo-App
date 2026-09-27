-- Fuente oficial: https://balticchaintour.com/ (edición 2026). La web del
-- organizador identifica a Lauri Tamm y Romet Pajur como National Team of
-- Estonia; las ocho clasificaciones colectivas conservan NATIONAL TEAM ESTONIA.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.baltic_chain_estonia_team_link_20260830_backup (
  operation text NOT NULL,
  result_id bigint PRIMARY KEY,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.baltic_chain_estonia_team_link_20260830_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.baltic_chain_estonia_team_link_20260830_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE private.baltic_chain_estonia_team_link_20260830_backup TO service_role;

INSERT INTO private.baltic_chain_estonia_team_link_20260830_backup (
  operation, result_id, row_data
)
SELECT
  'baltic-chain-estonia-national-team-20260830',
  r.id,
  to_jsonb(r)
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN public.races rc ON rc.id = s."raceId"
WHERE rc."year" = 2026
  AND rc.name = 'Baltic Chain Tour'
  AND rc.gender = 'male'
  AND public.fold_team_name(r."riderDisplay") = 'national estonia'
  AND r."teamId" IS NULL
  AND r."globalRiderId" IS NULL
  AND (s."classKind" = 'teams' OR s."isTeamEvent" = true)
ON CONFLICT (result_id) DO NOTHING;

INSERT INTO public.team_name_aliases (
  id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
)
SELECT
  'tna_baltic_chain_estonia_2026',
  t.id,
  'National Team Estonia',
  'national estonia',
  2026,
  'baltic_chain_official_2026',
  'https://balticchaintour.com/',
  true
FROM public.teams t
WHERE t."teamKind" = 'selection'
  AND t."selectionScope" = 'national'
  AND t."selectionCode" = 'ee'
  AND t.gender = 'male'
ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
  alias = EXCLUDED.alias,
  source = EXCLUDED.source,
  "sourceUrl" = EXCLUDED."sourceUrl",
  verified = EXCLUDED.verified,
  "updatedAt" = now();

UPDATE public.race_uci_results r
SET "teamId" = t.id
FROM private.baltic_chain_estonia_team_link_20260830_backup b
JOIN public.teams t
  ON t."teamKind" = 'selection'
 AND t."selectionScope" = 'national'
 AND t."selectionCode" = 'ee'
 AND t.gender = 'male'
WHERE b.operation = 'baltic-chain-estonia-national-team-20260830'
  AND b.result_id = r.id
  AND r."teamId" IS NULL
  AND r."globalRiderId" IS NULL;
