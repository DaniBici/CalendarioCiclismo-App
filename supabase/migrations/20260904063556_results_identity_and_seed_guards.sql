CREATE OR REPLACE FUNCTION public.resolve_uci_results_by_name(p_race_id text, p_gender text, p_rows jsonb)
 RETURNS TABLE(matched integer, created integer, unresolved integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row        jsonb;
  v_bib        text;
  v_has_bib    boolean;
  v_display    text;
  v_first      text;
  v_last       text;
  v_country    text;
  v_birth      date;
  v_ikey       text;
  v_found      text;
  v_base       text;
  v_candidate  text;
  v_n          int;
  v_created    int := 0;
  v_cands      text[];   -- (091) candidatos por subconjunto de tokens
  v_by_birth   text[];   -- (091) ídem con fecha de nacimiento igual
  v_by_ctry    text[];   -- (091) ídem con nacionalidad igual
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_bib     := NULLIF(v_row->>'bib', '');
    v_has_bib := v_bib IS NOT NULL AND v_bib ~ '^[0-9]+$';
    v_display := NULLIF(v_row->>'display', '');
    v_first   := COALESCE(v_row->>'firstName', '');
    v_last    := COALESCE(v_row->>'lastName', '');
    v_country := NULLIF(lower(COALESCE(v_row->>'countryCode','')), '');
    v_birth := NULL;
    BEGIN
      IF v_row->>'birthDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        v_birth := (v_row->>'birthDate')::date;
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      v_birth := NULL;
    END;
    v_ikey    := public.compute_identity_key(v_first, v_last);

    -- (093) sin identidad no hay nada que hacer; sin bib NI display tampoco
    -- (no habría forma de dirigir el UPDATE final).
    CONTINUE WHEN v_ikey IS NULL OR (NOT v_has_bib AND v_display IS NULL);

    -- Solo filas pendientes: no investigar ni repuntar identidades ya resueltas.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.race_uci_results r
      JOIN public.race_uci_stages st ON st.id=r."stageRef"
      WHERE r."raceId"=p_race_id AND NOT st."isTeamEvent" AND r."globalRiderId" IS NULL
        AND ((v_has_bib AND r.bib=v_bib)
          OR (NOT v_has_bib AND (r.bib IS NULL OR r.bib !~ '^[0-9]+$') AND r."riderDisplay"=v_display))
        AND (v_display IS NULL OR public.compute_identity_key(r."riderDisplay",'')=public.compute_identity_key(v_display,''))
    );
    v_cands := '{}';
    IF p_gender = 'male' THEN
      SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
    ELSE
      SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
    END IF;

    -- (094) Paso 2.25 — alias de identidad: clave de una ficha FUSIONADA →
    -- su superviviente. Prioridad sobre el subconjunto 091 (mapeo curado).
    IF v_found IS NULL THEN
      IF p_gender = 'male' THEN
        SELECT a."riderId" INTO v_found
          FROM public.rider_identity_aliases a
          JOIN public.riders_men m ON m.id = a."riderId"
         WHERE a."aliasKey" = v_ikey AND a.gender = 'male'
           AND (v_birth IS NULL OR m."birthDate" IS NULL OR m."birthDate"=v_birth)
           AND (v_country IS NULL OR m.nationality IS NULL OR m.nationality=v_country);
      ELSE
        SELECT a."riderId" INTO v_found
          FROM public.rider_identity_aliases a
          JOIN public.riders_women w ON w.id = a."riderId"
         WHERE a."aliasKey" = v_ikey AND a.gender = 'female'
           AND (v_birth IS NULL OR w."birthDate" IS NULL OR w."birthDate"=v_birth)
           AND (v_country IS NULL OR w.nationality IS NULL OR w.nationality=v_country);
      END IF;
    END IF;

    -- (091) Paso 2.5 — subconjunto de tokens (nombre largo UCI vs corto de
    -- la ficha, o al revés). Solo si el exacto no casó.
    IF v_found IS NULL THEN
      IF p_gender = 'male' THEN
        SELECT coalesce(array_agg(m.id), '{}'),
               coalesce(array_agg(m.id) FILTER (WHERE v_birth IS NOT NULL AND m."birthDate" IS NOT NULL AND m."birthDate" = v_birth), '{}'),
               coalesce(array_agg(m.id) FILTER (WHERE v_country IS NOT NULL AND m.nationality = v_country), '{}')
          INTO v_cands, v_by_birth, v_by_ctry
          FROM public.riders_men m
         WHERE m."identityKey" IS NOT NULL
           AND m."identityKey" <> v_ikey
           AND (m."birthDate" IS NULL OR v_birth IS NULL OR m."birthDate" = v_birth)
           AND ((array_length(string_to_array(m."identityKey", '-'), 1) >= 2
                 AND string_to_array(m."identityKey", '-') <@ string_to_array(v_ikey, '-'))
             OR (array_length(string_to_array(v_ikey, '-'), 1) >= 2
                 AND string_to_array(v_ikey, '-') <@ string_to_array(m."identityKey", '-')));
      ELSE
        SELECT coalesce(array_agg(w.id), '{}'),
               coalesce(array_agg(w.id) FILTER (WHERE v_birth IS NOT NULL AND w."birthDate" IS NOT NULL AND w."birthDate" = v_birth), '{}'),
               coalesce(array_agg(w.id) FILTER (WHERE v_country IS NOT NULL AND w.nationality = v_country), '{}')
          INTO v_cands, v_by_birth, v_by_ctry
          FROM public.riders_women w
         WHERE w."identityKey" IS NOT NULL
           AND w."identityKey" <> v_ikey
           AND (w."birthDate" IS NULL OR v_birth IS NULL OR w."birthDate" = v_birth)
           AND ((array_length(string_to_array(w."identityKey", '-'), 1) >= 2
                 AND string_to_array(w."identityKey", '-') <@ string_to_array(v_ikey, '-'))
             OR (array_length(string_to_array(v_ikey, '-'), 1) >= 2
                 AND string_to_array(v_ikey, '-') <@ string_to_array(w."identityKey", '-')));
      END IF;

      IF array_length(v_cands, 1) = 1 THEN
        v_found := v_cands[1];
      ELSIF array_length(v_by_birth, 1) = 1 THEN
        v_found := v_by_birth[1];
      ELSIF array_length(v_by_ctry, 1) = 1 THEN
        v_found := v_by_ctry[1];
      END IF;
    END IF;

    IF v_found IS NULL THEN
      -- Una ausencia no autoriza una ficha incompleta ni una duplicación ambigua.
      CONTINUE WHEN cardinality(v_cands)>0 OR btrim(v_first)='' OR btrim(v_last)=''
        OR v_country IS NULL OR v_country !~ '^[a-z]{2}$'
        OR v_birth IS NULL OR v_birth < DATE '1900-01-01' OR v_birth > CURRENT_DATE;
      PERFORM pg_advisory_xact_lock(hashtextextended(p_gender || v_ikey,0));
      v_base := regexp_replace(
                  public.fold_name(v_last) || '-' || public.fold_name(v_first),
                  ' ', '-', 'g');
      v_base := regexp_replace(v_base, '-+', '-', 'g');
      v_base := regexp_replace(v_base, '(^-|-$)', '', 'g');
      IF v_base = '' OR v_base = '-' THEN v_base := 'rider'; END IF;

      v_candidate := v_base; v_n := 2;
      LOOP
        IF p_gender = 'male' THEN
          PERFORM 1 FROM public.riders_men   WHERE id = v_candidate;
        ELSE
          PERFORM 1 FROM public.riders_women WHERE id = v_candidate;
        END IF;
        EXIT WHEN NOT FOUND;
        v_candidate := v_base || '-' || v_n; v_n := v_n + 1;
        EXIT WHEN v_n > 200;
      END LOOP;

      BEGIN
        IF p_gender = 'male' THEN
          INSERT INTO public.riders_men   (id, "firstName", "lastName", nationality, "birthDate", source, verified)
          VALUES (v_candidate, v_first, v_last, v_country, v_birth, 'catalog_gold', false);
        ELSE
          INSERT INTO public.riders_women (id, "firstName", "lastName", nationality, "birthDate", source, verified)
          VALUES (v_candidate, v_first, v_last, v_country, v_birth, 'catalog_gold', false);
        END IF;
        v_found := v_candidate;
        v_created := v_created + 1;
      EXCEPTION WHEN unique_violation THEN
        IF p_gender = 'male' THEN
          SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
        ELSE
          SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
        END IF;
      END;
    END IF;

    IF v_found IS NOT NULL THEN
      IF v_has_bib THEN
        UPDATE public.race_uci_results r
           SET "globalRiderId" = v_found
          FROM public.race_uci_stages st
         WHERE st.id = r."stageRef"
           AND st."isTeamEvent" = false
           AND r."raceId" = p_race_id
           AND r.bib = v_bib
           AND r."globalRiderId" IS NULL
           AND (v_display IS NULL OR public.compute_identity_key(r."riderDisplay",'')=public.compute_identity_key(v_display,''));
      ELSE
        -- (093) fila sin dorsal: enlazar por riderDisplay, SOLO sobre filas
        -- sin bib numérico (las resueltas por dorsal no se tocan).
        UPDATE public.race_uci_results r
           SET "globalRiderId" = v_found
          FROM public.race_uci_stages st
         WHERE st.id = r."stageRef"
           AND st."isTeamEvent" = false
           AND r."raceId" = p_race_id
           AND (r.bib IS NULL OR r.bib !~ '^[0-9]+$')
           AND r."riderDisplay" = v_display
           AND r."globalRiderId" IS NULL
           AND (v_display IS NULL OR public.compute_identity_key(r."riderDisplay",'')=public.compute_identity_key(v_display,''));
      END IF;
    END IF;
  END LOOP;

  SELECT
    COUNT(*) FILTER (WHERE r."globalRiderId" IS NOT NULL)::int,
    v_created,
    COUNT(*) FILTER (WHERE r."globalRiderId" IS NULL)::int
  INTO matched, created, unresolved
  FROM public.race_uci_results r
  JOIN public.race_uci_stages st ON st.id = r."stageRef"
  WHERE r."raceId" = p_race_id
    AND st."isTeamEvent" = false;

  RETURN NEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.resolve_uci_startlist(p_race_id text, p_gender text, p_rows jsonb)
 RETURNS TABLE(teams_seeded integer, riders_seeded integer, teams_matched integer, teams_unmatched integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_row jsonb; v_plan jsonb := '[]'; v_group record; v_resolution record;
  v_ids text[]; v_profile record; v_st_id text; v_sort integer := 0;
BEGIN
  IF p_gender NOT IN ('male','female')
     OR (SELECT gender FROM public.races WHERE id=p_race_id) IS DISTINCT FROM p_gender THEN
    RAISE EXCEPTION 'Género incompatible con la carrera';
  END IF;
  teams_seeded:=0; riders_seeded:=0; teams_matched:=0; teams_unmatched:=0;
  -- La siembra automática solo crea soporte cuando todavía no existe una lista.
  -- Nunca sustituye una lista editada ni publica el acceso a inscritos.
  PERFORM 1 FROM public.races WHERE id=p_race_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.startlist_teams WHERE "raceId"=p_race_id) THEN
    RETURN NEXT; RETURN;
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)=0 THEN
    RETURN NEXT; RETURN;
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF COALESCE(v_row->>'bib','') !~ '^[1-9][0-9]{0,6}$' THEN
      RETURN NEXT; RETURN;
    END IF;
    SELECT array_agg(DISTINCT r."globalRiderId") INTO v_ids
    FROM public.race_uci_results r JOIN public.race_uci_stages s ON s.id=r."stageRef"
    WHERE r."raceId"=p_race_id AND NOT s."isTeamEvent" AND r.bib=v_row->>'bib'
      AND r."globalRiderId" IS NOT NULL
      AND (NULLIF(v_row->>'display','') IS NULL OR
        public.compute_identity_key(r."riderDisplay",'')=public.compute_identity_key(v_row->>'display',''));
    IF COALESCE(cardinality(v_ids),0)<>1 THEN RETURN NEXT; RETURN; END IF;
    SELECT * INTO v_profile FROM (
      SELECT id,"firstName","lastName",nationality FROM public.riders_men WHERE p_gender='male'
      UNION ALL SELECT id,"firstName","lastName",nationality FROM public.riders_women WHERE p_gender='female'
    ) p WHERE p.id=v_ids[1];
    IF NOT FOUND OR NULLIF(btrim(v_profile."firstName"),'') IS NULL
      OR NULLIF(btrim(v_profile."lastName"),'') IS NULL
      OR COALESCE(v_profile.nationality,'') !~ '^[a-z]{2}$' THEN
      RETURN NEXT; RETURN;
    END IF;
    v_plan := v_plan || jsonb_build_object('bib',(v_row->>'bib')::int,
      'globalRiderId',v_profile.id,'firstName',v_profile."firstName",'lastName',v_profile."lastName",
      'countryCode',v_profile.nationality,
      'teamName',COALESCE(NULLIF(btrim(v_row->>'teamName'),''),'Individual'));
  END LOOP;
  -- Dorsales o fichas repetidas entre pruebas de un campeonato no forman una lista.
  IF (SELECT count(DISTINCT r->>'bib') FROM jsonb_array_elements(v_plan) r)<>jsonb_array_length(v_plan)
    OR (SELECT count(DISTINCT r->>'globalRiderId') FROM jsonb_array_elements(v_plan) r)<>jsonb_array_length(v_plan) THEN
    RETURN NEXT; RETURN;
  END IF;
  BEGIN
    FOR v_group IN SELECT public.fold_team_name(r->>'teamName') folded,
        min(r->>'teamName') name, min((r->>'bib')::int) first_bib,
        jsonb_agg(r) riders FROM jsonb_array_elements(v_plan) r
      GROUP BY public.fold_team_name(r->>'teamName') ORDER BY first_bib
    LOOP
      SELECT * INTO v_resolution FROM public.ensure_startlist_team(p_race_id,v_group.name,p_gender);
      IF v_resolution.action NOT IN ('reused','created','ignored') THEN
        RAISE EXCEPTION 'Equipo ambiguo: %',v_group.name USING ERRCODE='ZZ002';
      END IF;
      v_st_id:='sluci_' || md5(p_race_id || '|' || v_group.folded);
      INSERT INTO public.startlist_teams(id,"raceId","teamName","teamId","sortOrder","isConfirmed")
      VALUES(v_st_id,p_race_id,
        COALESCE((SELECT name FROM public.teams WHERE id=v_resolution.team_id),v_group.name),
        v_resolution.team_id,v_sort,false);
      INSERT INTO public.startlist_riders(id,"raceId","teamId",dorsal,"firstName","lastName","countryCode","globalRiderId")
      SELECT 'sruci_' || md5(p_race_id || '|' || (r->>'bib')),p_race_id,v_st_id,
        (r->>'bib')::int,r->>'firstName',r->>'lastName',r->>'countryCode',r->>'globalRiderId'
      FROM jsonb_array_elements(v_group.riders) r;
      teams_seeded:=teams_seeded+1;
      riders_seeded:=riders_seeded+jsonb_array_length(v_group.riders);
      teams_matched:=teams_matched+CASE WHEN v_resolution.team_id IS NULL THEN 0 ELSE 1 END;
      v_sort:=v_sort+1;
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'ZZ002' THEN
    -- Revierte solo esta siembra, sin perder los resultados oficiales ya volcados.
    teams_seeded:=0; riders_seeded:=0; teams_matched:=0; teams_unmatched:=1;
    RAISE WARNING 'Inscritos automáticos pendientes: %',SQLERRM;
  END;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_startlist_team(p_race_id text, p_team_name text, p_team_gender text DEFAULT NULL::text)
 RETURNS TABLE(team_id text, action text, team_kind text, selection_scope text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_name text := NULLIF(btrim(p_team_name), '');
  v_fold text;
  v_year smallint;
  v_race_gender text;
  v_gender text;
  v_race_url text;
  v_kind text := 'club';
  v_scope text;
  v_selection_code text;
  v_country_code text;
  v_category text;
  v_team_id text;
  v_candidates text[];
  v_kind_is_explicit boolean := false;
  v_inserted boolean := false;
BEGIN
  IF NOT COALESCE((select private.is_admin()) OR (select auth.role()) = 'service_role'
    OR (session_user IN ('postgres','cc_results_worker')
      AND (select auth.role()) IS NULL
      AND COALESCE(current_setting('role',true),'none') IN ('none','cc_results_worker')),false) THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'pending', 'club', NULL::text;
    RETURN;
  END IF;

  IF public.is_startlist_no_team_placeholder(v_name) THEN
    RETURN QUERY SELECT NULL::text, 'ignored', 'club', NULL::text;
    RETURN;
  END IF;

  SELECT COALESCE(rc."year", 2026)::smallint, rc.gender, rc."websiteUrl"
  INTO v_year, v_race_gender, v_race_url
  FROM public.races rc
  WHERE rc.id = p_race_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La carrera % no existe en public.races', p_race_id;
  END IF;

  v_gender := CASE
    WHEN COALESCE(p_team_gender, v_race_gender) IN ('male', 'female')
      THEN COALESCE(p_team_gender, v_race_gender)
    ELSE NULL
  END;
  IF p_team_gender IN ('male', 'female')
     AND v_race_gender IN ('male', 'female')
     AND p_team_gender <> v_race_gender THEN
    RAISE EXCEPTION 'El género % del equipo no es compatible con el género % de la carrera %',
      p_team_gender, v_race_gender, p_race_id;
  END IF;

  v_fold := public.fold_team_name(v_name);
  IF v_fold IS NULL THEN
    RAISE EXCEPTION 'No se pudo normalizar el nombre de equipo «%»', v_name;
  END IF;

  SELECT tsa."selectionScope", tsa."selectionCode", tsa."countryCode"
  INTO v_scope, v_selection_code, v_country_code
  FROM public.team_selection_aliases tsa
  WHERE tsa."foldedName" = v_fold
  LIMIT 1;

  IF v_scope IS NOT NULL THEN
    v_kind := 'selection';
    v_kind_is_explicit := true;
  ELSIF lower(v_name) ~ '(regional|region|province|comunidad|county|state|euskadi|catalunya|catalonia|bretagne|normandie|flanders|wallonia)' THEN
    v_kind := 'selection';
    v_scope := 'regional';
    v_kind_is_explicit := true;
  ELSIF lower(v_name) ~ '(national|selection|seleccion|sélection|equipe nationale)' THEN
    v_kind := 'selection';
    v_scope := 'national';
    v_kind_is_explicit := true;
  END IF;

  IF v_kind = 'selection' THEN
    v_category := CASE WHEN v_gender = 'female' THEN 'NTW' WHEN v_gender = 'male' THEN 'NTM' ELSE NULL END;
  ELSE
    v_category := CASE WHEN v_gender = 'female' THEN 'CLUBW' WHEN v_gender = 'male' THEN 'CLUBM' ELSE NULL END;
  END IF;

  SELECT array_agg(DISTINCT t.id ORDER BY t.id)
  INTO v_candidates
  FROM public.teams t
  LEFT JOIN public.team_name_aliases a
    ON a."teamId" = t.id
   AND a.year = v_year
   AND a."foldedName" = v_fold
  WHERE t."specialEdition" IS NOT TRUE
    AND (t.gender IS NULL OR v_gender IS NULL OR t.gender = v_gender)
    AND (NOT v_kind_is_explicit OR t."teamKind" = v_kind)
    AND (
      a.id IS NOT NULL
      OR public.fold_team_name(t.name) = v_fold
      OR v_fold = ANY(t."foldedNames")
    );

  IF COALESCE(array_length(v_candidates, 1), 0) > 1 THEN
    RETURN QUERY SELECT NULL::text, 'ambiguous', v_kind, v_scope;
    RETURN;
  END IF;

  IF COALESCE(array_length(v_candidates, 1), 0) = 1 THEN
    v_team_id := v_candidates[1];
    action := 'reused';
  ELSE
    IF v_kind = 'selection'
       AND v_scope = 'national'
       AND v_selection_code ~ '^[a-z]{2}$'
       AND v_gender IN ('male', 'female') THEN
      v_team_id := CASE WHEN v_gender = 'female' THEN 'team_ntw_' ELSE 'team_ntm_' END
        || COALESCE(NULLIF(regexp_replace(v_fold, '[^a-z0-9]+', '_', 'g'), ''), v_selection_code);
    ELSE
      v_team_id := 'team_auto_' || md5(
        COALESCE(v_year::text, '2026') || '|' || v_kind || '|' ||
        COALESCE(v_gender, '') || '|' || COALESCE(v_scope, '') || '|' ||
        COALESCE(v_selection_code, '') || '|' || COALESCE(v_fold, v_name)
      );
    END IF;
    INSERT INTO public.teams (
      id, name, category, gender, "countryCode", "teamKind",
      "selectionScope", "selectionCode"
    ) VALUES (
      v_team_id, v_name, v_category, v_gender, v_country_code, v_kind,
      v_scope, v_selection_code
    )
    ON CONFLICT (id) DO NOTHING;
    v_inserted := FOUND;
    action := CASE WHEN v_inserted THEN 'created' ELSE 'reused' END;
  END IF;

  INSERT INTO public.team_name_aliases (
    id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
  ) VALUES (
    'tna_auto_' || md5(v_team_id || '|' || v_year::text || '|' || v_fold),
    v_team_id, v_name, v_fold, v_year, 'startlist_auto', v_race_url, false
  )
  ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
    alias = EXCLUDED.alias,
    "sourceUrl" = COALESCE(EXCLUDED."sourceUrl", public.team_name_aliases."sourceUrl"),
    "updatedAt" = now();

  team_id := v_team_id;
  team_kind := v_kind;
  selection_scope := v_scope;
  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ensure_startlist_team(text,text,text) TO cc_results_worker;
