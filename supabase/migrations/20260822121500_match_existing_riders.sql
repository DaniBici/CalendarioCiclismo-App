-- Enlaza borradores de inscritos únicamente con identidades ya existentes.
-- No inserta ni actualiza: los nombres sin match único quedan para revisión
-- manual en el panel. Los alias proceden de fusiones humanas previas.

CREATE OR REPLACE FUNCTION public.match_existing_riders(
  p_gender text,
  p_rows jsonb
)
RETURNS TABLE (
  idx integer,
  matched_id text,
  match_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row jsonb;
  v_idx integer;
  v_identity_key text;
  v_candidate_ids text[];
BEGIN
  IF p_gender NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_rows) = 'array' THEN p_rows ELSE '[]'::jsonb END
    )
  LOOP
    v_idx := NULLIF(v_row->>'idx', '')::integer;
    v_identity_key := public.compute_identity_key(
      COALESCE(v_row->>'firstName', ''),
      COALESCE(v_row->>'lastName', '')
    );
    idx := v_idx;
    matched_id := NULL;
    match_count := 0;

    IF v_idx IS NULL OR v_identity_key IS NULL THEN
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF p_gender = 'male' THEN
      SELECT array_agg(DISTINCT candidate.id ORDER BY candidate.id)
        INTO v_candidate_ids
      FROM (
        SELECT m.id
          FROM public.riders_men m
         WHERE m."identityKey" = v_identity_key
        UNION
        SELECT a."riderId"
          FROM public.rider_identity_aliases a
          JOIN public.riders_men m ON m.id = a."riderId"
         WHERE a."aliasKey" = v_identity_key
           AND a.gender = 'male'
      ) candidate;
    ELSE
      SELECT array_agg(DISTINCT candidate.id ORDER BY candidate.id)
        INTO v_candidate_ids
      FROM (
        SELECT w.id
          FROM public.riders_women w
         WHERE w."identityKey" = v_identity_key
        UNION
        SELECT a."riderId"
          FROM public.rider_identity_aliases a
          JOIN public.riders_women w ON w.id = a."riderId"
         WHERE a."aliasKey" = v_identity_key
           AND a.gender = 'female'
      ) candidate;
    END IF;

    match_count := COALESCE(cardinality(v_candidate_ids), 0);
    IF match_count = 1 THEN
      matched_id := v_candidate_ids[1];
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.match_existing_riders(text, jsonb) IS
  'Resuelve por identityKey exacto y alias de fusiones, sin crear ni modificar fichas. Devuelve matched_id solo cuando existe una coincidencia única.';

REVOKE ALL ON FUNCTION public.match_existing_riders(text, jsonb) FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_existing_riders(text, jsonb) TO authenticated, service_role;
