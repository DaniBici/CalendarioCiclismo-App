-- ═══════════════════════════════════════════════════════════════════
--  093 — resolve_uci_results_by_name: filas SIN dorsal (bib NULL).
--
--  PROBLEMA (detectado por Dani 2026-06-10, GP Beiras e Serra da Estrela):
--  la UCI a veces publica filas de resultado SIN bib ("NOHALES NIETO Edgar",
--  dorsal 181 en nuestra startlist pero bib NULL en DataRide). Esas filas
--  eran invisibles para AMBAS rutas de enlace: resolve_uci_results (082)
--  necesita el bib para cruzar con la startlist, y esta RPC saltaba toda
--  fila sin bib numérico (CONTINUE) — además el upsert ni siquiera las
--  incluía en el payload (dedupe por bib). 340 filas sin enlazar en 7
--  carreras al detectarlo.
--
--  FIX (RPC + cliente):
--  · El upsert (extractRidersForNameResolve) incluye ahora las filas sin
--    bib y añade 'display' (riderDisplay crudo) a TODAS las entradas.
--  · Esta RPC acepta entradas sin bib: la búsqueda/creación de ficha es
--    idéntica (exacto → subconjunto 091 → crear), y el UPDATE final enlaza
--    por riderDisplay, SOLO sobre filas sin bib numérico — jamás repunta
--    filas ya resueltas por dorsal. Entradas sin bib Y sin display se
--    ignoran (no hay forma de dirigir el UPDATE).
--  · Payloads antiguos (sin 'display') siguen funcionando igual que antes.
--
--  Sigue a la 092. La siguiente migración es la 094.
-- ═══════════════════════════════════════════════════════════════════

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

-- Grants idénticos a la 083 (CREATE OR REPLACE conserva ACLs; explícitos por claridad).
REVOKE ALL ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_uci_results_by_name(text, text, jsonb) TO authenticated, service_role;
