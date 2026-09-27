-- Todas las listas usan sus fichas canónicas. Se conserva la propiedad de lectura
-- para versiones móviles publicadas, sin un estado editable por carrera.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.apply_startlist_import(p_import_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_job private.startlist_imports%ROWTYPE; v_plan jsonb; v_doc jsonb;
  v_team jsonb; v_row jsonb; v_patch jsonb; v_teams jsonb := '[]'; v_rows jsonb;
  v_team_rows jsonb := '[]'; v_rider_rows jsonb := '[]'; v_result jsonb;
  v_team_id text; v_sl_team_id text; v_sl_rider_id text; v_gender text;
  v_resolution record; v_rider_resolution record; v_idx integer := 0;
  v_team_ids text[] := '{}'; v_rider_ids text[] := '{}';
  v_created_riders integer := 0; v_created_teams integer := 0; v_override_key text; v_birth date;
BEGIN
  PERFORM private.assert_startlist_import_admin();
  SELECT * INTO STRICT v_job FROM private.startlist_imports WHERE id=p_import_id FOR UPDATE;
  IF v_job.status = 'applied' THEN RETURN v_job.result || jsonb_build_object('alreadyApplied',true); END IF;
  PERFORM 1 FROM public.races WHERE id=v_job.race_id FOR UPDATE;
  IF private.startlist_import_snapshot(v_job.race_id) IS DISTINCT FROM v_job.before_state THEN
    RAISE EXCEPTION 'La lista ha cambiado desde la preparación. Vuelve a prepararla antes de aplicar.' USING ERRCODE='40001';
  END IF;
  IF jsonb_typeof(p_overrides) IS DISTINCT FROM 'object'
     OR (p_overrides - ARRAY['riders','teams']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Correcciones inválidas: se admiten riders y teams';
  END IF;
  IF (p_overrides ? 'riders' AND jsonb_typeof(p_overrides->'riders') <> 'object')
     OR (p_overrides ? 'teams' AND jsonb_typeof(p_overrides->'teams') <> 'object') THEN
    RAISE EXCEPTION 'Las correcciones se identifican por dorsal e índice de equipo';
  END IF;
  FOR v_override_key IN SELECT jsonb_object_keys(COALESCE(p_overrides->'riders','{}')) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_job.document->'teams') t,
      jsonb_array_elements(t->'riders') r WHERE r->>'dorsal'=v_override_key) THEN
      RAISE EXCEPTION 'Dorsal ajeno al borrador: %',v_override_key;
    END IF;
  END LOOP;
  FOR v_override_key IN SELECT jsonb_object_keys(COALESCE(p_overrides->'teams','{}')) LOOP
    IF v_override_key !~ '^(0|[1-9][0-9]{0,4})$'
       OR v_override_key::int >= jsonb_array_length(v_job.document->'teams') THEN
      RAISE EXCEPTION 'Índice de equipo ajeno al borrador: %',v_override_key;
    END IF;
  END LOOP;
  -- Solo las excepciones: riders por dorsal, teams por índice (desde cero).
  FOR v_team IN SELECT value FROM jsonb_array_elements(v_job.document->'teams') LOOP
    v_patch := COALESCE(p_overrides->'teams'->v_idx::text,'{}'::jsonb);
    IF jsonb_typeof(v_patch) IS DISTINCT FROM 'object' OR (v_patch - ARRAY['teamId','teamName']) <> '{}'::jsonb THEN RAISE EXCEPTION 'Campos de equipo no admitidos'; END IF;
    v_team := v_team || v_patch; v_rows := '[]';
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_team->'riders') LOOP
      v_patch := COALESCE(p_overrides->'riders'->(v_row->>'dorsal'),'{}'::jsonb);
      IF jsonb_typeof(v_patch) IS DISTINCT FROM 'object' OR (v_patch - ARRAY['firstName','lastName','globalRiderId','countryCode','birthDate','otherNames','uciProfileId','sourceUrl','rejectedCandidateIds']) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Campos de corredor no admitidos';
      END IF;
      v_rows := v_rows || (v_row || v_patch);
    END LOOP;
    v_teams := v_teams || (v_team || jsonb_build_object('riders',v_rows)); v_idx := v_idx + 1;
  END LOOP;
  v_doc := v_job.document || jsonb_build_object('teams',v_teams);
  v_plan := private.plan_startlist_import(v_job.race_id,v_doc);
  UPDATE private.startlist_imports SET document=v_doc,plan=v_plan,updated_at=now() WHERE id=p_import_id;
  IF NOT (v_plan->>'ready')::boolean THEN
    RETURN (v_plan-'document') || jsonb_build_object('importId',p_import_id,'status','prepared');
  END IF;
  SELECT gender INTO v_gender FROM public.races WHERE id=v_job.race_id;
  FOR v_team IN SELECT value FROM jsonb_array_elements(v_plan->'document'->'teams') LOOP
    v_team_id := NULLIF(v_team->>'teamId','');
    IF v_team_id IS NULL THEN
      SELECT * INTO v_resolution FROM public.ensure_startlist_team(v_job.race_id,v_team->>'teamName',v_gender);
      IF v_resolution.action NOT IN ('created','reused','ignored') THEN RAISE EXCEPTION 'Equipo pendiente: %',v_team->>'teamName'; END IF;
      v_team_id := v_resolution.team_id;
      IF v_resolution.action='created' THEN v_created_teams := v_created_teams+1; END IF;
    END IF;
    SELECT id INTO v_sl_team_id FROM public.startlist_teams
    WHERE "raceId"=v_job.race_id AND NOT(id=ANY(v_team_ids))
      AND ("teamId"=v_team_id OR public.fold_team_name("teamName")=public.fold_team_name(v_team->>'teamName'))
    ORDER BY ("sortOrder"=(v_team->>'sortOrder')::integer) DESC,id LIMIT 1;
    v_sl_team_id := COALESCE(v_sl_team_id,gen_random_uuid()::text);
    v_team_ids := array_append(v_team_ids,v_sl_team_id);
    v_team_rows := v_team_rows || jsonb_build_object('id',v_sl_team_id,'raceId',v_job.race_id,
      'teamName',COALESCE((SELECT name FROM public.teams WHERE id=v_team_id),v_team->>'teamName'),
      'teamId',v_team_id,'sortOrder',(v_team->>'sortOrder')::integer,
      'isConfirmed',COALESCE((v_team->>'isConfirmed')::boolean,false));
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_team->'riders') LOOP
      IF v_row->>'globalRiderId' IS NULL THEN
        -- Serializa altas con la misma clave entre carreras concurrentes.
        PERFORM pg_advisory_xact_lock(hashtextextended(v_gender || public.compute_identity_key(v_row->>'firstName',v_row->>'lastName'),0));
        SELECT * INTO v_rider_resolution FROM public.resolve_riders(v_gender,jsonb_build_array(v_row || jsonb_build_object('idx',0)));
        IF v_rider_resolution.matched_id IS NULL THEN RAISE EXCEPTION 'No se pudo crear la ficha del dorsal %',v_row->>'dorsal'; END IF;
        IF v_rider_resolution.created THEN
          IF v_gender='male' THEN
            UPDATE public.riders_men SET "birthDate"=(v_row->>'birthDate')::date,
              "otherNames"=NULLIF(v_row->>'otherNames',''),"uciProfileId"=NULLIF(v_row->>'uciProfileId',''),source='startlist_import'
            WHERE id=v_rider_resolution.matched_id;
          ELSE
            UPDATE public.riders_women SET "birthDate"=(v_row->>'birthDate')::date,
              "otherNames"=NULLIF(v_row->>'otherNames',''),"uciProfileId"=NULLIF(v_row->>'uciProfileId',''),source='startlist_import'
            WHERE id=v_rider_resolution.matched_id;
          END IF;
          v_created_riders := v_created_riders+1;
        ELSE
          SELECT "birthDate" INTO v_birth FROM (
            SELECT id,"birthDate" FROM public.riders_men WHERE v_gender='male'
            UNION ALL SELECT id,"birthDate" FROM public.riders_women WHERE v_gender='female'
          ) c WHERE id=v_rider_resolution.matched_id;
          IF v_birth IS DISTINCT FROM (v_row->>'birthDate')::date THEN
            RAISE EXCEPTION 'La ficha ha cambiado durante la importación; vuelve a preparar el dorsal %',v_row->>'dorsal' USING ERRCODE='40001';
          END IF;
        END IF;
        v_row := v_row || jsonb_build_object('globalRiderId',v_rider_resolution.matched_id);
      END IF;
      SELECT id INTO v_sl_rider_id FROM public.startlist_riders WHERE "raceId"=v_job.race_id AND dorsal=(v_row->>'dorsal')::int ORDER BY id LIMIT 1;
      v_sl_rider_id := COALESCE(v_sl_rider_id,gen_random_uuid()::text);
      v_rider_ids := array_append(v_rider_ids,v_sl_rider_id);
      v_rider_rows := v_rider_rows || (v_row || jsonb_build_object('id',v_sl_rider_id,'raceId',v_job.race_id,'teamId',v_sl_team_id));
    END LOOP;
  END LOOP;
  DELETE FROM public.startlist_riders WHERE "raceId"=v_job.race_id AND NOT(id=ANY(v_rider_ids));
  INSERT INTO public.startlist_teams(id,"raceId","teamName","teamId","sortOrder","isConfirmed")
  SELECT x.id,x."raceId",x."teamName",x."teamId",x."sortOrder",x."isConfirmed"
  FROM jsonb_to_recordset(v_team_rows) AS x(id text,"raceId" text,"teamName" text,"teamId" text,"sortOrder" int,"isConfirmed" boolean)
  ON CONFLICT(id) DO UPDATE SET "teamName"=EXCLUDED."teamName","teamId"=EXCLUDED."teamId",
    "sortOrder"=EXCLUDED."sortOrder","isConfirmed"=EXCLUDED."isConfirmed"
  WHERE (startlist_teams."teamName",startlist_teams."teamId",startlist_teams."sortOrder",startlist_teams."isConfirmed")
    IS DISTINCT FROM (EXCLUDED."teamName",EXCLUDED."teamId",EXCLUDED."sortOrder",EXCLUDED."isConfirmed");
  INSERT INTO public.startlist_riders(id,"raceId","teamId",dorsal,"firstName","lastName","countryCode","globalRiderId")
  SELECT x.id,x."raceId",x."teamId",x.dorsal,x."firstName",x."lastName",x."countryCode",x."globalRiderId"
  FROM jsonb_to_recordset(v_rider_rows) AS x(id text,"raceId" text,"teamId" text,dorsal int,"firstName" text,"lastName" text,"countryCode" text,"globalRiderId" text)
  ON CONFLICT(id) DO UPDATE SET "teamId"=EXCLUDED."teamId",dorsal=EXCLUDED.dorsal,
    "firstName"=EXCLUDED."firstName","lastName"=EXCLUDED."lastName",
    "countryCode"=EXCLUDED."countryCode","globalRiderId"=EXCLUDED."globalRiderId"
  WHERE (startlist_riders."teamId",startlist_riders.dorsal,startlist_riders."firstName",startlist_riders."lastName",startlist_riders."countryCode",startlist_riders."globalRiderId")
    IS DISTINCT FROM (EXCLUDED."teamId",EXCLUDED.dorsal,EXCLUDED."firstName",EXCLUDED."lastName",EXCLUDED."countryCode",EXCLUDED."globalRiderId");
  DELETE FROM public.startlist_teams WHERE "raceId"=v_job.race_id AND NOT(id=ANY(v_team_ids));
  IF (SELECT count(*) FROM public.startlist_riders WHERE "raceId"=v_job.race_id) <> cardinality(v_rider_ids)
     OR (SELECT count(DISTINCT "globalRiderId") FROM public.startlist_riders WHERE "raceId"=v_job.race_id) <> cardinality(v_rider_ids)
     OR EXISTS(SELECT 1 FROM public.startlist_riders WHERE "raceId"=v_job.race_id AND ("globalRiderId" IS NULL OR "countryCode" IS NULL)) THEN
    RAISE EXCEPTION 'No se cumple la integridad de la lista enriquecida';
  END IF;
  PERFORM public.sync_startlist_riders_to_canonical(v_job.race_id);
  PERFORM public.resolve_uci_results(v_job.race_id);
  UPDATE public.races SET "startlistImportedAt"=now(),"startlistProvisional"=v_job.provisional WHERE id=v_job.race_id;
  v_result := jsonb_build_object('importId',p_import_id,'status','applied','ready',true,'raceId',v_job.race_id,
    'teams',cardinality(v_team_ids),'riders',cardinality(v_rider_ids),'createdTeams',v_created_teams,'createdRiders',v_created_riders,'importedAt',now());
  UPDATE private.startlist_imports SET status='applied',result=v_result,updated_at=now() WHERE id=p_import_id;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ingest_startlist(p_race_id text, p_gender text, p_rows jsonb)
 RETURNS TABLE(teams_seeded integer, teams_matched integer, teams_unmatched integer, riders_seeded integer, riders_matched integer, riders_created integer, riders_unresolved integer, unmatched_teams text[], created_riders text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RAISE EXCEPTION 'ingest_startlist está retirado; usar prepare_startlist_import y apply_startlist_import con la lista completa' USING ERRCODE = '0A000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_uci_startlist(p_race_id text, p_gender text, p_rows jsonb)
 RETURNS TABLE(teams_seeded integer, riders_seeded integer, teams_matched integer, teams_unmatched integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row        jsonb;
  v_team_name  text;
  v_fold       text;
  v_team_id    text;
  v_st_id      text;
  v_gid        text;
  v_dorsal     int;
  v_sort       int := 0;
  v_seeded_t   int := 0;
  v_seeded_r   int := 0;
  v_matched    int := 0;
  v_unmatched  int := 0;
  v_is_devo    boolean;
  v_devo_in_rx constant text :=
    '(development|développement|\mdevo\M|\mu[ -]?23\M|academy|académie|rookies|\mgen[ -]?z\M|future racing|\mespoirs?\M|continentale?\M|generation)';
  v_devo_cat_rx constant text :=
    '(development|\mdevo\M|\mu[ -]?23\M|academy|rookies|\mgen[ -]?z\M|future racing|generation)';
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  DELETE FROM public.startlist_riders WHERE "raceId" = p_race_id;
  DELETE FROM public.startlist_teams  WHERE "raceId" = p_race_id;

  DROP TABLE IF EXISTS _uci_team_map;
  CREATE TEMP TABLE _uci_team_map (fold text PRIMARY KEY, st_id text, team_id text)
    ON COMMIT DROP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_team_name := NULLIF(btrim(v_row->>'teamName'), '');
    IF v_team_name IS NULL THEN CONTINUE; END IF;
    v_fold := COALESCE(public.fold_team_name(v_team_name), lower(v_team_name));
    CONTINUE WHEN EXISTS (SELECT 1 FROM _uci_team_map m WHERE m.fold = v_fold);

    v_is_devo := lower(v_team_name) ~ v_devo_in_rx;

    SELECT t.id INTO v_team_id
    FROM public.teams t
    WHERE NOT t."specialEdition"
      AND v_fold = ANY(t."foldedNames")
      AND (t.gender IS NULL OR t.gender = p_gender)
      AND (CASE WHEN v_is_devo
             THEN t.category IS NULL OR t.category NOT IN ('WT','WWT','PT','PRW')
                  OR lower(t.name) ~ v_devo_in_rx
             ELSE NOT (lower(t.name) ~ v_devo_cat_rx) END)
    LIMIT 1;

    IF v_team_id IS NULL AND length(v_fold) >= 4 THEN
      SELECT t.id INTO v_team_id
      FROM public.teams t, unnest(t."foldedNames") AS fn
      WHERE NOT t."specialEdition"
        AND length(fn) >= 4
        AND (fn LIKE '%'||v_fold||'%' OR v_fold LIKE '%'||fn||'%')
        AND (t.gender IS NULL OR t.gender = p_gender)
        AND (CASE WHEN v_is_devo
               THEN t.category IS NULL OR t.category NOT IN ('WT','WWT','PT','PRW')
                    OR lower(t.name) ~ v_devo_in_rx
               ELSE NOT (lower(t.name) ~ v_devo_cat_rx) END)
      LIMIT 1;
    END IF;

    IF v_team_id IS NOT NULL THEN v_matched := v_matched + 1; ELSE v_unmatched := v_unmatched + 1; END IF;

    v_st_id := 'sluci_' || md5(p_race_id || '|' || v_fold);
    INSERT INTO public.startlist_teams (id, "raceId", "teamName", "sortOrder", "teamId", "isConfirmed")
    VALUES (v_st_id, p_race_id, v_team_name, v_sort, v_team_id, false);
    v_seeded_t := v_seeded_t + 1;
    v_sort := v_sort + 1;
    INSERT INTO _uci_team_map (fold, st_id, team_id) VALUES (v_fold, v_st_id, v_team_id);
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    CONTINUE WHEN (v_row->>'bib') IS NULL OR (v_row->>'bib') !~ '^[0-9]+$';
    v_dorsal := (v_row->>'bib')::int;
    v_team_name := NULLIF(btrim(v_row->>'teamName'), '');
    v_fold := CASE WHEN v_team_name IS NULL THEN NULL
                   ELSE COALESCE(public.fold_team_name(v_team_name), lower(v_team_name)) END;
    v_st_id := NULL;
    IF v_fold IS NOT NULL THEN
      SELECT m.st_id INTO v_st_id FROM _uci_team_map m WHERE m.fold = v_fold;
    END IF;
    IF v_st_id IS NULL THEN
      SELECT m.st_id INTO v_st_id FROM _uci_team_map m WHERE m.fold = '\x00individual';
      IF v_st_id IS NULL THEN
        v_st_id := 'sluci_' || md5(p_race_id || '|individual');
        INSERT INTO public.startlist_teams (id, "raceId", "teamName", "sortOrder", "teamId", "isConfirmed")
        VALUES (v_st_id, p_race_id, 'Individual', 9999, NULL, false);
        INSERT INTO _uci_team_map (fold, st_id, team_id) VALUES ('\x00individual', v_st_id, NULL);
        v_seeded_t := v_seeded_t + 1;
      END IF;
    END IF;

    SELECT r."globalRiderId" INTO v_gid
    FROM public.race_uci_results r
    JOIN public.race_uci_stages st ON st.id = r."stageRef"
    WHERE r."raceId" = p_race_id AND st."isTeamEvent" = false
      AND r.bib = v_dorsal::text AND r."globalRiderId" IS NOT NULL
    LIMIT 1;

    INSERT INTO public.startlist_riders
      (id, "teamId", "raceId", dorsal, "firstName", "lastName", "countryCode", "globalRiderId")
    VALUES (
      'sruci_' || md5(p_race_id || '|' || v_dorsal::text),
      v_st_id, p_race_id, v_dorsal,
      '', '',
      NULLIF(lower(COALESCE(v_row->>'countryCode','')), ''),
      v_gid
    )
    ON CONFLICT (id) DO NOTHING;
    v_seeded_r := v_seeded_r + 1;
  END LOOP;



  teams_seeded := v_seeded_t; riders_seeded := v_seeded_r;
  teams_matched := v_matched; teams_unmatched := v_unmatched;
  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION private.startlist_import_snapshot(p_race_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'race', (SELECT jsonb_build_object('gender',gender,'year',year,'startDate',"startDate",'endDate',"endDate",'startlistImportedAt', "startlistImportedAt",
      'startlistProvisional', "startlistProvisional")
      FROM public.races WHERE id = p_race_id),
    'teams', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)
      FROM public.startlist_teams t WHERE "raceId" = p_race_id), '[]'::jsonb),
    'riders', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
      FROM public.startlist_riders r WHERE "raceId" = p_race_id), '[]'::jsonb));
$function$;

ALTER TABLE public.races DROP COLUMN "enrichedStartlist";
ALTER TABLE public.races ADD COLUMN "enrichedStartlist" boolean GENERATED ALWAYS AS (true) STORED;
COMMENT ON COLUMN public.races."enrichedStartlist" IS 'Compatibilidad de lectura para apps anteriores: constante true, sin estado de enriquecimiento por carrera.';
NOTIFY pgrst, 'reload schema';
