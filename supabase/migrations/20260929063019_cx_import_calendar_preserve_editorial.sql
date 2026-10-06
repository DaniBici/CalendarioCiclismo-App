-- Reimportar el calendario UCI ya no sobrescribe datos editoriales de carreras
-- existentes (fechas, clase, país, sede) ni recrea categorías borradas: las
-- discrepancias con UCI se devuelven en `differences` para revisión manual.
CREATE OR REPLACE FUNCTION public.cx_import_calendar(p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE item jsonb; cat jsonb; r public.cx_races; cur public.cx_races; rid text; season text; y integer;
  inserted integer:=0; existing integer:=0; category_count integer:=0;
  diffs jsonb:='[]'::jsonb; fields jsonb; missing jsonb;
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
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'categories') v GROUP BY v->>'category' HAVING count(*)>1) THEN
      RAISE EXCEPTION 'Categoría duplicada en ficha UCI' USING ERRCODE='22023';
    END IF;
    FOR cat IN SELECT value FROM jsonb_array_elements(item->'categories') LOOP
      IF (cat->>'dateKey')::date IS NULL OR (cat->>'dateKey')::date NOT BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey") THEN
        RAISE EXCEPTION 'Fecha de categoría fuera del programa UCI' USING ERRCODE='22023';
      END IF;
      category_count:=category_count+1;
    END LOOP;
    SELECT * INTO cur FROM public.cx_races WHERE "seasonKey"=season AND "uciCalendarId"=r."uciCalendarId" FOR UPDATE;
    IF cur.id IS NULL THEN
      INSERT INTO public.cx_races(name,slug,"seasonKey","seasonStartYear","dateKey","endDateKey",class,"countryCode",venue,"websiteUrl","uciCalendarId","calendarSourceUrl","calendarImportedAt")
        VALUES(r.name,r.slug,season,y,r."dateKey",r."endDateKey",r.class,r."countryCode",r.venue,r."websiteUrl",r."uciCalendarId",r."calendarSourceUrl",now()) RETURNING id INTO rid;
      INSERT INTO public.cx_race_categories("raceId",category,"dateKey","sortOrder")
        SELECT rid,v->>'category',(v->>'dateKey')::date,(v->>'sortOrder')::integer
        FROM jsonb_array_elements(item->'categories') v;
      inserted:=inserted+1;
    ELSE
      -- Carrera existente: los datos editoriales mandan. Solo se completa la web
      -- ausente y se anotan las discrepancias con UCI.
      UPDATE public.cx_races SET "websiteUrl"=coalesce("websiteUrl",r."websiteUrl"),"calendarImportedAt"=now()
        WHERE id=cur.id;
      existing:=existing+1;
      SELECT coalesce(jsonb_object_agg(f.k,jsonb_build_object('actual',f.cur_v,'uci',f.uci_v)),'{}'::jsonb) INTO fields
      FROM (VALUES
        ('dateKey',to_jsonb(cur."dateKey"),to_jsonb(r."dateKey")),
        ('endDateKey',to_jsonb(cur."endDateKey"),to_jsonb(r."endDateKey")),
        ('class',to_jsonb(cur.class),to_jsonb(r.class)),
        ('countryCode',to_jsonb(cur."countryCode"),to_jsonb(r."countryCode")),
        ('venue',to_jsonb(cur.venue),to_jsonb(r.venue))) f(k,cur_v,uci_v)
      WHERE f.cur_v IS DISTINCT FROM f.uci_v;
      SELECT coalesce(jsonb_agg(v->>'category' ORDER BY v->>'category'),'[]'::jsonb) INTO missing
      FROM jsonb_array_elements(item->'categories') v
      WHERE NOT EXISTS(SELECT 1 FROM public.cx_race_categories c WHERE c."raceId"=cur.id AND c.category=v->>'category');
      IF fields<>'{}'::jsonb OR missing<>'[]'::jsonb THEN
        diffs:=diffs||jsonb_build_object('raceId',cur.id,'name',cur.name,'fields',fields,'missingCategories',missing);
      END IF;
    END IF;
  END LOOP;
  IF category_count IS DISTINCT FROM (p_manifest#>>'{summary,categories}')::integer THEN
    RAISE EXCEPTION 'Recuento de categorías incompatible' USING ERRCODE='22023';
  END IF;
  INSERT INTO private.cx_change_log(operation,after,evidence) VALUES('calendar_import',
    jsonb_build_object('seasonKey',season,'inserted',inserted,'existing',existing,'categories',category_count,'differences',jsonb_array_length(diffs)),p_manifest);
  RETURN jsonb_build_object('seasonKey',season,'inserted',inserted,'existing',existing,'categories',category_count,'differences',diffs);
END $function$;
