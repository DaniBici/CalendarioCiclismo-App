-- Registro privado de eventos CX; el emisor y su cola existentes son únicos.
CREATE TABLE private.cx_push_auto_dispatch (
  "raceId" text NOT NULL REFERENCES public.cx_races(id) ON DELETE CASCADE,
  category text NOT NULL CHECK(category IN ('ME','WE','MU','WU','MJ','WJ')),
  "eventType" text NOT NULL CHECK("eventType" IN ('start','results')),
  language text NOT NULL CHECK(language IN ('es','en')),
  "scheduledNotificationId" text UNIQUE REFERENCES public.scheduled_push_notifications(id) ON DELETE SET NULL,
  "sourceDigest" text NOT NULL,
  "validUntil" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY("raceId",category,"eventType",language)
);
ALTER TABLE private.cx_push_auto_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cx_push_auto_dispatch FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT SELECT ON TABLE private.cx_push_auto_dispatch TO authenticated,service_role;
CREATE POLICY cx_push_auto_admin_read ON private.cx_push_auto_dispatch FOR SELECT TO authenticated USING((select private.is_admin()));

-- Fechas UTC serializadas explícitamente: el digest no depende de TimeZone del rol.
CREATE FUNCTION private.cx_auto_push_source(p_race_id text,p_category text,p_event_type text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE
    WHEN p_event_type='start' AND c."startTimeUtc" IS NOT NULL AND c."durationMinutes" IS NOT NULL
      AND c."durationRuleVersion"='2026-07-01' AND c."scheduleSourceUrl" ~ '^https?://' THEN
      jsonb_build_object('sourceTimeUtc',to_char(c."startTimeUtc" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'format',c."durationFormat",'rule',c."durationRuleVersion",'programme',c."scheduleSourceUrl")
    WHEN p_event_type='results' AND c."resultsStatus"='official' AND c."resultsImportedAt" IS NOT NULL
      AND c."resultsSourceUrl" ~ '^https?://' AND EXISTS(SELECT 1 FROM public.cx_results x WHERE x."raceId"=r.id
        AND x.category=c.category AND x.rank=1 AND x.irm IS NULL) THEN
      jsonb_build_object('sourceTimeUtc',to_char(c."resultsImportedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'sourceUrl',c."resultsSourceUrl",'resultsDigest',(SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder",x.id),'[]')::text)
          FROM public.cx_results x WHERE x."raceId"=r.id AND x.category=c.category))
    ELSE NULL END || jsonb_build_object('raceId',r.id,'category',c.category,'eventType',p_event_type,
      'dateKey',coalesce(c."dateKey",r."dateKey"),'name',r.name,'nameEn',coalesce(nullif(btrim(r."nameEn"),''),r.name))
  FROM public.cx_races r JOIN public.cx_race_categories c ON c."raceId"=r.id AND c.category=p_category
  WHERE r.id=p_race_id AND r."editorialStatus"='published' AND NOT r."isCancelled" AND NOT c."isCancelled"
    AND r."dateKey">=make_date(r."seasonStartYear",8,1) AND coalesce(r."endDateKey",r."dateKey")<make_date(r."seasonStartYear"+1,3,1)
    AND extract(month FROM r."dateKey") IN(8,9,10,11,12,1,2)
    AND extract(month FROM coalesce(r."endDateKey",r."dateKey")) IN(8,9,10,11,12,1,2)
    AND coalesce(c."dateKey",r."dateKey") BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey")
    AND extract(month FROM coalesce(c."dateKey",r."dateKey")) IN(8,9,10,11,12,1,2);
$$;
REVOKE ALL ON FUNCTION private.cx_auto_push_source(text,text,text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION private.cx_auto_push_source(text,text,text) TO service_role;

CREATE FUNCTION private.cx_enqueue_automatic_pushes(p_now timestamptz DEFAULT now(),p_race_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text:=coalesce(nullif(nullif(current_setting('role',true),'none'),''),session_user);
  rec record; lang text; payload jsonb; digest text; existing private.cx_push_auto_dispatch; queue_status text;
  notification_id text; deadline timestamptz; scheduled_for timestamptz; source_time timestamptz;
  v_title text; v_subtitle text; found_count integer:=0; scheduled_count integer:=0; updated_count integer:=0; cancelled_count integer:=0;
BEGIN
  IF actor<>'cc_results_worker' THEN RAISE EXCEPTION 'Worker CX no autorizado' USING ERRCODE='42501'; END IF;
  IF p_now IS NULL OR NOT isfinite(p_now) THEN RAISE EXCEPTION 'Fecha inválida' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cc-cx-push-auto'));
  -- Retirar solo avisos automáticos pendientes. No modificar avisos manuales ni procesados.
  FOR rec IN SELECT d.*,n.status FROM private.cx_push_auto_dispatch d JOIN public.scheduled_push_notifications n ON n.id=d."scheduledNotificationId"
    WHERE n.status='pending' AND n."createdBy"='cx_auto_dispatch' AND (p_race_id IS NULL OR d."raceId"=p_race_id) LOOP
    payload:=private.cx_auto_push_source(rec."raceId",rec.category,rec."eventType");
    source_time:=(payload->>'sourceTimeUtc')::timestamptz;
    IF payload IS NULL OR (CASE WHEN rec."eventType"='start' THEN source_time ELSE source_time+interval '12 hours' END)<=p_now THEN
      UPDATE public.scheduled_push_notifications SET status='cancelled',"errorMessage"='Evento CX vencido o retirado'
        WHERE id=rec."scheduledNotificationId" AND status='pending';
      IF FOUND THEN cancelled_count:=cancelled_count+1; END IF;
    END IF;
  END LOOP;
  FOR rec IN SELECT r.id AS race_id,c.category,k.kind FROM public.cx_races r JOIN public.cx_race_categories c ON c."raceId"=r.id
    CROSS JOIN (VALUES('start'),('results')) k(kind)
    WHERE (p_race_id IS NULL OR r.id=p_race_id) AND r."editorialStatus"='published' AND NOT r."isCancelled" AND NOT c."isCancelled"
      AND r."dateKey">=make_date(r."seasonStartYear",8,1) AND coalesce(r."endDateKey",r."dateKey")<make_date(r."seasonStartYear"+1,3,1)
      AND extract(month FROM coalesce(c."dateKey",r."dateKey")) IN(8,9,10,11,12,1,2)
      AND coalesce(c."dateKey",r."dateKey") BETWEEN r."dateKey" AND coalesce(r."endDateKey",r."dateKey")
      AND ((k.kind='start' AND c."startTimeUtc">p_now AND c."startTimeUtc"<=p_now+interval '48 hours')
        OR (k.kind='results' AND c."resultsImportedAt" BETWEEN p_now-interval '12 hours' AND p_now
          AND coalesce(c."dateKey",r."dateKey") BETWEEN (p_now AT TIME ZONE 'Europe/Madrid')::date-1 AND (p_now AT TIME ZONE 'Europe/Madrid')::date))
    ORDER BY r.id,c.category,k.kind LOOP
    payload:=private.cx_auto_push_source(rec.race_id,rec.category,rec.kind);
    IF payload IS NULL THEN CONTINUE; END IF;
    digest:=md5(payload::text);source_time:=(payload->>'sourceTimeUtc')::timestamptz;
    deadline:=CASE WHEN rec.kind='start' THEN source_time ELSE source_time+interval '12 hours' END;
    scheduled_for:=CASE WHEN rec.kind='start' THEN greatest(source_time-interval '30 minutes',p_now) ELSE p_now END;
    FOREACH lang IN ARRAY ARRAY['es','en'] LOOP
      found_count:=found_count+1;
      v_title:=CASE WHEN lang='es' THEN payload->>'name' ELSE payload->>'nameEn' END||' · '||rec.category;
      v_subtitle:=CASE WHEN rec.kind='start' THEN CASE WHEN lang='es' THEN 'Salida próxima' ELSE 'Starting soon' END
        ELSE CASE WHEN lang='es' THEN 'Resultados oficiales disponibles' ELSE 'Official results available' END END;
      SELECT * INTO existing FROM private.cx_push_auto_dispatch WHERE "raceId"=rec.race_id AND category=rec.category AND "eventType"=rec.kind AND language=lang;
      IF FOUND THEN
        SELECT status INTO queue_status FROM public.scheduled_push_notifications WHERE id=existing."scheduledNotificationId";
        -- Una cancelación administrativa, fallo o envío previo conserva prioridad. No rearmar ni reenviar.
        IF queue_status IS DISTINCT FROM 'pending' THEN CONTINUE; END IF;
        IF existing."sourceDigest"=digest THEN CONTINUE; END IF;
        UPDATE public.scheduled_push_notifications SET title=v_title,subtitle=v_subtitle,"scheduledAt"=scheduled_for
          WHERE id=existing."scheduledNotificationId" AND status='pending' AND "createdBy"='cx_auto_dispatch';
        IF NOT FOUND THEN CONTINUE; END IF;
        UPDATE private.cx_push_auto_dispatch SET "sourceDigest"=digest,"validUntil"=deadline,"updatedAt"=p_now
          WHERE "raceId"=rec.race_id AND category=rec.category AND "eventType"=rec.kind AND language=lang;
        updated_count:=updated_count+1;
      ELSE
        notification_id:=gen_random_uuid()::text;
        INSERT INTO public.scheduled_push_notifications(id,title,subtitle,"deepLink","cxRaceId",category,"targetLanguages","scheduledAt",status,"createdBy")
          VALUES(notification_id,v_title,v_subtitle,'cxRace/'||rec.race_id||'#'||rec.category,rec.race_id,'cyclocross',ARRAY[lang],scheduled_for,'pending','cx_auto_dispatch');
        INSERT INTO private.cx_push_auto_dispatch("raceId",category,"eventType",language,"scheduledNotificationId","sourceDigest","validUntil")
          VALUES(rec.race_id,rec.category,rec.kind,lang,notification_id,digest,deadline);
        scheduled_count:=scheduled_count+1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('found',found_count,'scheduled',scheduled_count,'updated',updated_count,'cancelled',cancelled_count);
END $$;
REVOKE ALL ON FUNCTION private.cx_enqueue_automatic_pushes(timestamptz,text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION private.cx_enqueue_automatic_pushes(timestamptz,text) TO cc_results_worker;

-- Fachada del único emisor: revalidación de la manga, fuente, idioma y caducidad justo antes de enviar.
CREATE FUNCTION public.cx_auto_push_is_available(p_notification_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM private.cx_push_auto_dispatch d JOIN public.scheduled_push_notifications n ON n.id=d."scheduledNotificationId"
    WHERE n.id=p_notification_id AND n."createdBy"='cx_auto_dispatch' AND n.status IN('pending','processing')
      AND n."cxRaceId"=d."raceId" AND n."raceId" IS NULL AND n."raceDayId" IS NULL AND n.category='cyclocross'
      AND n."deepLink"='cxRace/'||d."raceId"||'#'||d.category AND n."targetLanguages"=ARRAY[d.language]
      AND n."scheduledAt"<=now() AND d."validUntil">now()
      AND (d."eventType"<>'start' OR (private.cx_auto_push_source(d."raceId",d.category,d."eventType")->>'sourceTimeUtc')::timestamptz<=now()+interval '30 minutes')
      AND d."sourceDigest"=md5(private.cx_auto_push_source(d."raceId",d.category,d."eventType")::text));
$$;
REVOKE ALL ON FUNCTION public.cx_auto_push_is_available(text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_auto_push_is_available(text) TO service_role;
NOTIFY pgrst,'reload schema';
