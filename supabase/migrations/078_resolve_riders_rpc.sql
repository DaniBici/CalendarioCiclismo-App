-- ═══════════════════════════════════════════════════════════════════
--  RPC resolve_riders — resolución de una startlist contra el catálogo
--
--  Resuelve cada corredor de una startlist al catálogo oro por identityKey
--  (token-set del nombre plegado, compute_identity_key), en UN round-trip.
--  Sustituye el matcher JS del panel (normalizeTeamName/slugify orden-dependiente,
--  la causa raíz del rediseño). La frontera apellido/nombre deja de adivinarse:
--  el identityKey es invariante al orden de los tokens.
--
--  Política (la ya establecida): casar primero por identityKey EXACTO; si no
--  existe, CREAR la ficha (slug exquisito apellido-nombre vía fold_name, sufijo
--  numérico si el id colisiona; nacionalidad de la startlist; verified=false;
--  source='startlist_resolve'; identityKey lo pone el trigger set_identity_key_*).
--  El índice UNIQUE de identityKey impide duplicados: dos filas homónimas del
--  mismo batch resuelven a la misma ficha (se inserta dentro del loop → la 2ª ve
--  la 1ª); un homónimo con fecha distinta ya en BD se detecta al re-buscar tras
--  la violación de unicidad.
--
--  NO hace fuzzy/contención (eso queda para el operador humano en el editor):
--  es el camino determinista exacto.
-- ═══════════════════════════════════════════════════════════════════

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

-- Mismos grants que sync_startlist_riders_to_canonical: solo usuarios autenticados.
REVOKE ALL ON FUNCTION public.resolve_riders(text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_riders(text, jsonb) TO authenticated, service_role;
