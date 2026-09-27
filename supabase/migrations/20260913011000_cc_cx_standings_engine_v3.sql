-- Motor CX v3: política explícita de bonos ante forfaits X2O.
-- Conserva el cuerpo vigente, la identidad por id, los locks y la prioridad manual.
CREATE OR REPLACE FUNCTION private.cx_publish_standings(p_tournament_id text, p_category text, p_expected_digest text, p_calculation jsonb, p_replace_manual boolean DEFAULT false, p_source text DEFAULT 'computed'::text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  IF p_source='computed' AND ((p_calculation->>'engineVersion') IS DISTINCT FROM '3'
    OR (publication<>'needs_review' AND (tournament."pointsScheme"->>'status' IS DISTINCT FROM 'verified'
      OR tournament."pointsScheme"#>>'{edition,seasonKey}' IS DISTINCT FROM tournament."seasonKey"
      OR coalesce(tournament."pointsScheme"#>>ARRAY['categories',p_category,'review','cotejoUrl'],'') !~ '^https?://'
      OR coalesce(tournament."pointsScheme"#>>ARRAY['categories',p_category,'review','sourceUrl'],'') !~ '^https?://'
      OR (mode='time' AND coalesce(tournament."pointsScheme"#>>ARRAY['categories',p_category,'review','forfaitBonusesPolicy'],'') NOT IN ('retain','discard'))))) THEN
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
      p_expected_digest,CASE WHEN p_source='computed' THEN 3 END,p_calculation->'roundIds',p_calculation->'issues',p_calculation->'breakdown',p_evidence->>'sourceUrl')
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
END $function$
;

REVOKE ALL ON FUNCTION private.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.cx_publish_standings(text,text,text,jsonb,boolean,text,jsonb) TO authenticated,cc_results_worker;

