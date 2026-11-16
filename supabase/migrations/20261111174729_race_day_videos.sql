-- Vídeos por jornada de carretera (docs/plans/videos-5-2.md, fase 1), análogos a
-- cx_videos: YouTube u otras plataformas https. kind fija el tipo y el orden de
-- presentación (emisión completa, resumen, último kilómetro y el resto); el
-- orden dentro de cada tipo es sortOrder. embeddable sigue el criterio de
-- broadcasts (oEmbed: 200 → true; 401/404 → false; resto NULL) y country los
-- grupos regionales de broadcasts.country (NULL o ALL: sin restricción).
-- Escritura con save_race_day_videos (lista completa por jornada, como
-- cx_save_media) y auditoría en private.race_day_video_log. Lista de la sección
-- Vídeos con video_feed_days, de solo lectura.
CREATE TABLE public.race_day_videos (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "raceDayId" text NOT NULL REFERENCES public.race_days(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('full','summary','last_km','other')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  "titleEn" text,
  channel text,
  url text NOT NULL CHECK (url ~ '^https://'),
  embeddable boolean,
  country text CHECK (country IS NULL OR country = ANY (ARRAY['ALL','ES','EUROPA','PT','FR','BE','NL','IT','DE_AT_CH','UK_IE','SCANDI','EE','LATAM','NORTEAM','ASIAPAC','AFRICA','MENA'])),
  "sortOrder" integer NOT NULL DEFAULT 0,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX race_day_videos_day_order ON public.race_day_videos ("raceDayId", "sortOrder");

ALTER TABLE public.race_day_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY race_day_videos_read ON public.race_day_videos
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY race_day_videos_admin ON public.race_day_videos
  FOR ALL TO authenticated USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));
GRANT SELECT ON public.race_day_videos TO anon, authenticated, cc_agent, cc_publicador;
GRANT INSERT, UPDATE, DELETE ON public.race_day_videos TO authenticated, cc_agent;

CREATE TABLE private.race_day_video_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  "actorId" uuid DEFAULT auth.uid(),
  "actorRole" text NOT NULL DEFAULT CURRENT_USER,
  operation text NOT NULL,
  "raceDayId" text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX race_day_video_log_day ON private.race_day_video_log ("raceDayId", at);
ALTER TABLE private.race_day_video_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY race_day_video_log_insert ON private.race_day_video_log
  FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_admin()));
CREATE POLICY race_day_video_log_read ON private.race_day_video_log
  FOR SELECT TO authenticated USING ((SELECT private.is_admin()));
GRANT SELECT, INSERT ON private.race_day_video_log TO authenticated, cc_agent;

-- Lista completa deseada de la jornada: borra lo ausente, fija sortOrder por el
-- orden del array y devuelve el número de filas. YouTube se guarda en la forma
-- canónica https://www.youtube.com/watch?v=<ID> (youtu.be, /shorts/, /live/,
-- /embed/ y m.youtube.com). Sin la clave embeddable, conserva el valor de la
-- fila con el mismo id y la misma URL.
CREATE FUNCTION public.save_race_day_videos(p_race_day_id text, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  payload jsonb;
  v public.race_day_videos;
  previous jsonb;
  stored jsonb;
  canonical text;
  yt text;
  seen text[] := '{}';
  n integer := 0;
BEGIN
  IF current_user <> 'postgres' AND NOT (SELECT private.is_admin()) THEN
    RAISE EXCEPTION 'Se requiere administración' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.race_days WHERE id = p_race_day_id FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Jornada o lista de vídeos inválida' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) item
              WHERE jsonb_typeof(item) IS DISTINCT FROM 'object' OR nullif(btrim(item->>'id'), '') IS NULL)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) item GROUP BY item->>'id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Vídeo sin ID o con ID duplicado' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) item
              WHERE coalesce(item->>'url', '') !~ '^https://'
                 OR coalesce(item->>'kind', '') NOT IN ('full','summary','last_km','other')
                 OR nullif(btrim(coalesce(item->>'title', '')), '') IS NULL
                 OR (item->>'country' IS NOT NULL AND item->>'country' NOT IN ('ALL','ES','EUROPA','PT','FR','BE','NL','IT','DE_AT_CH','UK_IE','SCANDI','EE','LATAM','NORTEAM','ASIAPAC','AFRICA','MENA'))) THEN
    RAISE EXCEPTION 'Vídeo con URL no https, tipo desconocido, sin título o país inválido' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.race_day_videos x JOIN jsonb_array_elements(p_rows) item ON item->>'id' = x.id
              WHERE x."raceDayId" <> p_race_day_id) THEN
    RAISE EXCEPTION 'Vídeo perteneciente a otra jornada' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder"), '[]') INTO previous
    FROM public.race_day_videos x WHERE x."raceDayId" = p_race_day_id;
  DELETE FROM public.race_day_videos x
   WHERE x."raceDayId" = p_race_day_id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) item WHERE item->>'id' = x.id);

  FOR payload IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v := jsonb_populate_record(NULL::public.race_day_videos, payload);
    canonical := btrim(v.url);
    yt := coalesce(
      (regexp_match(canonical, '^https://(?:(?:www|m)\.)?youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|live/|embed/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])'))[1],
      (regexp_match(canonical, '^https://youtu\.be/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])'))[1]);
    IF yt IS NOT NULL THEN
      canonical := 'https://www.youtube.com/watch?v=' || yt;
    END IF;
    IF canonical = ANY (seen) THEN
      RAISE EXCEPTION 'Vídeo repetido en la jornada: %', canonical USING ERRCODE = '22023';
    END IF;
    seen := seen || canonical;
    IF NOT payload ? 'embeddable' THEN
      SELECT x.embeddable INTO v.embeddable FROM public.race_day_videos x WHERE x.id = v.id AND x.url = canonical;
    END IF;
    INSERT INTO public.race_day_videos (id, "raceDayId", kind, title, "titleEn", channel, url, embeddable, country, "sortOrder", "updatedAt")
      VALUES (v.id, p_race_day_id, v.kind, btrim(v.title), nullif(btrim(v."titleEn"), ''), nullif(btrim(v.channel), ''),
              canonical, v.embeddable, v.country, n, now())
      ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, title = excluded.title, "titleEn" = excluded."titleEn",
        channel = excluded.channel, url = excluded.url, embeddable = excluded.embeddable, country = excluded.country,
        "sortOrder" = excluded."sortOrder", "updatedAt" = excluded."updatedAt";
    n := n + 1;
  END LOOP;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."sortOrder"), '[]') INTO stored
    FROM public.race_day_videos x WHERE x."raceDayId" = p_race_day_id;
  INSERT INTO private.race_day_video_log (operation, "raceDayId", before, after)
    VALUES ('save_race_day_videos', p_race_day_id, previous, stored);
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.save_race_day_videos(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_race_day_videos(text, jsonb) TO authenticated, cc_agent;

-- Jornadas de la sección Vídeos: publicadas en [p_from, p_to] con filas en
-- race_day_videos o con emisiones candidatas a «Emisión de la etapa/carrera»
-- (YouTube con vídeo fijo y embeddable distinto de false) y clasificaciones
-- propias (race_uci_stages con keepForWeb y filas: las de la jornada o, sin
-- jornada enlazada, las de su número de etapa, como buildInhouseResultsMatcher
-- de js/services/races.js). Cada elemento lleva la jornada, su carrera, sus
-- vídeos y sus emisiones candidatas, con country para el filtro regional que
-- aplica cada cliente. Con p_from NULL, solo el último día con contenido hasta
-- p_to (ancla de la ventana).
CREATE FUNCTION public.video_feed_days(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH dias AS (
    SELECT d.id, d."raceId", d."dateKey", d."stageNumber"
      FROM public.race_days d
     WHERE d."editorialStatus" = 'published'
       AND (p_to IS NULL OR d."dateKey" <= to_char(p_to, 'YYYY-MM-DD'))
       AND (p_from IS NULL OR d."dateKey" >= to_char(p_from, 'YYYY-MM-DD'))
  ), emisiones AS (
    SELECT b.*
      FROM public.broadcasts b
      JOIN dias d ON d.id = b."raceDayId"
     WHERE b.embeddable IS DISTINCT FROM false
       AND ((b.url ~* '^https?://([a-z0-9-]+\.)*youtube\.com/'
             AND (b.url ~ '[?&]v=[A-Za-z0-9_-]{11}' OR b.url ~ 'youtube\.com/(live|embed|shorts)/[A-Za-z0-9_-]{11}'))
            OR b.url ~* '^https?://youtu\.be/[A-Za-z0-9_-]{11}')
  ), candidatas AS (
    SELECT DISTINCT e."raceDayId" AS id FROM emisiones e
  ), enlazadas AS (
    SELECT DISTINCT u."raceDayId" AS id
      FROM public.race_uci_stages u
     WHERE u."keepForWeb" AND u."rowCount" > 0 AND u."raceDayId" IS NOT NULL
  ), legado AS (
    SELECT u."raceId", coalesce(u."stageNumber", -1) AS etapa
      FROM public.race_uci_stages u
     WHERE u."keepForWeb" AND u."rowCount" > 0 AND u."raceDayId" IS NULL
    EXCEPT
    SELECT u."raceId", coalesce(u."stageNumber", -1)
      FROM public.race_uci_stages u
     WHERE u."keepForWeb" AND u."rowCount" > 0 AND u."raceDayId" IS NOT NULL
  ), clasificadas AS (
    SELECT d.id
      FROM dias d
      JOIN candidatas c ON c.id = d.id
     WHERE d.id IN (SELECT id FROM enlazadas)
        OR (d."raceId", coalesce(d."stageNumber", -1)) IN (SELECT "raceId", etapa FROM legado)
  ), con_videos AS (
    SELECT DISTINCT v."raceDayId" AS id FROM public.race_day_videos v
  ), contenido AS (
    SELECT d.id, d."dateKey", (c.id IS NOT NULL) AS convertible
      FROM dias d
      LEFT JOIN clasificadas c ON c.id = d.id
     WHERE c.id IS NOT NULL OR d.id IN (SELECT id FROM con_videos)
  ), elegidas AS (
    SELECT * FROM contenido
     WHERE p_from IS NOT NULL OR "dateKey" = (SELECT max("dateKey") FROM contenido)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'raceId', d."raceId", 'dateKey', d."dateKey", 'stageNumber', d."stageNumber",
      'stageSuffix', CASE WHEN d."stageNumber" IS NOT NULL AND (
          SELECT count(*) FROM public.race_days s
           WHERE s."raceId" = d."raceId" AND s."dateKey" = d."dateKey" AND s."stageNumber" = d."stageNumber"
             AND NOT s."isRestDay" AND s."editorialStatus" = 'published') > 1
        THEN chr(65 + (
          SELECT count(*)::integer FROM public.race_days s
           WHERE s."raceId" = d."raceId" AND s."dateKey" = d."dateKey" AND s."stageNumber" = d."stageNumber"
             AND NOT s."isRestDay" AND s."editorialStatus" = 'published' AND s.id <> d.id
             AND (coalesce(s."neutralStartTimeUtc", 'infinity') < coalesce(d."neutralStartTimeUtc", 'infinity')
                  OR (coalesce(s."neutralStartTimeUtc", 'infinity') = coalesce(d."neutralStartTimeUtc", 'infinity') AND s.id < d.id))))
        END,
      'slug', d.slug, 'slugEn', d."slugEn", 'isCancelledDay', d."isCancelledDay",
      'distanceKm', d."distanceKm", 'elevationGain', d."elevationProfile"->'elevationGain',
      'primaryType', d."primaryType", 'secondaryType', d."secondaryType", 'countryCode', d."countryCode",
      'neutralStartTimeUtc', d."neutralStartTimeUtc", 'realStartTimeUtc', d."realStartTimeUtc",
      'estimatedFinishTimeUtc', d."estimatedFinishTimeUtc",
      'race', (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'nameEn', r."nameEn", 'slug', r.slug, 'slugEn', r."slugEn",
                 'year', r.year, 'countryCode', r."countryCode", 'gender', r.gender, 'raceFormat', r."raceFormat",
                 'uciCategory', r."uciCategory", 'colorHex', r."colorHex", 'isGrandTour', r."isGrandTour",
                 'startDate', r."startDate", 'endDate', r."endDate", 'logoUrl', r."logoUrl")
                 FROM public.races r WHERE r.id = d."raceId"),
      'videos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'title', v.title, 'titleEn', v."titleEn",
                   'channel', v.channel, 'url', v.url, 'embeddable', v.embeddable, 'country', v.country,
                   'sortOrder', v."sortOrder", 'updatedAt', v."updatedAt") ORDER BY v."sortOrder", v.id), '[]')
                   FROM public.race_day_videos v WHERE v."raceDayId" = d.id),
      'broadcasts', CASE WHEN x.convertible THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'channel', e.channel,
                   'url', e.url, 'embeddable', e.embeddable, 'country', e.country, 'sortOrder', e."sortOrder",
                   'showInRevive', e."showInRevive") ORDER BY e."sortOrder", e.id), '[]')
                   FROM emisiones e WHERE e."raceDayId" = d.id) ELSE '[]'::jsonb END
    ) ORDER BY d."dateKey" DESC, d."raceId", d.id), '[]')
    FROM elegidas x
    JOIN public.race_days d ON d.id = x.id
$function$;
REVOKE ALL ON FUNCTION public.video_feed_days(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.video_feed_days(date, date) TO anon, authenticated, cc_agent, cc_publicador;
