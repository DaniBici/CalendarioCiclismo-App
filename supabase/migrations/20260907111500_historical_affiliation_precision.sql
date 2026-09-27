BEGIN;

CREATE FUNCTION private.upsert_historical_affiliation(
  p_batch text,p_rider_id text,p_gender text,p_team_id text,p_team_profile text,p_year integer,
  p_type text,p_date_from date,p_date_to date,p_date_from_precision text,p_date_to_precision text,
  p_source_url text,p_verified_at timestamptz,p_evidence jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id text; v_rider_id text; v_before jsonb;
BEGIN
  PERFORM private.historical_batch_guard(p_batch);
  SELECT after->>'riderId' INTO v_rider_id FROM private.historical_identity_changes
    WHERE "batchId"=p_batch AND entity='rider-profile'
      AND "entityKey"=p_year||':'||p_gender||':'||p_rider_id;
  IF p_gender NOT IN ('male','female') OR p_year NOT BETWEEN 2020 AND 2025
    OR p_type NOT IN ('regular','trainee')
    OR p_date_from_precision NOT IN ('day','month','year','unknown')
    OR p_date_to_precision NOT IN ('day','month','year','unknown')
    OR (p_date_from IS NULL) <> (p_date_from_precision='unknown')
    OR (p_date_to IS NULL) <> (p_date_to_precision='unknown')
    OR p_date_from IS NOT NULL AND extract(year FROM p_date_from)::integer<>p_year
    OR p_date_to IS NOT NULL AND extract(year FROM p_date_to)::integer<>p_year
    OR p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from>p_date_to
    OR p_source_url!~'^https://[^/ ]+/' OR p_verified_at IS NULL
    OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence)=0
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) e WHERE COALESCE((e->>'externalToUci')::boolean,false))
    OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=p_team_id AND gender=p_gender AND NOT "specialEdition" AND "teamKind"<>'selection')
    OR NOT EXISTS(SELECT 1 FROM private.uci_catalog_team_links WHERE season=p_year AND profile=p_team_profile
      AND gender=p_gender AND team_id=p_team_id)
    OR v_rider_id IS NULL
    OR NOT ((p_gender='male' AND EXISTS(SELECT 1 FROM public.riders_men WHERE id=v_rider_id))
      OR (p_gender='female' AND EXISTS(SELECT 1 FROM public.riders_women WHERE id=v_rider_id)))
    THEN RAISE EXCEPTION 'invalid_historical_affiliation'; END IF;
  v_id:='hist_'||md5(concat_ws('|',p_gender,v_rider_id,p_team_id,p_year,p_type,p_date_from,p_date_to,p_source_url));
  SELECT to_jsonb(a) INTO v_before FROM public.rider_team_affiliations a WHERE id=v_id FOR UPDATE;
  INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateFrom","dateTo",
    source,verified,"affiliationType","sourceUrl","uciTeamProfileId","dateBasis","verifiedAt","dateFromPrecision","dateToPrecision")
  VALUES(v_id,v_rider_id,p_gender,p_team_id,p_year,p_date_from,p_date_to,'historical_verified',true,p_type,
    p_source_url,p_team_profile::integer,
    CASE WHEN p_type='trainee' AND p_date_from=make_date(p_year,8,1) AND p_date_to=make_date(p_year,12,31)
      THEN 'regulatory_window' WHEN p_type='trainee' THEN 'official' ELSE 'external_evidence' END,
    p_verified_at,p_date_from_precision,p_date_to_precision)
  ON CONFLICT(id) DO UPDATE SET "dateFrom"=EXCLUDED."dateFrom","dateTo"=EXCLUDED."dateTo",
    "affiliationType"=EXCLUDED."affiliationType","sourceUrl"=EXCLUDED."sourceUrl",
    "uciTeamProfileId"=EXCLUDED."uciTeamProfileId","verifiedAt"=EXCLUDED."verifiedAt",
    "dateFromPrecision"=EXCLUDED."dateFromPrecision","dateToPrecision"=EXCLUDED."dateToPrecision","updatedAt"=now();
  INSERT INTO private.historical_identity_changes("batchId",entity,"entityKey",before,after,evidence)
    VALUES(p_batch,p_type||'-affiliation',v_id,v_before,
      (SELECT to_jsonb(a) FROM public.rider_team_affiliations a WHERE id=v_id),p_evidence)
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION private.upsert_historical_affiliation(
  text,text,text,text,text,integer,text,date,date,text,text,text,timestamptz,jsonb
) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.upsert_historical_affiliation(
  text,text,text,text,text,integer,text,date,date,text,text,text,timestamptz,jsonb
) TO service_role;

COMMIT;
