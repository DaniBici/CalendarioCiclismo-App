-- Permite listas enriquecidas sin dorsales: dorsal=0 es el valor interno y puede
-- repetirse. Los dorsales positivos siguen siendo únicos. El editor conserva la
-- identidad de cada fila mediante startlistRiderId y rowKey.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private.plan_startlist_import(p_race_id text, p_document jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_gender text; v_year integer; v_team jsonb; v_row jsonb; v_team_plan jsonb;
  v_teams jsonb := '[]'; v_rows jsonb; v_issues jsonb := '[]';
  v_matches jsonb; v_candidates jsonb; v_rider jsonb; v_team_ids text[];
  v_tokens text[]; v_candidate_catalog jsonb; v_last_fold text; v_first_initial text;
  v_key text; v_gid text; v_country text; v_birth date; v_row_key text; v_sl_rider_id text;
  v_bibs integer[] := '{}'; v_gids text[] := '{}'; v_new_keys text[] := '{}'; v_bib integer;
  v_row_keys text[] := '{}'; v_sl_rider_ids text[] := '{}';
  v_count integer := 0; v_existing integer := 0; v_new integer := 0;
  v_new_teams integer := 0; v_team_idx integer := 0; v_team_id text;
  v_race public.races%ROWTYPE; v_catalog_team public.teams%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_race FROM public.races WHERE id = p_race_id;
  v_gender := v_race.gender; v_year := COALESCE(v_race."year", extract(year FROM current_date)::int);
  IF v_gender NOT IN ('male','female') OR v_gender IS NULL THEN
    RAISE EXCEPTION 'La carrera debe tener género male/female';
  END IF;
  IF jsonb_typeof(p_document->'teams') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_document->'teams') = 0 THEN
    RAISE EXCEPTION 'La lista requiere equipos y corredores';
  END IF;
  IF p_document->>'raceId' IS DISTINCT FROM p_race_id THEN
    RAISE EXCEPTION 'El raceId del documento no coincide con el destino';
  END IF;
  FOR v_team IN SELECT value FROM jsonb_array_elements(p_document->'teams') LOOP
    IF NULLIF(btrim(v_team->>'teamName'),'') IS NULL
       OR jsonb_typeof(v_team->'riders') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_team->'riders') = 0 THEN
      RAISE EXCEPTION 'Cada equipo requiere teamName y corredores';
    END IF;
    v_team_id := NULLIF(v_team->>'teamId','');
    IF v_team_id IS NOT NULL THEN
      SELECT * INTO v_catalog_team FROM public.teams WHERE id = v_team_id;
      IF NOT FOUND OR (v_catalog_team.gender IS NOT NULL AND v_catalog_team.gender <> v_gender) THEN
        RAISE EXCEPTION 'Equipo inexistente o incompatible: %', v_team_id;
      END IF;
      IF v_catalog_team."specialEdition" AND (
        (v_catalog_team."specialEditionRaceId" IS NOT NULL AND v_catalog_team."specialEditionRaceId" <> p_race_id)
        OR (v_catalog_team."specialEditionValidFrom" IS NOT NULL AND v_race."startDate"::date < v_catalog_team."specialEditionValidFrom")
        OR (v_catalog_team."specialEditionValidTo" IS NOT NULL AND v_race."endDate"::date > v_catalog_team."specialEditionValidTo")
      ) THEN RAISE EXCEPTION 'El maillot especial no corresponde a esta carrera'; END IF;
    ELSE
      SELECT array_agg(DISTINCT t.id) INTO v_team_ids
      FROM public.teams t LEFT JOIN public.team_name_aliases a
        ON a."teamId" = t.id AND a.year = v_year
        AND a."foldedName" = public.fold_team_name(v_team->>'teamName')
      WHERE t."specialEdition" IS NOT TRUE AND (t.gender IS NULL OR t.gender = v_gender)
        AND (a.id IS NOT NULL OR public.fold_team_name(t.name) = public.fold_team_name(v_team->>'teamName')
          OR public.fold_team_name(v_team->>'teamName') = ANY(t."foldedNames"));
      IF cardinality(v_team_ids) = 1 THEN v_team_id := v_team_ids[1];
      ELSIF cardinality(v_team_ids) > 1 THEN
        v_issues := v_issues || jsonb_build_object('code','AMBIGUOUS_TEAM','teamIndex',v_team_idx,
          'teamName',v_team->>'teamName','candidateIds',to_jsonb(v_team_ids));
      ELSIF NOT public.is_startlist_no_team_placeholder(v_team->>'teamName') THEN
        v_new_teams := v_new_teams + 1;
      END IF;
    END IF;
    v_rows := '[]';
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_team->'riders') LOOP
      v_count := v_count + 1;
      v_row_key := COALESCE(NULLIF(v_row->>'rowKey',''), v_team_idx::text || ':' || (v_count - 1)::text);
      IF v_row_key = ANY(v_row_keys) THEN RAISE EXCEPTION 'Identificador de fila duplicado: %', v_row_key; END IF;
      v_row_keys := array_append(v_row_keys,v_row_key);
      v_row := v_row || jsonb_build_object('rowKey',v_row_key);
      IF COALESCE(v_row->>'dorsal','') !~ '^(0|[1-9][0-9]{0,8})$' THEN
        RAISE EXCEPTION 'Dorsal inválido: %', v_row->>'dorsal';
      END IF;
      v_bib := (v_row->>'dorsal')::integer;
      IF v_bib > 0 THEN
        IF v_bib = ANY(v_bibs) THEN RAISE EXCEPTION 'Dorsal duplicado: %', v_bib; END IF;
        v_bibs := array_append(v_bibs,v_bib);
      END IF;
      v_sl_rider_id := NULLIF(v_row->>'startlistRiderId','');
      IF v_sl_rider_id IS NOT NULL THEN
        IF v_sl_rider_id = ANY(v_sl_rider_ids) THEN
          RAISE EXCEPTION 'Fila de startlist duplicada: %', v_sl_rider_id;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.startlist_riders sr
          WHERE sr.id = v_sl_rider_id AND sr."raceId" = p_race_id) THEN
          RAISE EXCEPTION 'La fila de startlist % no pertenece a esta carrera', v_sl_rider_id;
        END IF;
        v_sl_rider_ids := array_append(v_sl_rider_ids,v_sl_rider_id);
      END IF;
      IF NULLIF(btrim(v_row->>'firstName'),'') IS NULL OR NULLIF(btrim(v_row->>'lastName'),'') IS NULL THEN
        RAISE EXCEPTION 'Falta nombre/apellido en la fila %', v_row_key;
      END IF;
      IF v_row ? 'rejectedCandidateIds' AND jsonb_typeof(v_row->'rejectedCandidateIds') <> 'array' THEN
        RAISE EXCEPTION 'rejectedCandidateIds debe ser un array de identificadores';
      END IF;
      v_gid := NULLIF(v_row->>'globalRiderId','');
      v_key := public.compute_identity_key(v_row->>'firstName',v_row->>'lastName');
      WITH catalog AS (
        SELECT m.* FROM public.riders_men m WHERE v_gender = 'male'
        UNION ALL SELECT w.* FROM public.riders_women w WHERE v_gender = 'female'
      ) SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]') INTO v_matches FROM catalog c
      WHERE CASE WHEN v_gid IS NOT NULL THEN c.id = v_gid ELSE
        c."identityKey" = v_key
        OR (NULLIF(v_row->>'uciProfileId','') IS NOT NULL AND c."uciProfileId" = v_row->>'uciProfileId')
        OR EXISTS (SELECT 1 FROM public.rider_identity_aliases a WHERE a.gender = v_gender
          AND a."aliasKey" = v_key AND a."riderId" = c.id) END;
      v_rider := NULL; v_candidates := '[]';
      IF jsonb_array_length(v_matches) = 1 THEN
        v_rider := v_matches->0;
        IF v_gid IS NULL AND (
          (NULLIF(v_row->>'birthDate','') IS NOT NULL AND v_rider->>'birthDate' IS NOT NULL
            AND v_row->>'birthDate' <> v_rider->>'birthDate')
          OR (NULLIF(v_row->>'uciProfileId','') IS NOT NULL AND v_rider->>'uciProfileId' IS NOT NULL
            AND v_row->>'uciProfileId' <> v_rider->>'uciProfileId')
        ) THEN
          v_issues := v_issues || jsonb_build_object('code','IDENTITY_CONFLICT','rowKey',v_row_key,'dorsal',v_bib,
            'firstName',v_row->>'firstName','lastName',v_row->>'lastName','candidates',v_matches);
        END IF;
        v_gid := v_rider->>'id'; v_existing := v_existing + 1;
      ELSIF v_gid IS NOT NULL THEN
        RAISE EXCEPTION 'La ficha % no existe en el catálogo de esta carrera', v_gid;
      ELSIF jsonb_array_length(v_matches) > 1 THEN
        v_candidates := v_matches;
      ELSE
        v_tokens := regexp_split_to_array(public.fold_name((v_row->>'firstName') || ' ' || (v_row->>'lastName')), '[^a-z0-9]+');
        IF v_candidate_catalog IS NULL THEN
          WITH catalog AS (
            SELECT id,"firstName","lastName","otherNames",nationality,"birthDate" FROM public.riders_men WHERE v_gender = 'male'
            UNION ALL SELECT id,"firstName","lastName","otherNames",nationality,"birthDate" FROM public.riders_women WHERE v_gender = 'female'
          ) SELECT COALESCE(jsonb_agg(to_jsonb(c) || jsonb_build_object(
            'tokens',regexp_split_to_array(public.fold_name(c."firstName" || ' ' || c."lastName"), '[^a-z0-9]+'),
            'foldedLast',public.fold_name(c."lastName"),
            'firstInitial',left(public.fold_name(c."firstName"),1))), '[]')
          INTO v_candidate_catalog FROM catalog c;
        END IF;
        v_last_fold := public.fold_name(v_row->>'lastName');
        v_first_initial := left(public.fold_name(v_row->>'firstName'),1);
        SELECT COALESCE(jsonb_agg(c - ARRAY['tokens','foldedLast','firstInitial']),'[]')
        INTO v_candidates FROM jsonb_array_elements(v_candidate_catalog) c
        WHERE c->'tokens' @> to_jsonb(v_tokens) OR to_jsonb(v_tokens) @> c->'tokens'
          OR (c->>'foldedLast' = v_last_fold AND c->>'firstInitial' = v_first_initial);
      END IF;
      IF v_gid IS NULL AND jsonb_array_length(v_candidates) > 0 THEN
        IF jsonb_array_length(v_matches) > 1 OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_candidates) c
          WHERE NOT (COALESCE(v_row->'rejectedCandidateIds','[]'::jsonb) ? (c->>'id'))
        ) THEN
          v_issues := v_issues || jsonb_build_object('code','REVIEW_RIDER','rowKey',v_row_key,'dorsal',v_bib,
            'firstName',v_row->>'firstName','lastName',v_row->>'lastName',
            'canCreate',jsonb_array_length(v_matches)=0,'candidates',v_candidates);
        END IF;
      END IF;
      IF v_gid IS NOT NULL THEN
        IF v_gid = ANY(v_gids) THEN RAISE EXCEPTION 'Ficha duplicada en la lista: %', v_gid; END IF;
        v_gids := array_append(v_gids,v_gid);
      ELSE
        IF v_key = ANY(v_new_keys) THEN RAISE EXCEPTION 'Identidad nueva duplicada: %',v_key; END IF;
        v_new_keys := array_append(v_new_keys,v_key);
        v_new := v_new + 1;
      END IF;
      v_country := lower(COALESCE(NULLIF(v_row->>'countryCode',''), NULLIF(v_rider->>'nationality','')));
      IF COALESCE(v_country,'') !~ '^[a-z]{2}$' THEN
        v_issues := v_issues || jsonb_build_object('code','MISSING_COUNTRY','rowKey',v_row_key,'dorsal',v_bib,
          'firstName',v_row->>'firstName','lastName',v_row->>'lastName');
      END IF;
      v_birth := NULL;
      IF v_gid IS NULL THEN
        BEGIN
          IF COALESCE(v_row->>'birthDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            v_birth := (v_row->>'birthDate')::date;
          END IF;
        EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN v_birth := NULL;
        END;
        IF v_birth IS NULL OR v_birth >= current_date OR v_birth < date '1900-01-01' THEN
          v_issues := v_issues || jsonb_build_object('code','MISSING_BIRTH_DATE','rowKey',v_row_key,'dorsal',v_bib,
            'firstName',v_row->>'firstName','lastName',v_row->>'lastName');
        END IF;
      END IF;
      v_rows := v_rows || (v_row || jsonb_build_object('dorsal',v_bib,'globalRiderId',v_gid,
        'firstName',COALESCE(v_rider->>'firstName',v_row->>'firstName'),
        'lastName',COALESCE(v_rider->>'lastName',v_row->>'lastName'),
        'countryCode',v_country,'resolutionAction',CASE WHEN v_gid IS NULL THEN 'create' ELSE 'exact' END));
    END LOOP;
    v_team_plan := v_team || jsonb_build_object('teamId',v_team_id,'sortOrder',v_team_idx,'riders',v_rows);
    v_teams := v_teams || v_team_plan; v_team_idx := v_team_idx + 1;
  END LOOP;
  IF COALESCE(p_document->>'expectedRiderCount','') !~ '^[1-9][0-9]*$'
     OR (p_document->>'expectedRiderCount')::integer <> v_count THEN
    RAISE EXCEPTION 'El recuento de la fuente no coincide con los % corredores extraídos', v_count;
  END IF;
  RETURN jsonb_build_object('ready',jsonb_array_length(v_issues)=0,'issues',v_issues,
    'summary',jsonb_build_object('teams',v_team_idx,'riders',v_count,'existingRiders',v_existing,
      'newRiders',v_new,'newTeams',v_new_teams),
    'document',p_document || jsonb_build_object('teams',v_teams));
END;
$$;
REVOKE ALL ON FUNCTION private.plan_startlist_import(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.plan_startlist_import(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_startlist_import(p_import_id uuid, p_overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_job private.startlist_imports%ROWTYPE; v_plan jsonb; v_doc jsonb;
  v_team jsonb; v_row jsonb; v_patch jsonb; v_teams jsonb := '[]'; v_rows jsonb;
  v_team_rows jsonb := '[]'; v_rider_rows jsonb := '[]'; v_result jsonb;
  v_team_id text; v_sl_team_id text; v_sl_rider_id text; v_requested_sl_rider_id text; v_gender text;
  v_resolution record; v_rider_resolution record; v_idx integer := 0;
  v_team_ids text[] := '{}'; v_rider_ids text[] := '{}';
  v_created_riders integer := 0; v_created_teams integer := 0; v_override_key text;
  v_override_matches integer; v_birth date;
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
    RAISE EXCEPTION 'Las correcciones se identifican por dorsal/rowKey e índice de equipo';
  END IF;
  FOR v_override_key IN SELECT jsonb_object_keys(COALESCE(p_overrides->'riders','{}')) LOOP
    SELECT count(*) INTO v_override_matches
    FROM jsonb_array_elements(v_job.document->'teams') t,
      jsonb_array_elements(t->'riders') r
    WHERE r->>'rowKey'=v_override_key OR r->>'dorsal'=v_override_key;
    IF v_override_matches <> 1 THEN
      RAISE EXCEPTION 'Identificador de corredor ajeno o ambiguo en el borrador: %',v_override_key;
    END IF;
  END LOOP;
  FOR v_override_key IN SELECT jsonb_object_keys(COALESCE(p_overrides->'teams','{}')) LOOP
    IF v_override_key !~ '^(0|[1-9][0-9]{0,4})$'
       OR v_override_key::int >= jsonb_array_length(v_job.document->'teams') THEN
      RAISE EXCEPTION 'Índice de equipo ajeno al borrador: %',v_override_key;
    END IF;
  END LOOP;
  FOR v_team IN SELECT value FROM jsonb_array_elements(v_job.document->'teams') LOOP
    v_patch := COALESCE(p_overrides->'teams'->v_idx::text,'{}'::jsonb);
    IF jsonb_typeof(v_patch) IS DISTINCT FROM 'object' OR (v_patch - ARRAY['teamId','teamName']) <> '{}'::jsonb THEN RAISE EXCEPTION 'Campos de equipo no admitidos'; END IF;
    v_team := v_team || v_patch; v_rows := '[]';
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_team->'riders') LOOP
      v_patch := COALESCE(p_overrides->'riders'->(v_row->>'rowKey'),
        p_overrides->'riders'->(v_row->>'dorsal'),'{}'::jsonb);
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
        PERFORM pg_advisory_xact_lock(hashtextextended(v_gender || public.compute_identity_key(v_row->>'firstName',v_row->>'lastName'),0));
        SELECT * INTO v_rider_resolution FROM public.resolve_riders(v_gender,jsonb_build_array(v_row || jsonb_build_object('idx',0)));
        IF v_rider_resolution.matched_id IS NULL THEN RAISE EXCEPTION 'No se pudo crear la ficha de la fila %',v_row->>'rowKey'; END IF;
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
            RAISE EXCEPTION 'La ficha ha cambiado durante la importación; vuelve a preparar la fila %',v_row->>'rowKey' USING ERRCODE='40001';
          END IF;
        END IF;
        v_row := v_row || jsonb_build_object('globalRiderId',v_rider_resolution.matched_id);
      END IF;
      v_requested_sl_rider_id := NULLIF(v_row->>'startlistRiderId','');
      v_sl_rider_id := NULL;
      IF v_requested_sl_rider_id IS NOT NULL THEN
        SELECT sr.id INTO v_sl_rider_id FROM public.startlist_riders sr
        WHERE sr.id=v_requested_sl_rider_id AND sr."raceId"=v_job.race_id
          AND NOT(sr.id=ANY(v_rider_ids));
      ELSIF (v_row->>'dorsal')::integer > 0 THEN
        SELECT sr.id INTO v_sl_rider_id FROM public.startlist_riders sr
        WHERE sr."raceId"=v_job.race_id AND sr.dorsal=(v_row->>'dorsal')::int
          AND NOT(sr.id=ANY(v_rider_ids)) ORDER BY sr.id LIMIT 1;
      ELSE
        SELECT sr.id INTO v_sl_rider_id FROM public.startlist_riders sr
        WHERE sr."raceId"=v_job.race_id AND sr."globalRiderId"=v_row->>'globalRiderId'
          AND NOT(sr.id=ANY(v_rider_ids)) ORDER BY sr.id LIMIT 1;
      END IF;
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
$$;
REVOKE ALL ON FUNCTION public.apply_startlist_import(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_startlist_import(uuid,jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_startlist_import(uuid,jsonb) IS
  'Aplica listas enriquecidas con dorsales positivos únicos o dorsal 0 repetible para corredores aún sin número; conserva filas mediante startlistRiderId.';
