-- Emisor de cada vídeo CX, como race_day_videos.channel en carretera: texto
-- visible de la fuente con el nombre del canal tal cual («Eurosport España»,
-- «UEC», «Sporza»). NULL: fuente sin identificar. cx_save_media lo guarda en la
-- rama 'videos'; vacío o solo espacios se guarda como NULL.
ALTER TABLE public.cx_videos ADD COLUMN channel text;

CREATE OR REPLACE FUNCTION public.cx_save_media(p_race_id text, p_kind text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      IF NOT payload ? 'embeddable' THEN
        SELECT x.embeddable INTO b.embeddable FROM public.cx_broadcasts x WHERE x.id=b.id AND x.url=b.url;
      END IF;
      INSERT INTO public.cx_broadcasts(id,"raceId",category,channel,"startTimeUtc",url,note,country,"sortOrder","showInRevive","isSporza",embeddable)
        VALUES(b.id,p_race_id,b.category,b.channel,b."startTimeUtc",b.url,b.note,b.country,n,coalesce(b."showInRevive",false),coalesce(b."isSporza",false),b.embeddable)
        ON CONFLICT(id) DO UPDATE SET category=excluded.category,channel=excluded.channel,"startTimeUtc"=excluded."startTimeUtc",url=excluded.url,note=excluded.note,country=excluded.country,"sortOrder"=excluded."sortOrder","showInRevive"=excluded."showInRevive","isSporza"=excluded."isSporza",embeddable=excluded.embeddable;
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
      INSERT INTO public.cx_videos(id,"raceId",category,title,"titleEn",channel,url,"sortOrder") VALUES(video.id,p_race_id,video.category,video.title,nullif(btrim(video."titleEn"),''),nullif(btrim(video.channel),''),video.url,n)
        ON CONFLICT(id) DO UPDATE SET category=excluded.category,title=excluded.title,"titleEn"=excluded."titleEn",channel=excluded.channel,url=excluded.url,"sortOrder"=excluded."sortOrder";
      n:=n+1;
    END LOOP;
  END IF;
  INSERT INTO private.cx_change_log(operation,"raceId",before,after) VALUES('save_'||p_kind,p_race_id,previous,p_rows);
  RETURN n;
END $function$;
