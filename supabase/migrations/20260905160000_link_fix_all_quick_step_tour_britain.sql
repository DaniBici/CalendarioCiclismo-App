-- Enlaza las clasificaciones colectivas de la Vuelta a Gran Bretaña 2026
-- con la edición especial Fix All Quick-Step. Matsport publica el nombre del
-- equipo padre, SOUDAL QUICK-STEP, mientras la startlist usa la ficha especial.
-- El alias en la ficha especial mantiene el enlace en los volcados posteriores,
-- incluida la quinta etapa.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.repair_tour_britain_fix_all_20260905_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.repair_tour_britain_fix_all_20260905_backup IS
  'Backup dirigido de la ficha Fix All Quick-Step y sus enlaces en las clasificaciones por equipos de la Vuelta a Gran Bretaña 2026.';

ALTER TABLE private.repair_tour_britain_fix_all_20260905_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_tour_britain_fix_all_20260905_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.repair_tour_britain_fix_all_20260905_backup
  TO service_role;

DO $$
DECLARE
  v_race_id text;
  v_parent_team_id text;
  v_special_team_id text;
  v_target_count integer;
BEGIN
  SELECT id INTO STRICT v_race_id
  FROM public.races
  WHERE slug = 'vuelta-a-gran-bretana-2026'
    AND name = 'Vuelta a Gran Bretaña'
    AND "startDate" = '2026-09-02'
    AND "endDate" = '2026-09-06';

  SELECT id INTO STRICT v_parent_team_id
  FROM public.teams
  WHERE name = 'Soudal Quick-Step'
    AND gender = 'male'
    AND "specialEdition" IS FALSE;

  SELECT id INTO STRICT v_special_team_id
  FROM public.teams
  WHERE name = 'Fix All Quick-Step'
    AND gender = 'male'
    AND "specialEdition" IS TRUE
    AND "parentTeamId" = v_parent_team_id
    AND "specialEditionRaceId" = v_race_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.startlist_teams
    WHERE "raceId" = v_race_id
      AND "teamId" = v_special_team_id
  ) THEN
    RAISE EXCEPTION 'Fix All Quick-Step no está enlazado en la startlist de la Vuelta a Gran Bretaña 2026';
  END IF;

  SELECT count(*) INTO v_target_count
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  WHERE s."raceId" = v_race_id
    AND s."classKind" = 'teams'
    AND s."stageNumber" BETWEEN 1 AND 4
    AND public.fold_team_name(r."riderDisplay") = public.fold_team_name('Soudal Quick-Step');

  IF v_target_count < 6 THEN
    RAISE EXCEPTION 'Se esperaban al menos 6 filas colectivas de Soudal Quick-Step en las etapas 1-4; encontradas: %', v_target_count;
  END IF;

  INSERT INTO private.repair_tour_britain_fix_all_20260905_backup
    (operation, entity, row_id, row_data)
  SELECT
    'tour-britain-fix-all-team-links-20260905',
    'teams',
    t.id,
    to_jsonb(t)
  FROM public.teams t
  WHERE t.id = v_special_team_id
  ON CONFLICT (operation, entity, row_id) DO NOTHING;

  INSERT INTO private.repair_tour_britain_fix_all_20260905_backup
    (operation, entity, row_id, row_data)
  SELECT
    'tour-britain-fix-all-team-links-20260905',
    'race_uci_results',
    r.id::text,
    to_jsonb(r)
  FROM public.race_uci_results r
  JOIN public.race_uci_stages s ON s.id = r."stageRef"
  WHERE s."raceId" = v_race_id
    AND s."classKind" = 'teams'
    AND s."stageNumber" BETWEEN 1 AND 4
    AND public.fold_team_name(r."riderDisplay") = public.fold_team_name('Soudal Quick-Step')
  ON CONFLICT (operation, entity, row_id) DO NOTHING;

  UPDATE public.teams
  SET "nameAliases" = concat_ws(E'\n', NULLIF("nameAliases", ''), 'Soudal Quick-Step'),
      "updatedAt" = now()
  WHERE id = v_special_team_id
    AND NOT (public.fold_team_name('Soudal Quick-Step') = ANY("foldedNames"));

  UPDATE public.race_uci_results r
  SET "teamId" = v_special_team_id
  FROM public.race_uci_stages s
  WHERE s.id = r."stageRef"
    AND s."raceId" = v_race_id
    AND s."classKind" = 'teams'
    AND s."stageNumber" BETWEEN 1 AND 4
    AND public.fold_team_name(r."riderDisplay") = public.fold_team_name('Soudal Quick-Step')
    AND r."teamId" IS DISTINCT FROM v_special_team_id;
END
$$;
