-- ═══════════════════════════════════════════════════════════════════
--  FICHAS CX DESDE RESULTADOS — cx_ingest_results crea/enlaza fichas
--
--  Cambio de producto: las filas de resultados DataRide/PDF/manual
--  traen nombre partido, nacionalidad y fecha de nacimiento verificados
--  en la fuente oficial. Cuando proceda, la ingesta crea la ficha CX
--  ausente en el género de la manga y enlaza la fila. Reglas:
--   · Se enlaza si existe exactamente una ficha con el nombre plegado
--     (public.fold_name) en la tabla del género, verified=true y
--     compatible en nacionalidad/nacimiento (NULL del catálogo no
--     contradice). Dos fichas del mismo nombre plegado se consideran
--     homónimos: ni enlace ni creación (queda NULL con aviso Node).
--   · Se crea solo si no existe ninguna ficha con ese nombre plegado y
--     la fila aporta nombre+apellido+nacionalidad+nacimiento válidos.
--   · source='results_<inputSource>'; verified=true (fuente UCI).
--   · pending nunca crea; el borrado por contrato queda exento.
--   · La validación identityEvidence de IDs explícitos se ejecuta sobre
--     las filas originales, igual que antes; los enlaces/creaciones de
--     esta llamada se aplican después y entran en el digest, de modo
--     que la re-ingesta del mismo documento devuelve unchanged.
--  Concesiones mínimas: INSERT en fichas para cc_results_worker
--  (SECURITY INVOKER; el resto de privilegios sin cambios).
--  Rollback: restaurar la versión anterior de cx_ingest_results y
--  REVOKE INSERT.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cx_ingest_results(p_race_id text, p_category text, p_rows jsonb, p_status text, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE race public.cx_races; manga public.cx_race_categories; link public.cx_race_uci_links;
  date_key date; source text; digest text; result jsonb; identity jsonb; expected_identity jsonb; male boolean;
  rowv jsonb; rows_resolved jsonb:='[]'::jsonb; riders_linked integer:=0; riders_created integer:=0;
  f_first text; f_last text; cand_id text; cand_count integer; compat_count integer; nat text; dob date; new_id text; overlap integer;
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
  -- Resolución de fichas: enlace por nombre plegado compatible o creación
  -- cuando no existe ninguna ficha con ese nombre en el género de la manga.
  IF p_status<>'pending' THEN
    FOR rowv IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      IF rowv->>'globalRiderId' IS NOT NULL
        OR coalesce(btrim(rowv->>'firstName'),'')='' OR coalesce(btrim(rowv->>'lastName'),'')='' THEN
        rows_resolved:=rows_resolved||rowv; CONTINUE;
      END IF;
      nat:=nullif(btrim(coalesce(rowv->>'isoCode2','')),'');
      IF nat IS NULL OR nat!~'^[A-Z]{2}$' THEN rows_resolved:=rows_resolved||rowv; CONTINUE; END IF;
      BEGIN dob:=nullif(btrim(coalesce(rowv->>'birthDate','')),'')::date; EXCEPTION WHEN OTHERS THEN dob:=NULL; END;
      IF dob IS NULL OR dob<'1900-01-01'::date OR dob>current_date THEN rows_resolved:=rows_resolved||rowv; CONTINUE; END IF;
      f_first:=public.fold_name(rowv->>'firstName'); f_last:=public.fold_name(rowv->>'lastName');
      IF f_first='' OR f_last='' THEN rows_resolved:=rows_resolved||rowv; CONTINUE; END IF;
      IF male THEN
        SELECT count(*), min(id) INTO STRICT cand_count, cand_id FROM public.cx_riders_men
          WHERE public.fold_name("firstName")=f_first AND public.fold_name("lastName")=f_last;
        IF cand_count=1 THEN
          SELECT count(*) INTO STRICT compat_count FROM public.cx_riders_men
            WHERE public.fold_name("firstName")=f_first AND public.fold_name("lastName")=f_last
              AND verified AND (nationality IS NULL OR nationality=nat) AND ("birthDate" IS NULL OR "birthDate"=dob);
          IF compat_count=1 THEN
            SELECT id INTO STRICT cand_id FROM public.cx_riders_men
              WHERE public.fold_name("firstName")=f_first AND public.fold_name("lastName")=f_last
                AND verified AND (nationality IS NULL OR nationality=nat) AND ("birthDate" IS NULL OR "birthDate"=dob);
          ELSE cand_id:=NULL;
          END IF;
        END IF;
        IF cand_count=0 THEN
          new_id:=replace(f_last,' ','-')||'-'||replace(f_first,' ','-'); overlap:=0;
          WHILE EXISTS(SELECT 1 FROM public.cx_riders_men WHERE id=new_id) LOOP overlap:=overlap+1; new_id:=replace(f_last,' ','-')||'-'||replace(f_first,' ','-')||'-'||overlap; END LOOP;
          INSERT INTO public.cx_riders_men(id,"firstName","lastName",nationality,"birthDate",source,verified)
            VALUES(new_id,initcap(lower(btrim(rowv->>'firstName'))),initcap(lower(btrim(rowv->>'lastName'))),nat,dob,'results_'||source,true);
          cand_id:=new_id; riders_created:=riders_created+1;
        ELSIF cand_count=1 AND cand_id IS NOT NULL THEN
          riders_linked:=riders_linked+1;
        END IF;
      ELSE
        SELECT count(*), min(id) INTO STRICT cand_count, cand_id FROM public.cx_riders_women
          WHERE public.fold_name("firstName")=f_first AND public.fold_name("lastName")=f_last;
        IF cand_count=1 THEN
          SELECT count(*) INTO STRICT compat_count FROM public.cx_riders_women
            WHERE public.fold_name("firstName")=f_first AND public.fold_name("lastName")=f_last
              AND verified AND (nationality IS NULL OR nationality=nat) AND ("birthDate" IS NULL OR "birthDate"=dob);
          IF compat_count=1 THEN
            SELECT id INTO STRICT cand_id FROM public.cx_riders_women
              WHERE public.fold_name("firstName")=f_first AND public.fold_name("lastName")=f_last
                AND verified AND (nationality IS NULL OR nationality=nat) AND ("birthDate" IS NULL OR "birthDate"=dob);
          ELSE cand_id:=NULL;
          END IF;
        END IF;
        IF cand_count=0 THEN
          new_id:=replace(f_last,' ','-')||'-'||replace(f_first,' ','-'); overlap:=0;
          WHILE EXISTS(SELECT 1 FROM public.cx_riders_women WHERE id=new_id) LOOP overlap:=overlap+1; new_id:=replace(f_last,' ','-')||'-'||replace(f_first,' ','-')||'-'||overlap; END LOOP;
          INSERT INTO public.cx_riders_women(id,"firstName","lastName",nationality,"birthDate",source,verified)
            VALUES(new_id,initcap(lower(btrim(rowv->>'firstName'))),initcap(lower(btrim(rowv->>'lastName'))),nat,dob,'results_'||source,true);
          cand_id:=new_id; riders_created:=riders_created+1;
        ELSIF cand_count=1 AND cand_id IS NOT NULL THEN
          riders_linked:=riders_linked+1;
        END IF;
      END IF;
      IF cand_id IS NOT NULL THEN rowv:=jsonb_set(rowv,'{globalRiderId}',to_jsonb(cand_id)); END IF;
      rows_resolved:=rows_resolved||rowv;
    END LOOP;
    p_rows:=rows_resolved;
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
    RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'status',p_status,'unchanged',true,'rows',jsonb_array_length(p_rows),'ridersLinked',riders_linked,'ridersCreated',riders_created);
  END IF;
  result:=public.cx_replace_results(p_race_id,p_category,p_rows,p_status,p_evidence);
  UPDATE public.cx_race_categories SET "resultsInputDigest"=digest WHERE "raceId"=p_race_id AND category=p_category;
  RETURN result||jsonb_build_object('unchanged',false,'digest',digest,'ridersLinked',riders_linked,'ridersCreated',riders_created);
END $function$;

GRANT INSERT ON public.cx_riders_men TO cc_results_worker;
GRANT INSERT ON public.cx_riders_women TO cc_results_worker;
