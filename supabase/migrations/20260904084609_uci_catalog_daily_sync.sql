-- Catálogo UCI diario. Inactivo por defecto; la observación no cambia datos públicos.
BEGIN;
CREATE ROLE cc_uci_catalog_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE cc_uci_catalog_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
-- PostgreSQL administrado no es superusuario: necesita SET para transferir
-- propiedad y conservar acceso administrativo a los objetos privados.
GRANT cc_uci_catalog_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
GRANT USAGE ON SCHEMA private, public TO cc_uci_catalog_owner, cc_uci_catalog_worker;
GRANT CREATE ON SCHEMA private TO cc_uci_catalog_owner;
GRANT SELECT ON public.teams, public.riders_men, public.riders_women,
  public.rider_team_affiliations, public.rider_transfers TO cc_uci_catalog_owner;
GRANT INSERT, UPDATE, DELETE ON public.rider_team_affiliations TO cc_uci_catalog_owner;
GRANT UPDATE ("birthDate",nationality,"updatedAt") ON public.riders_men, public.riders_women TO cc_uci_catalog_owner;
CREATE POLICY uci_catalog_affiliations ON public.rider_team_affiliations FOR ALL TO cc_uci_catalog_owner USING (true) WITH CHECK (true);
CREATE POLICY uci_catalog_men ON public.riders_men FOR UPDATE TO cc_uci_catalog_owner USING (true) WITH CHECK (true);
CREATE POLICY uci_catalog_women ON public.riders_women FOR UPDATE TO cc_uci_catalog_owner USING (true) WITH CHECK (true);

CREATE TABLE private.uci_catalog_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  season integer NOT NULL CHECK (season BETWEEN 2005 AND 2100),
  enabled boolean NOT NULL DEFAULT false,
  token uuid, lease_until timestamptz, run_id uuid
);
INSERT INTO private.uci_catalog_control (season) VALUES (2026);
CREATE TABLE private.uci_catalog_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('shadow','apply')),
  revision text NOT NULL, started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  observed_at timestamptz, finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','noop','partial','error')),
  snapshot jsonb, plan jsonb, summary jsonb NOT NULL DEFAULT '{}', error_code text
);
CREATE INDEX uci_catalog_runs_observed ON private.uci_catalog_runs (observed_at DESC) WHERE snapshot IS NOT NULL;
CREATE TABLE private.uci_catalog_team_links (
  season integer NOT NULL, profile text NOT NULL CHECK (profile ~ '^[0-9]{1,10}$'),
  team_id text NOT NULL REFERENCES public.teams(id), gender text NOT NULL CHECK (gender IN ('male','female')),
  category text NOT NULL, source_name text NOT NULL, source_code text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (season,profile), UNIQUE (season,team_id)
);
CREATE TABLE private.uci_catalog_baselines (
  season integer NOT NULL, gender text NOT NULL, profile text NOT NULL,
  team_id text NOT NULL, adopted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (season,gender,profile)
);
CREATE TABLE private.uci_catalog_cases (
  key text PRIMARY KEY, reason text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
  first_seen timestamptz NOT NULL DEFAULT clock_timestamp(), last_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','locked','resolved')),
  decision text
);
CREATE TABLE private.uci_catalog_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES private.uci_catalog_runs(id),
  profile text NOT NULL, rider_id text NOT NULL, gender text NOT NULL CHECK (gender IN ('male','female')),
  operations jsonb NOT NULL, expected_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','reverted','conflict')),
  before_state jsonb, after_state jsonb, evidence jsonb,
  applied_day date, applied_at timestamptz, reverted_at timestamptz,
  date_timezone text NOT NULL DEFAULT 'Europe/Madrid' CHECK (date_timezone='Europe/Madrid'),
  UNIQUE (run_id,gender,rider_id)
);
CREATE INDEX uci_catalog_changes_run ON private.uci_catalog_changes (run_id,status);
CREATE TABLE private.uci_catalog_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_key text REFERENCES private.uci_catalog_cases(key),
  decision text NOT NULL, status text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Todos los escritores de fichas/afiliaciones comparten exclusión por corredor.
-- Los timeouts/deadlocks se devuelven al llamante: nunca se omite el bloqueo.
CREATE FUNCTION private.uci_catalog_lock_rider() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_keys text[] := '{}'; v_key text;
BEGIN
  IF TG_TABLE_NAME='rider_team_affiliations' THEN
    IF TG_OP<>'INSERT' THEN v_keys := array_append(v_keys,OLD."riderGender"||':'||OLD."riderId"); END IF;
    IF TG_OP<>'DELETE' THEN v_keys := array_append(v_keys,NEW."riderGender"||':'||NEW."riderId"); END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN v_keys := array_append(v_keys,TG_ARGV[0]||':'||OLD.id); END IF;
    IF TG_OP<>'DELETE' THEN v_keys := array_append(v_keys,TG_ARGV[0]||':'||NEW.id); END IF;
  END IF;
  FOR v_key IN SELECT DISTINCT k FROM unnest(v_keys) k ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('uci-catalog-rider:'||v_key,0));
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE TRIGGER a00_uci_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON public.rider_team_affiliations
  FOR EACH ROW EXECUTE FUNCTION private.uci_catalog_lock_rider();
CREATE TRIGGER a00_uci_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON public.riders_men
  FOR EACH ROW EXECUTE FUNCTION private.uci_catalog_lock_rider('male');
CREATE TRIGGER a00_uci_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON public.riders_women
  FOR EACH ROW EXECUTE FUNCTION private.uci_catalog_lock_rider('female');

CREATE FUNCTION private.uci_catalog_state(p_id text,p_gender text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' SET timezone='UTC' AS $$
  SELECT jsonb_build_object('rider',CASE WHEN p_gender='male'
    THEN (SELECT to_jsonb(r) FROM public.riders_men r WHERE id=p_id)
    WHEN p_gender='female' THEN (SELECT to_jsonb(r) FROM public.riders_women r WHERE id=p_id) END,
    'affiliations',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.rider_team_affiliations a
      WHERE "riderId"=p_id AND "riderGender"=p_gender),'[]'::jsonb),
    'transfers',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.rider_transfers t
      WHERE "riderId"=p_id AND "riderGender"=p_gender),'[]'::jsonb));
$$;

CREATE FUNCTION private.uci_catalog_lease(p_run uuid,p_token uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  -- Bloquear la fila evita que otro worker tome el lease durante un COMMIT.
  PERFORM 1 FROM private.uci_catalog_control WHERE singleton AND run_id=p_run AND token=p_token
    AND lease_until>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'uci_lease_lost' USING ERRCODE='55000'; END IF;
END;
$$;

CREATE FUNCTION private.uci_catalog_begin(p_mode text,p_revision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_control private.uci_catalog_control; v_id uuid; v_token uuid:=gen_random_uuid();
BEGIN
  IF p_mode NOT IN ('shadow','apply') OR length(p_revision)>80 THEN RAISE EXCEPTION 'invalid_run'; END IF;
  SELECT * INTO v_control FROM private.uci_catalog_control WHERE singleton FOR UPDATE;
  IF v_control.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('skipped','locked'); END IF;
  IF p_mode='apply' AND NOT v_control.enabled THEN RAISE EXCEPTION 'uci_writes_disabled'; END IF;
  IF v_control.season<>extract(year FROM clock_timestamp() AT TIME ZONE 'Europe/Madrid') THEN RAISE EXCEPTION 'season_not_adopted'; END IF;
  UPDATE private.uci_catalog_runs SET status='error',error_code='lease_expired',finished_at=clock_timestamp()
    WHERE status='running' AND id=v_control.run_id;
  INSERT INTO private.uci_catalog_runs(mode,revision) VALUES(p_mode,p_revision) RETURNING id INTO v_id;
  UPDATE private.uci_catalog_control SET token=v_token,run_id=v_id,lease_until=clock_timestamp()+interval '120 seconds' WHERE singleton;
  RETURN jsonb_build_object('runId',v_id,'token',v_token,'year',v_control.season);
END;
$$;

CREATE FUNCTION private.uci_catalog_renew(p_run uuid,p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.uci_catalog_lease(p_run,p_token);
  IF NOT EXISTS(SELECT 1 FROM private.uci_catalog_runs WHERE id=p_run AND status='running'
    AND started_at>clock_timestamp()-interval '130 minutes') THEN RAISE EXCEPTION 'run_expired'; END IF;
  UPDATE private.uci_catalog_control SET lease_until=clock_timestamp()+interval '120 seconds' WHERE singleton;
END;
$$;

CREATE FUNCTION private.uci_catalog_observe(p_run uuid,p_token uuid,p_snapshot jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_year integer; v_count integer; v_item record;
BEGIN
  PERFORM private.uci_catalog_lease(p_run,p_token);
  SELECT season INTO v_year FROM private.uci_catalog_control WHERE singleton;
  IF p_snapshot->>'complete' IS DISTINCT FROM 'true' OR p_snapshot->>'version' IS DISTINCT FROM '1'
    OR (p_snapshot->>'year')::integer<>v_year OR octet_length(p_snapshot::text)>16000000
    OR jsonb_typeof(p_snapshot->'records') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_snapshot->'teams') IS DISTINCT FROM 'object'
    OR p_snapshot->>'collectedAt' IS NULL OR p_snapshot->>'startedAt' IS NULL
    OR (p_snapshot->>'collectedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '15 minutes' AND clock_timestamp()+interval '1 minute'
    OR (p_snapshot->>'startedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '130 minutes' AND (p_snapshot->>'collectedAt')::timestamptz
    THEN RAISE EXCEPTION 'invalid_snapshot'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_object_keys(p_snapshot->'records');
  IF v_count NOT BETWEEN 6 AND 6000 THEN RAISE EXCEPTION 'invalid_record_count'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_object_keys(p_snapshot->'teams');
  IF v_count NOT BETWEEN 6 AND 1000 THEN RAISE EXCEPTION 'invalid_team_count'; END IF;
  IF (SELECT count(DISTINCT value->>'category') FROM jsonb_each(p_snapshot->'teams'))<>6
    OR EXISTS(SELECT 1 FROM jsonb_each(p_snapshot->'teams') WHERE value->>'category' NOT IN ('WT','PT','CT','WWT','PRW','CTW'))
    THEN RAISE EXCEPTION 'incomplete_divisions'; END IF;
  FOR v_item IN SELECT * FROM jsonb_each(p_snapshot->'records') LOOP
    IF v_item.key!~'^[0-9]{1,10}$' OR v_item.value->>'gender' NOT IN ('male','female')
      OR jsonb_typeof(v_item.value->'regular') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_item.value->'trainees') IS DISTINCT FROM 'array'
      OR v_item.value->'evidence' IS DISTINCT FROM jsonb_build_object('gender',v_item.value->'gender',
        'bio',v_item.value->'bio','regular',v_item.value->'regular','trainees',v_item.value->'trainees',
        'panels',v_item.value->'panels','conflict',v_item.value->'conflict') THEN RAISE EXCEPTION 'invalid_source_record'; END IF;
  END LOOP;
  UPDATE private.uci_catalog_runs SET snapshot=p_snapshot,observed_at=clock_timestamp()
    WHERE id=p_run AND snapshot IS NULL AND status='running';
  IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_already_recorded'; END IF;
  -- Adoptar únicamente las relaciones actuales que ya coinciden con la fuente.
  INSERT INTO private.uci_catalog_baselines(season,gender,profile,team_id)
    SELECT v_year,r.gender,r.profile,l.team_id FROM (
      SELECT 'male' AS gender,"uciProfileId" AS profile,"currentTeamId" AS team FROM public.riders_men
      UNION ALL SELECT 'female',"uciProfileId","currentTeamId" FROM public.riders_women
    ) r JOIN private.uci_catalog_team_links l ON l.season=v_year AND l.gender=r.gender AND l.team_id=r.team
    WHERE p_snapshot->'records'->r.profile->'regular'=jsonb_build_array(l.profile)
      AND p_snapshot->'records'->r.profile->>'conflict'='false'
      AND p_snapshot->'teams'->l.profile->>'name'=l.source_name
    ON CONFLICT DO NOTHING;
END;
$$;

CREATE FUNCTION private.uci_catalog_context(p_run uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run private.uci_catalog_runs; v_year integer; v_result jsonb;
BEGIN
  PERFORM private.uci_catalog_lease(p_run,p_token);
  SELECT * INTO STRICT v_run FROM private.uci_catalog_runs WHERE id=p_run AND snapshot IS NOT NULL;
  v_year:=(v_run.snapshot->>'year')::integer;
  SELECT jsonb_build_object('year',v_year,'observedAt',v_run.observed_at,
    'previous',(SELECT jsonb_build_object('observedAt',observed_at,'snapshot',snapshot)
      FROM private.uci_catalog_runs WHERE id<>p_run AND snapshot IS NOT NULL AND observed_at<v_run.observed_at
        AND (snapshot->>'year')::integer=v_year ORDER BY observed_at DESC LIMIT 1),
    'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('profile',l.profile,'teamId',l.team_id,'gender',l.gender,
      'category',l.category,'sourceName',l.source_name,'sourceCode',l.source_code,'currentCategory',t.category,
      'specialEdition',t."specialEdition",'teamKind',t."teamKind"))
      FROM private.uci_catalog_team_links l JOIN public.teams t ON t.id=l.team_id WHERE l.season=v_year),'[]'::jsonb),
    'riders',(SELECT jsonb_agg(r) FROM (
      SELECT id,'male' AS gender,"firstName","lastName",nationality,"birthDate","uciProfileId","currentTeamId","contractUntil" FROM public.riders_men
      UNION ALL SELECT id,'female',"firstName","lastName",nationality,"birthDate","uciProfileId","currentTeamId","contractUntil" FROM public.riders_women
    ) r),
    'states',COALESCE((SELECT jsonb_object_agg(r.gender||':'||r.id,jsonb_build_object('hash',md5(s.state::text),'affiliations',s.state->'affiliations'))
      FROM (SELECT id,'male' AS gender,"uciProfileId" AS profile FROM public.riders_men
        UNION ALL SELECT id,'female',"uciProfileId" FROM public.riders_women) r
      CROSS JOIN LATERAL(SELECT private.uci_catalog_state(r.id,r.gender) AS state) s
      WHERE v_run.snapshot->'records' ? r.profile),'{}'::jsonb),
    'baselines',COALESCE((SELECT jsonb_object_agg(gender||':'||profile,team_id) FROM private.uci_catalog_baselines WHERE season=v_year),'{}'::jsonb),
    'blocked',COALESCE((SELECT jsonb_agg(key) FROM private.uci_catalog_cases WHERE status='locked'),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END;
$$;

-- Validador compartido entre preparación y aplicación. Las fechas nunca llegan del worker.
CREATE FUNCTION private.uci_catalog_check(p_run uuid,p_action jsonb) RETURNS text
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_run private.uci_catalog_runs; v_previous private.uci_catalog_runs;
  v_source jsonb; v_state jsonb; v_rider jsonb; v_bio jsonb; v_op jsonb; v_old jsonb;
  v_link private.uci_catalog_team_links; v_team public.teams;
  v_year integer; v_day date:=(clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date;
  v_gender text:=p_action->>'gender'; v_id text:=p_action->>'riderId'; v_profile text:=p_action->>'profile';
  v_active integer; v_count integer;
BEGIN
  SELECT * INTO STRICT v_run FROM private.uci_catalog_runs WHERE id=p_run AND snapshot IS NOT NULL;
  v_year:=(v_run.snapshot->>'year')::integer;
  IF v_year<>extract(year FROM v_day) THEN RETURN 'season_not_adopted'; END IF;
  v_source:=v_run.snapshot->'records'->v_profile; v_bio:=v_source->'bio';
  IF v_profile!~'^[0-9]{1,10}$' OR v_source IS NULL OR v_source->>'gender' IS DISTINCT FROM v_gender
    OR v_source->>'conflict' IS DISTINCT FROM 'false' OR jsonb_typeof(v_bio) IS DISTINCT FROM 'object'
    THEN RETURN 'source_identity_conflict'; END IF;
  SELECT * INTO v_previous FROM private.uci_catalog_runs WHERE id<>p_run AND snapshot IS NOT NULL
    AND observed_at<v_run.observed_at AND (snapshot->>'year')::integer=v_year ORDER BY observed_at DESC LIMIT 1;
  IF v_previous.id IS NULL OR v_run.observed_at-v_previous.observed_at NOT BETWEEN interval '20 hours' AND interval '52 hours'
    OR v_previous.snapshot->'records'->v_profile->'evidence' IS DISTINCT FROM v_source->'evidence'
    THEN RETURN 'awaiting_stability'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(v_previous.snapshot->'teams') old
    WHERE NOT (v_run.snapshot->'teams' ? old.key)
      OR (v_run.snapshot->'teams'->old.key->>'members')::integer < (old.value->>'members')::numeric*.8)
    THEN RETURN 'source_roster_drop'; END IF;
  IF EXISTS(SELECT 1 FROM private.uci_catalog_cases WHERE key='rider:'||v_year||':'||v_profile AND status='locked')
    THEN RETURN 'manual_lock'; END IF;
  SELECT count(*) INTO v_count FROM (
    SELECT id FROM public.riders_men WHERE "uciProfileId"=v_profile
    UNION ALL SELECT id FROM public.riders_women WHERE "uciProfileId"=v_profile) r;
  IF v_count<>1 THEN RETURN 'identity_conflict'; END IF;
  v_state:=private.uci_catalog_state(v_id,v_gender); v_rider:=v_state->'rider';
  IF v_rider->>'uciProfileId' IS DISTINCT FROM v_profile THEN RETURN 'identity_conflict'; END IF;
  IF md5(v_state::text) IS DISTINCT FROM p_action->>'expectedHash' THEN RETURN 'concurrent_edit'; END IF;
  IF public.fold_name((v_rider->>'firstName')||' '||(v_rider->>'lastName')) IS DISTINCT FROM
      public.fold_name((v_bio->>'firstName')||' '||(v_bio->>'lastName'))
    OR (v_rider->>'birthDate' IS NOT NULL AND v_rider->>'birthDate' IS DISTINCT FROM v_bio->>'birthDate')
    OR (v_rider->>'nationality' IS NOT NULL AND v_rider->>'nationality' IS DISTINCT FROM v_bio->>'nationality')
    THEN RETURN 'biography_review'; END IF;
  IF (v_bio->>'birthDate' IS NOT NULL AND (v_bio->>'birthDate')::date NOT BETWEEN date '1900-01-01' AND v_day-interval '14 years')
    OR (v_bio->>'nationality' IS NOT NULL AND v_bio->>'nationality'!~'^[a-z]{2}$') THEN RETURN 'invalid_biography'; END IF;
  IF jsonb_typeof(p_action->'operations') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_action->'operations') NOT BETWEEN 1 AND 4 THEN RETURN 'invalid_operations'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_action->'operations') o GROUP BY o HAVING count(*)>1)
    THEN RETURN 'duplicate_operation'; END IF;
  FOR v_op IN SELECT * FROM jsonb_array_elements(p_action->'operations') LOOP
    IF v_op->>'kind'='fill' THEN
      IF NOT ((v_rider->>'birthDate' IS NULL AND v_bio->>'birthDate' IS NOT NULL)
        OR (v_rider->>'nationality' IS NULL AND v_bio->>'nationality' IS NOT NULL)) THEN RETURN 'already_filled'; END IF;
      CONTINUE;
    END IF;
    IF v_op->>'kind' NOT IN ('move','trainee') OR v_op->>'kind' IS NULL THEN RETURN 'invalid_operation'; END IF;
    SELECT * INTO v_link FROM private.uci_catalog_team_links WHERE season=v_year AND profile=v_op->>'teamProfile';
    IF NOT FOUND THEN RETURN 'team_not_mapped'; END IF;
    SELECT * INTO STRICT v_team FROM public.teams WHERE id=v_link.team_id;
    IF v_link.gender<>v_gender OR v_team.gender<>v_gender OR v_team.category<>v_link.category
      OR v_team."specialEdition" OR v_team."teamKind"='selection'
      OR v_run.snapshot->'teams'->v_link.profile->>'name' IS DISTINCT FROM v_link.source_name
      OR v_run.snapshot->'teams'->v_link.profile->>'code' IS DISTINCT FROM v_link.source_code
      OR v_run.snapshot->'teams'->v_link.profile->>'category' IS DISTINCT FROM v_link.category
      THEN RETURN 'team_catalog_review'; END IF;
    IF v_op->>'kind'='move' THEN
      IF v_day=make_date(v_year,1,1) THEN RETURN 'season_transition_review'; END IF;
      IF v_source->'regular'<>jsonb_build_array(v_link.profile) THEN RETURN 'multiple_regular_teams'; END IF;
      IF v_rider->>'currentTeamId' IS NULL OR v_rider->>'currentTeamId'=v_link.team_id THEN RETURN 'not_a_transfer'; END IF;
      IF NOT EXISTS(SELECT 1 FROM private.uci_catalog_baselines WHERE season=v_year AND gender=v_gender AND profile=v_profile
        AND team_id=v_rider->>'currentTeamId') THEN RETURN 'baseline_conflict'; END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_source->'history') h
        WHERE h->>'year'=v_year::text AND h->>'url'='/team-details/'||v_link.profile) THEN RETURN 'source_history_conflict'; END IF;
      SELECT count(*) INTO v_active FROM jsonb_array_elements(v_state->'affiliations') a
        WHERE a->>'affiliationType'='regular' AND (a->>'year')::integer=v_year
          AND (a->>'dateFrom' IS NULL OR (a->>'dateFrom')::date<=v_day)
          AND (a->>'dateTo' IS NULL OR (a->>'dateTo')::date>=v_day);
      SELECT a INTO v_old FROM jsonb_array_elements(v_state->'affiliations') a
        WHERE a->>'affiliationType'='regular' AND (a->>'year')::integer=v_year
          AND a->>'teamId'=v_rider->>'currentTeamId'
          AND (a->>'dateFrom' IS NULL OR (a->>'dateFrom')::date<=v_day)
          AND (a->>'dateTo' IS NULL OR (a->>'dateTo')::date>=v_day) LIMIT 1;
      IF v_active<>1 OR v_old IS NULL OR v_old->>'dateTo' IS NOT NULL OR (v_old->>'dateFrom')::date>=v_day
        OR (v_rider->>'contractUntil')::integer>v_year
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_state->'affiliations') a WHERE a->>'affiliationType'='regular'
          AND ((a->>'year')::integer>v_year OR (a->>'dateFrom')::date>v_day))
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_state->'transfers') t
          WHERE (t->>'season')::integer>=v_year AND t->>'status'='confirmed')
        THEN RETURN 'affiliation_or_contract_review'; END IF;
    ELSE
      IF NOT (v_source->'trainees' ? v_link.profile) OR v_day<make_date(v_year,8,1) THEN RETURN 'trainee_review'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_state->'affiliations') a
        WHERE (a->>'year')::integer=v_year AND a->>'teamId'=v_link.team_id) THEN RETURN 'existing_affiliation'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION private.uci_catalog_stage(p_run uuid,p_token uuid,p_plan jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_item jsonb; v_reason text; v_limit integer; v_new_cases integer:=0; v_count integer; v_rejected integer:=0; v_year text;
BEGIN
  PERFORM private.uci_catalog_lease(p_run,p_token);
  IF EXISTS(SELECT 1 FROM private.uci_catalog_runs WHERE id=p_run AND plan IS NOT NULL) THEN
    RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'status',status)),'[]'::jsonb)
      FROM private.uci_catalog_changes WHERE run_id=p_run);
  END IF;
  IF octet_length(p_plan::text)>4000000 OR p_plan->>'version' IS DISTINCT FROM '1'
    OR jsonb_typeof(p_plan->'actions') IS DISTINCT FROM 'array' OR jsonb_typeof(p_plan->'cases') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plan->'cases')>10000 THEN RAISE EXCEPTION 'invalid_plan'; END IF;
  SELECT least(50,greatest(1,floor(count(*)*.02)::integer)) INTO v_limit FROM private.uci_catalog_runs r,
    LATERAL jsonb_object_keys(r.snapshot->'records') k WHERE r.id=p_run;
  SELECT snapshot->>'year' INTO v_year FROM private.uci_catalog_runs WHERE id=p_run;
  IF jsonb_array_length(p_plan->'actions')>v_limit THEN RAISE EXCEPTION 'change_budget_exceeded'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan->'cases') LOOP
    INSERT INTO private.uci_catalog_cases(key,reason,detail)
      VALUES(v_item->>'key',v_item->>'reason',COALESCE(v_item->'detail','{}'::jsonb))
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count=ROW_COUNT; v_new_cases:=v_new_cases+v_count;
    UPDATE private.uci_catalog_cases SET last_seen=clock_timestamp(),reason=v_item->>'reason',detail=COALESCE(v_item->'detail','{}'::jsonb)
      WHERE key=v_item->>'key' AND status='open';
  END LOOP;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan->'actions') LOOP
    v_reason:=private.uci_catalog_check(p_run,v_item);
    IF v_reason IS NOT NULL THEN
      v_rejected:=v_rejected+1;
      INSERT INTO private.uci_catalog_cases(key,reason,detail)
        VALUES('rider:'||v_year||':'||(v_item->>'profile')||':prepare',v_reason,v_item)
        ON CONFLICT(key) DO UPDATE SET last_seen=clock_timestamp(),reason=EXCLUDED.reason,detail=EXCLUDED.detail
          WHERE private.uci_catalog_cases.status='open';
      CONTINUE;
    END IF;
    INSERT INTO private.uci_catalog_changes(run_id,profile,rider_id,gender,operations,expected_hash)
      VALUES(p_run,v_item->>'profile',v_item->>'riderId',v_item->>'gender',v_item->'operations',v_item->>'expectedHash');
  END LOOP;
  UPDATE private.uci_catalog_runs SET plan=p_plan,summary=jsonb_build_object('newCases',v_new_cases,'rejected',v_rejected,'proposed',p_plan->'proposed') WHERE id=p_run;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'status',status)),'[]'::jsonb) FROM private.uci_catalog_changes WHERE run_id=p_run);
END;
$$;

-- FOR SHARE requiere UPDATE en PostgreSQL. Encapsular solo el bloqueo mantiene al
-- propietario del sincronizador sin permiso para editar el catálogo de equipos.
CREATE FUNCTION private.uci_catalog_lock_teams(p_run uuid,p_operations jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT 1 FROM public.teams t JOIN private.uci_catalog_team_links l ON l.team_id=t.id
    JOIN private.uci_catalog_runs r ON r.id=p_run
    WHERE l.season=(r.snapshot->>'year')::integer AND l.profile IN (
      SELECT o->>'teamProfile' FROM jsonb_array_elements(p_operations) o) ORDER BY t.id FOR SHARE OF t,l NOWAIT;
$$;

CREATE FUNCTION private.uci_catalog_try_component(p_run uuid,p_operations jsonb,p_id text,p_gender text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_team text;
BEGIN
  -- Tomar los mutex de equipos sin esperar; después, el del corredor. Si otro
  -- escritor tiene cualquiera de ellos, ceder antes de bloquear sus filas.
  FOR v_team IN SELECT "teamId" FROM public.rider_team_affiliations WHERE "riderId"=p_id AND "riderGender"=p_gender
    UNION SELECT l.team_id FROM private.uci_catalog_team_links l JOIN private.uci_catalog_runs r ON r.id=p_run
      WHERE l.season=(r.snapshot->>'year')::integer AND l.profile IN (SELECT o->>'teamProfile' FROM jsonb_array_elements(p_operations) o)
    ORDER BY 1 LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('regular-team-roster:'||v_team,0)) THEN RAISE EXCEPTION 'component_busy'; END IF;
  END LOOP;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('uci-catalog-rider:'||p_gender||':'||p_id,0)) THEN RAISE EXCEPTION 'component_busy'; END IF;
END;
$$;

CREATE FUNCTION private.uci_catalog_apply(p_change uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='Europe/Madrid' SET lock_timeout='2s' AS $$
DECLARE v_change private.uci_catalog_changes; v_run private.uci_catalog_runs; v_state jsonb; v_after jsonb;
  v_source jsonb; v_op jsonb; v_reason text; v_team text; v_old text; v_new text; v_year integer;
  v_day date:=CURRENT_DATE; v_expected_team text; v_row record;
BEGIN
  SELECT * INTO STRICT v_change FROM private.uci_catalog_changes WHERE id=p_change FOR UPDATE;
  IF v_change.status='applied' THEN RETURN jsonb_build_object('status','alreadyApplied','day',v_change.applied_day); END IF;
  IF v_change.status<>'pending' THEN RAISE EXCEPTION 'change_not_pending'; END IF;
  PERFORM private.uci_catalog_lease(v_change.run_id,p_token);
  SELECT * INTO STRICT v_run FROM private.uci_catalog_runs WHERE id=v_change.run_id;
  IF v_run.mode<>'apply' OR NOT (SELECT enabled FROM private.uci_catalog_control WHERE singleton) THEN RAISE EXCEPTION 'uci_writes_disabled'; END IF;
  IF (SELECT count(*) FROM private.uci_catalog_changes WHERE applied_day=v_day)>=50 THEN RAISE EXCEPTION 'daily_change_budget'; END IF;
  PERFORM private.uci_catalog_try_component(v_change.run_id,v_change.operations,v_change.rider_id,v_change.gender);
  IF v_change.gender='male' THEN PERFORM 1 FROM public.riders_men WHERE id=v_change.rider_id FOR UPDATE NOWAIT;
  ELSE PERFORM 1 FROM public.riders_women WHERE id=v_change.rider_id FOR UPDATE NOWAIT; END IF;
  PERFORM 1 FROM public.rider_team_affiliations WHERE "riderId"=v_change.rider_id AND "riderGender"=v_change.gender ORDER BY id FOR UPDATE NOWAIT;
  -- Mantener estables los equipos revisados durante el componente.
  PERFORM private.uci_catalog_lock_teams(v_change.run_id,v_change.operations);
  v_reason:=private.uci_catalog_check(v_change.run_id,jsonb_build_object('profile',v_change.profile,'riderId',v_change.rider_id,
    'gender',v_change.gender,'expectedHash',v_change.expected_hash,'operations',v_change.operations));
  IF v_reason IS NOT NULL THEN RAISE EXCEPTION 'apply_rejected:%',v_reason; END IF;
  v_year:=(v_run.snapshot->>'year')::integer; v_source:=v_run.snapshot->'records'->v_change.profile;
  v_state:=private.uci_catalog_state(v_change.rider_id,v_change.gender);
  v_expected_team:=v_state->'rider'->>'currentTeamId';
  -- Respaldo remoto en PostgreSQL, en la misma transacción que la mutación.
  UPDATE private.uci_catalog_changes SET before_state=v_state,evidence=jsonb_build_object('source',v_source,
    'manifestHash',v_run.snapshot->'manifestHash','observedAt',v_run.observed_at,'dateBasis','sync_observation') WHERE id=p_change;
  FOR v_op IN SELECT * FROM jsonb_array_elements(v_change.operations) LOOP
    IF v_op->>'kind'='fill' THEN
      IF v_change.gender='male' THEN
        UPDATE public.riders_men SET "birthDate"=COALESCE("birthDate",(v_source->'bio'->>'birthDate')::date),
          nationality=COALESCE(nationality,v_source->'bio'->>'nationality'),"updatedAt"=now() WHERE id=v_change.rider_id;
      ELSE
        UPDATE public.riders_women SET "birthDate"=COALESCE("birthDate",(v_source->'bio'->>'birthDate')::date),
          nationality=COALESCE(nationality,v_source->'bio'->>'nationality'),"updatedAt"=now() WHERE id=v_change.rider_id;
      END IF;
      CONTINUE;
    END IF;
    SELECT team_id INTO STRICT v_team FROM private.uci_catalog_team_links WHERE season=v_year AND profile=v_op->>'teamProfile';
    v_new:=gen_random_uuid()::text;
    IF v_op->>'kind'='move' THEN
      SELECT id INTO STRICT v_old FROM public.rider_team_affiliations WHERE "riderId"=v_change.rider_id AND "riderGender"=v_change.gender
        AND year=v_year AND "teamId"=v_state->'rider'->>'currentTeamId' AND "affiliationType"='regular'
        AND ("dateFrom" IS NULL OR "dateFrom"<=v_day) AND "dateTo" IS NULL;
      -- Conservar dateFrom, fuente y base previa de A; el cierre operativo se documenta por campo en changes.
      UPDATE public.rider_team_affiliations SET "dateTo"=v_day-1,"updatedAt"=now() WHERE id=v_old;
      INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateFrom",source,verified,
        "sourceUrl","uciTeamProfileId","dateBasis","verifiedAt")
        VALUES(v_new,v_change.rider_id,v_change.gender,v_team,v_year,v_day,'uci_catalog',true,
          'https://www.uci.org/team-details/'||(v_op->>'teamProfile'),(v_op->>'teamProfile')::integer,'sync_observation',v_run.observed_at);
      UPDATE private.uci_catalog_changes SET evidence=evidence||jsonb_build_object('boundaries',jsonb_build_array(
        jsonb_build_object('affiliationId',v_old,'field','dateTo','value',v_day-1,'basis','sync_observation'),
        jsonb_build_object('affiliationId',v_new,'field','dateFrom','value',v_day,'basis','sync_observation')
      )) WHERE id=p_change;
      v_expected_team:=v_team;
      UPDATE private.uci_catalog_baselines SET team_id=v_team WHERE season=v_year AND gender=v_change.gender AND profile=v_change.profile;
    ELSE
      INSERT INTO public.rider_team_affiliations(id,"riderId","riderGender","teamId",year,"dateFrom","dateTo",source,verified,
        "affiliationType","sourceUrl","uciTeamProfileId","dateBasis","verifiedAt")
        VALUES(v_new,v_change.rider_id,v_change.gender,v_team,v_year,make_date(v_year,8,1),make_date(v_year,12,31),'uci_catalog',true,
          'trainee','https://www.uci.org/team-details/'||(v_op->>'teamProfile'),(v_op->>'teamProfile')::integer,'regulatory_window',v_run.observed_at);
    END IF;
  END LOOP;
  v_after:=private.uci_catalog_state(v_change.rider_id,v_change.gender);
  IF v_after->'rider'->>'currentTeamId' IS DISTINCT FROM v_expected_team OR v_after->'transfers' IS DISTINCT FROM v_state->'transfers'
    OR v_after->'rider'->'contractUntil' IS DISTINCT FROM v_state->'rider'->'contractUntil' THEN RAISE EXCEPTION 'postcondition_failed'; END IF;
  IF (clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date<>v_day THEN RAISE EXCEPTION 'midnight_retry'; END IF;
  PERFORM private.uci_catalog_lease(v_change.run_id,p_token);
  UPDATE private.uci_catalog_changes SET status='applied',after_state=v_after,applied_at=clock_timestamp(),applied_day=v_day WHERE id=p_change;
  UPDATE private.uci_catalog_cases SET status='resolved' WHERE status='open' AND (
    key='rider:'||v_year||':'||v_change.profile OR key LIKE 'rider:'||v_year||':'||v_change.profile||':%');
  RETURN jsonb_build_object('status','applied','day',v_day);
END;
$$;

CREATE FUNCTION private.uci_catalog_finish(p_run uuid,p_token uuid,p_error text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run private.uci_catalog_runs; v_applied integer; v_pending integer; v_status text;
BEGIN
  PERFORM private.uci_catalog_lease(p_run,p_token);
  SELECT * INTO STRICT v_run FROM private.uci_catalog_runs WHERE id=p_run;
  SELECT count(*) FILTER(WHERE status='applied'),count(*) FILTER(WHERE status='pending')
    INTO v_applied,v_pending FROM private.uci_catalog_changes WHERE run_id=p_run;
  v_status:=CASE WHEN p_error IS NOT NULL OR v_run.plan IS NULL THEN 'error'
    WHEN v_run.mode='apply' AND v_pending>0 THEN 'partial'
    WHEN (v_run.summary->>'rejected')::integer>0 THEN 'partial'
    WHEN v_applied>0 THEN 'success'
    WHEN (v_run.summary->>'newCases')::integer>0 OR (v_run.plan->>'suspended')::boolean THEN 'partial' ELSE 'noop' END;
  UPDATE private.uci_catalog_runs SET status=v_status,finished_at=clock_timestamp(),error_code=left(p_error,160),
    summary=summary||jsonb_build_object('mode',mode,'applied',v_applied,'pending',v_pending,'http',snapshot->'stats') WHERE id=p_run;
  UPDATE private.uci_catalog_control SET token=NULL,lease_until=NULL WHERE singleton;
  -- Las copias anteriores/posteriores y su evidencia no se purgan. Las capturas completas sí.
  UPDATE private.uci_catalog_runs SET snapshot=NULL,plan=NULL WHERE observed_at<clock_timestamp()-interval '30 days' AND status<>'running' AND snapshot IS NOT NULL;
  DELETE FROM private.uci_catalog_runs r WHERE started_at<clock_timestamp()-interval '180 days'
    AND NOT EXISTS(SELECT 1 FROM private.uci_catalog_changes c WHERE c.run_id=r.id);
  RETURN jsonb_build_object('status',v_status,'applied',v_applied,'pending',v_pending,'newCases',v_run.summary->'newCases');
END;
$$;

CREATE FUNCTION private.uci_catalog_rollback(p_change uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='Europe/Madrid' SET lock_timeout='2s' AS $$
DECLARE v_change private.uci_catalog_changes; v_before jsonb; v_after jsonb; v_row jsonb; v_year integer;
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin') AND NOT COALESCE(private.is_admin(),false) THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT v_change FROM private.uci_catalog_changes WHERE id=p_change FOR UPDATE;
  IF v_change.status='reverted' THEN RETURN jsonb_build_object('status','alreadyReverted'); END IF;
  IF v_change.status<>'applied' THEN RAISE EXCEPTION 'not_applied'; END IF;
  IF extract(year FROM CURRENT_DATE)<>extract(year FROM v_change.applied_day) THEN RAISE EXCEPTION 'historical_rollback_review'; END IF;
  PERFORM private.uci_catalog_try_component(v_change.run_id,v_change.operations,v_change.rider_id,v_change.gender);
  IF v_change.gender='male' THEN PERFORM 1 FROM public.riders_men WHERE id=v_change.rider_id FOR UPDATE NOWAIT;
  ELSE PERFORM 1 FROM public.riders_women WHERE id=v_change.rider_id FOR UPDATE NOWAIT; END IF;
  PERFORM 1 FROM public.rider_team_affiliations WHERE "riderId"=v_change.rider_id AND "riderGender"=v_change.gender ORDER BY id FOR UPDATE NOWAIT;
  v_before:=v_change.before_state; v_after:=v_change.after_state;
  IF private.uci_catalog_state(v_change.rider_id,v_change.gender) IS DISTINCT FROM v_after THEN RAISE EXCEPTION 'rollback_concurrent_edit'; END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_after->'affiliations') LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_before->'affiliations') a WHERE a->>'id'=v_row->>'id') THEN
      DELETE FROM public.rider_team_affiliations WHERE id=v_row->>'id';
    END IF;
  END LOOP;
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_before->'affiliations') LOOP
    UPDATE public.rider_team_affiliations SET "dateTo"=(v_row->>'dateTo')::date,"updatedAt"=(v_row->>'updatedAt')::timestamptz
      WHERE id=v_row->>'id' AND ("dateTo" IS DISTINCT FROM (v_row->>'dateTo')::date OR "updatedAt" IS DISTINCT FROM (v_row->>'updatedAt')::timestamptz);
  END LOOP;
  IF v_change.gender='male' THEN
    UPDATE public.riders_men SET "birthDate"=(v_before->'rider'->>'birthDate')::date,nationality=v_before->'rider'->>'nationality',
      "updatedAt"=(v_before->'rider'->>'updatedAt')::timestamptz WHERE id=v_change.rider_id;
  ELSE
    UPDATE public.riders_women SET "birthDate"=(v_before->'rider'->>'birthDate')::date,nationality=v_before->'rider'->>'nationality',
      "updatedAt"=(v_before->'rider'->>'updatedAt')::timestamptz WHERE id=v_change.rider_id;
  END IF;
  IF private.uci_catalog_state(v_change.rider_id,v_change.gender) IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'rollback_postcondition_failed'; END IF;
  v_year:=extract(year FROM v_change.applied_day)::integer;
  UPDATE private.uci_catalog_baselines SET team_id=v_before->'rider'->>'currentTeamId'
    WHERE season=v_year AND gender=v_change.gender AND profile=v_change.profile;
  INSERT INTO private.uci_catalog_cases(key,reason,status,decision)
    VALUES('rider:'||v_year||':'||v_change.profile,'reverted_change','locked','Reversión administrativa '||p_change)
    ON CONFLICT(key) DO UPDATE SET status='locked',decision=EXCLUDED.decision;
  UPDATE private.uci_catalog_changes SET status='reverted',reverted_at=clock_timestamp() WHERE id=p_change;
  RETURN jsonb_build_object('status','reverted');
END;
$$;

CREATE FUNCTION private.uci_catalog_review_case(p_key text,p_status text,p_decision text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin') AND NOT COALESCE(private.is_admin(),false) THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  IF p_status NOT IN ('open','locked','resolved') OR length(btrim(p_decision)) NOT BETWEEN 5 AND 4000 THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  UPDATE private.uci_catalog_cases SET status=p_status,decision=p_decision WHERE key=p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_not_found'; END IF;
  INSERT INTO private.uci_catalog_decisions(case_key,decision,status) VALUES(p_key,p_decision,p_status);
END;
$$;

CREATE FUNCTION private.uci_catalog_review_team(p_run uuid,p_profile text,p_team_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_source jsonb; v_snapshot jsonb; v_year integer; v_team public.teams;
BEGIN
  IF session_user NOT IN ('postgres','supabase_admin') AND NOT COALESCE(private.is_admin(),false) THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  SELECT snapshot,snapshot->'teams'->p_profile,(snapshot->>'year')::integer INTO v_snapshot,v_source,v_year FROM private.uci_catalog_runs WHERE id=p_run;
  SELECT * INTO STRICT v_team FROM public.teams WHERE id=p_team_id;
  IF v_source IS NULL OR v_team."specialEdition" OR v_team."teamKind"='selection'
    OR v_team.gender IS DISTINCT FROM v_source->>'gender' OR v_team.category IS DISTINCT FROM v_source->>'category'
    THEN RAISE EXCEPTION 'team_catalog_review'; END IF;
  INSERT INTO private.uci_catalog_team_links(season,profile,team_id,gender,category,source_name,source_code)
    VALUES(v_year,p_profile,p_team_id,v_team.gender,v_team.category,v_source->>'name',v_source->>'code')
    ON CONFLICT(season,profile) DO UPDATE SET team_id=EXCLUDED.team_id,gender=EXCLUDED.gender,category=EXCLUDED.category,
      source_name=EXCLUDED.source_name,source_code=EXCLUDED.source_code,reviewed_at=clock_timestamp();
  INSERT INTO private.uci_catalog_decisions(decision,status) VALUES('Equipo UCI '||p_profile||' de '||v_year||' asociado a '||p_team_id,'team_link');
  INSERT INTO private.uci_catalog_baselines(season,gender,profile,team_id)
    SELECT v_year,r.gender,r.profile,p_team_id FROM (
      SELECT 'male' AS gender,"uciProfileId" AS profile,"currentTeamId" AS team FROM public.riders_men
      UNION ALL SELECT 'female',"uciProfileId","currentTeamId" FROM public.riders_women
    ) r WHERE r.team=p_team_id AND r.gender=v_team.gender
      AND v_snapshot->'records'->r.profile->'regular'=jsonb_build_array(p_profile)
      AND v_snapshot->'records'->r.profile->>'conflict'='false'
    ON CONFLICT DO NOTHING;
END;
$$;

-- El propietario de las RPC no puede iniciar sesión. Su autoridad de pruebas es acotada a estas RPC.
DO $$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('private.guard_trainee_affiliation()'::regprocedure) INTO v_definition;
  IF position('''postgres'',''supabase_admin'',''service_role''' IN v_definition)=0 THEN
    RAISE EXCEPTION 'trainee_guard_contract_changed';
  END IF;
  EXECUTE replace(v_definition,'''postgres'',''supabase_admin'',''service_role''',
    '''postgres'',''supabase_admin'',''service_role'',''cc_uci_catalog_owner''');
END;
$$;
GRANT EXECUTE ON FUNCTION public.fold_name(text),private.is_admin(),private.guard_trainee_affiliation() TO cc_uci_catalog_owner;

DO $$
DECLARE v_object record;
BEGIN
  FOR v_object IN SELECT c.oid::regclass AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private' AND c.relkind='r' AND c.relname LIKE 'uci_catalog_%' LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO cc_uci_catalog_owner',v_object.name);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated,service_role,cc_uci_catalog_worker',v_object.name);
  END LOOP;
  FOR v_object IN SELECT p.oid::regprocedure AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname LIKE 'uci_catalog_%' LOOP
    IF v_object.name::text NOT LIKE 'private.uci_catalog_lock_teams(%' THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO cc_uci_catalog_owner',v_object.name);
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,cc_uci_catalog_worker',v_object.name);
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION private.uci_catalog_begin(text,text),private.uci_catalog_renew(uuid,uuid),
  private.uci_catalog_observe(uuid,uuid,jsonb),private.uci_catalog_context(uuid,uuid),
  private.uci_catalog_stage(uuid,uuid,jsonb),private.uci_catalog_apply(uuid,uuid),private.uci_catalog_finish(uuid,uuid,text)
  TO cc_uci_catalog_worker;
REVOKE CREATE ON SCHEMA private FROM cc_uci_catalog_owner;
GRANT EXECUTE ON FUNCTION private.uci_catalog_rollback(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.uci_catalog_review_case(text,text,text),private.uci_catalog_review_team(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.uci_catalog_lock_teams(uuid,jsonb) TO cc_uci_catalog_owner;
-- Las funciones usadas por triggers conservan acceso para los escritores vigentes.
GRANT EXECUTE ON FUNCTION private.uci_catalog_lock_rider() TO authenticated,service_role,cc_results_worker;

ALTER FUNCTION private.get_automation_monitor() RENAME TO get_automation_monitor_before_uci_catalog;
CREATE FUNCTION private.get_automation_monitor() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $$
DECLARE v_result jsonb; v_runs jsonb;
BEGIN
  IF NOT COALESCE(private.is_admin(),false) THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  v_result:=private.get_automation_monitor_before_uci_catalog();
  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'startedAt' DESC),'[]'::jsonb) INTO v_runs FROM (
    SELECT item FROM jsonb_array_elements(v_result->'runs') item
    UNION ALL SELECT jsonb_build_object('id',id,'job','uci_catalog','triggerKind',mode,'revision',revision,
      'startedAt',started_at,'finishedAt',finished_at,'status',CASE WHEN status='running' AND started_at<now()-interval '130 minutes' THEN 'error' ELSE status END,
      'summary',summary,'errorMessage',CASE WHEN status='running' AND started_at<now()-interval '130 minutes' THEN 'Ejecución interrumpida' ELSE error_code END)
      FROM (SELECT * FROM private.uci_catalog_runs ORDER BY started_at DESC LIMIT 20) r
  ) all_runs;
  RETURN v_result||jsonb_build_object('runs',v_runs,'uciCatalog',jsonb_build_object(
    'enabled',(SELECT enabled FROM private.uci_catalog_control WHERE singleton),
    'lastObservation',(SELECT max(observed_at) FROM private.uci_catalog_runs),
    'overdue',COALESCE((SELECT max(observed_at)<now()-interval '36 hours' FROM private.uci_catalog_runs),false),
    'openCases',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='open'),
    'lockedCases',(SELECT count(*) FROM private.uci_catalog_cases WHERE status='locked')));
END;
$$;
REVOKE ALL ON FUNCTION private.get_automation_monitor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.get_automation_monitor() TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_get_automation_monitor() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER STABLE SET search_path='' AS $$
BEGIN
  IF NOT COALESCE(private.is_admin(),false) THEN RAISE EXCEPTION 'admin_required' USING ERRCODE='42501'; END IF;
  RETURN private.get_automation_monitor();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_automation_monitor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_automation_monitor() TO authenticated;
COMMIT;
