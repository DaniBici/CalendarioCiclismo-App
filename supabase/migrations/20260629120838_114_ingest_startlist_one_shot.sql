-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260629120838, nombre 114_ingest_startlist_one_shot). Texto aplicado en producción, sin cambios.

-- Migración 114: ingest_startlist — botón único de ingesta MANUAL de startlists.
-- Aditivo, NO toca resolve_uci_startlist (flujo UCI por dorsal intacto → 0 downtime).
-- Traga el array crudo [{team,first,last,bib?,country?}] tal como se lee del documento
-- y dentro de Postgres: reordena nombre tolerante, siembra equipos+corredores verbatim,
-- enlaza equipos al catálogo (foldedNames), resuelve ficha de corredor por nombre
-- (exacto → alias fusión → subconjunto de tokens → crear), marca enrichedStartlist.
-- Devuelve UNA fila resumen + arrays nombrados de lo que no casó (para revisión puntual).

CREATE OR REPLACE FUNCTION public.ingest_startlist(
  p_race_id text,
  p_gender  text,
  p_rows    jsonb
)
RETURNS TABLE(
  teams_seeded     integer,
  teams_matched    integer,
  teams_unmatched  integer,
  riders_seeded    integer,
  riders_matched   integer,
  riders_created   integer,
  riders_unresolved integer,
  unmatched_teams  text[],   -- nombres de equipo que NO casaron con el catálogo
  created_riders   text[]    -- "Nombre Apellido" de las fichas nuevas creadas
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row       jsonb;
  v_team_name text;
  v_first     text;
  v_last      text;
  v_full      text;
  v_bib       int;
  v_country   text;
  v_fold      text;
  v_team_id   text;
  v_st_id     text;
  v_sort      int := 0;
  v_ikey      text;
  v_found     text;
  v_cands     text[];
  v_by_birth  text[];     -- placeholder simetría (sin birthDate en startlist manual)
  v_base      text;
  v_candidate text;
  v_n         int;
  v_seeded_t  int := 0;
  v_matched_t int := 0;
  v_unmatch_t int := 0;
  v_seeded_r  int := 0;
  v_matched_r int := 0;
  v_created_r int := 0;
  v_unres_r   int := 0;
  v_um_teams  text[] := '{}';
  v_cr_riders text[] := '{}';
  v_is_upper  boolean;
  v_parts     text[];
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  -- Limpieza: resiembra completa de la startlist de esta carrera (idempotente).
  DELETE FROM public.startlist_riders WHERE "raceId" = p_race_id;
  DELETE FROM public.startlist_teams  WHERE "raceId" = p_race_id;

  DROP TABLE IF EXISTS _ing_team_map;
  CREATE TEMP TABLE _ing_team_map (fold text PRIMARY KEY, st_id text, team_id text)
    ON COMMIT DROP;

  -- ===== PASE 1: equipos =====
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_team_name := NULLIF(btrim(v_row->>'team'), '');
    IF v_team_name IS NULL THEN CONTINUE; END IF;
    v_fold := COALESCE(public.fold_team_name(v_team_name), lower(v_team_name));
    CONTINUE WHEN EXISTS (SELECT 1 FROM _ing_team_map m WHERE m.fold = v_fold);

    -- match exacto por foldedNames (no specialEdition, género compatible)
    SELECT t.id INTO v_team_id
    FROM public.teams t
    WHERE NOT t."specialEdition"
      AND v_fold = ANY(t."foldedNames")
      AND (t.gender IS NULL OR t.gender = p_gender)
    LIMIT 1;

    -- fallback por contención (≥4 chars)
    IF v_team_id IS NULL AND length(v_fold) >= 4 THEN
      SELECT t.id INTO v_team_id
      FROM public.teams t, unnest(t."foldedNames") AS fn
      WHERE NOT t."specialEdition"
        AND length(fn) >= 4
        AND (fn LIKE '%'||v_fold||'%' OR v_fold LIKE '%'||fn||'%')
        AND (t.gender IS NULL OR t.gender = p_gender)
      LIMIT 1;
    END IF;

    IF v_team_id IS NOT NULL THEN
      v_matched_t := v_matched_t + 1;
    ELSE
      v_unmatch_t := v_unmatch_t + 1;
      v_um_teams  := v_um_teams || v_team_name;
    END IF;

    v_st_id := 'sling_' || md5(p_race_id || '|' || v_fold);
    INSERT INTO public.startlist_teams (id, "raceId", "teamName", "sortOrder", "teamId", "isConfirmed")
    VALUES (v_st_id, p_race_id, v_team_name, v_sort, v_team_id, false);
    v_seeded_t := v_seeded_t + 1;
    v_sort := v_sort + 1;
    INSERT INTO _ing_team_map (fold, st_id, team_id) VALUES (v_fold, v_st_id, v_team_id);
  END LOOP;

  -- ===== PASE 2: corredores =====
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_first := btrim(COALESCE(v_row->>'first',''));
    v_last  := btrim(COALESCE(v_row->>'last',''));
    v_bib   := NULLIF(v_row->>'bib','')::int;
    v_country := NULLIF(lower(COALESCE(v_row->>'country','')), '');

    -- (A) Reorden tolerante de nombre.
    -- Caso 1: last vacío y first trae el nombre completo → partir.
    IF v_last = '' AND v_first <> '' AND position(' ' IN v_first) > 0 THEN
      v_full := v_first;
      v_parts := regexp_split_to_array(v_full, '\s+');
      -- "APELLIDO Nombre": primer token TODO MAYÚSCULAS → apellido al frente.
      v_is_upper := (v_parts[1] = upper(v_parts[1]) AND v_parts[1] <> lower(v_parts[1]));
      IF v_is_upper THEN
        -- todos los tokens en mayúscula iniciales = apellido; resto = nombre
        v_last  := '';
        v_first := '';
        FOR v_n IN 1 .. array_length(v_parts,1) LOOP
          IF v_parts[v_n] = upper(v_parts[v_n]) AND v_parts[v_n] <> lower(v_parts[v_n]) THEN
            v_last := btrim(v_last || ' ' || v_parts[v_n]);
          ELSE
            v_first := btrim(v_first || ' ' || v_parts[v_n]);
          END IF;
        END LOOP;
        -- si la heurística dejó algo vacío, revertir a "última palabra = apellido"
        IF v_first = '' OR v_last = '' THEN
          v_last  := v_parts[array_length(v_parts,1)];
          v_first := btrim(left(v_full, length(v_full) - length(v_last)));
        END IF;
      ELSE
        -- "Nombre Apellido(s)": última palabra = apellido (conservador)
        v_last  := v_parts[array_length(v_parts,1)];
        v_first := btrim(left(v_full, length(v_full) - length(v_last)));
      END IF;
    -- Caso 2: last viene TODO en mayúsculas (típico "first=Tadej last=POGACAR") → Title Case suave.
    ELSIF v_last <> '' AND v_last = upper(v_last) AND v_last <> lower(v_last) THEN
      v_last := initcap(lower(v_last));
    END IF;

    -- localizar la fila de equipo
    v_team_name := NULLIF(btrim(v_row->>'team'), '');
    v_fold := CASE WHEN v_team_name IS NULL THEN NULL
                   ELSE COALESCE(public.fold_team_name(v_team_name), lower(v_team_name)) END;
    v_st_id := NULL;
    IF v_fold IS NOT NULL THEN
      SELECT m.st_id INTO v_st_id FROM _ing_team_map m WHERE m.fold = v_fold;
    END IF;

    -- ===== resolución de ficha por nombre =====
    v_found := NULL;
    v_ikey  := public.compute_identity_key(v_first, v_last);

    IF v_ikey IS NOT NULL THEN
      -- 1) exacto
      IF p_gender = 'male' THEN
        SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey LIMIT 1;
      ELSE
        SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
      END IF;

      -- 2) alias de fusión
      IF v_found IS NULL THEN
        IF p_gender = 'male' THEN
          SELECT a."riderId" INTO v_found FROM public.rider_identity_aliases a
            JOIN public.riders_men m ON m.id = a."riderId"
           WHERE a."aliasKey" = v_ikey AND a.gender = 'male' LIMIT 1;
        ELSE
          SELECT a."riderId" INTO v_found FROM public.rider_identity_aliases a
            JOIN public.riders_women w ON w.id = a."riderId"
           WHERE a."aliasKey" = v_ikey AND a.gender = 'female' LIMIT 1;
        END IF;
      END IF;

      -- 3) subconjunto de tokens (nombre largo vs corto), desempate por país
      IF v_found IS NULL THEN
        IF p_gender = 'male' THEN
          SELECT coalesce(array_agg(m.id), '{}'),
                 coalesce(array_agg(m.id) FILTER (WHERE v_country IS NOT NULL AND m.nationality = v_country), '{}')
            INTO v_cands, v_by_birth
            FROM public.riders_men m
           WHERE m."identityKey" IS NOT NULL AND m."identityKey" <> v_ikey
             AND ((array_length(string_to_array(m."identityKey",'-'),1) >= 2
                   AND string_to_array(m."identityKey",'-') <@ string_to_array(v_ikey,'-'))
               OR (array_length(string_to_array(v_ikey,'-'),1) >= 2
                   AND string_to_array(v_ikey,'-') <@ string_to_array(m."identityKey",'-')));
        ELSE
          SELECT coalesce(array_agg(w.id), '{}'),
                 coalesce(array_agg(w.id) FILTER (WHERE v_country IS NOT NULL AND w.nationality = v_country), '{}')
            INTO v_cands, v_by_birth
            FROM public.riders_women w
           WHERE w."identityKey" IS NOT NULL AND w."identityKey" <> v_ikey
             AND ((array_length(string_to_array(w."identityKey",'-'),1) >= 2
                   AND string_to_array(w."identityKey",'-') <@ string_to_array(v_ikey,'-'))
               OR (array_length(string_to_array(v_ikey,'-'),1) >= 2
                   AND string_to_array(v_ikey,'-') <@ string_to_array(w."identityKey",'-')));
        END IF;
        IF array_length(v_cands,1) = 1 THEN
          v_found := v_cands[1];
        ELSIF array_length(v_by_birth,1) = 1 THEN
          v_found := v_by_birth[1];   -- único candidato del mismo país
        END IF;
      END IF;

      -- 4) crear ficha nueva
      IF v_found IS NULL THEN
        v_base := regexp_replace(public.fold_name(v_last)||'-'||public.fold_name(v_first),' ','-','g');
        v_base := regexp_replace(v_base,'-+','-','g');
        v_base := regexp_replace(v_base,'(^-|-$)','','g');
        IF v_base = '' OR v_base = '-' THEN v_base := 'rider'; END IF;
        v_candidate := v_base; v_n := 2;
        LOOP
          IF p_gender = 'male' THEN PERFORM 1 FROM public.riders_men WHERE id=v_candidate;
          ELSE PERFORM 1 FROM public.riders_women WHERE id=v_candidate; END IF;
          EXIT WHEN NOT FOUND;
          v_candidate := v_base||'-'||v_n; v_n := v_n+1; EXIT WHEN v_n>200;
        END LOOP;
        BEGIN
          IF p_gender = 'male' THEN
            INSERT INTO public.riders_men (id,"firstName","lastName",nationality,source,verified)
            VALUES (v_candidate,v_first,v_last,v_country,'ingest_startlist',false);
          ELSE
            INSERT INTO public.riders_women (id,"firstName","lastName",nationality,source,verified)
            VALUES (v_candidate,v_first,v_last,v_country,'ingest_startlist',false);
          END IF;
          v_found := v_candidate;
          v_created_r := v_created_r + 1;
          v_cr_riders := v_cr_riders || (v_first||' '||v_last);
        EXCEPTION WHEN unique_violation THEN
          IF p_gender = 'male' THEN
            SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey"=v_ikey LIMIT 1;
          ELSE
            SELECT id INTO v_found FROM public.riders_women WHERE "identityKey"=v_ikey LIMIT 1;
          END IF;
        END;
      END IF;
    END IF;

    IF v_found IS NOT NULL THEN v_matched_r := v_matched_r + 1; ELSE v_unres_r := v_unres_r + 1; END IF;

    INSERT INTO public.startlist_riders
      (id,"teamId","raceId",dorsal,"firstName","lastName","countryCode","globalRiderId")
    VALUES (
      'sring_'||md5(p_race_id||'|'||COALESCE(v_bib::text, 'r'||v_seeded_r::text)),
      v_st_id, p_race_id, v_bib, v_first, v_last, v_country, v_found
    )
    ON CONFLICT (id) DO NOTHING;
    v_seeded_r := v_seeded_r + 1;
  END LOOP;

  -- nombres canónicos para los corredores casados
  PERFORM public.sync_startlist_riders_to_canonical(p_race_id);

  UPDATE public.races SET "enrichedStartlist" = true
  WHERE id = p_race_id AND "enrichedStartlist" IS DISTINCT FROM true;

  teams_seeded := v_seeded_t; teams_matched := v_matched_t; teams_unmatched := v_unmatch_t;
  riders_seeded := v_seeded_r; riders_matched := v_matched_r; riders_created := v_created_r;
  riders_unresolved := v_unres_r;
  unmatched_teams := v_um_teams; created_riders := v_cr_riders;
  RETURN NEXT;
END $function$;
