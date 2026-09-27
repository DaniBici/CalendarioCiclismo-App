BEGIN;

ALTER TABLE public.race_uci_results
  ADD COLUMN IF NOT EXISTS "sourceUciProfileId" text;

COMMENT ON COLUMN public.race_uci_results."sourceUciProfileId" IS
  'Identificador interno del perfil UCI publicado por la fuente. No es la licencia UCI de 11 cifras.';

ALTER TABLE public.race_uci_results
  DROP CONSTRAINT IF EXISTS race_uci_results_source_uci_profile_id_format;
ALTER TABLE public.race_uci_results
  ADD CONSTRAINT race_uci_results_source_uci_profile_id_format
  CHECK ("sourceUciProfileId" IS NULL OR "sourceUciProfileId" ~ '^[0-9]{1,10}$');

CREATE OR REPLACE FUNCTION public.resolve_historical_uci_results_by_name(
  p_race_id text,
  p_gender text,
  p_rows jsonb
) RETURNS TABLE(matched integer, created integer, unresolved integer)
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_row          jsonb;
  v_bib          text;
  v_has_bib      boolean;
  v_display      text;
  v_first        text;
  v_last         text;
  v_country      text;
  v_birth        date;
  v_profile      text;
  v_license      text;
  v_ikey         text;
  v_found        text;
  v_base         text;
  v_candidate    text;
  v_n            integer;
  v_created      integer := 0;
  v_name_cands   text[];
  v_subset_cands text[];
  v_birth_cands  text[];
BEGIN
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'p_gender debe ser male|female, recibido %', p_gender;
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_rows debe ser un array JSON';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.races r
    WHERE r.id=p_race_id AND r."resultsOnly"=true AND r.year BETWEEN 2020 AND 2025
      AND r.gender=p_gender
  ) THEN
    RAISE EXCEPTION 'La resolución histórica solo admite resultsOnly 2020-2025 del género indicado';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_bib := NULLIF(v_row->>'bib','');
    v_has_bib := v_bib IS NOT NULL AND v_bib ~ '^[0-9]+$';
    v_display := NULLIF(v_row->>'display','');
    v_first := COALESCE(v_row->>'firstName','');
    v_last := COALESCE(v_row->>'lastName','');
    v_country := NULLIF(lower(COALESCE(v_row->>'countryCode','')), '');
    v_profile := NULLIF(v_row->>'uciProfileId','');
    v_license := NULLIF(v_row->>'uciLicenseId','');
    IF v_profile IS NOT NULL AND v_profile !~ '^[0-9]{1,10}$' THEN v_profile := NULL; END IF;
    IF v_license IS NOT NULL AND v_license !~ '^[0-9]{11}$' THEN v_license := NULL; END IF;
    v_birth := NULL;
    BEGIN
      IF v_row->>'birthDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        v_birth := (v_row->>'birthDate')::date;
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      v_birth := NULL;
    END;
    v_ikey := public.compute_identity_key(v_first,v_last);
    CONTINUE WHEN v_ikey IS NULL OR (NOT v_has_bib AND v_display IS NULL);

    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.race_uci_results r
      JOIN public.race_uci_stages st ON st.id=r."stageRef"
      WHERE r."raceId"=p_race_id AND NOT st."isTeamEvent" AND r."globalRiderId" IS NULL
        AND ((v_has_bib AND r.bib=v_bib)
          OR (NOT v_has_bib AND (r.bib IS NULL OR r.bib !~ '^[0-9]+$') AND r."riderDisplay"=v_display))
        AND (v_row->'eventIds' IS NULL OR jsonb_array_length(v_row->'eventIds')=0
          OR r."eventId"::text IN (SELECT jsonb_array_elements_text(v_row->'eventIds')))
        AND (v_display IS NULL OR r."riderDisplay" IS NULL
          OR public.compute_identity_key(r."riderDisplay",'')=public.compute_identity_key(v_display,''))
    );

    v_found := NULL;
    v_name_cands := '{}';
    v_subset_cands := '{}';
    v_birth_cands := '{}';

    IF p_gender='male' THEN
      SELECT id INTO v_found FROM public.riders_men
      WHERE v_profile IS NOT NULL AND "uciProfileId"=v_profile
        AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
        AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
    ELSE
      SELECT id INTO v_found FROM public.riders_women
      WHERE v_profile IS NOT NULL AND "uciProfileId"=v_profile
        AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
        AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
    END IF;

    IF v_found IS NULL THEN
      IF p_gender='male' THEN
        SELECT id INTO v_found FROM public.riders_men
        WHERE v_license IS NOT NULL AND "uciLicenseId"=v_license
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
      ELSE
        SELECT id INTO v_found FROM public.riders_women
        WHERE v_license IS NOT NULL AND "uciLicenseId"=v_license
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
      END IF;
    END IF;

    IF v_found IS NULL THEN
      IF p_gender='male' THEN
        SELECT id INTO v_found FROM public.riders_men
        WHERE "identityKey"=v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
      ELSE
        SELECT id INTO v_found FROM public.riders_women
        WHERE "identityKey"=v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
      END IF;
    END IF;

    -- El catálogo UCI conserva en otherNames las grafías oficiales largas. Este
    -- paso resuelve, por ejemplo, IZAGUIRRE INSAUSTI Ion contra Ion Izagirre.
    IF v_found IS NULL THEN
      IF p_gender='male' THEN
        SELECT coalesce(array_agg(id),'{}') INTO v_name_cands
        FROM public.riders_men
        WHERE "otherNames" IS NOT NULL
          AND public.compute_identity_key("firstName","otherNames")=v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
      ELSE
        SELECT coalesce(array_agg(id),'{}') INTO v_name_cands
        FROM public.riders_women
        WHERE "otherNames" IS NOT NULL
          AND public.compute_identity_key("firstName","otherNames")=v_ikey
          AND (v_birth IS NULL OR "birthDate" IS NULL OR "birthDate"=v_birth)
          AND (v_country IS NULL OR nationality IS NULL OR nationality=v_country);
      END IF;
      IF cardinality(v_name_cands)=1 THEN v_found:=v_name_cands[1]; END IF;
    END IF;

    IF v_found IS NULL THEN
      IF p_gender='male' THEN
        SELECT a."riderId" INTO v_found
        FROM public.rider_identity_aliases a JOIN public.riders_men m ON m.id=a."riderId"
        WHERE a."aliasKey"=v_ikey AND a.gender='male'
          AND (v_birth IS NULL OR m."birthDate" IS NULL OR m."birthDate"=v_birth)
          AND (v_country IS NULL OR m.nationality IS NULL OR m.nationality=v_country);
      ELSE
        SELECT a."riderId" INTO v_found
        FROM public.rider_identity_aliases a JOIN public.riders_women w ON w.id=a."riderId"
        WHERE a."aliasKey"=v_ikey AND a.gender='female'
          AND (v_birth IS NULL OR w."birthDate" IS NULL OR w."birthDate"=v_birth)
          AND (v_country IS NULL OR w.nationality IS NULL OR w.nationality=v_country);
      END IF;
    END IF;

    IF v_found IS NULL THEN
      IF p_gender='male' THEN
        SELECT coalesce(array_agg(m.id),'{}') INTO v_subset_cands
        FROM public.riders_men m
        WHERE m."identityKey" IS NOT NULL AND m."identityKey"<>v_ikey
          AND (m."birthDate" IS NULL OR v_birth IS NULL OR m."birthDate"=v_birth)
          AND ((array_length(string_to_array(m."identityKey",'-'),1)>=2
                AND string_to_array(m."identityKey",'-') <@ string_to_array(v_ikey,'-'))
            OR (array_length(string_to_array(v_ikey,'-'),1)>=2
                AND string_to_array(v_ikey,'-') <@ string_to_array(m."identityKey",'-')));
      ELSE
        SELECT coalesce(array_agg(w.id),'{}') INTO v_subset_cands
        FROM public.riders_women w
        WHERE w."identityKey" IS NOT NULL AND w."identityKey"<>v_ikey
          AND (w."birthDate" IS NULL OR v_birth IS NULL OR w."birthDate"=v_birth)
          AND ((array_length(string_to_array(w."identityKey",'-'),1)>=2
                AND string_to_array(w."identityKey",'-') <@ string_to_array(v_ikey,'-'))
            OR (array_length(string_to_array(v_ikey,'-'),1)>=2
                AND string_to_array(v_ikey,'-') <@ string_to_array(w."identityKey",'-')));
      END IF;
      IF cardinality(v_subset_cands)=1 THEN v_found:=v_subset_cands[1]; END IF;
    END IF;

    -- El nacimiento y el país forman un guard anti-duplicados. No bastan para
    -- casar dos personas: cualquier candidato biográfico impide el alta automática
    -- y el caso queda pendiente si los pasos nominales anteriores no lo resolvieron.
    IF v_birth IS NOT NULL AND v_country IS NOT NULL THEN
      IF p_gender='male' THEN
        SELECT coalesce(array_agg(m.id),'{}') INTO v_birth_cands
        FROM public.riders_men m
        WHERE m."birthDate"=v_birth AND m.nationality=v_country;
      ELSE
        SELECT coalesce(array_agg(w.id),'{}') INTO v_birth_cands
        FROM public.riders_women w
        WHERE w."birthDate"=v_birth AND w.nationality=v_country;
      END IF;
    END IF;

    IF v_found IS NULL THEN
      -- No se crea si el catálogo contiene cualquier candidato nominal o biográfico.
      CONTINUE WHEN cardinality(v_name_cands)>0 OR cardinality(v_subset_cands)>0
        OR cardinality(v_birth_cands)>0
        OR btrim(v_first)='' OR btrim(v_last)=''
        OR v_country IS NULL OR v_country !~ '^[a-z]{2}$'
        OR v_birth IS NULL OR v_birth<date '1900-01-01' OR v_birth>current_date;
      PERFORM pg_advisory_xact_lock(hashtextextended(p_gender||v_ikey,0));
      v_base:=regexp_replace(public.fold_name(v_last)||'-'||public.fold_name(v_first),' ','-','g');
      v_base:=regexp_replace(v_base,'-+','-','g');
      v_base:=regexp_replace(v_base,'(^-|-$)','','g');
      IF v_base='' OR v_base='-' THEN v_base:='rider'; END IF;
      v_candidate:=v_base; v_n:=2;
      LOOP
        IF p_gender='male' THEN PERFORM 1 FROM public.riders_men WHERE id=v_candidate;
        ELSE PERFORM 1 FROM public.riders_women WHERE id=v_candidate; END IF;
        EXIT WHEN NOT FOUND;
        v_candidate:=v_base||'-'||v_n; v_n:=v_n+1;
        EXIT WHEN v_n>200;
      END LOOP;
      BEGIN
        IF p_gender='male' THEN
          INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate",source,verified,
            "uciProfileId","uciLicenseId","historicalCatalogOnly")
          VALUES(v_candidate,v_first,v_last,v_country,v_birth,'uci_results',false,v_profile,v_license,true);
        ELSE
          INSERT INTO public.riders_women(id,"firstName","lastName",nationality,"birthDate",source,verified,
            "uciProfileId","uciLicenseId","historicalCatalogOnly")
          VALUES(v_candidate,v_first,v_last,v_country,v_birth,'uci_results',false,v_profile,v_license,true);
        END IF;
        v_found:=v_candidate; v_created:=v_created+1;
      EXCEPTION WHEN unique_violation THEN
        v_found:=NULL;
      END;
    END IF;

    IF v_found IS NOT NULL THEN
      IF v_has_bib THEN
        UPDATE public.race_uci_results r SET "globalRiderId"=v_found
        FROM public.race_uci_stages st
        WHERE st.id=r."stageRef" AND NOT st."isTeamEvent" AND r."raceId"=p_race_id
          AND r.bib=v_bib AND r."globalRiderId" IS NULL
          AND (v_row->'eventIds' IS NULL OR jsonb_array_length(v_row->'eventIds')=0
            OR r."eventId"::text IN (SELECT jsonb_array_elements_text(v_row->'eventIds')))
          AND (v_display IS NULL OR r."riderDisplay" IS NULL
            OR public.compute_identity_key(r."riderDisplay",'')=public.compute_identity_key(v_display,''));
      ELSE
        UPDATE public.race_uci_results r SET "globalRiderId"=v_found
        FROM public.race_uci_stages st
        WHERE st.id=r."stageRef" AND NOT st."isTeamEvent" AND r."raceId"=p_race_id
          AND (r.bib IS NULL OR r.bib !~ '^[0-9]+$') AND r."riderDisplay"=v_display
          AND r."globalRiderId" IS NULL
          AND (v_row->'eventIds' IS NULL OR jsonb_array_length(v_row->'eventIds')=0
            OR r."eventId"::text IN (SELECT jsonb_array_elements_text(v_row->'eventIds')));
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) FILTER (WHERE r."globalRiderId" IS NOT NULL)::integer,
         v_created,
         count(*) FILTER (WHERE r."globalRiderId" IS NULL)::integer
  INTO matched,created,unresolved
  FROM public.race_uci_results r JOIN public.race_uci_stages st ON st.id=r."stageRef"
  WHERE r."raceId"=p_race_id AND NOT st."isTeamEvent";
  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION public.resolve_historical_uci_results_by_name(text,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_historical_uci_results_by_name(text,text,jsonb)
  TO service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.resolve_historical_result_participations(text,text)
  TO cc_results_worker;

COMMIT;
