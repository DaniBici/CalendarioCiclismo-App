CREATE OR REPLACE FUNCTION public.ensure_startlist_team(
  p_race_id text,
  p_team_name text,
  p_team_gender text DEFAULT NULL
)
RETURNS TABLE (team_id text, action text, team_kind text, selection_scope text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  v_inserted boolean := false;
BEGIN
  IF v_name IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'pending', 'club', NULL::text;
    RETURN;
  END IF;

  IF lower(v_name) = 'individual' THEN
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
  ELSIF lower(v_name) ~ '(regional|region|province|comunidad|county|state|euskadi|catalunya|catalonia|bretagne|normandie|flanders|wallonia)' THEN
    v_kind := 'selection';
    v_scope := 'regional';
  ELSIF lower(v_name) ~ '(national|selection|seleccion|sélection|equipe nationale)' THEN
    v_kind := 'selection';
    v_scope := 'national';
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
    AND t."teamKind" = v_kind
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
$$;

COMMENT ON FUNCTION public.ensure_startlist_team(text, text, text) IS
  'Resuelve o crea el equipo de una fila de startlist para la temporada de la carrera. '
  'Rechaza carreras inexistentes y sexos incompatibles; acepta clubes, selecciones nacionales y regionales (NTM/NTW).';
