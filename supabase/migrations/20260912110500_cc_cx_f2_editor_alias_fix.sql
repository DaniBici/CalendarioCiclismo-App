-- Corrige alias PL/pgSQL detectados antes de la primera carga CX.

CREATE OR REPLACE FUNCTION public.cx_save_race(p_race jsonb,p_categories jsonb,p_allow_category_removal boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.cx_races; c public.cx_race_categories; payload jsonb; previous jsonb;
BEGIN
  PERFORM public.cx_require_admin();
  r:=jsonb_populate_record(NULL::public.cx_races,p_race);
  IF jsonb_typeof(p_categories) IS DISTINCT FROM 'array' OR jsonb_array_length(p_categories)=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_categories) v GROUP BY v->>'category' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Seleccionar categorías únicas' USING ERRCODE='22023';
  END IF;
  IF r.timezone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=r.timezone) THEN
    RAISE EXCEPTION 'Zona IANA no reconocida' USING ERRCODE='22023';
  END IF;
  r.id:=coalesce(r.id,gen_random_uuid()::text);
  SELECT to_jsonb(x) INTO previous FROM public.cx_races x WHERE id=r.id FOR UPDATE;
  INSERT INTO public.cx_races(id,name,"nameEn",abbrev,slug,"slugEn","seasonKey","seasonStartYear","dateKey","endDateKey",class,"countryCode",venue,"websiteUrl","tournamentId","colorHex","logoUrl","isCancelled","editorialStatus",timezone)
    VALUES(r.id,r.name,r."nameEn",r.abbrev,r.slug,r."slugEn",r."seasonKey",r."seasonStartYear",r."dateKey",r."endDateKey",r.class,r."countryCode",r.venue,r."websiteUrl",r."tournamentId",r."colorHex",r."logoUrl",coalesce(r."isCancelled",false),coalesce(r."editorialStatus",'published'),r.timezone)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,"nameEn"=excluded."nameEn",abbrev=excluded.abbrev,slug=excluded.slug,"slugEn"=excluded."slugEn",
      "seasonKey"=excluded."seasonKey","seasonStartYear"=excluded."seasonStartYear","dateKey"=excluded."dateKey","endDateKey"=excluded."endDateKey",class=excluded.class,
      "countryCode"=excluded."countryCode",venue=excluded.venue,"websiteUrl"=excluded."websiteUrl","tournamentId"=excluded."tournamentId","colorHex"=excluded."colorHex","logoUrl"=excluded."logoUrl",
      "isCancelled"=excluded."isCancelled","editorialStatus"=excluded."editorialStatus",timezone=excluded.timezone,"updatedAt"=now();
  IF EXISTS(SELECT 1 FROM public.cx_race_categories x WHERE "raceId"=r.id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_categories) v WHERE v->>'category'=x.category)) THEN
    IF NOT coalesce(p_allow_category_removal,false) THEN
      RAISE EXCEPTION 'Eliminar categorías requiere confirmación explícita; elimina sus datos asociados' USING ERRCODE='22023';
    END IF;
    DELETE FROM public.cx_race_categories x WHERE "raceId"=r.id
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_categories) v WHERE v->>'category'=x.category);
  END IF;
  FOR payload IN SELECT value FROM jsonb_array_elements(p_categories) LOOP
    c:=jsonb_populate_record(NULL::public.cx_race_categories,payload);
    IF coalesce(c."dateKey",r."dateKey") NOT BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey")
      OR (c."startTimeUtc" IS NOT NULL AND (r.timezone IS NULL OR (c."startTimeUtc" AT TIME ZONE r.timezone)::date<>coalesce(c."dateKey",r."dateKey"))) THEN
      RAISE EXCEPTION 'Horario/fecha de categoría fuera de la carrera o sin zona verificada' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.cx_race_categories("raceId",category,"startTimeUtc","dateKey","sortOrder","isCancelled")
      VALUES(r.id,c.category,c."startTimeUtc",c."dateKey",coalesce(c."sortOrder",0),coalesce(c."isCancelled",false))
      ON CONFLICT("raceId",category) DO UPDATE SET "startTimeUtc"=excluded."startTimeUtc","dateKey"=excluded."dateKey","sortOrder"=excluded."sortOrder","isCancelled"=excluded."isCancelled";
  END LOOP;
  INSERT INTO private.cx_change_log(operation,"raceId",before,after) VALUES('save_race',r.id,previous,jsonb_build_object('race',p_race,'categories',p_categories,'allowCategoryRemoval',p_allow_category_removal));
  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.cx_prepare_startlist_import(p_race_id text,p_category text,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE payload jsonb; row public.cx_startlist_riders; rows jsonb:='[]'; snapshot text; iid uuid; matched integer:=0;
  rider record; candidate_count integer; male boolean;
BEGIN
  PERFORM public.cx_require_admin();
  PERFORM 1 FROM public.cx_race_categories WHERE "raceId"=p_race_id AND category=p_category FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(p_document->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_document->'rows')=0
    OR coalesce(p_document->>'sourceUrl','') !~ '^https?://' THEN
    RAISE EXCEPTION 'Categoría, fuente o inscritos inválidos' USING ERRCODE='22023';
  END IF;
  male:=left(p_category,1)='M';
  FOR payload IN SELECT value FROM jsonb_array_elements(p_document->'rows') LOOP
    row:=jsonb_populate_record(NULL::public.cx_startlist_riders,payload);
    IF coalesce(btrim(row."firstName"),'')='' OR coalesce(btrim(row."lastName"),'')='' THEN
      RAISE EXCEPTION 'Inscrito sin nombre y apellido' USING ERRCODE='22023';
    END IF;
    IF row."globalRiderId" IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.cx_riders_men WHERE male AND id=row."globalRiderId"
          UNION ALL SELECT 1 FROM public.cx_riders_women WHERE NOT male AND id=row."globalRiderId") THEN
        RAISE EXCEPTION 'Ficha CX inexistente o de otro género: %',row."globalRiderId" USING ERRCODE='22023';
      END IF;
    ELSE
      SELECT count(*) INTO candidate_count FROM (
        SELECT id FROM public.cx_riders_men WHERE male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName"))
          AND (row."countryCode" IS NULL OR nationality=row."countryCode")
        UNION ALL
        SELECT id FROM public.cx_riders_women WHERE NOT male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName"))
          AND (row."countryCode" IS NULL OR nationality=row."countryCode")
      ) x;
      IF candidate_count=1 THEN
        SELECT * INTO rider FROM (
          SELECT id,"currentTeamId" FROM public.cx_riders_men WHERE male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName")) AND (row."countryCode" IS NULL OR nationality=row."countryCode")
          UNION ALL
          SELECT id,"currentTeamId" FROM public.cx_riders_women WHERE NOT male AND lower(btrim("firstName"))=lower(btrim(row."firstName")) AND lower(btrim("lastName"))=lower(btrim(row."lastName")) AND (row."countryCode" IS NULL OR nationality=row."countryCode")
        ) x;
        row."globalRiderId":=rider.id;
      END IF;
    END IF;
    IF row."globalRiderId" IS NOT NULL THEN
      matched:=matched+1;
      SELECT "currentTeamId" INTO rider FROM public.cx_riders_men WHERE male AND id=row."globalRiderId"
        UNION ALL SELECT "currentTeamId" FROM public.cx_riders_women WHERE NOT male AND id=row."globalRiderId";
      row."teamId":=coalesce(row."teamId",rider."currentTeamId");
    END IF;
    IF row."teamId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cx_teams WHERE id=row."teamId") THEN
      RAISE EXCEPTION 'Equipo CX inexistente' USING ERRCODE='22023';
    END IF;
    rows:=rows||jsonb_build_array(jsonb_build_object('bib',nullif(btrim(row.bib),''),'firstName',row."firstName",'lastName',row."lastName",'countryCode',row."countryCode",'globalRiderId',row."globalRiderId",'teamId',row."teamId",'sortOrder',jsonb_array_length(rows)));
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows) v WHERE v->>'bib' IS NOT NULL GROUP BY v->>'bib' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(rows) v WHERE v->>'globalRiderId' IS NOT NULL GROUP BY v->>'globalRiderId' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Dorsal o ficha duplicados' USING ERRCODE='22023';
  END IF;
  SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder",x.id)::text,'[]')) INTO snapshot
    FROM public.cx_startlist_riders x WHERE "raceId"=p_race_id AND category=p_category;
  INSERT INTO private.cx_startlist_imports("raceId",category,document,"expectedSnapshot")
    VALUES(p_race_id,p_category,p_document||jsonb_build_object('rows',rows),snapshot) RETURNING id INTO iid;
  RETURN jsonb_build_object('importId',iid,'raceId',p_race_id,'category',p_category,'rows',rows,'matched',matched,'unmatched',jsonb_array_length(rows)-matched,'status','prepared');
END $$;

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
    "resultsSourceUrl"=p_evidence->>'sourceUrl',"bonusSourceUrl"=p_evidence->>'bonusSourceUrl' WHERE "raceId"=p_race_id AND category=p_category;
  INSERT INTO private.cx_change_log(operation,"raceId",category,before,after,evidence)
    VALUES('replace_results',p_race_id,p_category,previous,jsonb_build_object('status',p_status,'rows',p_rows),p_evidence);
  RETURN jsonb_build_object('raceId',p_race_id,'category',p_category,'rows',n,'status',p_status,'mode',mode);
END $$;

NOTIFY pgrst,'reload schema';

REVOKE ALL ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.cx_prepare_startlist_import(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_prepare_startlist_import(text,text,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb) TO authenticated,cc_results_worker;
