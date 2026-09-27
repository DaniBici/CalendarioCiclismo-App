-- Conserva la identidad histórica de Le Dévoluy, adopta el nombre Tenvels
-- desde el 10-09-2026 y representa la denominación anterior como edición
-- especial para las carreras terminadas hasta el 09-09-2026.

CREATE TABLE private.tenvels_le_devoluy_20260908_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.tenvels_le_devoluy_20260908_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.tenvels_le_devoluy_20260908_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.tenvels_le_devoluy_20260908_backup TO service_role;

DO $$
DECLARE
  v_canonical_id text;
  v_duplicate_id text;
  v_special_id text := 'team_special_' || substr(md5('Le Dévoluy - Région Sud|female|2026-09-09'), 1, 24);
BEGIN
  SELECT id INTO STRICT v_canonical_id
  FROM public.teams
  WHERE name = 'Le Dévoluy - Région Sud'
    AND gender = 'female'
    AND "specialEdition" IS FALSE;

  SELECT id INTO STRICT v_duplicate_id
  FROM public.teams
  WHERE name = 'Tenvels Le Dévoluy'
    AND gender = 'female'
    AND "specialEdition" IS FALSE;

  IF EXISTS (SELECT 1 FROM public.teams WHERE id = v_special_id) THEN
    RAISE EXCEPTION 'La edición especial de Le Dévoluy ya existe';
  END IF;

  INSERT INTO private.tenvels_le_devoluy_20260908_backup(entity, row_key, row_data)
  SELECT 'teams', id, to_jsonb(t)
  FROM public.teams t
  WHERE id IN (v_canonical_id, v_duplicate_id);

  INSERT INTO private.tenvels_le_devoluy_20260908_backup(entity, row_key, row_data)
  SELECT 'team_seasons', id, to_jsonb(s)
  FROM public.team_seasons s
  WHERE "teamId" IN (v_canonical_id, v_duplicate_id);

  INSERT INTO private.tenvels_le_devoluy_20260908_backup(entity, row_key, row_data)
  SELECT 'team_name_aliases', id, to_jsonb(a)
  FROM public.team_name_aliases a
  WHERE "teamId" IN (v_canonical_id, v_duplicate_id);

  INSERT INTO private.tenvels_le_devoluy_20260908_backup(entity, row_key, row_data)
  SELECT 'startlist_teams', id, to_jsonb(st)
  FROM public.startlist_teams st
  WHERE "teamId" IN (v_canonical_id, v_duplicate_id);

  INSERT INTO private.tenvels_le_devoluy_20260908_backup(entity, row_key, row_data)
  SELECT 'startlist_riders', id, to_jsonb(sr)
  FROM public.startlist_riders sr
  WHERE "teamId" IN (v_canonical_id, v_duplicate_id);

  INSERT INTO private.tenvels_le_devoluy_20260908_backup(entity, row_key, row_data)
  SELECT 'race_uci_results', id, to_jsonb(rr)
  FROM public.race_uci_results rr
  WHERE "teamId" IN (v_canonical_id, v_duplicate_id);

  INSERT INTO public.teams
  SELECT (jsonb_populate_record(
    NULL::public.teams,
    to_jsonb(t) || jsonb_build_object(
      'id', v_special_id,
      'name', 'Le Dévoluy - Région Sud',
      'specialEdition', true,
      'parentTeamId', v_canonical_id,
      'specialEditionValidFrom', NULL,
      'specialEditionValidTo', '2026-09-09',
      'specialEditionRaceId', NULL,
      'createdAt', transaction_timestamp(),
      'updatedAt', transaction_timestamp()
    )
  )).* FROM public.teams t WHERE id = v_canonical_id;

  UPDATE public.startlist_teams st
  SET "teamId" = v_special_id,
      "teamName" = 'Le Dévoluy - Région Sud'
  FROM public.races r
  WHERE st."raceId" = r.id
    AND st."teamId" = v_canonical_id
    AND r."endDate"::date <= DATE '2026-09-09';

  UPDATE public.startlist_riders sr
  SET "teamId" = v_special_id
  FROM public.races r
  WHERE sr."raceId" = r.id
    AND sr."teamId" = v_canonical_id
    AND r."endDate"::date <= DATE '2026-09-09';

  UPDATE public.race_uci_results rr
  SET "teamId" = v_special_id
  FROM public.races r
  WHERE rr."raceId" = r.id
    AND rr."teamId" = v_canonical_id
    AND r."endDate"::date <= DATE '2026-09-09';

  UPDATE public.startlist_teams
  SET "teamId" = v_canonical_id,
      "teamName" = 'Tenvels Le Dévoluy'
  WHERE "teamId" = v_duplicate_id;

  UPDATE public.startlist_riders
  SET "teamId" = v_canonical_id
  WHERE "teamId" = v_duplicate_id;

  UPDATE public.race_uci_results
  SET "teamId" = v_canonical_id
  WHERE "teamId" = v_duplicate_id;

  DELETE FROM public.team_name_aliases a
  WHERE a."teamId" = v_duplicate_id
    AND EXISTS (
      SELECT 1 FROM public.team_name_aliases c
      WHERE c."teamId" = v_canonical_id
        AND c.year IS NOT DISTINCT FROM a.year
        AND c."foldedName" = a."foldedName"
    );

  UPDATE public.team_name_aliases
  SET "teamId" = v_canonical_id,
      verified = true,
      "updatedAt" = transaction_timestamp()
  WHERE "teamId" = v_duplicate_id;

  DELETE FROM public.team_seasons WHERE "teamId" = v_duplicate_id;
  DELETE FROM public.teams WHERE id = v_duplicate_id;

  UPDATE public.teams
  SET name = 'Tenvels Le Dévoluy',
      "nameAliases" = 'Devoluy' || E'\n' ||
        'Dévoluy-Région Sud Ladies Cycling Team' || E'\n' ||
        'Le Dévoluy - Région Sud' || E'\n' ||
        'Le Devoluy Region Sud Ladies' || E'\n' ||
        'Le Devoluy-Ladies Cycling Team',
      "foldedNames" = ARRAY[
        'devoluy', 'devoluy region sud ladies', 'le devoluy ladies',
        'le devoluy region sud', 'le devoluy region sud ladies',
        'tenvels le devoluy'
      ],
      "updatedAt" = transaction_timestamp()
  WHERE id = v_canonical_id;

  UPDATE public.team_seasons
  SET name = 'Tenvels Le Dévoluy',
      "nameAliases" = 'Devoluy' || E'\n' ||
        'Dévoluy-Région Sud Ladies Cycling Team' || E'\n' ||
        'Le Dévoluy - Région Sud' || E'\n' ||
        'Le Devoluy Region Sud Ladies' || E'\n' ||
        'Le Devoluy-Ladies Cycling Team',
      "updatedAt" = transaction_timestamp()
  WHERE "teamId" = v_canonical_id AND year = 2026;

  IF (SELECT count(*) FROM public.teams WHERE id = v_canonical_id AND name = 'Tenvels Le Dévoluy') <> 1
     OR EXISTS (SELECT 1 FROM public.teams WHERE id = v_duplicate_id)
     OR (SELECT count(*) FROM public.teams WHERE id = v_special_id AND "specialEdition" AND "parentTeamId" = v_canonical_id AND "specialEditionValidTo" = DATE '2026-09-09') <> 1
     OR EXISTS (
       SELECT 1 FROM public.startlist_teams st
       JOIN public.races r ON r.id = st."raceId"
       WHERE st."teamId" = v_canonical_id AND r."endDate"::date <= DATE '2026-09-09'
     )
     OR EXISTS (
       SELECT 1 FROM public.startlist_teams st
       JOIN public.races r ON r.id = st."raceId"
       WHERE st."teamId" = v_special_id AND r."endDate"::date >= DATE '2026-09-10'
     ) THEN
    RAISE EXCEPTION 'Falló la consolidación temporal de Tenvels Le Dévoluy';
  END IF;
END $$;
