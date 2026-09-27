-- F5: entrada común, cola invalidada por cambios y publicación atómica de generales.
-- No carga reglas ni resultados, no activa timers y no envía push.
ALTER TABLE public.cx_race_categories ADD COLUMN "resultsEvidence" jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof("resultsEvidence")='object');
GRANT UPDATE ("resultsEvidence") ON public.cx_race_categories TO cc_results_worker;
COMMENT ON COLUMN public.cx_race_categories."resultsEvidence" IS
  'Pruebas públicas de puestos por categoría y ajustes; el registro completo sigue en private.cx_change_log.';

CREATE TABLE public.cx_standings_state (
  "tournamentId" text NOT NULL,
  "seasonKey" text NOT NULL,
  category text NOT NULL CHECK (category IN ('ME','WE','MU','WU','MJ','WJ')),
  status text NOT NULL CHECK (status IN ('pending','ready','empty','needs_review','manual')),
  "inputDigest" text,
  "engineVersion" integer,
  "roundIds" jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("roundIds")='array'),
  issues jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues)='array'),
  breakdown jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(breakdown)='array'),
  "sourceUrl" text,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tournamentId",category),
  FOREIGN KEY ("tournamentId","seasonKey") REFERENCES public.cx_tournaments(id,"seasonKey") ON DELETE CASCADE
);
ALTER TABLE public.cx_standings_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cx_standings_state FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT SELECT ON TABLE public.cx_standings_state TO anon,authenticated,service_role,cc_results_worker;
CREATE POLICY cx_public_read ON public.cx_standings_state FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY cx_worker_read ON public.cx_standings_state FOR SELECT TO cc_results_worker USING (true);

CREATE TABLE private.cx_standings_queue (
  "tournamentId" text NOT NULL REFERENCES public.cx_tournaments(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('ME','WE','MU','WU','MJ','WJ')),
  generation bigint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','review','error')),
  "requestedAt" timestamptz NOT NULL DEFAULT now(),
  "claimedAt" timestamptz,
  "finishedAt" timestamptz,
  "lastError" text,
  PRIMARY KEY ("tournamentId",category)
);
CREATE INDEX cx_standings_queue_pending_idx ON private.cx_standings_queue("requestedAt") WHERE status IN ('pending','running');
ALTER TABLE private.cx_standings_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cx_standings_queue FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT SELECT ON TABLE private.cx_standings_queue TO authenticated,cc_results_worker;
GRANT UPDATE (status,"finishedAt","lastError") ON TABLE private.cx_standings_queue TO cc_results_worker;
CREATE POLICY cx_admin_read ON private.cx_standings_queue FOR SELECT TO authenticated USING ((select private.is_admin()));
CREATE POLICY cx_worker_read ON private.cx_standings_queue FOR SELECT TO cc_results_worker USING (true);
CREATE POLICY cx_worker_update ON private.cx_standings_queue FOR UPDATE TO cc_results_worker USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.cx_replace_results(p_race_id text,p_category text,p_rows jsonb,p_status text,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous jsonb; payload jsonb; row public.cx_results; mode text; n integer:=0; male boolean;
BEGIN
  IF current_user<>'cc_results_worker' THEN PERFORM public.cx_require_admin(); END IF;
  PERFORM 1 FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category FOR UPDATE;
  IF NOT FOUND OR p_status IS NULL OR p_status NOT IN ('pending','provisional','official') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR (p_status<>'pending' AND jsonb_array_length(p_rows)=0) OR coalesce(p_evidence->>'sourceUrl','') !~ '^https?://' THEN
    RAISE EXCEPTION 'Categoría, publicación, filas o fuente inválidos' USING ERRCODE='22023';
  END IF;
  SELECT t."pointsScheme"#>>ARRAY['categories',p_category,'mode'] INTO mode FROM public.cx_races r
    JOIN public.cx_tournaments t ON t.id=r."tournamentId" WHERE r.id=p_race_id;
  male:=left(p_category,1)='M';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) v WHERE nullif(v->>'bib','') IS NOT NULL GROUP BY v->>'bib' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) v WHERE v->>'globalRiderId' IS NOT NULL GROUP BY v->>'globalRiderId' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Dorsal o ficha duplicados' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder"),'[]') INTO previous
    FROM public.cx_results x WHERE "raceId"=p_race_id AND category=p_category;
  DELETE FROM public.cx_results WHERE "raceId"=p_race_id AND category=p_category;
  FOR payload IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row:=jsonb_populate_record(NULL::public.cx_results,payload);
    IF coalesce(btrim(row."riderDisplay"),'')='' OR (row."globalRiderId" IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.cx_riders_men WHERE male AND id=row."globalRiderId"
        UNION ALL SELECT 1 FROM public.cx_riders_women WHERE NOT male AND id=row."globalRiderId")) THEN
      RAISE EXCEPTION 'Nombre vacío o ficha CX inválida' USING ERRCODE='22023';
    END IF;
    IF mode='points' AND row."bonusSeconds" IS NOT NULL OR mode='time' AND coalesce(row."bonusPoints",0)<>0 THEN
      RAISE EXCEPTION 'Bonificación en una unidad distinta del torneo' USING ERRCODE='22023';
    END IF;
    IF row."bonusSeconds" IS NOT NULL AND coalesce(p_evidence->>'bonusSourceUrl','') !~ '^https?://'
      OR coalesce(row."bonusPoints",0)<>0 AND (coalesce(p_evidence->>'adjustmentReason','')='' OR coalesce(p_evidence->>'adjustmentSourceUrl','') !~ '^https?://') THEN
      RAISE EXCEPTION 'Bono o ajuste sin evidencia oficial' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.cx_results("raceId",category,rank,"rankText",bib,"riderDisplay","firstName","lastName","globalRiderId","teamName","isoCode2","timeText","gapText",points,"bonusPoints","timeSeconds","bonusSeconds",irm,"sortOrder")
      VALUES(p_race_id,p_category,row.rank,row."rankText",nullif(btrim(row.bib),''),row."riderDisplay",row."firstName",row."lastName",row."globalRiderId",row."teamName",row."isoCode2",row."timeText",row."gapText",row.points,coalesce(row."bonusPoints",0),row."timeSeconds",row."bonusSeconds",row.irm,n);
    n:=n+1;
  END LOOP;
  UPDATE public.cx_race_categories SET "resultsStatus"=p_status,"resultsImportedAt"=now(),
    "winnerName"=(SELECT "riderDisplay" FROM public.cx_results WHERE "raceId"=p_race_id AND category=p_category AND rank=1 ORDER BY "sortOrder" LIMIT 1),
    "resultsEvidence"=jsonb_strip_nulls(jsonb_build_object(
      'rankScope',p_evidence->'rankScope','categoryClassificationSourceUrl',p_evidence->'categoryClassificationSourceUrl',
      'adjustmentSourceUrl',p_evidence->'adjustmentSourceUrl','adjustmentReason',p_evidence->'adjustmentReason')),
    "resultsSourceUrl"=p_evidence->>'sourceUrl',"bonusSourceUrl"=p_evidence->>'bonusSourceUrl' WHERE "raceId"=p_race_id AND category=p_category;
  INSERT INTO private.cx_change_log(operation,"raceId",category,before,after,evidence)
    VALUES('replace_results',p_race_id,p_category,previous,jsonb_build_object('status',p_status,'rows',p_rows),p_evidence);
  RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'rows',n,'status',p_status,'mode',mode);
END $$;

CREATE FUNCTION public.cx_standings_snapshot(p_tournament_id text,p_category text)
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('race',to_jsonb(r),'manga',to_jsonb(c),'results',
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

-- Se limita a admin/worker antes de adquirir privilegios del propietario. Los locks
-- SHARE mantienen estable toda la entrada durante digest, reemplazo y auditoría;
-- no requieren ampliar los privilegios de escritura del worker sobre el calendario.
CREATE FUNCTION private.cx_publish_standings(p_tournament_id text,p_category text,p_expected_digest text,
  p_calculation jsonb,p_replace_manual boolean DEFAULT false,p_source text DEFAULT 'computed',p_evidence jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE worker boolean; snapshot jsonb; tournament public.cx_tournaments; mode text; publication text;
  previous jsonb; payload jsonb; row public.cx_tournament_standings; count_rows integer:=0; actor_role text;
BEGIN
  worker:=session_user='cc_results_worker' OR coalesce(current_setting('role',true),'')='cc_results_worker';
  IF NOT worker AND NOT (select private.is_admin()) THEN
    RAISE EXCEPTION 'Se requiere administración CC-CX' USING ERRCODE='42501'; END IF;
  IF worker AND (p_source IS DISTINCT FROM 'computed' OR p_replace_manual IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'El worker no puede sustituir una general oficial o manual' USING ERRCODE='42501';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('computed','manual') THEN RAISE EXCEPTION 'Origen inválido' USING ERRCODE='22023'; END IF;
  LOCK TABLE public.cx_tournaments,public.cx_races,public.cx_race_categories,public.cx_results,
    public.cx_riders_men,public.cx_riders_women IN SHARE MODE;
  LOCK TABLE public.cx_tournament_standings,public.cx_standings_state IN SHARE ROW EXCLUSIVE MODE;
  snapshot:=public.cx_standings_snapshot(p_tournament_id,p_category);
  IF p_expected_digest IS NULL OR snapshot->>'digest' IS DISTINCT FROM p_expected_digest THEN
    RAISE EXCEPTION 'La entrada cambió; volver a calcular antes de publicar' USING ERRCODE='40001';
  END IF;
  SELECT * INTO tournament FROM public.cx_tournaments WHERE id=p_tournament_id;
  mode:=tournament."pointsScheme"#>>ARRAY['categories',p_category,'mode'];
  publication:=p_calculation->>'status';
  IF ((mode IS NULL OR mode NOT IN ('points','time')) AND (publication IS DISTINCT FROM 'needs_review' OR p_source<>'computed'))
    OR p_calculation->>'category' IS DISTINCT FROM p_category
    OR p_calculation->>'unit' IS DISTINCT FROM mode OR publication IS NULL OR publication NOT IN ('ready','empty','needs_review')
    OR jsonb_typeof(p_calculation->'rows') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_calculation->'issues') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_calculation->'roundIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_calculation->'breakdown') IS DISTINCT FROM 'array'
    OR (publication='ready' AND jsonb_array_length(p_calculation->'rows')=0)
    OR (publication<>'ready' AND jsonb_array_length(p_calculation->'rows')<>0)
    OR (publication<>'needs_review' AND jsonb_array_length(p_calculation->'issues')<>0) THEN
    RAISE EXCEPTION 'Cálculo, estado, categoría o unidad inválidos' USING ERRCODE='22023';
  END IF;
  IF p_source='computed' AND ((p_calculation->>'engineVersion') IS DISTINCT FROM '1'
    OR (publication<>'needs_review' AND (tournament."pointsScheme"->>'status' IS DISTINCT FROM 'verified'
      OR tournament."pointsScheme"#>>'{edition,seasonKey}' IS DISTINCT FROM tournament."seasonKey"
      OR coalesce(tournament."pointsScheme"#>>ARRAY['categories',p_category,'review','cotejoUrl'],'') !~ '^https?://'
      OR coalesce(tournament."pointsScheme"#>>ARRAY['categories',p_category,'review','sourceUrl'],'') !~ '^https?://'))) THEN
    RAISE EXCEPTION 'Motor o revisión de edición/categoría inválidos' USING ERRCODE='22023';
  END IF;
  IF p_source='manual' AND (publication='needs_review' OR coalesce(p_evidence->>'sourceUrl','') !~ '^https?://'
    OR coalesce(btrim(p_evidence->>'reason'),'')='') THEN
    RAISE EXCEPTION 'Override manual sin clasificación oficial o motivo' USING ERRCODE='22023';
  END IF;
  IF NOT coalesce(p_replace_manual,false) AND (EXISTS(SELECT 1 FROM public.cx_tournament_standings
    WHERE "tournamentId"=p_tournament_id AND category=p_category AND source<>'computed') OR EXISTS(
    SELECT 1 FROM public.cx_standings_state WHERE "tournamentId"=p_tournament_id AND category=p_category AND status='manual')) THEN
    RAISE EXCEPTION 'General oficial o manual existente; revisión administrativa requerida' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_calculation->'rows') v GROUP BY v->>'globalRiderId' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_calculation->'rows') v GROUP BY v->>'rank' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Ficha o puesto repetidos en la general' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_calculation->'roundIds') v WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(snapshot#>'{input,rounds}') r WHERE r#>>'{race,id}'=v.value
      AND r#>>'{manga,resultsStatus}'='official' AND r#>>'{race,editorialStatus}'='published'
      AND r#>>'{race,isCancelled}'='false' AND r#>>'{manga,isCancelled}'='false')) THEN
    RAISE EXCEPTION 'Cálculo con una ronda retirada o no oficial' USING ERRCODE='22023';
  END IF;
  IF p_source='computed' AND publication<>'needs_review' AND
    (SELECT coalesce(jsonb_agg(v.value ORDER BY v.value),'[]') FROM jsonb_array_elements_text(p_calculation->'roundIds') v)
    IS DISTINCT FROM (SELECT coalesce(jsonb_agg(r#>>'{race,id}' ORDER BY r#>>'{race,id}'),'[]')
      FROM jsonb_array_elements(snapshot#>'{input,rounds}') r WHERE r#>>'{manga,resultsStatus}'='official'
        AND r#>>'{race,editorialStatus}'='published' AND r#>>'{race,isCancelled}'='false' AND r#>>'{manga,isCancelled}'='false'
        AND extract(month FROM (r#>>'{race,dateKey}')::date) IN (8,9,10,11,12,1,2)
        AND extract(month FROM coalesce(r#>>'{race,endDateKey}',r#>>'{race,dateKey}')::date) IN (8,9,10,11,12,1,2)
        AND extract(month FROM coalesce(r#>>'{manga,dateKey}',r#>>'{race,dateKey}')::date) IN (8,9,10,11,12,1,2)
        AND (r#>>'{race,dateKey}')::date>=make_date(left(tournament."seasonKey",4)::integer,8,1)
        AND coalesce(r#>>'{race,endDateKey}',r#>>'{race,dateKey}')::date<make_date(left(tournament."seasonKey",4)::integer+1,3,1)
        AND coalesce(r#>>'{manga,dateKey}',r#>>'{race,dateKey}')::date BETWEEN (r#>>'{race,dateKey}')::date
          AND coalesce(r#>>'{race,endDateKey}',r#>>'{race,dateKey}')::date) THEN
    RAISE EXCEPTION 'El cálculo omite, duplica o añade rondas oficiales de la categoría' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY rank,id),'[]') INTO previous FROM public.cx_tournament_standings s
    WHERE "tournamentId"=p_tournament_id AND category=p_category;
  DELETE FROM public.cx_tournament_standings WHERE "tournamentId"=p_tournament_id AND category=p_category;
  FOR payload IN SELECT value FROM jsonb_array_elements(p_calculation->'rows') LOOP
    row:=jsonb_populate_record(NULL::public.cx_tournament_standings,payload);
    IF coalesce(btrim(row."riderDisplay"),'')='' OR row."globalRiderId" IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.cx_riders_men WHERE left(p_category,1)='M' AND id=row."globalRiderId"
      UNION ALL SELECT 1 FROM public.cx_riders_women WHERE left(p_category,1)='W' AND id=row."globalRiderId")
      OR row.rank IS NULL OR row.rank<=0 OR row.rank>jsonb_array_length(p_calculation->'rows')
      OR num_nonnulls(row.points,row."timeSeconds")<>1 OR (mode='points' AND row.points IS NULL)
      OR (mode='time' AND (row."timeSeconds" IS NULL OR row."timeSeconds"<0))
      OR (mode='points' AND row.points::text !~ '^-?[0-9]+(\.[0-9]+)?$') THEN
      RAISE EXCEPTION 'Fila de general inválida o ficha ajena a CX' USING ERRCODE='22023';
    END IF;
    IF p_source='computed' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot#>'{input,riders}') v
      WHERE v->>'id'=row."globalRiderId") THEN
      RAISE EXCEPTION 'Ficha sin resultados propios en el torneo' USING ERRCODE='22023'; END IF;
    IF p_source='computed' AND tournament."pointsScheme"#>>ARRAY['categories',p_category,'extras','derived','fromCategory']='WE'
      AND NOT EXISTS(SELECT 1 FROM public.cx_riders_women WHERE id=row."globalRiderId" AND verified
        AND left(tournament."seasonKey",4)::integer+1-extract(year FROM "birthDate") BETWEEN 19 AND 22) THEN
      RAISE EXCEPTION 'General derivada con identidad/edad fuera de la categoría' USING ERRCODE='22023'; END IF;
    INSERT INTO public.cx_tournament_standings("tournamentId","seasonKey",category,rank,points,"timeSeconds",
      "globalRiderId","riderDisplay","teamName","isoCode2",source)
      VALUES(p_tournament_id,tournament."seasonKey",p_category,row.rank,row.points,row."timeSeconds",
        row."globalRiderId",row."riderDisplay",row."teamName",row."isoCode2",p_source);
    count_rows:=count_rows+1;
  END LOOP;
  INSERT INTO public.cx_standings_state("tournamentId","seasonKey",category,status,"inputDigest","engineVersion","roundIds",issues,breakdown,"sourceUrl")
    VALUES(p_tournament_id,tournament."seasonKey",p_category,CASE WHEN p_source='manual' THEN 'manual' ELSE publication END,
      p_expected_digest,CASE WHEN p_source='computed' THEN 1 END,p_calculation->'roundIds',p_calculation->'issues',p_calculation->'breakdown',p_evidence->>'sourceUrl')
    ON CONFLICT ("tournamentId",category) DO UPDATE SET status=excluded.status,"inputDigest"=excluded."inputDigest",
      "engineVersion"=excluded."engineVersion","roundIds"=excluded."roundIds",issues=excluded.issues,breakdown=excluded.breakdown,
      "sourceUrl"=excluded."sourceUrl","updatedAt"=now();
  actor_role:=coalesce(nullif(current_setting('role',true),'none'),session_user);
  INSERT INTO private.cx_change_log(operation,category,"actorRole",before,after,evidence)
    VALUES('publish_standings',p_category,actor_role,previous,p_calculation,
      p_evidence||jsonb_build_object('tournamentId',p_tournament_id,'seasonKey',tournament."seasonKey",'source',p_source,'inputDigest',p_expected_digest));
  UPDATE private.cx_standings_queue SET status=CASE WHEN publication='needs_review' THEN 'review' ELSE 'done' END,
    "finishedAt"=now(),"lastError"=CASE WHEN publication='needs_review' THEN (p_calculation->'issues')::text END
    WHERE "tournamentId"=p_tournament_id AND category=p_category;
  RETURN jsonb_build_object('tournamentId',p_tournament_id,'category',p_category,'status',publication,'source',p_source,'rows',count_rows,'digest',p_expected_digest);
END $$;

CREATE FUNCTION private.cx_enqueue_standings(p_tournament_id text,p_category text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tournament public.cx_tournaments; target text;
BEGIN
  SELECT * INTO tournament FROM public.cx_tournaments WHERE id=p_tournament_id;
  IF NOT FOUND THEN RETURN; END IF;
  FOR target IN SELECT key FROM jsonb_each(coalesce(tournament."pointsScheme"->'categories','{}'))
    WHERE key IN ('ME','WE','MU','WU','MJ','WJ') AND (p_category IS NULL OR key=p_category
      OR value#>>'{extras,derived,fromCategory}'=p_category) LOOP
    DELETE FROM public.cx_tournament_standings WHERE "tournamentId"=p_tournament_id AND category=target AND source='computed';
    INSERT INTO public.cx_standings_state("tournamentId","seasonKey",category,status)
      VALUES(p_tournament_id,tournament."seasonKey",target,'pending')
      ON CONFLICT ("tournamentId",category) DO UPDATE SET
        status=CASE WHEN cx_standings_state.status='manual' THEN 'manual' ELSE 'pending' END,
        "inputDigest"=NULL,"updatedAt"=now();
    INSERT INTO private.cx_standings_queue("tournamentId",category) VALUES(p_tournament_id,target)
      ON CONFLICT ("tournamentId",category) DO UPDATE SET status='pending',generation=cx_standings_queue.generation+1,
        "requestedAt"=now(),"claimedAt"=NULL,"finishedAt"=NULL,"lastError"=NULL;
  END LOOP;
END $$;

CREATE FUNCTION private.cx_standings_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb; new_row jsonb; race_id text; target text; source_category text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME='cx_tournaments' THEN
    IF TG_OP='UPDATE' AND old_row->'pointsScheme' IS NOT DISTINCT FROM new_row->'pointsScheme' THEN RETURN NULL; END IF;
    PERFORM private.cx_enqueue_standings(coalesce(new_row,old_row)->>'id');
  ELSIF TG_TABLE_NAME='cx_races' THEN
    IF TG_OP='UPDATE' AND (old_row - ARRAY['name','nameEn','slug','slugEn','abbrev','colorHex','logoUrl','venue','websiteUrl','timezone'])
      IS NOT DISTINCT FROM (new_row - ARRAY['name','nameEn','slug','slugEn','abbrev','colorHex','logoUrl','venue','websiteUrl','timezone']) THEN RETURN NULL; END IF;
    PERFORM private.cx_enqueue_standings(old_row->>'tournamentId');
    IF new_row->>'tournamentId' IS DISTINCT FROM old_row->>'tournamentId' THEN PERFORM private.cx_enqueue_standings(new_row->>'tournamentId'); END IF;
  ELSIF TG_TABLE_NAME IN ('cx_riders_men','cx_riders_women') THEN
    IF TG_OP='UPDATE' AND old_row->'birthDate' IS NOT DISTINCT FROM new_row->'birthDate'
      AND old_row->'verified' IS NOT DISTINCT FROM new_row->'verified' THEN RETURN NULL; END IF;
    FOR target,source_category IN SELECT DISTINCT r."tournamentId",x.category FROM public.cx_results x
      JOIN public.cx_races r ON r.id=x."raceId" WHERE r."tournamentId" IS NOT NULL
      AND x."globalRiderId"=coalesce(new_row,old_row)->>'id'
      AND left(x.category,1)=CASE WHEN TG_TABLE_NAME='cx_riders_men' THEN 'M' ELSE 'W' END LOOP
      PERFORM private.cx_enqueue_standings(target,source_category);
    END LOOP;
  ELSE
    IF TG_TABLE_NAME='cx_race_categories' AND TG_OP='UPDATE' AND
      (old_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl'])
      IS NOT DISTINCT FROM (new_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl']) THEN RETURN NULL; END IF;
    race_id:=coalesce(new_row,old_row)->>'raceId';
    SELECT "tournamentId" INTO target FROM public.cx_races WHERE id=race_id;
    PERFORM private.cx_enqueue_standings(target,coalesce(new_row,old_row)->>'category');
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER cx_standings_results_changed AFTER INSERT OR UPDATE OR DELETE ON public.cx_results FOR EACH ROW EXECUTE FUNCTION private.cx_standings_changed();
CREATE TRIGGER cx_standings_category_changed AFTER INSERT OR UPDATE OR DELETE ON public.cx_race_categories FOR EACH ROW EXECUTE FUNCTION private.cx_standings_changed();
CREATE TRIGGER cx_standings_race_changed AFTER INSERT OR UPDATE OR DELETE ON public.cx_races FOR EACH ROW EXECUTE FUNCTION private.cx_standings_changed();
CREATE TRIGGER cx_standings_rules_changed AFTER INSERT OR UPDATE ON public.cx_tournaments FOR EACH ROW EXECUTE FUNCTION private.cx_standings_changed();
CREATE TRIGGER cx_standings_men_changed AFTER UPDATE OR DELETE ON public.cx_riders_men FOR EACH ROW EXECUTE FUNCTION private.cx_standings_changed();
CREATE TRIGGER cx_standings_women_changed AFTER UPDATE OR DELETE ON public.cx_riders_women FOR EACH ROW EXECUTE FUNCTION private.cx_standings_changed();

CREATE FUNCTION private.cx_claim_standings() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed private.cx_standings_queue;
BEGIN
  IF session_user<>'cc_results_worker' AND coalesce(current_setting('role',true),'')<>'cc_results_worker'
    AND NOT (select private.is_admin()) THEN
    RAISE EXCEPTION 'Se requiere administración CC-CX' USING ERRCODE='42501'; END IF;
  WITH candidate AS (SELECT "tournamentId",category FROM private.cx_standings_queue
    WHERE status='pending' OR (status='running' AND "claimedAt"<now()-interval '10 minutes')
    ORDER BY "requestedAt","tournamentId",category FOR UPDATE SKIP LOCKED LIMIT 1)
  UPDATE private.cx_standings_queue q SET status='running',"claimedAt"=now()
    FROM candidate c WHERE q."tournamentId"=c."tournamentId" AND q.category=c.category RETURNING q.* INTO claimed;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN to_jsonb(claimed)||jsonb_build_object('generation',claimed.generation::text);
END $$;

-- Fachada invocadora; el cuerpo privilegiado permanece fuera del esquema API.
CREATE FUNCTION public.cx_publish_standings(p_tournament_id text,p_category text,p_expected_digest text,
  p_calculation jsonb,p_replace_manual boolean DEFAULT false,p_source text DEFAULT 'computed',p_evidence jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.cx_publish_standings(p_tournament_id,p_category,p_expected_digest,p_calculation,p_replace_manual,p_source,p_evidence);
$$;
REVOKE ALL ON FUNCTION public.cx_standings_snapshot(text,text),public.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb),
  private.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb),private.cx_claim_standings()
  FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_standings_snapshot(text,text),public.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb),
  private.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb) TO authenticated,cc_results_worker;
GRANT EXECUTE ON FUNCTION private.cx_claim_standings() TO cc_results_worker;
REVOKE ALL ON FUNCTION private.cx_enqueue_standings(text,text),private.cx_standings_changed()
  FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
REVOKE ALL ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb) TO authenticated,cc_results_worker;
NOTIFY pgrst,'reload schema';
