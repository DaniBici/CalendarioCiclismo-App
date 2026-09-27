-- Repara la instantánea vigente del ránking UCI después de la curación de
-- nombres de equipos de 2026 y enlaza la única fila que quedó sin catálogo.

CREATE TABLE private.uci_team_rankings_name_link_repair_20260906_backup (
  gender text NOT NULL,
  rank smallint NOT NULL,
  ranking_row jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gender, rank)
);

REVOKE ALL ON TABLE private.uci_team_rankings_name_link_repair_20260906_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.uci_team_rankings_name_link_repair_20260906_backup
  TO service_role;

INSERT INTO private.uci_team_rankings_name_link_repair_20260906_backup (
  gender, rank, ranking_row
)
SELECT r.gender, r.rank, to_jsonb(r)
FROM public.uci_team_rankings r
LEFT JOIN public.team_seasons ts
  ON ts."teamId" = r."teamId" AND ts.year = 2026
WHERE (r."teamId" IS NOT NULL AND r."displayName" IS DISTINCT FROM ts.name)
   OR (r.gender = 'male' AND r.rank = 160 AND r."uciTeamId" = 4034
       AND r."teamId" IS NULL);

DO $$
DECLARE
  v_backup_count integer;
  v_prowheel_count integer;
BEGIN
  SELECT count(*) INTO v_backup_count
  FROM private.uci_team_rankings_name_link_repair_20260906_backup;
  IF v_backup_count <> 112 THEN
    RAISE EXCEPTION 'Preflight de ránking UCI inesperado: se esperaban 112 filas y hay %', v_backup_count;
  END IF;

  SELECT count(*) INTO v_prowheel_count
  FROM public.teams t
  JOIN public.team_seasons ts ON ts."teamId" = t.id AND ts.year = 2026
  WHERE t.id = 'team_1780912000010_pl0o8p'
    AND t.gender = 'male'
    AND t."countryCode" = 'cn'
    AND ts.category = 'CT';
  IF v_prowheel_count <> 1 THEN
    RAISE EXCEPTION 'No se verificó el catálogo 2026 de Prowheel Kung Shenzhen';
  END IF;
END $$;

UPDATE public.uci_team_rankings r
SET "displayName" = ts.name
FROM public.team_seasons ts
WHERE ts."teamId" = r."teamId"
  AND ts.year = 2026
  AND r."displayName" IS DISTINCT FROM ts.name;

UPDATE public.uci_team_rankings r
SET "teamId" = 'team_1780912000010_pl0o8p',
    "teamCategory" = 'CT',
    "displayName" = 'Prowheel Kung Shenzhen Cycling Team'
WHERE r.gender = 'male'
  AND r.rank = 160
  AND r."uciTeamId" = 4034
  AND r."teamId" IS NULL
  AND r."sourceName" = 'PROWHEEL KUNG SHENZHEN CYCLING TEAM';

DO $$
DECLARE
  v_remaining_name_mismatches integer;
  v_unlinked integer;
BEGIN
  SELECT count(*) INTO v_remaining_name_mismatches
  FROM public.uci_team_rankings r
  JOIN public.team_seasons ts ON ts."teamId" = r."teamId" AND ts.year = 2026
  WHERE r."displayName" IS DISTINCT FROM ts.name;
  IF v_remaining_name_mismatches <> 0 THEN
    RAISE EXCEPTION 'Quedan % nombres de ránking UCI sin igualar', v_remaining_name_mismatches;
  END IF;

  SELECT count(*) INTO v_unlinked
  FROM public.uci_team_rankings
  WHERE "teamId" IS NULL;
  IF v_unlinked <> 0 THEN
    RAISE EXCEPTION 'Quedan % filas del ránking UCI sin enlace de equipo', v_unlinked;
  END IF;
END $$;

-- Rollback dirigido:
-- UPDATE public.uci_team_rankings r
-- SET "teamId" = b.ranking_row->>'teamId',
--     "teamCategory" = b.ranking_row->>'teamCategory',
--     "displayName" = b.ranking_row->>'displayName'
-- FROM private.uci_team_rankings_name_link_repair_20260906_backup b
-- WHERE r.gender = b.gender AND r.rank = b.rank;
