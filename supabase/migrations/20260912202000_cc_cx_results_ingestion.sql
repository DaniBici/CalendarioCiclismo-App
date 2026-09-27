-- F5: importación controlada e idempotente; conserva correcciones administrativas.
ALTER TABLE public.cx_race_categories
  ADD COLUMN "resultsLockedAt" timestamptz,
  ADD COLUMN "resultsProvider" text CHECK ("resultsProvider" IN ('dataride','pdf','manual')),
  ADD COLUMN "resultsInputDigest" text;
GRANT UPDATE ("resultsProvider","resultsInputDigest") ON public.cx_race_categories TO cc_results_worker;
-- Postgres recalcula la columna generada incluso al actualizar otra columna.
-- Solo se concede ejecución de la regla pura, sin permiso de edición del programa.
GRANT EXECUTE ON FUNCTION public.cx_duration_minutes(text,text,text) TO cc_results_worker;
COMMENT ON COLUMN public.cx_race_categories."resultsLockedAt" IS 'Bloqueo administrativo frente al worker; no altera la publicación de resultados.';
COMMENT ON COLUMN public.cx_race_categories."resultsInputDigest" IS 'Checksum de entrada de cx_ingest_results; la edición manual lo invalida.';

-- Un documento manual procesado por el runtime conserva la misma protección.
-- El worker puede activar esta protección al importar PDF/manual, nunca quitarla.
CREATE FUNCTION private.cx_lock_manual_ingestion() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user='cc_results_worker' AND NEW."resultsProvider" IN ('pdf','manual') THEN
    NEW."resultsLockedAt":=coalesce(OLD."resultsLockedAt",now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cx_lock_manual_ingestion BEFORE UPDATE OF "resultsProvider" ON public.cx_race_categories
  FOR EACH ROW EXECUTE FUNCTION private.cx_lock_manual_ingestion();
REVOKE ALL ON FUNCTION private.cx_lock_manual_ingestion() FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;

CREATE OR REPLACE FUNCTION public.cx_replace_results(p_race_id text,p_category text,p_rows jsonb,p_status text,p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous jsonb; payload jsonb; row public.cx_results; mode text; n integer:=0; male boolean; category_lock timestamptz;
BEGIN
  IF current_user<>'cc_results_worker' THEN PERFORM public.cx_require_admin(); END IF;
  SELECT "resultsLockedAt" INTO category_lock FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category FOR UPDATE;
  IF NOT FOUND OR p_status IS NULL OR p_status NOT IN ('pending','provisional','official') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR (p_status<>'pending' AND jsonb_array_length(p_rows)=0) OR coalesce(p_evidence->>'sourceUrl','') !~ '^https?://' THEN
    RAISE EXCEPTION 'Categoría, publicación, filas o fuente inválidos' USING ERRCODE='22023';
  END IF;
  IF current_user='cc_results_worker' AND category_lock IS NOT NULL THEN
    RAISE EXCEPTION 'Resultados bloqueados por revisión administrativa' USING ERRCODE='55000'; END IF;
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
  UPDATE public.cx_race_categories SET "resultsInputDigest"=NULL,"resultsProvider"=coalesce(p_evidence->>'inputSource',
    CASE WHEN current_user='cc_results_worker' THEN 'dataride' ELSE 'manual' END) WHERE "raceId"=p_race_id AND category=p_category;
  IF current_user<>'cc_results_worker' THEN
    UPDATE public.cx_race_categories SET "resultsLockedAt"=CASE WHEN p_evidence->'lockAutomatic'='false'::jsonb THEN NULL ELSE now() END
      WHERE "raceId"=p_race_id AND category=p_category;
  END IF;
  INSERT INTO private.cx_change_log(operation,"raceId",category,before,after,evidence)
    VALUES('replace_results',p_race_id,p_category,previous,jsonb_build_object('status',p_status,'rows',p_rows),p_evidence);
  RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'rows',n,'status',p_status,'mode',mode,'lockedAt',(SELECT "resultsLockedAt" FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category));
END $$;

CREATE FUNCTION public.cx_ingest_results(p_race_id text,p_category text,p_rows jsonb,p_status text,p_evidence jsonb)
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

REVOKE ALL ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb),public.cx_ingest_results(text,text,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb),public.cx_ingest_results(text,text,jsonb,text,jsonb)
  TO authenticated,cc_results_worker;
-- Bloquear/desbloquear y guardar un digest no modifican la entrada de la general.
CREATE OR REPLACE FUNCTION private.cx_standings_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row jsonb; new_row jsonb; race_id text; target text; source_category text;
BEGIN
  IF TG_OP<>'INSERT' THEN old_row:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_row:=to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME='cx_tournaments' THEN
    IF TG_OP='UPDATE' AND old_row->'pointsScheme' IS NOT DISTINCT FROM new_row->'pointsScheme' THEN RETURN NULL; END IF;
    FOR source_category IN SELECT key FROM jsonb_each(coalesce(old_row#>'{pointsScheme,categories}','{}'))
      WHERE key IN ('ME','WE','MU','WU','MJ','WJ') AND NOT coalesce(new_row#>'{pointsScheme,categories}','{}') ? key LOOP
      target:=coalesce(new_row,old_row)->>'id';
      DELETE FROM public.cx_tournament_standings WHERE "tournamentId"=target AND category=source_category AND source='computed';
      UPDATE public.cx_standings_state SET status=CASE WHEN status='manual' THEN 'manual' ELSE 'pending' END,
        "inputDigest"=NULL,"updatedAt"=now() WHERE "tournamentId"=target AND category=source_category;
      INSERT INTO private.cx_standings_queue("tournamentId",category) VALUES(target,source_category)
        ON CONFLICT ("tournamentId",category) DO UPDATE SET status='pending',generation=cx_standings_queue.generation+1,
          "requestedAt"=now(),"claimedAt"=NULL,"finishedAt"=NULL,"lastError"=NULL;
    END LOOP;
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
      (old_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl','resultsLockedAt','resultsProvider','resultsInputDigest'])
      IS NOT DISTINCT FROM (new_row - ARRAY['startlistImportedAt','winnerName','durationFormat','durationMinutes','durationRuleVersion','durationRuleSourceUrl','scheduleSourceUrl','resultsLockedAt','resultsProvider','resultsInputDigest']) THEN RETURN NULL; END IF;
    FOR race_id,source_category IN SELECT DISTINCT v.race,v.category FROM
      (VALUES (old_row->>'raceId',old_row->>'category'),(new_row->>'raceId',new_row->>'category')) v(race,category)
      WHERE v.race IS NOT NULL AND v.category IS NOT NULL LOOP
      SELECT "tournamentId" INTO target FROM public.cx_races WHERE id=race_id;
      PERFORM private.cx_enqueue_standings(target,source_category);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.cx_standings_changed() FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;

NOTIFY pgrst,'reload schema';
