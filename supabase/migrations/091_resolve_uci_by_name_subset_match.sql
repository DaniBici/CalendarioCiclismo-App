-- ═══════════════════════════════════════════════════════════════════
--  091 — resolve_uci_results_by_name: match por SUBCONJUNTO de tokens
--  antes de crear ficha (anti-duplicados del drenaje del backlog).
--
--  PROBLEMA (detectado 2026-06-10 al drenar el backlog de resultados):
--  la UCI publica a menudo el nombre LARGO del corredor (con 2º apellido:
--  "SERRANO RODRIGUEZ Gonzalo", "HVIDEBERG Jonas Hem") mientras la ficha
--  del catálogo usa el corto ("Gonzalo Serrano", "Jonas Hvideberg") — o al
--  revés. El identityKey EXACTO no casa y la RPC creaba un DUPLICADO:
--    serrano-gonzalo        vs serrano-rodriguez-gonzalo
--    hamilton-lucas         vs hamilton-lucas-wade
--    hvideberg-jonas-hem    vs hvideberg-jonas-hem-2
--  El lote piloto (10 carreras) creó 70 fichas; muestra de 4 → 3 eran
--  duplicados de corredores WorldTour. A escala de ~246 carreras del
--  backlog, inundación de duplicados (mismo patrón que la 2ª ronda de
--  dedup manual: Guama Bayron/Byron, Warbasse Larry/Lawrence…).
--
--  REGLA NUEVA (paso 2.5, entre el match exacto y el CREATE):
--  si EXACTAMENTE UNA ficha existente tiene un token-set CONTENIDO en el
--  de la UCI — o al revés (el lado corto debe tener >=2 tokens) — y su
--  fecha de nacimiento NO CONTRADICE la de la UCI (compatibles si alguna
--  es NULL o difieren <=1 día: el /Date(ms)/ de DataRide viene a medianoche
--  CET y truncado en UTC retrocede un día — bug arreglado en el fetcher el
--  2026-06-10, la tolerancia cubre datos ya escritos con el desfase),
--  es la misma persona → enlazar esa ficha en vez de crear.
--  Con VARIOS candidatos, desempate en cascada:
--    1) fecha de nacimiento igual ±1 día (ambas no nulas) → si deja uno, ese;
--    2) nacionalidad igual → si deja uno, ese;
--    3) si no → CREAR ficha como antes (comportamiento previo, seguro
--       ante homónimos reales: "comparten carrera → personas distintas"
--       lo sigue resolviendo el escáner del panel).
--
--  IDEMPOTENCIA: intacta. Re-ejecutar sobre una carrera ya volcada
--  re-resuelve cada fila; las que apuntaban a un duplicado se repuntan a
--  la ficha canónica (IS DISTINCT FROM evita escrituras inútiles). La
--  fusión/borrado de los duplicados ya creados NO la hace esta migración
--  (limpieza one-off aparte, con backup).
--
--  Sigue a la 090. La siguiente migración es la 092.
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
  v_by_birth   text[];   -- (091) ídem con fecha de nacimiento exacta
  v_by_ctry    text[];   -- (091) ídem con nacionalidad igual
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_bib     := NULLIF(v_row->>'bib', '');
    v_first   := COALESCE(v_row->>'firstName', '');
    v_last    := COALESCE(v_row->>'lastName', '');
    v_country := NULLIF(lower(COALESCE(v_row->>'countryCode','')), '');
    v_birth   := NULLIF(v_row->>'birthDate','')::date;
    v_ikey    := public.compute_identity_key(v_first, v_last);

    CONTINUE WHEN v_bib IS NULL OR v_bib !~ '^[0-9]+$' OR v_ikey IS NULL;

    IF p_gender = 'male' THEN
      SELECT id INTO v_found FROM public.riders_men   WHERE "identityKey" = v_ikey LIMIT 1;
    ELSE
      SELECT id INTO v_found FROM public.riders_women WHERE "identityKey" = v_ikey LIMIT 1;
    END IF;

    -- (091) Paso 2.5 — subconjunto de tokens (nombre largo UCI vs corto de
    -- la ficha, o al revés). Solo si el exacto no casó. Ver cabecera.
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
      UPDATE public.race_uci_results r
         SET "globalRiderId" = v_found
        FROM public.race_uci_stages st
       WHERE st.id = r."stageRef"
         AND st."isTeamEvent" = false
         AND r."raceId" = p_race_id
         AND r.bib = v_bib
         AND r."globalRiderId" IS DISTINCT FROM v_found;
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
