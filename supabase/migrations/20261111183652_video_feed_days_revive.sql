-- Sección Vídeos (docs/plans/videos-5-2.md): una carrera sin vídeos pero con
-- emisión de Revive también aparece, con el botón de la emisión (decisión de
-- Dani, 2026-11-11). video_feed_days devuelve ahora, en las jornadas con
-- clasificaciones propias, todas las emisiones de Revive (la regla de
-- isReviveBroadcast de js/broadcast-priority.js: showInRevive; sin cancelar,
-- además Eurosport/HBO Max por canal y redes, YouTube y ETB On por URL), no solo
-- las de YouTube convertibles. Cada cliente aplica después la regla común
-- (conversión, región y Revive restante). Mismos privilegios.
CREATE OR REPLACE FUNCTION public.video_feed_days(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH dias AS (
    SELECT d.id, d."raceId", d."dateKey", d."stageNumber", d."isCancelledDay"
      FROM public.race_days d
     WHERE d."editorialStatus" = 'published'
       AND (p_to IS NULL OR d."dateKey" <= to_char(p_to, 'YYYY-MM-DD'))
       AND (p_from IS NULL OR d."dateKey" >= to_char(p_from, 'YYYY-MM-DD'))
  ), emisiones AS (
    SELECT b.*
      FROM public.broadcasts b
      JOIN dias d ON d.id = b."raceDayId"
     WHERE nullif(btrim(b.url), '') IS NOT NULL
       AND (b."showInRevive"
            OR (NOT d."isCancelledDay"
                AND (coalesce(b.channel, '') ~* '(eurosport|hbo max)'
                     OR b.url ~* '(youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|twitch\.tv|kick\.com|twitter\.com|(//|\.)x\.com|etbon\.eus/m/)')))
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
    SELECT d.id, d."dateKey", (c.id IS NOT NULL) AS revive
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
      'broadcasts', CASE WHEN x.revive THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'channel', e.channel,
                   'url', e.url, 'embeddable', e.embeddable, 'country', e.country, 'sortOrder', e."sortOrder",
                   'showInRevive', e."showInRevive") ORDER BY e."sortOrder", e.id), '[]')
                   FROM emisiones e WHERE e."raceDayId" = d.id) ELSE '[]'::jsonb END
    ) ORDER BY d."dateKey" DESC, d."raceId", d.id), '[]')
    FROM elegidas x
    JOIN public.race_days d ON d.id = x.id
$function$;
