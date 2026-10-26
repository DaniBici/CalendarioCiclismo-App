-- Fusiona cuatro fichas de selección nacional sin countryCode, creadas por
-- inscritos automáticos con el nombre de la fuente, en la selección canónica
-- del mismo país, categoría y género:
--   Moldavian National Team (NTM)       -> Moldova (md)
--   Israeli National Team (NTW)         -> Israel (il)
--   Serbia National (NTM)               -> Serbia (rs)
--   Selection Maurice - Team MCB (NTM)  -> Mauritius (mu); MCB patrocina la
--     selección nacional y la plantilla del Tour y la Clásica de Mauricio
--     corresponde a la de los Mundiales y el Campeonato de África.
-- Ningún par coincide en una misma carrera. Las fichas retiradas solo tienen
-- startlist_teams, team_link_decisions, team_name_aliases y team_seasons; ni
-- resultados, ni afiliaciones, ni corredores, ni otras referencias.

BEGIN;

CREATE TABLE private.repair_national_selection_merge_20261022_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, row_key)
);

ALTER TABLE private.repair_national_selection_merge_20261022_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_national_selection_merge_20261022_backup
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.repair_national_selection_merge_20261022_backup
  TO service_role;

COMMENT ON TABLE private.repair_national_selection_merge_20261022_backup IS
  'Estado previo de cuatro selecciones nacionales duplicadas sin countryCode y de sus canónicas (Moldova, Israel NTW, Serbia NTM, Mauritius NTM): fichas, temporadas, alias, startlists y decisiones de enlace antes de fusionarlas el 22-10-2026.';

DO $$
DECLARE
  v_pair record;
  v_new_startlists integer;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('team_auto_885a65b1ad75b85962c47bff62ab8c48', 'Moldavian National Team',
       'team_auto_cc780a1778eab2e8adb55de04f5724b5', 'Moldova', 'md', 'NTM', 'male', 1,
       'Moldavian National Team'),
      ('team_auto_d2325e521885a439fd1619fec21b80bb', 'Israeli National Team',
       'team_ntw_israel', 'Israel', 'il', 'NTW', 'female', 1,
       E'ISRAEL\nIsraeli National Team'),
      ('team_auto_5c2c998fe03e5771a70fe9d60ad84ccf', 'Serbia National',
       'team_ntm_serbia', 'Serbia', 'rs', 'NTM', 'male', 1,
       'Serbia National'),
      ('team_auto_f3d59f31d3cf77da53b170ffcb7c2947', 'Selection Maurice - Team MCB',
       'team_ntm_mauritius', 'Mauritius', 'mu', 'NTM', 'male', 2,
       E'Mauricio\nSelection Maurice - Team MCB')
    ) AS p(old_id, old_name, new_id, new_name, country, category, gender, startlists, aliases)
    ORDER BY old_id
  LOOP
    PERFORM id FROM public.teams WHERE id IN (v_pair.old_id, v_pair.new_id) ORDER BY id FOR UPDATE;

    IF (SELECT count(*) FROM public.teams
        WHERE id = v_pair.old_id AND name = v_pair.old_name AND category = v_pair.category
          AND gender = v_pair.gender AND "teamKind" = 'selection'
          AND "selectionScope" = 'national' AND "countryCode" IS NULL
          AND "nameAliases" IS NULL) <> 1
       OR (SELECT count(*) FROM public.teams
        WHERE id = v_pair.new_id AND name = v_pair.new_name AND category = v_pair.category
          AND gender = v_pair.gender AND "teamKind" = 'selection'
          AND "selectionScope" = 'national' AND "countryCode" = v_pair.country) <> 1 THEN
      RAISE EXCEPTION 'Las fichas de % han cambiado; no se fusionan', v_pair.new_name;
    END IF;

    IF (SELECT count(*) FROM public.startlist_teams WHERE "teamId" = v_pair.old_id) <> v_pair.startlists
       OR (SELECT count(*) FROM public.team_link_decisions WHERE "teamId" = v_pair.old_id) <> v_pair.startlists
       OR (SELECT count(*) FROM public.team_name_aliases WHERE "teamId" = v_pair.old_id) <> 1
       OR (SELECT count(*) FROM public.team_seasons WHERE "teamId" = v_pair.old_id) <> 1
       OR EXISTS (SELECT 1 FROM public.race_uci_results WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.rider_team_affiliations WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.riders_men WHERE "currentTeamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.riders_women WHERE "currentTeamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.uci_team_rankings WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.rider_transfers
                  WHERE "fromTeamId" = v_pair.old_id OR "toTeamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.teams WHERE "parentTeamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.team_development_links
                  WHERE "developmentTeamId" = v_pair.old_id OR "mainTeamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.cx_startlist_riders WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.cx_riders_men WHERE "currentTeamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.cx_riders_women WHERE "currentTeamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM private.uci_catalog_team_links WHERE team_id = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM private.uci_catalog_baselines WHERE team_id = v_pair.old_id) THEN
      RAISE EXCEPTION 'Las referencias de % han cambiado; no se fusionan', v_pair.old_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.startlist_teams a
      JOIN public.startlist_teams b ON b."raceId" = a."raceId"
      WHERE a."teamId" = v_pair.old_id AND b."teamId" = v_pair.new_id
    ) THEN
      RAISE EXCEPTION '% y % coinciden en una carrera; no se fusionan',
        v_pair.old_name, v_pair.new_name;
    END IF;

    SELECT count(*) INTO v_new_startlists
    FROM public.startlist_teams WHERE "teamId" = v_pair.new_id;

    INSERT INTO private.repair_national_selection_merge_20261022_backup(entity, row_key, row_data)
    SELECT 'teams', id, to_jsonb(t) FROM public.teams t WHERE id IN (v_pair.old_id, v_pair.new_id)
    UNION ALL
    SELECT 'team_seasons', id, to_jsonb(s) FROM public.team_seasons s
    WHERE "teamId" IN (v_pair.old_id, v_pair.new_id)
    UNION ALL
    SELECT 'team_name_aliases', id, to_jsonb(a) FROM public.team_name_aliases a
    WHERE "teamId" IN (v_pair.old_id, v_pair.new_id)
    UNION ALL
    SELECT 'startlist_teams', id, to_jsonb(st) FROM public.startlist_teams st
    WHERE "teamId" = v_pair.old_id
    UNION ALL
    SELECT 'team_link_decisions', id::text, to_jsonb(d) FROM public.team_link_decisions d
    WHERE "teamId" = v_pair.old_id;

    UPDATE public.team_name_aliases a
    SET "teamId" = v_pair.new_id, "updatedAt" = now()
    WHERE a."teamId" = v_pair.old_id
      AND NOT EXISTS (
        SELECT 1 FROM public.team_name_aliases b
        WHERE b."teamId" = v_pair.new_id AND b."foldedName" = a."foldedName" AND b.year = a.year
      );
    DELETE FROM public.team_name_aliases WHERE "teamId" = v_pair.old_id;

    UPDATE public.teams
    SET "nameAliases" = v_pair.aliases, "updatedAt" = now()
    WHERE id = v_pair.new_id;

    ALTER TABLE public.startlist_teams DISABLE TRIGGER auto_link_startlist_team_trg;
    UPDATE public.startlist_teams
    SET "teamId" = v_pair.new_id, "teamName" = v_pair.new_name
    WHERE "teamId" = v_pair.old_id;
    ALTER TABLE public.startlist_teams ENABLE TRIGGER auto_link_startlist_team_trg;

    UPDATE public.team_link_decisions
    SET "teamId" = v_pair.new_id, "updatedAt" = now()
    WHERE "teamId" = v_pair.old_id;

    DELETE FROM public.team_seasons WHERE "teamId" = v_pair.old_id;
    DELETE FROM public.teams WHERE id = v_pair.old_id;

    IF EXISTS (SELECT 1 FROM public.teams WHERE id = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.team_seasons WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.team_name_aliases WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.startlist_teams WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.team_link_decisions WHERE "teamId" = v_pair.old_id)
       OR EXISTS (SELECT 1 FROM public.rider_team_affiliations WHERE "teamId" = v_pair.new_id)
       OR (SELECT count(*) FROM public.startlist_teams
           WHERE "teamId" = v_pair.new_id) <> v_new_startlists + v_pair.startlists
       OR NOT EXISTS (SELECT 1 FROM public.team_name_aliases
                      WHERE "teamId" = v_pair.new_id
                        AND alias = v_pair.old_name AND year = 2026)
       OR (SELECT count(*) FROM public.teams
           WHERE id = v_pair.new_id AND "nameAliases" = v_pair.aliases
             AND cardinality("foldedNames") >= 2) <> 1 THEN
      RAISE EXCEPTION 'La verificación de la fusión en % ha fallado', v_pair.new_name;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Rollback dirigido: restaurar desde private.repair_national_selection_merge_20261022_backup
-- con jsonb_populate_record, en este orden: teams (duplicada y canónica), team_seasons,
-- team_name_aliases, startlist_teams (con auto_link_startlist_team_trg desactivado) y
-- team_link_decisions.
