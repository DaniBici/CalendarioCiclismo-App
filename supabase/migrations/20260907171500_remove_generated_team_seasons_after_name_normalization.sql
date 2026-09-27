-- Retira únicamente las temporadas generadas por el trigger durante la normalización inicial.
BEGIN;

CREATE TEMP TABLE _generated_team_seasons_after_name_case ON COMMIT DROP AS
SELECT s.* FROM public.team_seasons s
JOIN private.normalize_uci_team_names_20260907_backup b
  ON b.entity='teams' AND b.row_key=s."teamId"
WHERE s.year=2026
  AND s."createdAt" IN (
    '2026-09-07 12:46:12.049496+00'::timestamptz,
    '2026-09-07 12:50:27.368847+00'::timestamptz
  );

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM _generated_team_seasons_after_name_case) NOT IN (0,463)
  THEN RAISE EXCEPTION 'Cambió el conjunto de temporadas generadas que debe retirarse'; END IF;
  IF EXISTS(SELECT 1 FROM _generated_team_seasons_after_name_case g
      JOIN private.uci_catalog_team_links l ON l.team_id=g."teamId" AND l.season=g.year)
    OR EXISTS(SELECT 1 FROM _generated_team_seasons_after_name_case g
      JOIN public.rider_team_affiliations a ON a."teamId"=g."teamId" AND a.year=g.year)
    OR EXISTS(SELECT 1 FROM _generated_team_seasons_after_name_case g
      JOIN public.team_season_variants v ON v."teamId"=g."teamId" AND v.year=g.year)
  THEN RAISE EXCEPTION 'Una temporada generada adquirió referencias y no puede retirarse'; END IF;
END
$preflight$;

INSERT INTO private.normalize_uci_team_names_20260907_backup(entity,row_key,row_data)
SELECT 'generated_team_seasons',id,to_jsonb(g) FROM _generated_team_seasons_after_name_case g
ON CONFLICT DO NOTHING;

DELETE FROM public.team_seasons s USING _generated_team_seasons_after_name_case g WHERE s.id=g.id;

DO $verify$
BEGIN
  IF EXISTS(SELECT 1 FROM public.team_seasons s
      JOIN _generated_team_seasons_after_name_case g ON g.id=s.id)
  THEN RAISE EXCEPTION 'Quedan temporadas generadas por la normalización'; END IF;
END
$verify$;

COMMIT;
