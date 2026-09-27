-- Catálogo histórico 2020-2025. Contrato aditivo y compatible con clientes
-- anteriores: las columnas nuevas son anulables y no se retira ninguna RPC.
BEGIN;

ALTER TABLE public.riders_men ADD COLUMN IF NOT EXISTS "uciLicenseId" text;
ALTER TABLE public.riders_women ADD COLUMN IF NOT EXISTS "uciLicenseId" text;
ALTER TABLE public.riders_men ADD CONSTRAINT riders_men_uci_license_format
  CHECK ("uciLicenseId" IS NULL OR "uciLicenseId" ~ '^[0-9]{11}$');
ALTER TABLE public.riders_women ADD CONSTRAINT riders_women_uci_license_format
  CHECK ("uciLicenseId" IS NULL OR "uciLicenseId" ~ '^[0-9]{11}$');
CREATE UNIQUE INDEX IF NOT EXISTS riders_men_uci_license_unique
  ON public.riders_men ("uciLicenseId") WHERE "uciLicenseId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS riders_women_uci_license_unique
  ON public.riders_women ("uciLicenseId") WHERE "uciLicenseId" IS NOT NULL;

ALTER TABLE public.race_uci_results
  ADD COLUMN IF NOT EXISTS "sourceTeamName" text,
  ADD COLUMN IF NOT EXISTS "sourceTeamCode" text,
  ADD COLUMN IF NOT EXISTS "sourceUciLicense" text;
ALTER TABLE public.race_uci_results ADD CONSTRAINT race_uci_results_source_license_format
  CHECK ("sourceUciLicense" IS NULL OR "sourceUciLicense" ~ '^[0-9]{11}$');

ALTER TABLE public.rider_team_affiliations
  ADD COLUMN IF NOT EXISTS "dateFromPrecision" text,
  ADD COLUMN IF NOT EXISTS "dateToPrecision" text;
ALTER TABLE public.rider_team_affiliations ADD CONSTRAINT regular_affiliation_precision_valid
  CHECK (
    ("dateFromPrecision" IS NULL OR "dateFromPrecision" IN ('day','month','year','unknown'))
    AND ("dateToPrecision" IS NULL OR "dateToPrecision" IN ('day','month','year','unknown'))
    AND ("dateFrom" IS NOT NULL OR "dateFromPrecision" IS NULL OR "dateFromPrecision"='unknown')
    AND ("dateTo" IS NOT NULL OR "dateToPrecision" IS NULL OR "dateToPrecision"='unknown')
  );

CREATE TABLE public.team_season_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "teamId" text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  "validFrom" date,
  "validTo" date,
  name text NOT NULL CHECK (btrim(name)<>''),
  "uciCode" text CHECK ("uciCode" IS NULL OR (char_length("uciCode")=3 AND "uciCode"!~'[[:space:]]')),
  category text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male','female')),
  "sourceUrl" text NOT NULL CHECK ("sourceUrl" ~ '^https://[^/ ]+/'),
  "sourcePublishedAt" date,
  "verifiedAt" timestamptz NOT NULL,
  "evidenceSummary" text NOT NULL CHECK (btrim("evidenceSummary")<>''),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("validFrom" IS NULL OR extract(year FROM "validFrom")::integer=year),
  CHECK ("validTo" IS NULL OR extract(year FROM "validTo")::integer=year),
  CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom"<="validTo")
);
CREATE UNIQUE INDEX team_season_variants_logical_unique
  ON public.team_season_variants ("teamId",year,name,COALESCE("validFrom",date '0001-01-01'),COALESCE("validTo",date '9999-12-31'));
CREATE INDEX team_season_variants_lookup ON public.team_season_variants ("teamId",year,"validFrom","validTo");
ALTER TABLE public.team_season_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read_team_season_variants ON public.team_season_variants FOR SELECT USING (true);
REVOKE ALL ON public.team_season_variants FROM PUBLIC;
GRANT SELECT ON public.team_season_variants TO anon,authenticated,service_role;

CREATE TABLE private.historical_identity_batches (
  id text PRIMARY KEY CHECK (id ~ '^historical-identities-2020-2025-[0-9]{8}(?:-[a-z0-9-]+)?$'),
  status text NOT NULL CHECK (status IN ('applying','applied','failed')),
  manifest jsonb NOT NULL,
  "beforeCurrentState" jsonb NOT NULL,
  "afterCurrentState" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "completedAt" timestamptz
);
CREATE TABLE private.historical_identity_changes (
  "batchId" text NOT NULL REFERENCES private.historical_identity_batches(id),
  entity text NOT NULL,
  "entityKey" text NOT NULL,
  before jsonb,
  after jsonb NOT NULL,
  evidence jsonb NOT NULL,
  "changedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY ("batchId",entity,"entityKey")
);
CREATE TABLE private.historical_team_roster_observations (
  year integer NOT NULL CHECK (year BETWEEN 2020 AND 2025),
  "uciTeamProfileId" text NOT NULL CHECK ("uciTeamProfileId" ~ '^[0-9]{1,10}$'),
  "uciRiderProfileId" text NOT NULL CHECK ("uciRiderProfileId" ~ '^[0-9]{1,10}$'),
  "teamId" text NOT NULL REFERENCES public.teams(id),
  "riderId" text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('male','female')),
  "observationType" text NOT NULL CHECK ("observationType" IN ('regular','trainee')),
  "sourceUrl" text NOT NULL CHECK ("sourceUrl" ~ '^https://www[.]uci[.]org/team-details/[0-9]+$'),
  "sourceHash" text NOT NULL CHECK ("sourceHash" ~ '^[0-9a-f]{64}$'),
  "observedAt" timestamptz NOT NULL,
  "batchId" text NOT NULL REFERENCES private.historical_identity_batches(id),
  PRIMARY KEY (year,"uciTeamProfileId","uciRiderProfileId","observationType")
);
CREATE TABLE private.historical_participation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL CHECK (year BETWEEN 2020 AND 2025),
  "competitionId" bigint,
  "eventId" bigint,
  bib text,
  "uciRiderProfileId" text CHECK ("uciRiderProfileId" IS NULL OR "uciRiderProfileId" ~ '^[0-9]{1,10}$'),
  "uciLicenseId" text CHECK ("uciLicenseId" IS NULL OR "uciLicenseId" ~ '^[0-9]{11}$'),
  "riderId" text,
  "uciTeamProfileId" text CHECK ("uciTeamProfileId" IS NULL OR "uciTeamProfileId" ~ '^[0-9]{1,10}$'),
  "teamId" text NOT NULL REFERENCES public.teams(id),
  "sourceTeamName" text NOT NULL,
  "participationType" text NOT NULL CHECK ("participationType" IN ('regular','trainee','loan','selection','club','mixed_team','development_team')),
  evidence jsonb NOT NULL,
  decision text NOT NULL,
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified','pending','superseded')),
  "batchId" text NOT NULL REFERENCES private.historical_identity_batches(id),
  "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ("uciRiderProfileId" IS NOT NULL OR "uciLicenseId" IS NOT NULL OR "riderId" IS NOT NULL),
  CHECK ("competitionId" IS NOT NULL OR "eventId" IS NOT NULL)
);
CREATE UNIQUE INDEX historical_participation_decisions_key
  ON private.historical_participation_decisions
  (year,COALESCE("competitionId",-1),COALESCE("eventId",-1),COALESCE(bib,''),
   COALESCE("uciRiderProfileId",''),COALESCE("uciLicenseId",''),"teamId")
  WHERE status='verified';

REVOKE ALL ON private.historical_identity_batches,private.historical_identity_changes,
  private.historical_team_roster_observations,private.historical_participation_decisions
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON private.historical_identity_batches,private.historical_identity_changes,
  private.historical_team_roster_observations,private.historical_participation_decisions TO service_role;

CREATE FUNCTION private.historical_current_state() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'teamSeasons',COALESCE((SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text)
      FROM public.team_seasons s WHERE s.year>=extract(year FROM current_date)::integer),'none'),
    'teams',COALESCE((SELECT md5(jsonb_agg(jsonb_build_array(t.id,t.name,t.category,t.gender,t."firstSeason",
      t."headerBg",t."headerText",t."badgeTorsoCenter",t."badgeTorsoSides",t."badgeInnerCircle",t."badgeShorts") ORDER BY t.id)::text)
      FROM public.teams t WHERE EXISTS (SELECT 1 FROM public.team_seasons s WHERE s."teamId"=t.id AND s.year>=extract(year FROM current_date)::integer)),'none'),
    'men',COALESCE((SELECT md5(jsonb_agg(jsonb_build_array(id,"currentTeamId") ORDER BY id)::text)
      FROM public.riders_men WHERE "currentTeamId" IS NOT NULL),'none'),
    'women',COALESCE((SELECT md5(jsonb_agg(jsonb_build_array(id,"currentTeamId") ORDER BY id)::text)
      FROM public.riders_women WHERE "currentTeamId" IS NOT NULL),'none')
  );
$$;

CREATE FUNCTION private.historical_batch_guard(p_batch text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin','service_role')
     AND NOT COALESCE(private.is_admin(),false) THEN
    RAISE EXCEPTION 'historical_catalog_admin_required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.historical_identity_batches WHERE id=p_batch AND status='applying') THEN
    RAISE EXCEPTION 'historical_batch_not_applying' USING ERRCODE='55000';
  END IF;
END;
$$;

CREATE FUNCTION private.begin_historical_identity_batch(p_id text,p_manifest jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_state jsonb;
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin','service_role')
     AND NOT COALESCE(private.is_admin(),false) THEN RAISE EXCEPTION 'historical_catalog_admin_required' USING ERRCODE='42501'; END IF;
  IF p_id !~ '^historical-identities-2020-2025-[0-9]{8}(?:-[a-z0-9-]+)?$'
    OR jsonb_typeof(p_manifest) IS DISTINCT FROM 'object'
    OR p_manifest->>'applyAllowed' IS DISTINCT FROM 'true'
    OR p_manifest->>'scope' IS DISTINCT FROM '2020-2025'
    OR p_manifest->>'sourceHash' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_historical_manifest'; END IF;
  SELECT private.historical_current_state() INTO v_state;
  INSERT INTO private.historical_identity_batches(id,status,manifest,"beforeCurrentState")
    VALUES(p_id,'applying',p_manifest,v_state)
  ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND AND EXISTS(SELECT 1 FROM private.historical_identity_batches WHERE id=p_id AND status='applied') THEN
    RETURN jsonb_build_object('status','alreadyApplied');
  END IF;
  PERFORM private.historical_batch_guard(p_id);
  RETURN jsonb_build_object('status','applying','currentState',v_state);
END;
$$;

CREATE FUNCTION private.upsert_historical_team_season(
  p_batch text,p_year integer,p_profile text,p_team_id text,p_continuity text,
  p_name text,p_code text,p_gender text,p_category text,p_country text,
  p_evidence jsonb,p_appearance jsonb DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id text:=p_team_id; v_before jsonb; v_badge boolean;
BEGIN
  PERFORM private.historical_batch_guard(p_batch);
  IF p_year NOT BETWEEN 2020 AND 2025 OR p_profile!~'^[0-9]{1,10}$'
    OR p_continuity NOT IN ('new_matrix','same_matrix') OR btrim(COALESCE(p_name,''))=''
    OR p_code!~'^[^[:space:]]{3}$' OR p_gender NOT IN ('male','female')
    OR p_category NOT IN ('WT','PT','CT','WWT','PRW','CTW')
    OR (p_gender='male') IS DISTINCT FROM (p_category IN ('WT','PT','CT'))
    OR p_country!~'^[a-z]{2}$' OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_evidence)=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) e
      WHERE e->>'url'!~'^https://[^/ ]+/' OR e->>'consultedAt' IS NULL OR btrim(COALESCE(e->>'summary',''))='')
    OR (p_continuity='same_matrix' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) e WHERE COALESCE((e->>'externalToUci')::boolean,false)))
    THEN RAISE EXCEPTION 'invalid_historical_team_decision'; END IF;
  IF p_continuity='same_matrix' AND v_id IS NULL THEN RAISE EXCEPTION 'historical_team_id_required'; END IF;
  IF v_id IS NULL THEN v_id:=gen_random_uuid()::text; END IF;
  SELECT to_jsonb(t) INTO v_before FROM public.teams t WHERE id=v_id FOR UPDATE;
  IF v_before IS NULL THEN
    IF p_continuity<>'new_matrix' THEN RAISE EXCEPTION 'historical_team_missing'; END IF;
    PERFORM set_config('app.historical_catalog','on',true);
    INSERT INTO public.teams(id,name,category,gender,"countryCode","teamKind","firstSeason")
      VALUES(v_id,p_name,p_category,p_gender,p_country,'club',p_year);
  ELSIF (v_before->>'gender') IS DISTINCT FROM p_gender
    OR COALESCE((v_before->>'specialEdition')::boolean,false)
    OR v_before->>'teamKind'='selection' THEN RAISE EXCEPTION 'historical_team_incompatible'; END IF;
  v_badge:=p_appearance IS NOT NULL AND p_appearance ?& ARRAY['headerBg','headerText','badgeTorsoCenter','badgeTorsoSides','badgeShorts'];
  INSERT INTO public.team_seasons(id,"teamId",year,name,"nameAliases",category,gender,
    "headerBg","headerText","badgeTorsoCenter","badgeTorsoSides","badgeInnerCircle","badgeShorts",
    translations,"badgeVisible","continuityDoubt","uciCode")
  VALUES(v_id||'_'||p_year,v_id,p_year,p_name,NULL,p_category,p_gender,
    COALESCE(p_appearance->>'headerBg','#1f2937'),COALESCE(p_appearance->>'headerText','#ffffff'),
    COALESCE(p_appearance->>'badgeTorsoCenter','#ffffff'),COALESCE(p_appearance->>'badgeTorsoSides','#000000'),
    p_appearance->>'badgeInnerCircle',COALESCE(p_appearance->>'badgeShorts','#000000'),'{}',v_badge,false,p_code)
  ON CONFLICT("teamId",year) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,gender=EXCLUDED.gender,
    "uciCode"=EXCLUDED."uciCode","badgeVisible"=EXCLUDED."badgeVisible",
    "headerBg"=EXCLUDED."headerBg","headerText"=EXCLUDED."headerText",
    "badgeTorsoCenter"=EXCLUDED."badgeTorsoCenter","badgeTorsoSides"=EXCLUDED."badgeTorsoSides",
    "badgeInnerCircle"=EXCLUDED."badgeInnerCircle","badgeShorts"=EXCLUDED."badgeShorts","updatedAt"=now();
  INSERT INTO private.uci_catalog_team_links(season,profile,team_id,gender,category,source_name,source_code)
    VALUES(p_year,p_profile,v_id,p_gender,p_category,p_name,p_code)
  ON CONFLICT(season,profile) DO UPDATE SET team_id=EXCLUDED.team_id,gender=EXCLUDED.gender,
    category=EXCLUDED.category,source_name=EXCLUDED.source_name,source_code=EXCLUDED.source_code,reviewed_at=clock_timestamp();
  INSERT INTO private.historical_identity_changes("batchId",entity,"entityKey",before,after,evidence)
    VALUES(p_batch,'team-season',p_year||':'||p_profile,v_before,
      jsonb_build_object('teamId',v_id,'year',p_year,'profile',p_profile,'name',p_name,'code',p_code,'continuity',p_continuity),p_evidence)
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;

CREATE FUNCTION private.upsert_historical_rider_profile(
  p_batch text,p_year integer,p_profile text,p_gender text,p_rider_id text,
  p_first text,p_last text,p_country text,p_birth date,p_license text,p_evidence jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id text:=p_rider_id; v_key text; v_identity_key text; v_count integer; v_n integer:=1; v_before jsonb; v_profile_match boolean:=false;
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
  v_profile_match:=v_count=1;
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
  v_identity_key:=public.compute_identity_key(p_first,p_last);
  IF v_before IS NULL AND ((p_gender='male' AND EXISTS(SELECT 1 FROM public.riders_men WHERE "identityKey"=v_identity_key))
    OR (p_gender='female' AND EXISTS(SELECT 1 FROM public.riders_women WHERE "identityKey"=v_identity_key)))
  THEN v_identity_key:=v_identity_key||'-'||extract(year FROM p_birth)::integer; END IF;
  IF p_gender='male' THEN
    SELECT to_jsonb(r) INTO v_before FROM public.riders_men r WHERE id=v_id FOR UPDATE;
    IF v_before IS NULL THEN
      INSERT INTO public.riders_men(id,"firstName","lastName",nationality,"birthDate",source,verified,"uciProfileId","uciLicenseId","identityKey")
        VALUES(v_id,p_first,p_last,p_country,p_birth,'uci_historical',true,p_profile,p_license,v_identity_key);
    ELSE
      IF (p_license IS NOT NULL AND v_before->>'uciLicenseId' IS NOT NULL AND v_before->>'uciLicenseId'<>p_license)
        OR (v_before->>'birthDate' IS NOT NULL AND (v_before->>'birthDate')::date<>p_birth)
        OR (NOT v_profile_match AND p_country<>'xx' AND v_before->>'nationality' IS NOT NULL AND v_before->>'nationality'<>p_country)
        OR (NOT v_profile_match AND v_before->>'identityKey' NOT IN (public.compute_identity_key(p_first,p_last),
          public.compute_identity_key(p_first,p_last)||'-'||extract(year FROM p_birth)::integer)
        )
        THEN RAISE EXCEPTION 'historical_rider_identity_conflict'; END IF;
      UPDATE public.riders_men SET "birthDate"=COALESCE("birthDate",p_birth),nationality=COALESCE(nationality,p_country),
        "uciProfileId"=COALESCE("uciProfileId",p_profile),"uciLicenseId"=COALESCE("uciLicenseId",p_license),"updatedAt"=now() WHERE id=v_id;
    END IF;
  ELSE
    SELECT to_jsonb(r) INTO v_before FROM public.riders_women r WHERE id=v_id FOR UPDATE;
    IF v_before IS NULL THEN
      INSERT INTO public.riders_women(id,"firstName","lastName",nationality,"birthDate",source,verified,"uciProfileId","uciLicenseId","identityKey")
        VALUES(v_id,p_first,p_last,p_country,p_birth,'uci_historical',true,p_profile,p_license,v_identity_key);
    ELSE
      IF (p_license IS NOT NULL AND v_before->>'uciLicenseId' IS NOT NULL AND v_before->>'uciLicenseId'<>p_license)
        OR (v_before->>'birthDate' IS NOT NULL AND (v_before->>'birthDate')::date<>p_birth)
        OR (NOT v_profile_match AND p_country<>'xx' AND v_before->>'nationality' IS NOT NULL AND v_before->>'nationality'<>p_country)
        OR (NOT v_profile_match AND v_before->>'identityKey' NOT IN (public.compute_identity_key(p_first,p_last),
          public.compute_identity_key(p_first,p_last)||'-'||extract(year FROM p_birth)::integer)
        )
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

CREATE FUNCTION private.record_historical_roster_observation(
  p_batch text,p_year integer,p_team_profile text,p_rider_profile text,
  p_gender text,p_type text,p_source_hash text,p_observed_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_team text; v_rider text;
BEGIN
  PERFORM private.historical_batch_guard(p_batch);
  SELECT team_id INTO STRICT v_team FROM private.uci_catalog_team_links WHERE season=p_year AND profile=p_team_profile AND gender=p_gender;
  SELECT after->>'riderId' INTO v_rider FROM private.historical_identity_changes
    WHERE "batchId"=p_batch AND entity='rider-profile' AND "entityKey"=p_year||':'||p_gender||':'||p_rider_profile;
  IF v_rider IS NULL OR p_type NOT IN ('regular','trainee') OR p_source_hash!~'^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_historical_roster_observation'; END IF;
  INSERT INTO private.historical_team_roster_observations(year,"uciTeamProfileId","uciRiderProfileId","teamId","riderId",gender,
    "observationType","sourceUrl","sourceHash","observedAt","batchId")
  VALUES(p_year,p_team_profile,p_rider_profile,v_team,v_rider,p_gender,p_type,
    'https://www.uci.org/team-details/'||p_team_profile,p_source_hash,p_observed_at,p_batch)
  ON CONFLICT(year,"uciTeamProfileId","uciRiderProfileId","observationType") DO UPDATE SET
    "teamId"=EXCLUDED."teamId","riderId"=EXCLUDED."riderId","sourceHash"=EXCLUDED."sourceHash",
    "observedAt"=EXCLUDED."observedAt","batchId"=EXCLUDED."batchId";
END;
$$;

CREATE FUNCTION private.upsert_historical_regular_affiliation(
  p_batch text,p_rider_id text,p_gender text,p_team_id text,p_year integer,
  p_date_from date,p_date_to date,p_source_url text,p_verified_at timestamptz,p_evidence jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id text; v_before jsonb;
BEGIN
  PERFORM private.historical_batch_guard(p_batch);
  IF p_gender NOT IN ('male','female') OR p_year NOT BETWEEN 2020 AND 2025
    OR p_date_from IS NULL AND p_date_to IS NULL
    OR p_date_from IS NOT NULL AND extract(year FROM p_date_from)::integer<>p_year
    OR p_date_to IS NOT NULL AND extract(year FROM p_date_to)::integer<>p_year
    OR p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from>p_date_to
    OR p_source_url!~'^https://[^/ ]+/' OR p_verified_at IS NULL
    OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence)=0
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) e WHERE COALESCE((e->>'externalToUci')::boolean,false))
    OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=p_team_id AND gender=p_gender AND NOT "specialEdition" AND "teamKind"<>'selection')
    OR NOT ((p_gender='male' AND EXISTS(SELECT 1 FROM public.riders_men WHERE id=p_rider_id))
      OR (p_gender='female' AND EXISTS(SELECT 1 FROM public.riders_women WHERE id=p_rider_id)))
    THEN RAISE EXCEPTION 'invalid_historical_affiliation'; END IF;
  v_id:='hist_'||md5(concat_ws('|',p_gender,p_rider_id,p_team_id,p_year,p_date_from,p_date_to,p_source_url));
  SELECT to_jsonb(a) INTO v_before FROM public.rider_team_affiliations a WHERE id=v_id FOR UPDATE;
  INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateFrom","dateTo",
    source,verified,"sourceUrl","dateBasis","verifiedAt","dateFromPrecision","dateToPrecision")
  VALUES(v_id,p_rider_id,p_gender,p_team_id,p_year,p_date_from,p_date_to,'historical_verified',true,
    p_source_url,'official',p_verified_at,
    CASE WHEN p_date_from IS NULL THEN 'unknown' ELSE 'day' END,
    CASE WHEN p_date_to IS NULL THEN 'unknown' ELSE 'day' END)
  ON CONFLICT(id) DO UPDATE SET "dateFrom"=EXCLUDED."dateFrom","dateTo"=EXCLUDED."dateTo",
    "sourceUrl"=EXCLUDED."sourceUrl","verifiedAt"=EXCLUDED."verifiedAt",
    "dateFromPrecision"=EXCLUDED."dateFromPrecision","dateToPrecision"=EXCLUDED."dateToPrecision","updatedAt"=now();
  INSERT INTO private.historical_identity_changes("batchId",entity,"entityKey",before,after,evidence)
    VALUES(p_batch,'regular-affiliation',v_id,v_before,
      (SELECT to_jsonb(a) FROM public.rider_team_affiliations a WHERE id=v_id),p_evidence)
  ON CONFLICT DO NOTHING;
  RETURN v_id;
END;
$$;

CREATE FUNCTION private.record_historical_participation_decision(
  p_batch text,p_year integer,p_competition_id bigint,p_event_id bigint,p_bib text,
  p_rider_profile text,p_uci_license text,p_rider_id text,p_team_profile text,p_team_id text,
  p_source_team_name text,p_type text,p_evidence jsonb,p_decision text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM private.historical_batch_guard(p_batch);
  IF p_year NOT BETWEEN 2020 AND 2025 OR (p_competition_id IS NULL AND p_event_id IS NULL)
    OR (p_rider_profile IS NULL AND p_uci_license IS NULL AND p_rider_id IS NULL)
    OR (p_rider_profile IS NOT NULL AND p_rider_profile!~'^[0-9]{1,10}$')
    OR (p_uci_license IS NOT NULL AND p_uci_license!~'^[0-9]{11}$')
    OR btrim(COALESCE(p_source_team_name,''))='' OR btrim(COALESCE(p_decision,''))=''
    OR p_type NOT IN ('regular','trainee','loan','selection','club','mixed_team','development_team')
    OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence)=0
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) e
      WHERE COALESCE((e->>'externalToUci')::boolean,false) AND e->>'url'~'^https://[^/ ]+/' AND e->>'consultedAt' IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM public.teams WHERE id=p_team_id)
    OR (p_team_profile IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.uci_catalog_team_links
      WHERE season=p_year AND profile=p_team_profile AND team_id=p_team_id))
    THEN RAISE EXCEPTION 'invalid_historical_participation_decision'; END IF;
  INSERT INTO private.historical_participation_decisions(year,"competitionId","eventId",bib,
    "uciRiderProfileId","uciLicenseId","riderId","uciTeamProfileId","teamId","sourceTeamName",
    "participationType",evidence,decision,status,"batchId")
  VALUES(p_year,p_competition_id,p_event_id,p_bib,p_rider_profile,p_uci_license,p_rider_id,p_team_profile,
    p_team_id,p_source_team_name,p_type,p_evidence,p_decision,'verified',p_batch)
  ON CONFLICT (year,COALESCE("competitionId",-1),COALESCE("eventId",-1),COALESCE(bib,''),
    COALESCE("uciRiderProfileId",''),COALESCE("uciLicenseId",''),"teamId") WHERE status='verified'
  DO UPDATE SET "riderId"=EXCLUDED."riderId","uciTeamProfileId"=EXCLUDED."uciTeamProfileId",
    "sourceTeamName"=EXCLUDED."sourceTeamName","participationType"=EXCLUDED."participationType",
    evidence=EXCLUDED.evidence,decision=EXCLUDED.decision,"batchId"=EXCLUDED."batchId"
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.resolve_historical_result_participations(p_race_id text,p_gender text)
RETURNS TABLE(identity_matched integer,team_matched integer,unresolved_team integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_year integer; v_competition bigint; v_source text;
BEGIN
  IF p_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'invalid_gender'; END IF;
  SELECT r.year,l."competitionId",l.source INTO STRICT v_year,v_competition,v_source
    FROM public.races r LEFT JOIN public.race_uci_links l ON l."raceId"=r.id WHERE r.id=p_race_id;
  IF v_year NOT BETWEEN 2020 AND 2025 THEN
    SELECT 0,0,count(*)::integer INTO identity_matched,team_matched,unresolved_team
      FROM public.race_uci_results WHERE "raceId"=p_race_id AND "teamId" IS NULL;
    RETURN NEXT; RETURN;
  END IF;
  IF v_source='uci' AND p_gender='male' THEN
    UPDATE public.race_uci_results rr SET "globalRiderId"=r.id
    FROM public.riders_men r
    WHERE rr."raceId"=p_race_id AND rr."globalRiderId" IS NULL
      AND rr."sourceUciLicense" IS NOT NULL AND r."uciLicenseId"=rr."sourceUciLicense";
  ELSIF v_source='uci' THEN
    UPDATE public.race_uci_results rr SET "globalRiderId"=r.id
    FROM public.riders_women r
    WHERE rr."raceId"=p_race_id AND rr."globalRiderId" IS NULL
      AND rr."sourceUciLicense" IS NOT NULL AND r."uciLicenseId"=rr."sourceUciLicense";
  END IF;
  GET DIAGNOSTICS identity_matched=ROW_COUNT;
  IF v_source='uci' AND p_gender='male' THEN
    WITH source_ids AS (
      SELECT rr."globalRiderId" id,min(rr."sourceUciLicense") license
      FROM public.race_uci_results rr
      WHERE rr."raceId"=p_race_id AND rr."globalRiderId" IS NOT NULL AND rr."sourceUciLicense" IS NOT NULL
      GROUP BY rr."globalRiderId" HAVING count(DISTINCT rr."sourceUciLicense")=1
    ) UPDATE public.riders_men r SET "uciLicenseId"=s.license,"updatedAt"=now()
      FROM source_ids s WHERE r.id=s.id AND r."uciLicenseId" IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.riders_men other WHERE other."uciLicenseId"=s.license AND other.id<>r.id);
  ELSIF v_source='uci' THEN
    WITH source_ids AS (
      SELECT rr."globalRiderId" id,min(rr."sourceUciLicense") license
      FROM public.race_uci_results rr
      WHERE rr."raceId"=p_race_id AND rr."globalRiderId" IS NOT NULL AND rr."sourceUciLicense" IS NOT NULL
      GROUP BY rr."globalRiderId" HAVING count(DISTINCT rr."sourceUciLicense")=1
    ) UPDATE public.riders_women r SET "uciLicenseId"=s.license,"updatedAt"=now()
      FROM source_ids s WHERE r.id=s.id AND r."uciLicenseId" IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.riders_women other WHERE other."uciLicenseId"=s.license AND other.id<>r.id);
  END IF;
  WITH candidates AS (
    SELECT rr.id,d."teamId",count(*) OVER(PARTITION BY rr.id) n
    FROM public.race_uci_results rr
    JOIN private.historical_participation_decisions d ON d.year=v_year AND d.status='verified'
      AND (d."competitionId" IS NULL OR d."competitionId"=v_competition)
      AND (d."eventId" IS NULL OR d."eventId"=rr."eventId")
      AND (d.bib IS NULL OR d.bib=rr.bib)
      AND (d."riderId" IS NULL OR d."riderId"=rr."globalRiderId")
      AND (d."uciLicenseId" IS NULL OR d."uciLicenseId"=rr."sourceUciLicense")
    WHERE rr."raceId"=p_race_id AND rr."teamId" IS NULL
  ), unique_candidates AS (SELECT id,"teamId" FROM candidates WHERE n=1)
  UPDATE public.race_uci_results rr SET "teamId"=c."teamId"
  FROM unique_candidates c WHERE rr.id=c.id;
  GET DIAGNOSTICS team_matched=ROW_COUNT;
  SELECT count(*)::integer INTO unresolved_team FROM public.race_uci_results rr
    JOIN public.race_uci_stages s ON s.id=rr."stageRef"
    WHERE rr."raceId"=p_race_id AND NOT s."isTeamEvent" AND rr."teamId" IS NULL;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION private.finish_historical_identity_batch(p_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before jsonb; v_after jsonb; v_count integer;
BEGIN
  PERFORM private.historical_batch_guard(p_id);
  SELECT "beforeCurrentState" INTO STRICT v_before FROM private.historical_identity_batches WHERE id=p_id FOR UPDATE;
  SELECT private.historical_current_state() INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    UPDATE private.historical_identity_batches SET status='failed',"afterCurrentState"=v_after,"completedAt"=clock_timestamp() WHERE id=p_id;
    RAISE EXCEPTION 'historical_catalog_changed_current_state';
  END IF;
  SELECT count(*) INTO v_count FROM private.historical_identity_changes WHERE "batchId"=p_id;
  IF v_count=0 THEN RAISE EXCEPTION 'historical_batch_empty'; END IF;
  UPDATE private.historical_identity_batches SET status='applied',"afterCurrentState"=v_after,"completedAt"=clock_timestamp() WHERE id=p_id;
  RETURN jsonb_build_object('status','applied','changes',v_count,'currentStateUnchanged',true);
END;
$$;

-- Un alta histórica ejecutada por el contrato anterior no debe materializar una
-- temporada del año actual mediante el trigger de compatibilidad.
CREATE OR REPLACE FUNCTION public.sync_team_to_season()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_year integer:=extract(year FROM now())::integer;
BEGIN
  IF current_setting('app.historical_catalog',true)='on' OR NEW."specialEdition" IS TRUE THEN RETURN NEW; END IF;
  IF NEW."firstSeason" IS NOT NULL AND NEW."firstSeason">v_year THEN RETURN NEW; END IF;
  INSERT INTO public.team_seasons(id,"teamId",year,name,"nameAliases",category,gender,
    "headerBg","headerText","badgeTorsoCenter","badgeTorsoSides","badgeInnerCircle","badgeShorts",translations,"createdAt","updatedAt")
  VALUES(NEW.id||'_'||v_year,NEW.id,v_year,NEW.name,NEW."nameAliases",NEW.category,NEW.gender,
    COALESCE(NEW."headerBg",'#1f2937'),COALESCE(NEW."headerText",'#ffffff'),COALESCE(NEW."badgeTorsoCenter",'#ffffff'),
    COALESCE(NEW."badgeTorsoSides",'#000000'),NEW."badgeInnerCircle",COALESCE(NEW."badgeShorts",'#000000'),'{}',now(),now())
  ON CONFLICT("teamId",year) DO UPDATE SET name=EXCLUDED.name,"nameAliases"=EXCLUDED."nameAliases",category=EXCLUDED.category,
    gender=EXCLUDED.gender,"headerBg"=EXCLUDED."headerBg","headerText"=EXCLUDED."headerText",
    "badgeTorsoCenter"=EXCLUDED."badgeTorsoCenter","badgeTorsoSides"=EXCLUDED."badgeTorsoSides",
    "badgeInnerCircle"=EXCLUDED."badgeInnerCircle","badgeShorts"=EXCLUDED."badgeShorts","updatedAt"=now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.historical_current_state(),private.historical_batch_guard(text),
  private.begin_historical_identity_batch(text,jsonb),
  private.upsert_historical_team_season(text,integer,text,text,text,text,text,text,text,text,jsonb,jsonb),
  private.upsert_historical_rider_profile(text,integer,text,text,text,text,text,text,date,text,jsonb),
  private.record_historical_roster_observation(text,integer,text,text,text,text,text,timestamptz),
  private.upsert_historical_regular_affiliation(text,text,text,text,integer,date,date,text,timestamptz,jsonb),
  private.record_historical_participation_decision(text,integer,bigint,bigint,text,text,text,text,text,text,text,text,jsonb,text),
  private.finish_historical_identity_batch(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.begin_historical_identity_batch(text,jsonb),
  private.upsert_historical_team_season(text,integer,text,text,text,text,text,text,text,text,jsonb,jsonb),
  private.upsert_historical_rider_profile(text,integer,text,text,text,text,text,text,date,text,jsonb),
  private.record_historical_roster_observation(text,integer,text,text,text,text,text,timestamptz),
  private.upsert_historical_regular_affiliation(text,text,text,text,integer,date,date,text,timestamptz,jsonb),
  private.record_historical_participation_decision(text,integer,bigint,bigint,text,text,text,text,text,text,text,text,jsonb,text),
  private.finish_historical_identity_batch(text) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_historical_result_participations(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_historical_result_participations(text,text) TO service_role;

COMMIT;
