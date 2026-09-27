-- Trata de forma uniforme las etiquetas que la fuente usa para agrupar
-- corredores sin identidad de club o selección. Las filas startlist_teams y
-- sus corredores se conservan; solo se evita crear una identidad de catálogo.

CREATE OR REPLACE FUNCTION public.is_startlist_no_team_placeholder(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT public.fold_team_name(p_name) = ANY (ARRAY[
    'individual',
    'private member',
    'sin equipo',
    'un',
    'un attached leinster'
  ]::text[]);
$$;

COMMENT ON FUNCTION public.is_startlist_no_team_placeholder(text) IS
  'Identifica etiquetas de startlist que conservan la fila sin teamId y no deben crear un equipo de catálogo.';

REVOKE ALL ON FUNCTION public.is_startlist_no_team_placeholder(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_startlist_no_team_placeholder(text)
  TO service_role;

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
  v_kind_is_explicit boolean := false;
  v_inserted boolean := false;
BEGIN
  IF NOT ((select private.is_admin()) OR (select auth.role()) = 'service_role') THEN
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
$$;

COMMENT ON FUNCTION public.ensure_startlist_team(text, text, text) IS
  'Resuelve o crea el equipo de una fila de startlist. Ante varias entidades compatibles exige selección explícita; Individual y otros estados sin equipo conservan teamId NULL.';

REVOKE ALL ON FUNCTION public.ensure_startlist_team(text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_startlist_team(text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_link_startlist_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resolution record;
  v_team record;
  v_race record;
  v_action text := 'provided';
  v_method text := 'caller';
BEGIN
  IF NEW."teamId" IS NULL
     AND public.is_startlist_no_team_placeholder(NEW."teamName") THEN
    RETURN NEW;
  END IF;

  IF NEW."teamId" IS NULL THEN
    SELECT * INTO v_resolution
    FROM public.ensure_startlist_team(NEW."raceId", NEW."teamName", NULL);
    IF v_resolution.action = 'ambiguous' THEN
      RAISE EXCEPTION 'Equipo ambiguo para «%» en la carrera %; selecciona un teamId existente',
        NEW."teamName", NEW."raceId";
    END IF;
    IF v_resolution.team_id IS NULL THEN
      RAISE EXCEPTION 'No se pudo resolver el equipo «%» en la carrera %',
        NEW."teamName", NEW."raceId";
    END IF;
    NEW."teamId" := v_resolution.team_id;
    v_action := v_resolution.action;
    v_method := 'startlist_exact_or_auto';
  END IF;

  SELECT t.id, t.name, t.gender
  INTO v_team
  FROM public.teams t
  WHERE t.id = NEW."teamId";

  SELECT rc.id, rc.gender, rc."year", rc."websiteUrl"
  INTO v_race
  FROM public.races rc
  WHERE rc.id = NEW."raceId";

  IF v_team.gender IS NOT NULL
     AND v_race.gender IS NOT NULL
     AND v_team.gender <> v_race.gender THEN
    RAISE EXCEPTION 'Equipo «%» (%s) incompatible con el género %s de la carrera %s',
      v_team.name, v_team.gender, v_race.gender, v_race.id;
  END IF;

  INSERT INTO public.team_link_decisions (
    id, "raceId", "occurrenceType", "occurrenceId", "rawName", "foldedName",
    "teamId", action, "matchMethod", source, "sourceUrl", year
  ) VALUES (
    'tld_' || md5('startlist_team|' || NEW.id),
    NEW."raceId", 'startlist_team', NEW.id, NEW."teamName",
    public.fold_team_name(NEW."teamName"), NEW."teamId", v_action, v_method,
    'startlist_auto', v_race."websiteUrl", COALESCE(v_race."year", 2026)
  )
  ON CONFLICT ("occurrenceType", "occurrenceId") DO UPDATE SET
    "teamId" = EXCLUDED."teamId",
    action = EXCLUDED.action,
    "matchMethod" = EXCLUDED."matchMethod",
    "sourceUrl" = EXCLUDED."sourceUrl",
    "updatedAt" = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_link_startlist_team_trg ON public.startlist_teams;
CREATE TRIGGER auto_link_startlist_team_trg
  BEFORE INSERT OR UPDATE OF "teamId", "teamName", "raceId"
  ON public.startlist_teams
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_startlist_team();

COMMENT ON FUNCTION public.auto_link_startlist_team() IS
  'Garantiza que toda nueva fila startlist_teams tenga teamId, salvo los placeholders sin equipo; rechaza incompatibilidades de género y registra la decisión por ocurrencia.';
