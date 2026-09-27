-- Fusiona «RSV Concordia Forchheim 1920 e.V.» (CLUBW) en «Team Baden-Forchheim».
-- Team Baden-Forchheim es la escuadra femenina del RSV Concordia 1920 Forchheim
-- (https://rsv-forchheim.de/?page_id=6126). Las dos corredoras inscritas con el
-- nombre del club en los Campeonatos de Alemania 2026, Yasmin Anstruther e Ilsa
-- Beig, pertenecen a Team Baden-Forchheim. La ficha superviviente recibe además
-- countryCode = 'de'.

BEGIN;

CREATE TABLE private.repair_baden_forchheim_merge_20260926_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_baden_forchheim_merge_20260926_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_baden_forchheim_merge_20260926_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_baden_forchheim_merge_20260926_backup
  TO service_role;

COMMENT ON TABLE private.repair_baden_forchheim_merge_20260926_backup IS
  'Estado previo de RSV Concordia Forchheim 1920 e.V. y Team Baden-Forchheim antes de fusionarlos el 26-09-2026.';

DO $$
DECLARE
  v_old constant text := 'team_auto_8844dd3ab69cc52506a6b96a4e68f681';
  v_new constant text := 'team_auto_403be15fbbc932d3d6b3d3dc13f38f52';
  v_name constant text := 'Team Baden-Forchheim';
  v_old_name constant text := 'RSV Concordia Forchheim 1920 e.V.';
  v_backup_count integer;
BEGIN
  PERFORM id FROM public.teams WHERE id IN (v_old, v_new) ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM public.teams
      WHERE id = v_new AND name = v_name AND category = 'CLUBW' AND gender = 'female') <> 1
     OR (SELECT count(*) FROM public.teams
      WHERE id = v_old AND name = v_old_name AND category = 'CLUBW' AND gender = 'female') <> 1 THEN
    RAISE EXCEPTION 'Las fichas de equipo han cambiado; no se fusionan';
  END IF;

  IF (SELECT count(*) FROM public.startlist_teams WHERE "teamId" = v_old) <> 2
     OR (SELECT count(*) FROM public.team_link_decisions WHERE "teamId" = v_old) <> 2
     OR (SELECT count(*) FROM public.team_name_aliases WHERE "teamId" = v_old) <> 1
     OR (SELECT count(*) FROM public.team_seasons WHERE "teamId" = v_old) <> 1
     OR (SELECT count(*) FROM public.rider_team_affiliations WHERE "teamId" = v_old) <> 2
     OR (SELECT count(*) FROM public.riders_women WHERE "currentTeamId" = v_old) <> 1
     OR EXISTS (SELECT 1 FROM public.riders_men WHERE "currentTeamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.rider_transfers
                WHERE "fromTeamId" = v_old OR "toTeamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.teams WHERE "parentTeamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.uci_team_rankings WHERE "teamId" = v_old) THEN
    RAISE EXCEPTION 'Las referencias de RSV Concordia Forchheim han cambiado; no se fusionan';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.startlist_teams a
    JOIN public.startlist_teams b ON b."raceId" = a."raceId"
    WHERE a."teamId" = v_old AND b."teamId" = v_new
  ) THEN
    RAISE EXCEPTION 'Ambas fichas coaparecen en una carrera; exige revisión';
  END IF;

  INSERT INTO private.repair_baden_forchheim_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'teams', id, to_jsonb(t) FROM public.teams t WHERE id IN (v_old, v_new);

  INSERT INTO private.repair_baden_forchheim_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'team_seasons', id, to_jsonb(s) FROM public.team_seasons s
  WHERE "teamId" IN (v_old, v_new);

  INSERT INTO private.repair_baden_forchheim_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'team_name_aliases', id, to_jsonb(a) FROM public.team_name_aliases a
  WHERE "teamId" = v_old;

  INSERT INTO private.repair_baden_forchheim_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'startlist_teams', id::text, to_jsonb(st) FROM public.startlist_teams st
  WHERE "teamId" = v_old;

  INSERT INTO private.repair_baden_forchheim_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'team_link_decisions', id, to_jsonb(d) FROM public.team_link_decisions d
  WHERE "teamId" = v_old;

  INSERT INTO private.repair_baden_forchheim_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'rider_team_affiliations', id, to_jsonb(a) FROM public.rider_team_affiliations a
  WHERE "teamId" = v_old;

  INSERT INTO private.repair_baden_forchheim_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'riders_women', id, to_jsonb(r) FROM public.riders_women r
  WHERE "currentTeamId" = v_old;

  SELECT count(*) INTO v_backup_count
  FROM private.repair_baden_forchheim_merge_20260926_backup;
  IF v_backup_count <> 12 THEN
    RAISE EXCEPTION 'Backup incompleto: % filas', v_backup_count;
  END IF;

  -- Afiliaciones de 2026: la de Beig ya existe en el superviviente; la de
  -- Anstruther se traslada y recalcula su equipo actual mediante trigger.
  DELETE FROM public.rider_team_affiliations a
  WHERE a."teamId" = v_old
    AND EXISTS (
      SELECT 1 FROM public.rider_team_affiliations b
      WHERE b."teamId" = v_new AND b."riderId" = a."riderId"
        AND b.year = a.year AND b."affiliationType" = a."affiliationType"
    );

  UPDATE public.rider_team_affiliations
  SET "teamId" = v_new,
      id = "riderId" || '__' || v_new || '__' || year
  WHERE "teamId" = v_old;

  UPDATE public.team_name_aliases SET "teamId" = v_new, "updatedAt" = now()
  WHERE "teamId" = v_old;

  UPDATE public.team_link_decisions SET "teamId" = v_new, "updatedAt" = now()
  WHERE "teamId" = v_old;

  ALTER TABLE public.startlist_teams DISABLE TRIGGER auto_link_startlist_team_trg;

  UPDATE public.startlist_teams SET "teamId" = v_new, "teamName" = v_name
  WHERE "teamId" = v_old;

  ALTER TABLE public.startlist_teams ENABLE TRIGGER auto_link_startlist_team_trg;

  DELETE FROM public.teams WHERE id = v_old;

  UPDATE public.teams
  SET "nameAliases" = v_old_name, "countryCode" = 'de', "updatedAt" = now()
  WHERE id = v_new;

  IF EXISTS (SELECT 1 FROM public.teams WHERE id = v_old)
     OR EXISTS (SELECT 1 FROM public.startlist_teams WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.team_link_decisions WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.team_name_aliases WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.rider_team_affiliations WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.riders_women WHERE "currentTeamId" = v_old)
     OR (SELECT count(*) FROM public.startlist_teams
         WHERE "teamId" = v_new AND "teamName" = v_name) <> 3
     OR (SELECT count(*) FROM public.team_name_aliases WHERE "teamId" = v_new) <> 2
     OR (SELECT count(*) FROM public.riders_women
         WHERE id IN ('anstruther-yasmin', 'beig-ilsa') AND "currentTeamId" = v_new) <> 2
     OR (SELECT count(*) FROM public.teams
         WHERE id = v_new AND "countryCode" = 'de' AND "nameAliases" = v_old_name) <> 1 THEN
    RAISE EXCEPTION 'La verificación de la fusión de Baden-Forchheim ha fallado';
  END IF;
END $$;

COMMIT;

-- Rollback dirigido: recrear la ficha retirada y su temporada desde row_data
-- con jsonb_populate_record; restaurar alias, decisiones, afiliaciones y las
-- dos filas de startlist_teams por row_key con el trigger de auto-enlace
-- desactivado; restaurar Team Baden-Forchheim y recalcular el equipo actual
-- de Anstruther.
