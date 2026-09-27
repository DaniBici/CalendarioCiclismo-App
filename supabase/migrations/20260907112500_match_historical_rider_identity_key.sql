BEGIN;

CREATE OR REPLACE FUNCTION private.upsert_historical_rider_profile(
  p_batch text,p_year integer,p_profile text,p_gender text,p_rider_id text,
  p_first text,p_last text,p_country text,p_birth date,p_license text,p_evidence jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id text:=p_rider_id; v_key text; v_count integer; v_n integer:=1; v_before jsonb;
BEGIN
  PERFORM private.historical_batch_guard(p_batch);
  IF p_year NOT BETWEEN 2020 AND 2025 OR p_profile!~'^[0-9]{1,10}$' OR p_gender NOT IN ('male','female')
    OR btrim(COALESCE(p_first,''))='' OR btrim(COALESCE(p_last,''))='' OR p_country!~'^[a-z]{2}$'
    OR p_birth NOT BETWEEN date '1900-01-01' AND current_date-interval '14 years'
    OR (p_license IS NOT NULL AND p_license!~'^[0-9]{11}$')
    OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence)=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) e WHERE e->>'url'!~'^https://[^/ ]+/' OR e->>'consultedAt' IS NULL)
    THEN RAISE EXCEPTION 'invalid_historical_rider_decision'; END IF;
  IF (p_gender='male' AND EXISTS(SELECT 1 FROM public.riders_women WHERE "uciProfileId"=p_profile OR (p_license IS NOT NULL AND "uciLicenseId"=p_license)))
    OR (p_gender='female' AND EXISTS(SELECT 1 FROM public.riders_men WHERE "uciProfileId"=p_profile OR (p_license IS NOT NULL AND "uciLicenseId"=p_license)))
    THEN RAISE EXCEPTION 'historical_rider_gender_conflict'; END IF;
  SELECT count(*),min(id) INTO v_count,v_id FROM (
    SELECT id FROM public.riders_men WHERE p_gender='male' AND ("uciProfileId"=p_profile OR (p_license IS NOT NULL AND "uciLicenseId"=p_license))
    UNION ALL SELECT id FROM public.riders_women WHERE p_gender='female' AND ("uciProfileId"=p_profile OR (p_license IS NOT NULL AND "uciLicenseId"=p_license))
  ) q;
  IF v_count=0 THEN
    SELECT count(*),min(id) INTO v_count,v_id FROM (
      SELECT id FROM public.riders_men WHERE p_gender='male'
        AND "identityKey" IN (public.compute_identity_key(p_first,p_last),public.compute_identity_key(p_first,p_last)||'-'||extract(year FROM p_birth)::integer)
        AND ("birthDate" IS NULL OR "birthDate"=p_birth) AND (p_country='xx' OR nationality IS NULL OR nationality=p_country)
      UNION ALL SELECT id FROM public.riders_women WHERE p_gender='female'
        AND "identityKey" IN (public.compute_identity_key(p_first,p_last),public.compute_identity_key(p_first,p_last)||'-'||extract(year FROM p_birth)::integer)
        AND ("birthDate" IS NULL OR "birthDate"=p_birth) AND (p_country='xx' OR nationality IS NULL OR nationality=p_country)
    ) q;
  END IF;
  IF p_rider_id IS NOT NULL THEN v_id:=p_rider_id; END IF;
  IF v_count>1 THEN RAISE EXCEPTION 'historical_rider_identity_conflict'; END IF;
  IF v_id IS NULL THEN
    v_key:=regexp_replace(public.fold_name(p_last)||'-'||public.fold_name(p_first),'[^a-z0-9]+','-','g');
    v_key:=trim(both '-' from v_key); IF v_key='' THEN v_key:='rider'; END IF; v_id:=v_key;
    LOOP
      EXIT WHEN NOT EXISTS(SELECT 1 FROM public.riders_men WHERE id=v_id)
        AND NOT EXISTS(SELECT 1 FROM public.riders_women WHERE id=v_id);
      v_n:=v_n+1; v_id:=v_key||'-'||v_n; IF v_n>500 THEN RAISE EXCEPTION 'historical_rider_id_exhausted'; END IF;
    END LOOP;
  END IF;
  IF p_gender='male' THEN
    SELECT to_jsonb(r) INTO v_before FROM public.riders_men r WHERE id=v_id FOR UPDATE;
    IF v_before IS NULL THEN
      INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate",source,verified,"uciProfileId","uciLicenseId")
        VALUES(v_id,p_first,p_last,p_country,p_birth,'uci_historical',true,p_profile,p_license);
    ELSE
      IF (v_before->>'uciProfileId' IS NOT NULL AND v_before->>'uciProfileId'<>p_profile)
        OR (p_license IS NOT NULL AND v_before->>'uciLicenseId' IS NOT NULL AND v_before->>'uciLicenseId'<>p_license)
        OR (v_before->>'birthDate' IS NOT NULL AND (v_before->>'birthDate')::date<>p_birth)
        OR (p_country<>'xx' AND v_before->>'nationality' IS NOT NULL AND v_before->>'nationality'<>p_country)
        OR v_before->>'identityKey' NOT IN (public.compute_identity_key(p_first,p_last),
          public.compute_identity_key(p_first,p_last)||'-'||extract(year FROM p_birth)::integer)
        THEN RAISE EXCEPTION 'historical_rider_identity_conflict'; END IF;
      UPDATE public.riders_men SET "birthDate"=COALESCE("birthDate",p_birth),nationality=COALESCE(nationality,p_country),
        "uciProfileId"=COALESCE("uciProfileId",p_profile),"uciLicenseId"=COALESCE("uciLicenseId",p_license),"updatedAt"=now() WHERE id=v_id;
    END IF;
  ELSE
    SELECT to_jsonb(r) INTO v_before FROM public.riders_women r WHERE id=v_id FOR UPDATE;
    IF v_before IS NULL THEN
      INSERT INTO public.riders_women(id,"firstName","lastName",nationality,"birthDate",source,verified,"uciProfileId","uciLicenseId")
        VALUES(v_id,p_first,p_last,p_country,p_birth,'uci_historical',true,p_profile,p_license);
    ELSE
      IF (v_before->>'uciProfileId' IS NOT NULL AND v_before->>'uciProfileId'<>p_profile)
        OR (p_license IS NOT NULL AND v_before->>'uciLicenseId' IS NOT NULL AND v_before->>'uciLicenseId'<>p_license)
        OR (v_before->>'birthDate' IS NOT NULL AND (v_before->>'birthDate')::date<>p_birth)
        OR (p_country<>'xx' AND v_before->>'nationality' IS NOT NULL AND v_before->>'nationality'<>p_country)
        OR v_before->>'identityKey' NOT IN (public.compute_identity_key(p_first,p_last),
          public.compute_identity_key(p_first,p_last)||'-'||extract(year FROM p_birth)::integer)
        THEN RAISE EXCEPTION 'historical_rider_identity_conflict'; END IF;
      UPDATE public.riders_women SET "birthDate"=COALESCE("birthDate",p_birth),nationality=COALESCE(nationality,p_country),
        "uciProfileId"=COALESCE("uciProfileId",p_profile),"uciLicenseId"=COALESCE("uciLicenseId",p_license),"updatedAt"=now() WHERE id=v_id;
    END IF;
  END IF;
  INSERT INTO private.historical_identity_changes("batchId",entity,"entityKey",before,after,evidence)
    VALUES(p_batch,'rider-profile',p_year||':'||p_gender||':'||p_profile,v_before,
      jsonb_build_object('riderId',v_id,'year',p_year,'profile',p_profile,'license',p_license),p_evidence)
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;

COMMIT;
