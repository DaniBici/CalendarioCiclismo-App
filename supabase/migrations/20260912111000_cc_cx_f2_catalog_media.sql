-- CRUD atómico de enlaces, reglamento versionado y eliminación de fichas CX.
CREATE FUNCTION public.cx_save_media(p_race_id text,p_kind text,p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE payload jsonb; b public.cx_broadcasts; video public.cx_videos; previous jsonb; n integer:=0;
BEGIN
  PERFORM public.cx_require_admin();
  PERFORM 1 FROM public.cx_races WHERE id=p_race_id FOR UPDATE;
  IF NOT FOUND OR p_kind IS NULL OR p_kind NOT IN ('broadcasts','videos') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Carrera o enlaces inválidos' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) item GROUP BY item->>'id' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) item WHERE item->>'id' IS NULL OR coalesce(item->>'url','') !~ '^https?://') THEN
    RAISE EXCEPTION 'Enlace sin ID, duplicado o URL inválida' USING ERRCODE='22023';
  END IF;
  IF p_kind='broadcasts' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY "sortOrder"),'[]') INTO previous FROM public.cx_broadcasts x WHERE "raceId"=p_race_id;
    IF EXISTS(SELECT 1 FROM public.cx_broadcasts x JOIN jsonb_array_elements(p_rows) item ON item->>'id'=x.id WHERE x."raceId"<>p_race_id) THEN
      RAISE EXCEPTION 'Enlace perteneciente a otra carrera' USING ERRCODE='22023';
    END IF;
    DELETE FROM public.cx_broadcasts x WHERE "raceId"=p_race_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) item WHERE item->>'id'=x.id);
    FOR payload IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      b:=jsonb_populate_record(NULL::public.cx_broadcasts,payload);
      INSERT INTO public.cx_broadcasts(id,"raceId",category,channel,"startTimeUtc",url,note,country,"sortOrder","showInRevive","isSporza")
        VALUES(b.id,p_race_id,b.category,b.channel,b."startTimeUtc",b.url,b.note,b.country,n,coalesce(b."showInRevive",false),coalesce(b."isSporza",false))
        ON CONFLICT(id) DO UPDATE SET category=excluded.category,channel=excluded.channel,"startTimeUtc"=excluded."startTimeUtc",url=excluded.url,note=excluded.note,country=excluded.country,"sortOrder"=excluded."sortOrder","showInRevive"=excluded."showInRevive","isSporza"=excluded."isSporza";
      n:=n+1;
    END LOOP;
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY "sortOrder"),'[]') INTO previous FROM public.cx_videos x WHERE "raceId"=p_race_id;
    IF EXISTS(SELECT 1 FROM public.cx_videos x JOIN jsonb_array_elements(p_rows) item ON item->>'id'=x.id WHERE x."raceId"<>p_race_id) THEN
      RAISE EXCEPTION 'Vídeo perteneciente a otra carrera' USING ERRCODE='22023';
    END IF;
    DELETE FROM public.cx_videos x WHERE "raceId"=p_race_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) item WHERE item->>'id'=x.id);
    FOR payload IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      video:=jsonb_populate_record(NULL::public.cx_videos,payload);
      INSERT INTO public.cx_videos(id,"raceId",category,title,url,"sortOrder") VALUES(video.id,p_race_id,video.category,video.title,video.url,n)
        ON CONFLICT(id) DO UPDATE SET category=excluded.category,title=excluded.title,url=excluded.url,"sortOrder"=excluded."sortOrder";
      n:=n+1;
    END LOOP;
  END IF;
  INSERT INTO private.cx_change_log(operation,"raceId",before,after) VALUES('save_'||p_kind,p_race_id,previous,p_rows);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.cx_save_media(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_save_media(text,text,jsonb) TO authenticated;

CREATE FUNCTION public.cx_save_tournament(p_tournament jsonb) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.cx_tournaments; item record; scheme jsonb; previous jsonb;
BEGIN
  PERFORM public.cx_require_admin();
  t:=jsonb_populate_record(NULL::public.cx_tournaments,p_tournament);
  t.id:=coalesce(t.id,gen_random_uuid()::text);
  scheme:=t."pointsScheme";
  IF jsonb_typeof(scheme) IS DISTINCT FROM 'object' OR jsonb_typeof(scheme->'categories') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'El reglamento debe definir categorías' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT * FROM jsonb_each(scheme->'categories') LOOP
    IF item.key NOT IN ('ME','WE','MU','WU','MJ','WJ') OR coalesce(item.value->>'mode','') NOT IN ('points','time') THEN
      RAISE EXCEPTION 'Modalidad/categoría inválida: %',item.key USING ERRCODE='22023';
    END IF;
    IF item.value->>'mode'='points' THEN
      IF jsonb_typeof(item.value->'perRank') IS DISTINCT FROM 'array' OR jsonb_array_length(item.value->'perRank')=0
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(item.value->'perRank') p WHERE jsonb_typeof(p)<>'number') THEN
        RAISE EXCEPTION 'Faltan puntos por puesto: %',item.key USING ERRCODE='22023';
      END IF;
    ELSIF item.value ? 'perRank' THEN
      RAISE EXCEPTION 'La general por tiempo no admite puntos por puesto' USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT to_jsonb(x) INTO previous FROM public.cx_tournaments x WHERE id=t.id FOR UPDATE;
  INSERT INTO public.cx_tournaments(id,name,"nameEn",slug,"seasonKey","colorHex","logoUrl",translations,"pointsScheme")
    VALUES(t.id,t.name,t."nameEn",t.slug,t."seasonKey",t."colorHex",t."logoUrl",coalesce(t.translations,'{}'),scheme)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,"nameEn"=excluded."nameEn",slug=excluded.slug,"seasonKey"=excluded."seasonKey","colorHex"=excluded."colorHex","logoUrl"=excluded."logoUrl",translations=excluded.translations,"pointsScheme"=excluded."pointsScheme","updatedAt"=now();
  IF previous IS NOT NULL AND previous->'pointsScheme' IS DISTINCT FROM scheme THEN
    DELETE FROM public.cx_tournament_standings WHERE "tournamentId"=t.id AND source='computed';
  END IF;
  INSERT INTO private.cx_change_log(operation,before,after) VALUES('save_tournament',previous,p_tournament);
  RETURN t.id;
END $$;
REVOKE ALL ON FUNCTION public.cx_save_tournament(jsonb) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_save_tournament(jsonb) TO authenticated;

CREATE FUNCTION public.cx_delete_rider(p_id text,p_gender text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous jsonb; prefix text;
BEGIN
  PERFORM public.cx_require_admin();
  IF p_gender IS NULL OR p_gender NOT IN ('men','women') THEN RAISE EXCEPTION 'Género inválido' USING ERRCODE='22023'; END IF;
  prefix:=CASE p_gender WHEN 'men' THEN 'M' ELSE 'W' END;
  IF p_gender='men' THEN SELECT to_jsonb(x) INTO previous FROM public.cx_riders_men x WHERE id=p_id FOR UPDATE;
  ELSE SELECT to_jsonb(x) INTO previous FROM public.cx_riders_women x WHERE id=p_id FOR UPDATE; END IF;
  IF previous IS NULL THEN RAISE EXCEPTION 'Ficha inexistente' USING ERRCODE='22023'; END IF;
  UPDATE public.cx_startlist_riders SET "globalRiderId"=NULL WHERE "globalRiderId"=p_id AND left(category,1)=prefix;
  UPDATE public.cx_results SET "globalRiderId"=NULL WHERE "globalRiderId"=p_id AND left(category,1)=prefix;
  UPDATE public.cx_tournament_standings SET "globalRiderId"=NULL WHERE "globalRiderId"=p_id AND left(category,1)=prefix;
  IF p_gender='men' THEN DELETE FROM public.cx_riders_men WHERE id=p_id; ELSE DELETE FROM public.cx_riders_women WHERE id=p_id; END IF;
  INSERT INTO private.cx_change_log(operation,before,evidence) VALUES('delete_rider',previous,jsonb_build_object('gender',p_gender));
END $$;
REVOKE ALL ON FUNCTION public.cx_delete_rider(text,text) FROM PUBLIC,anon,authenticated,service_role,cc_results_worker;
GRANT EXECUTE ON FUNCTION public.cx_delete_rider(text,text) TO authenticated;

NOTIFY pgrst,'reload schema';
