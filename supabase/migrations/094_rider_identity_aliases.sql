-- ═══════════════════════════════════════════════════════════════════
--  094 — rider_identity_aliases: las fusiones de fichas duplicadas
--  sobreviven a futuros volcados.
--
--  PROBLEMA (saneo de resultados 2026, 2026-06-11): la UCI publica el
--  nombre oficial LARGO ("VAN 'T GELOOF Maria Apolonia") y el catálogo
--  tiene la ficha de uso ("Marjolein van 't Geloof"). El match por
--  subconjunto de tokens (091) NO cubre estos casos (ninguno de los dos
--  identityKey es subconjunto del otro: {apolonia,geloof,maria,t,van} vs
--  {geloof,marjolein,t,van}) → resolve_uci_results_by_name CREA una ficha
--  duplicada. Si un humano fusiona el duplicado, el SIGUIENTE volcado por
--  nombre lo RE-CREA: la fusión no era durable.
--
--  FIX: tabla de alias de identidad. Al fusionar una ficha duplicada se
--  guarda su identityKey apuntando a la superviviente. Las dos RPCs que
--  CREAN fichas (resolve_uci_results_by_name 083/091/093 y resolve_riders
--  078) consultan los alias tras fallar el match exacto y ANTES de crear
--  (en by_name: antes también del subconjunto 091 — el alias es un mapeo
--  curado por humano/juez, tiene prioridad). El JOIN contra riders_men/
--  riders_women defiende contra alias huérfanos (ficha borrada después).
--
--  Los alias los escriben los flujos de fusión (panel / saneos); no hay
--  trigger automático. PK (aliasKey, gender): un mismo nombre plegado solo
--  puede apuntar a una ficha por género.
--
--  Sigue a la 093. La siguiente migración es la 095.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.rider_identity_aliases (
  "aliasKey"  text NOT NULL,
  gender      text NOT NULL CHECK (gender IN ('male','female')),
  "riderId"   text NOT NULL,
  note        text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("aliasKey", gender)
);

COMMENT ON TABLE public.rider_identity_aliases IS
  'identityKey de fichas FUSIONADAS → id de la ficha superviviente. Lo consultan resolve_uci_results_by_name y resolve_riders antes de crear ficha nueva: una fusión queda blindada frente a futuros volcados/imports que traigan la grafía duplicada (p. ej. nombre oficial UCI largo vs nombre de uso). Escriben los flujos de fusión (panel / saneos).';

-- Solo los caminos internos (RPCs SECURITY DEFINER, service_role) la usan.
ALTER TABLE public.rider_identity_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rider_identity_aliases FROM public, anon;
GRANT SELECT ON TABLE public.rider_identity_aliases TO authenticated;
GRANT ALL ON TABLE public.rider_identity_aliases TO service_role;

-- ─── resolve_uci_results_by_name — añade Paso 2.25 (alias) ─────────
--  Cuerpo = 093 íntegro + bloque de alias entre el match exacto y el
--  subconjunto 091.
CREATE OR REPLACE FUNCTION public.resolve_uci_results_by_name(
  p_race_id text,
  p_gender  text,
  p_rows    jsonb
)
RETURNS TABLE (matched int, created int, unresolved int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  v_by_birth   text[];   -- (091) ídem con fecha de nacimiento igual ±1 día
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
    v_birth   := NULLIF(v_row->>'birthDate','')::date;
    v_ikey    := public.compute_identity_key(v_first, v_last);

    -- (093) sin identidad no hay nada que hacer; sin bib NI display tampoco
    -- (no habría forma de dirigir el UPDATE final).
    CONTINUE WHEN v_ikey IS NULL OR (NOT v_has_bib AND v_display IS NULL);

    IF p_gender = 'male' THEN
      SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey LIMIT 1;
    ELSE
      SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
    END IF;

    -- (094) Paso 2.25 — alias de identidad: clave de una ficha FUSIONADA →
    -- su superviviente. Prioridad sobre el subconjunto 091 (mapeo curado).
    IF v_found IS NULL THEN
      IF p_gender = 'male' THEN
        SELECT a."riderId" INTO v_found
          FROM public.rider_identity_aliases a
          JOIN public.riders_men m ON m.id = a."riderId"
         WHERE a."aliasKey" = v_ikey AND a.gender = 'male'
         LIMIT 1;
      ELSE
        SELECT a."riderId" INTO v_found
          FROM public.rider_identity_aliases a
          JOIN public.riders_women w ON w.id = a."riderId"
         WHERE a."aliasKey" = v_ikey AND a.gender = 'female'
         LIMIT 1;
      END IF;
    END IF;

    -- (091) Paso 2.5 — subconjunto de tokens (nombre largo UCI vs corto de
    -- la ficha, o al revés). Solo si el exacto no casó.
    IF v_found IS NULL THEN
      IF p_gender = 'male' THEN
        SELECT coalesce(array_agg(m.id), '{}'),
               coalesce(array_agg(m.id) FILTER (WHERE v_birth IS NOT NULL AND m."birthDate" IS NOT NULL AND abs(m."birthDate" - v_birth) <= 1), '{}'),
               coalesce(array_agg(m.id) FILTER (WHERE v_country IS NOT NULL AND m.nationality = v_country), '{}')
          INTO v_cands, v_by_birth, v_by_ctry
          FROM public.riders_men m
         WHERE m."identityKey" IS NOT NULL
           AND m."identityKey" <> v_ikey
           AND (m."birthDate" IS NULL OR v_birth IS NULL OR abs(m."birthDate" - v_birth) <= 1)
           AND ((array_length(string_to_array(m."identityKey", '-'), 1) >= 2
                 AND string_to_array(m."identityKey", '-') <@ string_to_array(v_ikey, '-'))
             OR (array_length(string_to_array(v_ikey, '-'), 1) >= 2
                 AND string_to_array(v_ikey, '-') <@ string_to_array(m."identityKey", '-')));
      ELSE
        SELECT coalesce(array_agg(w.id), '{}'),
               coalesce(array_agg(w.id) FILTER (WHERE v_birth IS NOT NULL AND w."birthDate" IS NOT NULL AND abs(w."birthDate" - v_birth) <= 1), '{}'),
               coalesce(array_agg(w.id) FILTER (WHERE v_country IS NOT NULL AND w.nationality = v_country), '{}')
          INTO v_cands, v_by_birth, v_by_ctry
          FROM public.riders_women w
         WHERE w."identityKey" IS NOT NULL
           AND w."identityKey" <> v_ikey
           AND (w."birthDate" IS NULL OR v_birth IS NULL OR abs(w."birthDate" - v_birth) <= 1)
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
          SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey LIMIT 1;
        ELSE
          SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
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
           AND r."globalRiderId" IS DISTINCT FROM v_found;
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
           AND r."globalRiderId" IS DISTINCT FROM v_found;
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
END $$;

REVOKE ALL ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) TO authenticated, service_role;

-- ─── resolve_riders — mismo alias-lookup antes de crear ────────────
--  Cuerpo = 078 íntegro + bloque de alias entre el match exacto (paso 1)
--  y la creación (paso 2). Las startlists también traen grafías largas.
CREATE OR REPLACE FUNCTION public.resolve_riders(p_gender text, p_rows jsonb)
RETURNS TABLE (idx int, matched_id text, created boolean, score real)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row        jsonb;
  v_idx        int;
  v_first      text;
  v_last       text;
  v_country    text;
  v_ikey       text;
  v_id         text;
  v_base       text;
  v_candidate  text;
  v_n          int;
  v_found      text;
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx     := (v_row->>'idx')::int;
    v_first   := COALESCE(v_row->>'firstName', '');
    v_last    := COALESCE(v_row->>'lastName', '');
    v_country := NULLIF(lower(COALESCE(v_row->>'countryCode','')), '');
    v_ikey    := public.compute_identity_key(v_first, v_last);

    -- Sin tokens útiles (nombre vacío) → no se resuelve.
    IF v_ikey IS NULL THEN
      idx := v_idx; matched_id := NULL; created := false; score := 0::real;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 1) ¿Existe ya por identityKey exacto?
    IF p_gender = 'male' THEN
      SELECT id INTO v_found FROM public.riders_men WHERE "identityKey" = v_ikey LIMIT 1;
    ELSE
      SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
    END IF;

    -- 1.5) (094) ¿Es la clave de una ficha fusionada? → superviviente.
    IF v_found IS NULL THEN
      IF p_gender = 'male' THEN
        SELECT a."riderId" INTO v_found
          FROM public.rider_identity_aliases a
          JOIN public.riders_men m ON m.id = a."riderId"
         WHERE a."aliasKey" = v_ikey AND a.gender = 'male'
         LIMIT 1;
      ELSE
        SELECT a."riderId" INTO v_found
          FROM public.rider_identity_aliases a
          JOIN public.riders_women w ON w.id = a."riderId"
         WHERE a."aliasKey" = v_ikey AND a.gender = 'female'
         LIMIT 1;
      END IF;
    END IF;

    IF v_found IS NOT NULL THEN
      idx := v_idx; matched_id := v_found; created := false; score := 1.0::real;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- 2) No existe → crear ficha. Slug exquisito apellido-nombre por fold_name.
    v_base := regexp_replace(
                public.fold_name(v_last) || '-' || public.fold_name(v_first),
                ' ', '-', 'g');
    v_base := regexp_replace(v_base, '-+', '-', 'g');
    v_base := regexp_replace(v_base, '(^-|-$)', '', 'g');
    IF v_base = '' OR v_base = '-' THEN
      v_base := 'rider';
    END IF;

    -- Resolver colisión de id (PK), no de identityKey.
    v_candidate := v_base;
    v_n := 2;
    LOOP
      IF p_gender = 'male' THEN
        PERFORM 1 FROM public.riders_men WHERE id = v_candidate;
      ELSE
        PERFORM 1 FROM public.riders_women WHERE id = v_candidate;
      END IF;
      EXIT WHEN NOT FOUND;
      v_candidate := v_base || '-' || v_n;
      v_n := v_n + 1;
      EXIT WHEN v_n > 200;  -- backstop
    END LOOP;
    v_id := v_candidate;

    BEGIN
      IF p_gender = 'male' THEN
        INSERT INTO public.riders_men (id, "firstName", "lastName", nationality, source, verified)
        VALUES (v_id, v_first, v_last, v_country, 'startlist_resolve', false);
      ELSE
        INSERT INTO public.riders_women (id, "firstName", "lastName", nationality, source, verified)
        VALUES (v_id, v_first, v_last, v_country, 'startlist_resolve', false);
      END IF;
      idx := v_idx; matched_id := v_id; created := true; score := 1.0::real;
      RETURN NEXT;
    EXCEPTION WHEN unique_violation THEN
      -- El índice UNIQUE de identityKey saltó → ya existe una ficha con esa clave
      -- (homónimo declarado en BD, o una fila previa del mismo batch). Re-buscar.
      IF p_gender = 'male' THEN
        SELECT id INTO v_found FROM public.riders_men WHERE "identityKey" = v_ikey LIMIT 1;
      ELSE
        SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
      END IF;
      idx := v_idx; matched_id := v_found; created := false; score := 1.0::real;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.resolve_riders(text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_riders(text, jsonb) TO authenticated, service_role;
