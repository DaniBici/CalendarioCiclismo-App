-- Cola operativa compartida; los destinos de las dos disciplinas son exclusivos.
ALTER TABLE private.results_manual_queue
  ADD COLUMN discipline_id integer NOT NULL DEFAULT 10 CHECK (discipline_id IN (10,3)),
  ADD COLUMN cx_race_id text REFERENCES public.cx_races(id) ON DELETE CASCADE,
  ADD COLUMN cx_category text CHECK (cx_category IN ('ME','WE','MU','WU','MJ','WJ')),
  ADD CONSTRAINT results_manual_queue_discipline_check CHECK (
    (discipline_id=10 AND cx_race_id IS NULL AND cx_category IS NULL)
    OR (discipline_id=3 AND race_id IS NULL AND stage_number IS NULL AND (cx_category IS NULL OR cx_race_id IS NOT NULL)));
CREATE INDEX results_manual_queue_discipline_claim_idx ON private.results_manual_queue(discipline_id,status,requested_at,id)
  WHERE status IN ('pending','running');
-- RLS/ACL privados existentes: solo las funciones autorizadas acceden a la cola.

CREATE FUNCTION private.cx_dispatch_results_fetch(p_race_id text,p_category text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE race public.cx_races; request_id bigint;
BEGIN
  IF NOT (select private.is_admin()) THEN RAISE EXCEPTION 'Operación administrativa' USING ERRCODE='42501'; END IF;
  IF p_category IS NOT NULL AND (p_race_id IS NULL OR p_category NOT IN ('ME','WE','MU','WU','MJ','WJ')) THEN
    RAISE EXCEPTION 'Categoría CX inválida' USING ERRCODE='22023'; END IF;
  IF p_race_id IS NOT NULL THEN
    SELECT * INTO race FROM public.cx_races WHERE id=p_race_id;
    IF NOT FOUND OR race."editorialStatus"<>'published' OR race."isCancelled"
      OR race."dateKey"<make_date(race."seasonStartYear",8,1)
      OR coalesce(race."endDateKey",race."dateKey")>=make_date(race."seasonStartYear"+1,3,1)
      OR NOT EXISTS(SELECT 1 FROM public.cx_race_uci_links WHERE "raceId"=p_race_id AND "disciplineId"=3 AND "seasonId">0)
      OR (p_category IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cx_race_categories WHERE "raceId"=p_race_id
        AND category=p_category AND NOT "isCancelled" AND coalesce("dateKey",race."dateKey") BETWEEN race."dateKey" AND coalesce(race."endDateKey",race."dateKey"))) THEN
      RAISE EXCEPTION 'Carrera/manga CX no disponible o sin enlace verificado' USING ERRCODE='22023'; END IF;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('results_manual_queue'));
  SELECT id INTO request_id FROM private.results_manual_queue WHERE discipline_id=3 AND status IN ('pending','running')
    AND cx_race_id IS NOT DISTINCT FROM p_race_id AND cx_category IS NOT DISTINCT FROM p_category ORDER BY requested_at,id LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO private.results_manual_queue(discipline_id,cx_race_id,cx_category,ignore_window,requested_by)
      VALUES(3,p_race_id,p_category,true,(select auth.uid())) RETURNING id INTO request_id;
  END IF;
  RETURN jsonb_build_object('requestId',request_id::text,'status','queued','cxRaceId',p_race_id,'category',p_category);
END $$;
CREATE FUNCTION public.cx_enqueue_results_fetch(p_race_id text DEFAULT NULL,p_category text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.cx_dispatch_results_fetch(p_race_id,p_category); $$;

CREATE FUNCTION private.claim_results_manual_request(p_discipline_id integer)
RETURNS TABLE(request_id bigint,race_id text,stage_number integer,ignore_window boolean,cx_race_id text,cx_category text,attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF session_user<>'cc_results_worker' AND coalesce(current_setting('role',true),'')<>'cc_results_worker' THEN
    RAISE EXCEPTION 'Worker no autorizado' USING ERRCODE='42501'; END IF;
  IF p_discipline_id IS NULL OR p_discipline_id NOT IN (10,3) THEN RAISE EXCEPTION 'Disciplina inválida' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH candidate AS (
    SELECT q.id FROM private.results_manual_queue q WHERE q.discipline_id=p_discipline_id
      AND (q.status='pending' OR (q.status='running' AND q.started_at<now()-interval '30 minutes'))
      ORDER BY q.requested_at,q.id FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE private.results_manual_queue q SET status='running',started_at=now(),finished_at=NULL,attempts=q.attempts+1,error_message=NULL
      FROM candidate c WHERE q.id=c.id RETURNING q.id,q.race_id,q.stage_number,q.ignore_window,q.cx_race_id,q.cx_category,q.attempts
  ) SELECT c.id,c.race_id,c.stage_number,c.ignore_window,c.cx_race_id,c.cx_category,c.attempts FROM claimed c;
END $$;
CREATE OR REPLACE FUNCTION private.claim_results_manual_request()
RETURNS TABLE(request_id bigint,race_id text,stage_number integer,ignore_window boolean)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT q.request_id,q.race_id,q.stage_number,q.ignore_window FROM private.claim_results_manual_request(10) q;
$$;
CREATE FUNCTION private.finish_results_manual_request(p_request_id bigint,p_success boolean,p_error text,p_discipline_id integer,p_attempts integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF session_user<>'cc_results_worker' AND coalesce(current_setting('role',true),'')<>'cc_results_worker' THEN
    RAISE EXCEPTION 'Worker no autorizado' USING ERRCODE='42501'; END IF;
  UPDATE private.results_manual_queue q SET status=CASE WHEN p_success THEN 'done' ELSE 'error' END,finished_at=now(),
    error_message=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Error sin detalle'),1000) END
    WHERE q.id=p_request_id AND q.status='running' AND q.discipline_id=p_discipline_id AND q.attempts=p_attempts;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no reclamada o intento obsoleto' USING ERRCODE='40001'; END IF;
END $$;
CREATE OR REPLACE FUNCTION private.finish_results_manual_request(p_request_id bigint,p_success boolean,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF session_user<>'cc_results_worker' AND coalesce(current_setting('role',true),'')<>'cc_results_worker' THEN
    RAISE EXCEPTION 'Worker no autorizado' USING ERRCODE='42501'; END IF;
  UPDATE private.results_manual_queue q SET status=CASE WHEN p_success THEN 'done' ELSE 'error' END,finished_at=now(),
    error_message=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'Error sin detalle'),1000) END
    WHERE q.id=p_request_id AND q.status='running' AND q.discipline_id=10;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud de carretera no reclamada' USING ERRCODE='40001'; END IF;
END $$;

REVOKE ALL ON FUNCTION private.cx_dispatch_results_fetch(text,text),public.cx_enqueue_results_fetch(text,text),
  private.claim_results_manual_request(integer),private.claim_results_manual_request(),
  private.finish_results_manual_request(bigint,boolean,text,integer,integer),private.finish_results_manual_request(bigint,boolean,text)
  FROM PUBLIC,anon,authenticated,service_role,cc_results_worker,cc_broadcasts_login;
GRANT EXECUTE ON FUNCTION private.cx_dispatch_results_fetch(text,text),public.cx_enqueue_results_fetch(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.claim_results_manual_request(integer),private.claim_results_manual_request(),
  private.finish_results_manual_request(bigint,boolean,text,integer,integer),private.finish_results_manual_request(bigint,boolean,text) TO cc_results_worker;

-- Comparación semántica de las columnas persistidas; IDs SQL y tipos de entrada no cambian el resultado.
CREATE FUNCTION private.cx_results_payload_digest(p_rows jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT md5(coalesce(jsonb_agg(jsonb_build_object('rank',x.rank,'rankText',x."rankText",'bib',nullif(btrim(x.bib),''),
    'riderDisplay',x."riderDisplay",'firstName',x."firstName",'lastName',x."lastName",'globalRiderId',x."globalRiderId",
    'teamName',x."teamName",'isoCode2',x."isoCode2",'timeText',x."timeText",'gapText',x."gapText",'points',trim_scale(x.points)::text,
    'bonusPoints',trim_scale(coalesce(x."bonusPoints",0))::text,'timeSeconds',x."timeSeconds"::text,'bonusSeconds',x."bonusSeconds",'irm',x.irm)
    ORDER BY x.ordinality),'[]')::text) FROM jsonb_populate_recordset(NULL::public.cx_results,p_rows) WITH ORDINALITY x;
$$;
REVOKE ALL ON FUNCTION private.cx_results_payload_digest(jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION private.cx_results_payload_digest(jsonb) TO authenticated,cc_results_worker;

ALTER TABLE private.automation_runs DROP CONSTRAINT automation_runs_job_check,
  ADD CONSTRAINT automation_runs_job_check CHECK (job IN ('results','cx_results','broadcasts','uci_team_ranking'));

CREATE OR REPLACE FUNCTION private.dispatch_results_sync(
  p_race_id text,
  p_stage integer,
  p_ignore_window boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;
  IF p_race_id IS NOT NULL AND btrim(p_race_id) = '' THEN
    RAISE EXCEPTION 'Falta p_race_id';
  END IF;
  IF p_stage IS NOT NULL AND p_race_id IS NULL THEN
    RAISE EXCEPTION 'Una etapa requiere p_race_id';
  END IF;
  IF p_race_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.races WHERE id = p_race_id
  ) THEN
    RAISE EXCEPTION 'Carrera inexistente: %', p_race_id;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('results_manual_queue'));
  IF NOT EXISTS (
    SELECT 1
    FROM private.results_manual_queue q
    WHERE q.discipline_id=10 AND q.status IN ('pending', 'running')
      AND q.race_id IS NOT DISTINCT FROM p_race_id
      AND q.stage_number IS NOT DISTINCT FROM p_stage
      AND q.ignore_window = COALESCE(p_ignore_window, false)
  ) THEN
    INSERT INTO private.results_manual_queue (
      race_id, stage_number, ignore_window, requested_by
    ) VALUES (
      p_race_id, p_stage, COALESCE(p_ignore_window, false), (SELECT auth.uid())
    );
  END IF;

  RETURN 'queued';
END;
$function$;


CREATE OR REPLACE FUNCTION public.cx_ingest_results(p_race_id text,p_category text,p_rows jsonb,p_status text,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE race public.cx_races; manga public.cx_race_categories; link public.cx_race_uci_links;
  date_key date; source text; digest text; result jsonb; identity jsonb; expected_identity jsonb; male boolean;
BEGIN
  IF current_user<>'cc_results_worker' THEN PERFORM public.cx_require_admin(); END IF;
  SELECT * INTO manga FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manga CX no encontrada' USING ERRCODE='22023'; END IF;
  SELECT * INTO race FROM public.cx_races WHERE id=p_race_id;
  date_key:=coalesce(manga."dateKey",race."dateKey"); source:=p_evidence->>'inputSource';
  IF race."editorialStatus"<>'published' OR race."isCancelled" OR manga."isCancelled"
    OR extract(month FROM race."dateKey") NOT IN (8,9,10,11,12,1,2)
    OR extract(month FROM coalesce(race."endDateKey",race."dateKey")) NOT IN (8,9,10,11,12,1,2)
    OR extract(month FROM date_key) NOT IN (8,9,10,11,12,1,2)
    OR race."dateKey"<make_date(race."seasonStartYear",8,1)
    OR coalesce(race."endDateKey",race."dateKey")>=make_date(race."seasonStartYear"+1,3,1)
    OR date_key NOT BETWEEN race."dateKey" AND coalesce(race."endDateKey",race."dateKey")
    OR p_evidence->>'seasonKey' IS DISTINCT FROM race."seasonKey"
    OR p_evidence->>'dateKey' IS DISTINCT FROM date_key::text
    OR source IS NULL OR source NOT IN ('dataride','pdf','manual') THEN
    RAISE EXCEPTION 'Carrera/manga no disponible o documento sin correspondencia de fecha/temporada' USING ERRCODE='22023';
  END IF;
  IF current_user='cc_results_worker' AND manga."resultsLockedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Resultados bloqueados por revisión administrativa' USING ERRCODE='55000'; END IF;
  IF p_status='official' AND (p_evidence->'officialReviewed' IS DISTINCT FROM 'true'::jsonb
    OR coalesce(p_evidence->>'officialReviewSourceUrl','') !~ '^https?://') THEN
    RAISE EXCEPTION 'Oficialización sin revisión explícita y fuente oficial' USING ERRCODE='22023'; END IF;
  IF source='dataride' THEN
    SELECT * INTO link FROM public.cx_race_uci_links WHERE "raceId"=p_race_id;
    IF NOT FOUND OR link."disciplineId"<>3 OR link."seasonId" IS NULL OR link."seasonId"<=0
      OR p_evidence#>>'{dataRide,disciplineId}' IS DISTINCT FROM '3'
      OR p_evidence#>>'{dataRide,competitionId}' IS DISTINCT FROM link."competitionId"::text
      OR p_evidence#>>'{dataRide,seasonId}' IS DISTINCT FROM link."seasonId"::text
      OR coalesce(p_evidence#>>'{dataRide,uciRaceId}','') !~ '^[1-9][0-9]*$'
      OR (link."uciRaceId">0 AND p_evidence#>>'{dataRide,uciRaceId}' IS DISTINCT FROM link."uciRaceId"::text)
      OR coalesce(p_evidence#>>'{dataRide,eventId}','') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Enlace DataRide CX no corresponde a los identificadores verificados' USING ERRCODE='22023';
    END IF;
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_typeof(p_evidence->'identityEvidence') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Filas o evidencia de identidad inválidas' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.cx_results,p_rows) x WHERE
      (x.rank IS NULL AND x.irm IS NULL) OR (x.rank IS NOT NULL AND x.rank<=0)
      OR (x.irm IS NOT NULL AND x.irm NOT IN ('DNS','DNF','LAP','DSQ','OTL','ABD'))
      OR (x.irm IS NOT NULL AND (x."timeSeconds" IS NOT NULL OR (x.irm<>'LAP' AND x.rank IS NOT NULL))))
    OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.cx_results,p_rows) x WHERE x.rank IS NOT NULL GROUP BY x.rank HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Puesto/estado duplicado o inválido; un IRM no aporta tiempo real de meta' USING ERRCODE='22023'; END IF;
  male:=left(p_category,1)='M';
  FOR identity IN SELECT value FROM jsonb_array_elements(p_rows) WHERE value->>'globalRiderId' IS NOT NULL LOOP
    SELECT to_jsonb(r) INTO expected_identity FROM (
      SELECT id,"firstName","lastName",nationality,"birthDate",verified FROM public.cx_riders_men WHERE male AND id=identity->>'globalRiderId'
      UNION ALL SELECT id,"firstName","lastName",nationality,"birthDate",verified FROM public.cx_riders_women WHERE NOT male AND id=identity->>'globalRiderId'
    ) r;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'identityEvidence') e WHERE e=expected_identity) THEN
      RAISE EXCEPTION 'La identidad CX cambió desde la preparación; volver a resolver' USING ERRCODE='40001'; END IF;
  END LOOP;
  IF current_user='cc_results_worker' AND source='dataride' AND p_status='provisional' AND manga."resultsStatus"='official'
    AND manga."resultsSourceUrl" IS NOT DISTINCT FROM p_evidence->>'sourceUrl'
    AND private.cx_results_payload_digest(p_rows)=(SELECT private.cx_results_payload_digest(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder"),'[]'))
      FROM public.cx_results x WHERE x."raceId"=p_race_id AND x.category=p_category) THEN
    RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'status','official','unchanged',true,'rows',jsonb_array_length(p_rows));
  END IF;
  digest:=md5(jsonb_build_object('rows',p_rows,'status',p_status,'evidence',p_evidence-ARRAY['fetchedAt','lockAutomatic'])::text);
  IF manga."resultsInputDigest"=digest AND manga."resultsStatus"=p_status THEN
    IF current_user<>'cc_results_worker' AND ((p_evidence->'lockAutomatic'='false'::jsonb AND manga."resultsLockedAt" IS NOT NULL)
      OR (p_evidence->'lockAutomatic' IS DISTINCT FROM 'false'::jsonb AND manga."resultsLockedAt" IS NULL)) THEN
      UPDATE public.cx_race_categories SET "resultsLockedAt"=CASE WHEN p_evidence->'lockAutomatic'='false'::jsonb THEN NULL ELSE now() END
        WHERE "raceId"=p_race_id AND category=p_category;
      INSERT INTO private.cx_change_log(operation,"raceId",category,before,after,evidence) VALUES('results_lock',p_race_id,p_category,
        to_jsonb(manga."resultsLockedAt"),jsonb_build_object('locked',p_evidence->'lockAutomatic' IS DISTINCT FROM 'false'::jsonb),p_evidence);
    END IF;
    RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'status',p_status,'unchanged',true,'rows',jsonb_array_length(p_rows));
  END IF;
  result:=public.cx_replace_results(p_race_id,p_category,p_rows,p_status,p_evidence);
  UPDATE public.cx_race_categories SET "resultsInputDigest"=digest WHERE "raceId"=p_race_id AND category=p_category;
  RETURN result||jsonb_build_object('unchanged',false,'digest',digest);
END $$;


CREATE OR REPLACE FUNCTION public.cx_standings_snapshot(p_tournament_id text,p_category text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE tournament public.cx_tournaments; source_category text; payload jsonb; rounds jsonb; riders jsonb;
BEGIN
  IF current_user<>'cc_results_worker' AND session_user<>'cc_results_worker'
    AND coalesce(current_setting('role',true),'')<>'cc_results_worker' THEN PERFORM public.cx_require_admin(); END IF;
  SELECT * INTO tournament FROM public.cx_tournaments WHERE id=p_tournament_id;
  IF NOT FOUND OR p_category IS NULL OR p_category NOT IN ('ME','WE','MU','WU','MJ','WJ') THEN
    RAISE EXCEPTION 'Torneo o categoría inválidos' USING ERRCODE='22023';
  END IF;
  source_category:=coalesce(tournament."pointsScheme"#>>ARRAY['categories',p_category,'extras','derived','fromCategory'],p_category);
  SELECT coalesce(jsonb_agg(jsonb_build_object('race',to_jsonb(r),'manga',to_jsonb(c)-ARRAY['resultsLockedAt','resultsProvider','resultsInputDigest'],'results',
    (SELECT coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('points',x.points::text,'bonusPoints',coalesce(x."bonusPoints",0)::text,
      'timeSeconds',x."timeSeconds"::text) ORDER BY x."sortOrder",x.id),'[]')
      FROM public.cx_results x WHERE x."raceId"=r.id AND x.category=source_category))
    ORDER BY coalesce(c."dateKey",r."dateKey"),c."startTimeUtc" NULLS LAST,r.id),'[]') INTO rounds
    FROM public.cx_races r JOIN public.cx_race_categories c ON c."raceId"=r.id AND c.category=source_category
    WHERE r."tournamentId"=p_tournament_id AND r."seasonKey"=tournament."seasonKey";
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') INTO riders FROM (
    SELECT id,"birthDate",verified FROM public.cx_riders_men WHERE left(source_category,1)='M' AND id IN
      (SELECT x."globalRiderId" FROM public.cx_results x JOIN public.cx_races r ON r.id=x."raceId"
        WHERE r."tournamentId"=p_tournament_id AND x.category=source_category)
    UNION ALL
    SELECT id,"birthDate",verified FROM public.cx_riders_women WHERE left(source_category,1)='W' AND id IN
      (SELECT x."globalRiderId" FROM public.cx_results x JOIN public.cx_races r ON r.id=x."raceId"
        WHERE r."tournamentId"=p_tournament_id AND x.category=source_category)
  ) v;
  payload:=jsonb_build_object('tournament',to_jsonb(tournament),'category',p_category,'rounds',rounds,'riders',riders);
  RETURN jsonb_build_object('input',payload,'digest',md5(payload::text));
END $$;


CREATE OR REPLACE FUNCTION private.finish_automation_run(p_run_id bigint, p_status text, p_summary jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  worker_role text:=coalesce(nullif(nullif(current_setting('role',true),'none'),''),session_user);
  v_job text;
BEGIN
  SELECT job INTO v_job FROM private.automation_runs WHERE id = p_run_id;
  IF (worker_role = 'cc_results_worker' AND v_job NOT IN ('results', 'cx_results', 'uci_team_ranking'))
     OR (worker_role = 'cc_broadcasts_login' AND v_job <> 'broadcasts')
     OR worker_role NOT IN ('cc_results_worker', 'cc_broadcasts_login') THEN
    RAISE EXCEPTION 'Ejecución no autorizada para este worker' USING ERRCODE = '42501';
  END IF;

  UPDATE private.automation_runs
  SET finished_at = now(),
      status = p_status,
      summary = COALESCE(p_summary, '{}'::jsonb),
      error_message = CASE WHEN p_status IN ('error', 'partial')
        THEN left(COALESCE(p_error, 'Error sin detalle'), 2000)
        ELSE NULL
      END
  WHERE id = p_run_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ejecución no activa: %', p_run_id;
  END IF;

  DELETE FROM private.automation_runs r
  WHERE r.status <> 'running'
    AND r.id NOT IN (
      SELECT recent.id
      FROM private.automation_runs recent
      ORDER BY recent.started_at DESC, recent.id DESC
      LIMIT 10
    )
    AND r.id NOT IN (
      SELECT DISTINCT ON (latest.job) latest.id
      FROM private.automation_runs latest
      ORDER BY latest.job, latest.started_at DESC, latest.id DESC
    );
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_automation_source_run(p_run_id bigint, p_source text, p_status text, p_items_found integer DEFAULT 0, p_items_matched integer DEFAULT 0, p_items_changed integer DEFAULT 0, p_errors integer DEFAULT 0, p_summary jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  worker_role text:=coalesce(nullif(nullif(current_setting('role',true),'none'),''),session_user);
  v_job text;
BEGIN
  SELECT job INTO v_job FROM private.automation_runs WHERE id = p_run_id;
  IF (worker_role = 'cc_results_worker' AND v_job NOT IN ('results', 'cx_results', 'uci_team_ranking'))
     OR (worker_role = 'cc_broadcasts_login' AND v_job <> 'broadcasts')
     OR worker_role NOT IN ('cc_results_worker', 'cc_broadcasts_login') THEN
    RAISE EXCEPTION 'Ejecución no autorizada para este worker' USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.automation_source_runs (
    run_id, source, status, items_found, items_matched, items_changed, errors, summary
  ) VALUES (
    p_run_id, p_source, p_status, p_items_found, p_items_matched,
    p_items_changed, p_errors, COALESCE(p_summary, '{}'::jsonb)
  )
  ON CONFLICT (run_id, source) DO UPDATE SET
    status = EXCLUDED.status,
    items_found = EXCLUDED.items_found,
    items_matched = EXCLUDED.items_matched,
    items_changed = EXCLUDED.items_changed,
    errors = EXCLUDED.errors,
    summary = EXCLUDED.summary;
END;
$function$;

CREATE OR REPLACE FUNCTION private.start_automation_run(p_job text, p_trigger_kind text, p_request_id bigint DEFAULT NULL::bigint, p_revision text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  worker_role text:=coalesce(nullif(nullif(current_setting('role',true),'none'),''),session_user);
  v_id bigint;
BEGIN
  IF worker_role = 'cc_results_worker' AND p_job NOT IN ('results', 'cx_results', 'uci_team_ranking') THEN
    RAISE EXCEPTION 'Trabajo no autorizado para cc_results_worker' USING ERRCODE = '42501';
  ELSIF worker_role = 'cc_broadcasts_login' AND p_job <> 'broadcasts' THEN
    RAISE EXCEPTION 'Trabajo no autorizado para cc_broadcasts_login' USING ERRCODE = '42501';
  ELSIF worker_role NOT IN ('cc_results_worker', 'cc_broadcasts_login') THEN
    RAISE EXCEPTION 'Worker no autorizado' USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.automation_runs (job, trigger_kind, request_id, revision)
  VALUES (p_job, p_trigger_kind, p_request_id, NULLIF(left(p_revision, 80), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.start_automation_run(text,text,bigint,text),
  private.finish_automation_run(bigint,text,jsonb,text),private.record_automation_source_run(bigint,text,text,integer,integer,integer,integer,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,cc_results_worker,cc_broadcasts_login;
GRANT EXECUTE ON FUNCTION private.start_automation_run(text,text,bigint,text),
  private.finish_automation_run(bigint,text,jsonb,text),private.record_automation_source_run(bigint,text,text,integer,integer,integer,integer,jsonb)
  TO cc_results_worker,cc_broadcasts_login;


CREATE OR REPLACE FUNCTION private.get_automation_monitor_before_uci_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'La operación requiere permisos de administración' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generatedAt', now(),
    'runs', COALESCE((
      SELECT jsonb_agg(to_jsonb(recent) ORDER BY recent."startedAt" DESC)
      FROM (
        SELECT id, job, trigger_kind AS "triggerKind", request_id AS "requestId",
               revision, started_at AS "startedAt", finished_at AS "finishedAt",
               status, summary, error_message AS "errorMessage"
        FROM private.automation_runs
        ORDER BY started_at DESC
        LIMIT 100
      ) recent
    ), '[]'::jsonb),
    'sources', COALESCE((
      SELECT jsonb_agg(to_jsonb(recent_sources) ORDER BY recent_sources."startedAt" DESC, recent_sources.source)
      FROM (
        SELECT s.run_id AS "runId",r.job,r.started_at AS "startedAt", s.source, s.status,
               s.items_found AS "itemsFound", s.items_matched AS "itemsMatched",
               s.items_changed AS "itemsChanged", s.errors, s.summary
        FROM private.automation_source_runs s
        JOIN private.automation_runs r ON r.id = s.run_id
        ORDER BY r.started_at DESC, s.source
        LIMIT 300
      ) recent_sources
    ), '[]'::jsonb),
    'queues', jsonb_build_object(
      'results', jsonb_build_object(
        'pending', (SELECT count(*) FROM private.results_manual_queue WHERE discipline_id=10 AND status = 'pending'),
        'running', (SELECT count(*) FROM private.results_manual_queue WHERE discipline_id=10 AND status = 'running'),
        'lastRequest', (SELECT to_jsonb(q) FROM (
          SELECT id, race_id AS "raceId", stage_number AS "stageNumber", requested_at AS "requestedAt",
                 started_at AS "startedAt", finished_at AS "finishedAt", status, error_message AS "errorMessage"
          FROM private.results_manual_queue WHERE discipline_id=10 ORDER BY requested_at DESC, id DESC LIMIT 1
        ) q)
      ),
      'cx_results', jsonb_build_object(
        'pending', (SELECT count(*) FROM private.results_manual_queue WHERE discipline_id=3 AND status='pending'),
        'running', (SELECT count(*) FROM private.results_manual_queue WHERE discipline_id=3 AND status='running'),
        'lastRequest', (SELECT to_jsonb(q) FROM (
          SELECT id::text AS id,cx_race_id AS "cxRaceId",cx_category AS category,requested_at AS "requestedAt",
            started_at AS "startedAt",finished_at AS "finishedAt",status,error_message AS "errorMessage"
          FROM private.results_manual_queue WHERE discipline_id=3 ORDER BY requested_at DESC,id DESC LIMIT 1
        ) q)
      ),
      'broadcasts', jsonb_build_object(
        'pending', (SELECT count(*) FROM private.broadcasts_manual_queue WHERE status = 'pending'),
        'running', (SELECT count(*) FROM private.broadcasts_manual_queue WHERE status = 'running'),
        'lastRequest', (SELECT to_jsonb(q) FROM (
          SELECT id, requested_at AS "requestedAt", started_at AS "startedAt",
                 finished_at AS "finishedAt", status, error_message AS "errorMessage"
          FROM private.broadcasts_manual_queue ORDER BY requested_at DESC, id DESC LIMIT 1
        ) q)
      )
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION private.get_automation_monitor_before_uci_catalog(),private.dispatch_results_sync(text,integer,boolean) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker,cc_broadcasts_login;
GRANT EXECUTE ON FUNCTION private.get_automation_monitor_before_uci_catalog(),private.dispatch_results_sync(text,integer,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.cx_ingest_results(text,text,jsonb,text,jsonb),public.cx_standings_snapshot(text,text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_ingest_results(text,text,jsonb,text,jsonb),public.cx_standings_snapshot(text,text) TO authenticated,cc_results_worker;
NOTIFY pgrst,'reload schema';
