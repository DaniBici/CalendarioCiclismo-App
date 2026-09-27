-- Detección de colisiones de nombre canónico entre fichas WT y CT al
-- importar listas. Una filial continental comparte pliegue de marca con su
-- equipo madre por diseño (fold_team_name elimina «development»,
-- «continental», «team»…): produce AMBIGUOUS_TEAM y se resuelve con
-- override. Pero dos fichas de categorías WT/CT (o WWT/CTW) cuyo pliegue
-- canónico coincide sin que ningún nombre lleve marcador de filial son un
-- catálogo corrupto que ningún override repara: exige saneo. La preparación
-- lo informa como TEAM_ALIAS_COLLISION y bloquea la aplicación hasta
-- corregir el catálogo.
CREATE OR REPLACE FUNCTION private.plan_startlist_import(p_race_id text, p_document jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_gender text; v_year integer; v_team jsonb; v_row jsonb; v_team_plan jsonb;
  v_teams jsonb := '[]'; v_rows jsonb; v_issues jsonb := '[]';
  v_matches jsonb; v_candidates jsonb; v_rider jsonb; v_team_ids text[];
  v_tokens text[]; v_key text; v_gid text; v_country text; v_birth date;
  v_bibs integer[] := '{}'; v_gids text[] := '{}'; v_new_keys text[] := '{}'; v_bib integer;
  v_count integer := 0; v_existing integer := 0; v_new integer := 0;
  v_new_teams integer := 0; v_team_idx integer := 0; v_team_id text;
  v_race public.races%ROWTYPE; v_catalog_team public.teams%ROWTYPE; v_collision record;
  v_filial text := '(develop|devo|continent|conti|acad|rook|u2[0-9]|u1[0-9]|junior|next gen|gen[ -]?z|future|(^|[^a-z])ct([^a-z]|$))';
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
    -- Fichas WT y CT alcanzadas por este equipo con el mismo pliegue canónico
    -- y sin marcador de filial en ninguno de los dos nombres: colisión de
    -- catálogo no subsanable con override.
    v_team_ids := CASE WHEN v_team_id IS NOT NULL THEN ARRAY[v_team_id]
      ELSE COALESCE(v_team_ids,'{}'::text[]) END;
    IF cardinality(v_team_ids) > 0 THEN
      FOR v_collision IN
        SELECT a.id AS id_a, a.name AS name_a, a.category AS category_a,
               b.id AS id_b, b.name AS name_b, b.category AS category_b
        FROM public.teams a
        JOIN public.teams b ON b.id > a.id
        WHERE (a.id = ANY(v_team_ids) OR b.id = ANY(v_team_ids))
          AND (a.category,b.category) IN (('WT','CT'),('CT','WT'),('WWT','CTW'),('CTW','WWT'))
          AND a."historicalCatalogOnly" IS NOT TRUE AND b."historicalCatalogOnly" IS NOT TRUE
          AND a."specialEdition" IS NOT TRUE AND b."specialEdition" IS NOT TRUE
          AND (a.gender IS NULL OR b.gender IS NULL OR a.gender = b.gender)
          AND public.fold_team_name(a.name) = public.fold_team_name(b.name)
          AND lower(a.name) !~ v_filial AND lower(b.name) !~ v_filial
      LOOP
        v_issues := v_issues || jsonb_build_object('code','TEAM_ALIAS_COLLISION',
          'teamIndex',v_team_idx,'teamName',v_team->>'teamName',
          'worldTeamId',CASE WHEN v_collision.category_a IN ('WT','WWT') THEN v_collision.id_a ELSE v_collision.id_b END,
          'worldTeamName',CASE WHEN v_collision.category_a IN ('WT','WWT') THEN v_collision.name_a ELSE v_collision.name_b END,
          'continentalId',CASE WHEN v_collision.category_a IN ('CT','CTW') THEN v_collision.id_a ELSE v_collision.id_b END,
          'continentalName',CASE WHEN v_collision.category_a IN ('CT','CTW') THEN v_collision.name_a ELSE v_collision.name_b END);
      END LOOP;
    END IF;
    v_rows := '[]';
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_team->'riders') LOOP
      v_count := v_count + 1;
      IF COALESCE(v_row->>'dorsal','') !~ '^[1-9][0-9]{0,8}$' THEN
        RAISE EXCEPTION 'Dorsal inválido: %', v_row->>'dorsal';
      END IF;
      v_bib := (v_row->>'dorsal')::integer;
      IF v_bib = ANY(v_bibs) THEN RAISE EXCEPTION 'Dorsal duplicado: %', v_bib; END IF;
      v_bibs := array_append(v_bibs,v_bib);
      IF NULLIF(btrim(v_row->>'firstName'),'') IS NULL OR NULLIF(btrim(v_row->>'lastName'),'') IS NULL THEN
        RAISE EXCEPTION 'Falta nombre/apellido en el dorsal %', v_bib;
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
          v_issues := v_issues || jsonb_build_object('code','IDENTITY_CONFLICT','dorsal',v_bib,
            'firstName',v_row->>'firstName','lastName',v_row->>'lastName','candidates',v_matches);
        END IF;
        v_gid := v_rider->>'id'; v_existing := v_existing + 1;
      ELSIF v_gid IS NOT NULL THEN
        RAISE EXCEPTION 'La ficha % no existe en el catálogo de esta carrera', v_gid;
      ELSIF jsonb_array_length(v_matches) > 1 THEN
        v_candidates := v_matches;
      ELSE
        v_tokens := regexp_split_to_array(public.fold_name((v_row->>'firstName') || ' ' || (v_row->>'lastName')), '[^a-z0-9]+');
        WITH catalog AS (
          SELECT id,"firstName","lastName","otherNames",nationality,"birthDate","identityKey" FROM public.riders_men WHERE v_gender = 'male'
          UNION ALL SELECT id,"firstName","lastName","otherNames",nationality,"birthDate","identityKey" FROM public.riders_women WHERE v_gender = 'female'
        ), candidates AS (
          SELECT c.*, regexp_split_to_array(public.fold_name(c."firstName" || ' ' || c."lastName"), '[^a-z0-9]+') AS tokens
          FROM catalog c
        ) SELECT COALESCE(jsonb_agg(to_jsonb(c) - 'tokens' - 'identityKey'),'[]') INTO v_candidates
        FROM candidates c WHERE c.tokens @> v_tokens OR v_tokens @> c.tokens
          OR (public.fold_name(c."lastName") = public.fold_name(v_row->>'lastName')
              AND left(public.fold_name(c."firstName"),1) = left(public.fold_name(v_row->>'firstName'),1));
      END IF;
      IF v_gid IS NULL AND jsonb_array_length(v_candidates) > 0 THEN
        -- Solo se descartan candidatos revisados por id; una coincidencia exacta
        -- ambigua requiere siempre selección, no puede convertirse en alta.
        IF jsonb_array_length(v_matches) > 1 OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_candidates) c
          WHERE NOT (COALESCE(v_row->'rejectedCandidateIds','[]'::jsonb) ? (c->>'id'))
        ) THEN
          v_issues := v_issues || jsonb_build_object('code','REVIEW_RIDER','dorsal',v_bib,
            'firstName',v_row->>'firstName','lastName',v_row->>'lastName','candidates',v_candidates);
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
        v_issues := v_issues || jsonb_build_object('code','MISSING_COUNTRY','dorsal',v_bib,
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
          v_issues := v_issues || jsonb_build_object('code','MISSING_BIRTH_DATE','dorsal',v_bib,
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
