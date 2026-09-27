-- La API UCI entrega las denominaciones en mayúsculas. Se conserva ese valor
-- literal en private.uci_catalog_team_links.source_name, pero no se usa como
-- nombre de presentación en teams ni team_seasons.

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM private.uci_team_officialization_20260905_backup;

  IF v_count <> 277 THEN
    RAISE EXCEPTION 'Backup UCI incompleto: esperadas 277 filas, obtenidas %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_seasons'
      AND column_name = 'uciCode'
  ) THEN
    RAISE EXCEPTION 'Falta team_seasons.uciCode';
  END IF;
END $$;

UPDATE public.teams t
SET
  name = b.teams_row->>'name',
  "nameAliases" = NULLIF(b.teams_row->>'nameAliases', ''),
  "updatedAt" = now()
FROM private.uci_team_officialization_20260905_backup b
WHERE t.id = b.team_id
  AND (t.name, t."nameAliases")
      IS DISTINCT FROM
      (b.teams_row->>'name', NULLIF(b.teams_row->>'nameAliases', ''));

UPDATE public.team_seasons s
SET
  name = b.team_season_row->>'name',
  "nameAliases" = NULLIF(b.team_season_row->>'nameAliases', ''),
  "updatedAt" = now()
FROM private.uci_team_officialization_20260905_backup b
WHERE s."teamId" = b.team_id
  AND s.year = b.season
  AND (s.name, s."nameAliases")
      IS DISTINCT FROM
      (b.team_season_row->>'name', NULLIF(b.team_season_row->>'nameAliases', ''));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.uci_team_officialization_20260905_backup b
    JOIN public.teams t ON t.id = b.team_id
    JOIN public.team_seasons s
      ON s."teamId" = b.team_id
     AND s.year = b.season
    WHERE t.name IS DISTINCT FROM b.teams_row->>'name'
       OR t."nameAliases" IS DISTINCT FROM NULLIF(b.teams_row->>'nameAliases', '')
       OR s.name IS DISTINCT FROM b.team_season_row->>'name'
       OR s."nameAliases" IS DISTINCT FROM NULLIF(b.team_season_row->>'nameAliases', '')
       OR s."uciCode" IS DISTINCT FROM b.official_code
  ) THEN
    RAISE EXCEPTION 'No se restauró la presentación o se perdió algún código UCI';
  END IF;
END $$;
