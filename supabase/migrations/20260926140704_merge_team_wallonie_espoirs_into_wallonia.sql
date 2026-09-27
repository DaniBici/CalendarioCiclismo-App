-- Fusiona el club Team Wallonie Espoirs (CLUBM) en la selección regional
-- Wallonia (NTM, selectionCode wallonia). Ambas fichas representan el Team
-- Wallonie de la FCWB, célula de selección de cadetes, juniors y espoirs.
-- Las selecciones no admiten afiliaciones: se retiran las 12 afiliaciones
-- startlist_club del club y se recalcula el equipo actual de sus corredores.

BEGIN;

CREATE TABLE private.repair_wallonia_team_merge_20260926_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_wallonia_team_merge_20260926_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_wallonia_team_merge_20260926_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_wallonia_team_merge_20260926_backup
  TO service_role;

COMMENT ON TABLE private.repair_wallonia_team_merge_20260926_backup IS
  'Estado previo de Team Wallonie Espoirs y Wallonia, sus startlists, alias, temporada, decisiones de enlace, afiliaciones y corredores antes de fusionarlos el 26-09-2026.';

DO $$
DECLARE
  v_old constant text := 'team_auto_872d7e6c142e276a99c8c729d5c47fcb';
  v_new constant text := 'team_auto_a1e41dabce5ac7f68a2b424c2e849c24';
  v_riders text[];
  v_rider text;
  v_new_startlists integer;
BEGIN
  PERFORM id FROM public.teams WHERE id IN (v_old, v_new) ORDER BY id FOR UPDATE;

  IF (SELECT count(*) FROM public.teams
      WHERE id = v_old AND name = 'Team Wallonie Espoirs' AND category = 'CLUBM'
        AND "teamKind" = 'club' AND gender = 'male') <> 1
     OR (SELECT count(*) FROM public.teams
      WHERE id = v_new AND name = 'Wallonia' AND category = 'NTM'
        AND "teamKind" = 'selection' AND "selectionScope" = 'regional'
        AND "selectionCode" = 'wallonia' AND gender = 'male') <> 1 THEN
    RAISE EXCEPTION 'Las fichas de Wallonia han cambiado; no se fusionan';
  END IF;

  IF (SELECT count(*) FROM public.startlist_teams WHERE "teamId" = v_old) <> 3
     OR (SELECT count(*) FROM public.team_link_decisions WHERE "teamId" = v_old) <> 3
     OR (SELECT count(*) FROM public.team_name_aliases WHERE "teamId" = v_old) <> 3
     OR (SELECT count(*) FROM public.team_seasons WHERE "teamId" = v_old) <> 1
     OR (SELECT count(*) FROM public.rider_team_affiliations
         WHERE "teamId" = v_old AND source = 'startlist_club'
           AND "affiliationType" = 'regular') <> 12
     OR (SELECT count(*) FROM public.rider_team_affiliations WHERE "teamId" = v_old) <> 12
     OR (SELECT count(*) FROM public.riders_men WHERE "currentTeamId" = v_old) <> 10
     OR EXISTS (SELECT 1 FROM public.riders_women WHERE "currentTeamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.uci_team_rankings WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.rider_transfers
                WHERE "fromTeamId" = v_old OR "toTeamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.teams WHERE "parentTeamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.team_development_links
                WHERE "developmentTeamId" = v_old OR "mainTeamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.team_season_variants WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.cx_startlist_riders WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.cx_riders_men WHERE "currentTeamId" = v_old) THEN
    RAISE EXCEPTION 'Las referencias de Team Wallonie Espoirs han cambiado; no se fusionan';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.startlist_teams a
    JOIN public.startlist_teams b ON b."raceId" = a."raceId"
    WHERE a."teamId" = v_old AND b."teamId" = v_new
  ) THEN
    RAISE EXCEPTION 'Ambos equipos coinciden en una carrera; no se fusionan';
  END IF;

  SELECT array_agg(DISTINCT rider ORDER BY rider) INTO v_riders FROM (
    SELECT "riderId" AS rider FROM public.rider_team_affiliations WHERE "teamId" = v_old
    UNION
    SELECT id FROM public.riders_men WHERE "currentTeamId" = v_old
  ) s;

  SELECT count(*) INTO v_new_startlists
  FROM public.startlist_teams WHERE "teamId" = v_new;

  INSERT INTO private.repair_wallonia_team_merge_20260926_backup(entity, row_key, row_data)
  SELECT 'teams', id, to_jsonb(t) FROM public.teams t WHERE id IN (v_old, v_new)
  UNION ALL
  SELECT 'team_seasons', id, to_jsonb(s) FROM public.team_seasons s WHERE "teamId" IN (v_old, v_new)
  UNION ALL
  SELECT 'team_name_aliases', id, to_jsonb(a) FROM public.team_name_aliases a WHERE "teamId" IN (v_old, v_new)
  UNION ALL
  SELECT 'startlist_teams', id, to_jsonb(st) FROM public.startlist_teams st WHERE "teamId" = v_old
  UNION ALL
  SELECT 'team_link_decisions', id::text, to_jsonb(d) FROM public.team_link_decisions d WHERE "teamId" = v_old
  UNION ALL
  SELECT 'rider_team_affiliations', id, to_jsonb(a) FROM public.rider_team_affiliations a WHERE "teamId" = v_old
  UNION ALL
  SELECT 'riders_men', id, to_jsonb(r) FROM public.riders_men r WHERE id = ANY (v_riders);

  -- Alias: los nombres del club pasan a la selección.
  UPDATE public.team_name_aliases a
  SET "teamId" = v_new
  WHERE a."teamId" = v_old
    AND NOT EXISTS (
      SELECT 1 FROM public.team_name_aliases b
      WHERE b."teamId" = v_new AND b."foldedName" = a."foldedName" AND b.year = a.year
    );
  DELETE FROM public.team_name_aliases WHERE "teamId" = v_old;

  UPDATE public.teams
  SET "nameAliases" = E'Team Wallon U23\nTeam Wallonie\nTeam Wallonie Espoirs\nWallon U23',
      "updatedAt" = now()
  WHERE id = v_new;

  ALTER TABLE public.startlist_teams DISABLE TRIGGER auto_link_startlist_team_trg;
  UPDATE public.startlist_teams
  SET "teamId" = v_new, "teamName" = 'Wallonia'
  WHERE "teamId" = v_old;
  ALTER TABLE public.startlist_teams ENABLE TRIGGER auto_link_startlist_team_trg;

  UPDATE public.team_link_decisions
  SET "teamId" = v_new, "updatedAt" = now()
  WHERE "teamId" = v_old;

  DELETE FROM public.rider_team_affiliations WHERE "teamId" = v_old;

  FOREACH v_rider IN ARRAY v_riders LOOP
    PERFORM public.recompute_current_team(v_rider, 'male');
  END LOOP;

  DELETE FROM public.team_seasons WHERE "teamId" = v_old;
  DELETE FROM public.teams WHERE id = v_old;

  IF EXISTS (SELECT 1 FROM public.teams WHERE id = v_old)
     OR EXISTS (SELECT 1 FROM public.team_seasons WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.team_name_aliases WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.startlist_teams WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.team_link_decisions WHERE "teamId" = v_old)
     OR EXISTS (SELECT 1 FROM public.rider_team_affiliations WHERE "teamId" IN (v_old, v_new))
     OR EXISTS (SELECT 1 FROM public.riders_men WHERE "currentTeamId" IN (v_old, v_new))
     OR (SELECT count(*) FROM public.startlist_teams
         WHERE "teamId" = v_new) <> v_new_startlists + 3
     OR (SELECT count(*) FROM public.team_name_aliases WHERE "teamId" = v_new) < 4
     OR (SELECT count(*) FROM public.teams
         WHERE id = v_new AND "foldedNames" @> ARRAY['wallonie espoirs', 'wallon u23']) <> 1 THEN
    RAISE EXCEPTION 'La verificación de la fusión de Wallonia ha fallado';
  END IF;
END $$;

COMMIT;

-- Rollback dirigido: restaurar desde private.repair_wallonia_team_merge_20260926_backup
-- con jsonb_populate_record, en este orden: teams (club y selección), team_seasons,
-- team_name_aliases, startlist_teams, team_link_decisions, rider_team_affiliations y
-- el currentTeamId de riders_men; después ejecutar recompute_current_team para
-- cada corredor restaurado.
