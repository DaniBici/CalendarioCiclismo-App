-- CC-CX F2: identificador del calendario web independiente de DataRide,
-- guardado atómico, listas planas preparadas y evidencia de resultados.
ALTER TABLE public.cx_races
  ADD COLUMN "uciCalendarId" integer CHECK ("uciCalendarId" > 0),
  ADD COLUMN "calendarSourceUrl" text CHECK ("calendarSourceUrl" ~ '^https://www\.uci\.org/competition-details/[0-9]{4}/CRO/[0-9]+$'),
  ADD COLUMN "calendarImportedAt" timestamptz,
  ADD COLUMN "updatedAt" timestamptz NOT NULL DEFAULT now(),
  ADD UNIQUE ("seasonKey","uciCalendarId");
ALTER TABLE public.cx_race_categories
  ADD COLUMN "resultsSourceUrl" text,
  ADD COLUMN "bonusSourceUrl" text;
GRANT UPDATE ("resultsSourceUrl","bonusSourceUrl") ON public.cx_race_categories TO cc_results_worker;

CREATE TABLE private.cx_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "actorId" uuid DEFAULT auth.uid(),
  "actorRole" text NOT NULL DEFAULT current_user,
  operation text NOT NULL,
  "raceId" text,
  category text,
  before jsonb,
  after jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX cx_change_log_race_idx ON private.cx_change_log("raceId",category,"createdAt");
CREATE TABLE private.cx_startlist_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "raceId" text NOT NULL REFERENCES public.cx_races(id) ON DELETE CASCADE,
  category text NOT NULL,
  document jsonb NOT NULL,
  "expectedSnapshot" text NOT NULL,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','applied')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "appliedAt" timestamptz,
  "createdBy" uuid DEFAULT auth.uid(),
  FOREIGN KEY ("raceId",category) REFERENCES public.cx_race_categories("raceId",category) ON DELETE CASCADE
);
CREATE INDEX cx_startlist_imports_category_idx ON private.cx_startlist_imports("raceId",category,"createdAt");
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cx_change_log','cx_startlist_imports'] LOOP
    EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role,cc_results_worker',t);
    EXECUTE format('GRANT SELECT,INSERT ON private.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY cx_admin_read ON private.%I FOR SELECT TO authenticated USING ((select private.is_admin()))',t);
    EXECUTE format('CREATE POLICY cx_admin_insert ON private.%I FOR INSERT TO authenticated WITH CHECK ((select private.is_admin()))',t);
  END LOOP;
END $$;
GRANT UPDATE (status,"appliedAt") ON private.cx_startlist_imports TO authenticated;
CREATE POLICY cx_admin_update ON private.cx_startlist_imports FOR UPDATE TO authenticated
  USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));
GRANT INSERT ON private.cx_change_log TO cc_results_worker;
CREATE POLICY cx_worker_insert ON private.cx_change_log FOR INSERT TO cc_results_worker WITH CHECK (true);

CREATE FUNCTION public.cx_require_admin() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user <> 'postgres' AND NOT (select private.is_admin()) THEN
    RAISE EXCEPTION 'Se requiere administración CC-CX' USING ERRCODE='42501';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.cx_require_admin() FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_require_admin() TO authenticated;

CREATE FUNCTION public.cx_import_calendar(p_manifest jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; cat jsonb; r public.cx_races; rid text; season text; y integer;
  inserted integer:=0; updated integer:=0; category_count integer:=0;
BEGIN
  PERFORM public.cx_require_admin();
  season:=p_manifest->>'seasonKey';
  y:=left(season,4)::integer;
  IF p_manifest->>'source' IS DISTINCT FROM 'uci_web_calendar' OR p_manifest->>'version' IS DISTINCT FROM '1'
    OR season IS NULL OR season !~ '^[0-9]{4}-[0-9]{2}$'
    OR right(season,2)::integer<>(y+1)%100
    OR jsonb_typeof(p_manifest->'races') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_manifest->'races')=0
    OR (p_manifest#>>'{summary,races}')::integer IS DISTINCT FROM jsonb_array_length(p_manifest->'races') THEN
    RAISE EXCEPTION 'Manifiesto UCI incompleto o inválido' USING ERRCODE='22023';
  END IF;
  -- Serializa importaciones de temporada y evita duplicar identificadores.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cx-calendar:'||season,0));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'races') v
    GROUP BY v#>>'{race,uciCalendarId}' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'ID de calendario duplicado' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_manifest->'races') LOOP
    r:=jsonb_populate_record(NULL::public.cx_races,item->'race');
    IF r."uciCalendarId" IS NULL OR r."seasonKey" IS DISTINCT FROM season OR r."seasonStartYear" IS DISTINCT FROM y
      OR r."calendarSourceUrl" IS DISTINCT FROM 'https://www.uci.org/competition-details/'||(y+1)::text||'/CRO/'||r."uciCalendarId"::text
      OR r."dateKey" IS NULL OR r."dateKey"<make_date(y,8,1) OR coalesce(r."endDateKey",r."dateKey")>make_date(y+1,7,31)
      OR jsonb_typeof(item->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'categories')=0 THEN
      RAISE EXCEPTION 'Ficha UCI inválida: %',item#>>'{race,name}' USING ERRCODE='22023';
    END IF;
    SELECT id INTO rid FROM public.cx_races WHERE "seasonKey"=season AND "uciCalendarId"=r."uciCalendarId" FOR UPDATE;
    IF rid IS NULL THEN
      INSERT INTO public.cx_races(name,slug,"seasonKey","seasonStartYear","dateKey","endDateKey",class,"countryCode",venue,"websiteUrl","uciCalendarId","calendarSourceUrl","calendarImportedAt")
        VALUES(r.name,r.slug,season,y,r."dateKey",r."endDateKey",r.class,r."countryCode",r.venue,r."websiteUrl",r."uciCalendarId",r."calendarSourceUrl",now()) RETURNING id INTO rid;
      inserted:=inserted+1;
    ELSE
      -- Reimportar conserva identidad editorial, slug, torneo, horarios y cancelación.
      UPDATE public.cx_races SET "dateKey"=r."dateKey","endDateKey"=r."endDateKey",class=r.class,
        "countryCode"=r."countryCode",venue=r.venue,"websiteUrl"=coalesce("websiteUrl",r."websiteUrl"),
        "calendarImportedAt"=now(),"updatedAt"=now() WHERE id=rid;
      updated:=updated+1;
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'categories') v GROUP BY v->>'category' HAVING count(*)>1) THEN
      RAISE EXCEPTION 'Categoría duplicada en ficha UCI' USING ERRCODE='22023';
    END IF;
    FOR cat IN SELECT value FROM jsonb_array_elements(item->'categories') LOOP
      IF (cat->>'dateKey')::date IS NULL OR (cat->>'dateKey')::date NOT BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey") THEN
        RAISE EXCEPTION 'Fecha de categoría fuera del programa UCI' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.cx_race_categories("raceId",category,"dateKey","sortOrder")
        VALUES(rid,cat->>'category',(cat->>'dateKey')::date,(cat->>'sortOrder')::integer)
        ON CONFLICT ("raceId",category) DO UPDATE SET
          "dateKey"=CASE WHEN cx_race_categories."startTimeUtc" IS NULL THEN excluded."dateKey" ELSE cx_race_categories."dateKey" END;
      category_count:=category_count+1;
    END LOOP;
  END LOOP;
  IF category_count IS DISTINCT FROM (p_manifest#>>'{summary,categories}')::integer THEN
    RAISE EXCEPTION 'Recuento de categorías incompatible' USING ERRCODE='22023';
  END IF;
  INSERT INTO private.cx_change_log(operation,after,evidence) VALUES('calendar_import',
    jsonb_build_object('seasonKey',season,'inserted',inserted,'updated',updated,'categories',category_count),p_manifest);
  RETURN jsonb_build_object('seasonKey',season,'inserted',inserted,'updated',updated,'categories',category_count);
END $$;
REVOKE ALL ON FUNCTION public.cx_import_calendar(jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_import_calendar(jsonb) TO authenticated;

CREATE FUNCTION public.cx_save_race(p_race jsonb,p_categories jsonb,p_allow_category_removal boolean DEFAULT false) RETURNS text
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
REVOKE ALL ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_save_race(jsonb,jsonb,boolean) TO authenticated;

CREATE FUNCTION public.cx_prepare_startlist_import(p_race_id text,p_category text,p_document jsonb) RETURNS jsonb
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
REVOKE ALL ON FUNCTION public.cx_prepare_startlist_import(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_prepare_startlist_import(text,text,jsonb) TO authenticated;

CREATE FUNCTION public.cx_get_startlist_import(p_import_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; BEGIN
  PERFORM public.cx_require_admin();
  SELECT to_jsonb(x) INTO result FROM private.cx_startlist_imports x WHERE id=p_import_id;
  IF result IS NULL THEN RAISE EXCEPTION 'Importación inexistente' USING ERRCODE='22023'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cx_get_startlist_import(uuid) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_get_startlist_import(uuid) TO authenticated;

CREATE FUNCTION public.cx_apply_startlist_import(p_import_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE imp private.cx_startlist_imports; snapshot text; previous jsonb;
BEGIN
  PERFORM public.cx_require_admin();
  SELECT * INTO STRICT imp FROM private.cx_startlist_imports WHERE id=p_import_id FOR UPDATE;
  IF imp.status='applied' THEN RETURN jsonb_build_object('importId',imp.id,'status','applied','rows',jsonb_array_length(imp.document->'rows')); END IF;
  PERFORM 1 FROM public.cx_race_categories WHERE "raceId"=imp."raceId" AND category=imp.category FOR UPDATE;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder",x.id),'[]') INTO previous
    FROM public.cx_startlist_riders x WHERE "raceId"=imp."raceId" AND category=imp.category;
  snapshot:=md5(previous::text);
  IF snapshot<>imp."expectedSnapshot" THEN RAISE EXCEPTION 'Los inscritos cambiaron tras preparar; preparar de nuevo' USING ERRCODE='40001'; END IF;
  -- Las fichas/equipos pudieron cambiar desde la preparación: se valida de nuevo.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(imp.document->'rows') v WHERE v->>'globalRiderId' IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.cx_riders_men WHERE left(imp.category,1)='M' AND id=v->>'globalRiderId'
      UNION ALL SELECT 1 FROM public.cx_riders_women WHERE left(imp.category,1)='W' AND id=v->>'globalRiderId')) THEN
    RAISE EXCEPTION 'Una ficha CX ya no existe; preparar de nuevo' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.cx_startlist_riders WHERE "raceId"=imp."raceId" AND category=imp.category;
  INSERT INTO public.cx_startlist_riders("raceId",category,bib,"firstName","lastName","countryCode","globalRiderId","teamId","sortOrder")
    SELECT imp."raceId",imp.category,x.bib,x."firstName",x."lastName",x."countryCode",x."globalRiderId",x."teamId",x."sortOrder"
    FROM jsonb_populate_recordset(NULL::public.cx_startlist_riders,imp.document->'rows') x;
  UPDATE public.cx_race_categories SET "startlistImportedAt"=now() WHERE "raceId"=imp."raceId" AND category=imp.category;
  UPDATE private.cx_startlist_imports SET status='applied',"appliedAt"=now() WHERE id=imp.id;
  INSERT INTO private.cx_change_log(operation,"raceId",category,before,after,evidence)
    VALUES('startlist_import',imp."raceId",imp.category,previous,imp.document->'rows',imp.document-'rows'||jsonb_build_object('importId',imp.id));
  RETURN jsonb_build_object('importId',imp.id,'status','applied','rows',jsonb_array_length(imp.document->'rows'));
END $$;
REVOKE ALL ON FUNCTION public.cx_apply_startlist_import(uuid) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_apply_startlist_import(uuid) TO authenticated;

CREATE FUNCTION public.cx_replace_results(p_race_id text,p_category text,p_rows jsonb,p_status text,p_evidence jsonb) RETURNS jsonb
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
REVOKE ALL ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_replace_results(text,text,jsonb,text,jsonb) TO authenticated,cc_results_worker;

NOTIFY pgrst,'reload schema';
