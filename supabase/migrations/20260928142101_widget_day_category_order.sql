-- widget_day con el orden de Hoy (apps 5.0.10): el miniperfil deja de
-- adelantar una carrera y la categoría usa una tabla única, espejo de
-- categoryRank (js/services/race-order.js y RaceLogic en iOS y Android).
-- El resto de la función no cambia respecto a 20260927102519.
CREATE OR REPLACE FUNCTION public.widget_day(
  p_date date,
  p_days integer DEFAULT 2,
  p_locale text DEFAULT 'es',
  p_broadcast_groups text[] DEFAULT ARRAY['ALL', 'ES', 'EUROPA'],
  p_filter text DEFAULT 'all',
  p_disciplines text[] DEFAULT ARRAY['road', 'cx'],
  p_race_ids text[] DEFAULT NULL,
  p_race_day_ids text[] DEFAULT NULL,
  p_cx_race_ids text[] DEFAULT NULL,
  p_cx_filter text DEFAULT 'all'
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH params AS (
  SELECT p_date AS d0,
         least(greatest(coalesce(p_days, 2), 1), 3) AS ndays,
         lower(coalesce(p_locale, 'es')) = 'en' AS en,
         coalesce(p_broadcast_groups, ARRAY['ALL', 'ES', 'EUROPA']) AS groups,
         coalesce(p_disciplines, ARRAY['road', 'cx']) AS disc,
         (p_race_ids IS NOT NULL OR p_race_day_ids IS NOT NULL) AS road_followed,
         lower(coalesce(p_cx_filter, 'all')) AS cxf,
         -- Horizonte de búsqueda de la próxima cita (cubre el parón invernal).
         150 AS horizon
),
days AS (
  SELECT (p.d0 + g)::date AS d FROM params p, generate_series(0, p.ndays - 1) g
),
labels AS (
  SELECT CASE WHEN p.en THEN
    '{"flat":"Flat","rolling":"Rolling","cotas":"Hilly","medium_mountain":"Medium mountain","high_mountain":"High mountain","cobbles":"Cobbles","sterrato":"Sterrato","itt":"ITT","ttt":"TTT","summit_finish":"Summit finish","uphill_finish":"Uphill finish","chrono_climb":"Chrono climb"}'::jsonb
  ELSE
    '{"flat":"Llana","rolling":"Sinuosa","cotas":"Cotas","medium_mountain":"Media montaña","high_mountain":"Alta montaña","cobbles":"Adoquines","sterrato":"Sterrato","itt":"CRI","ttt":"CRE","summit_finish":"Final en alto","uphill_finish":"Final en repecho","chrono_climb":"Cronoescalada"}'::jsonb
  END AS t FROM params p
),
-- ── Carretera ────────────────────────────────────────────────────────────
road AS (
  SELECT rd.id, rd."raceId", rd."dateKey"::date AS d, rd."stageNumber", rd."isRestDay", rd."isCancelledDay",
         rd."primaryType", rd."secondaryType", rd."neutralStartTimeUtc", rd."estimatedFinishTimeUtc",
         rd."tvStatus", rd."distanceKm", rd."raceStatus",
         CASE WHEN p.en THEN coalesce(nullif(rd."startLocationEn", ''), rd."startLocation") ELSE rd."startLocation" END AS start_loc,
         CASE WHEN p.en THEN coalesce(nullif(rd."finishLocationEn", ''), rd."finishLocation") ELSE rd."finishLocation" END AS finish_loc,
         CASE WHEN p.en THEN coalesce(nullif(r."nameEn", ''), r.name) ELSE r.name END AS race_name,
         r.name AS name_es, r."uciCategory", r.gender, r."countryCode" AS race_cc, r."endDate",
         coalesce(r."isGrandTour", false) AS gt,
         lower(CASE WHEN nullif(rd."countryCode", '') IS NOT NULL THEN rd."countryCode"
                    WHEN coalesce(r."hideFlag", false) THEN NULL ELSE r."countryCode" END) AS cc,
         NOT rd."isRestDay" AND NOT rd."isCancelledDay" AS active
    FROM public.race_days rd
    JOIN public.races r ON r.id = rd."raceId"
    CROSS JOIN params p
   WHERE 'road' = ANY(p.disc)
     AND rd."editorialStatus" = 'published'
     AND rd."dateKey" >= p.d0::text AND rd."dateKey" <= (p.d0 + p.horizon)::text
     AND NOT coalesce(r."isCancelled", false)
     AND CASE WHEN p.road_followed
              THEN rd."raceId" = ANY(coalesce(p_race_ids, '{}')) OR rd.id = ANY(coalesce(p_race_day_ids, '{}'))
              ELSE public.widget_road_matches(p_filter, r."uciCategory", r.gender, r."countryCode", r.name) END
),
road_ranked AS (
  SELECT b.*,
    CASE WHEN b."stageNumber" IS NOT NULL AND b.active
          AND count(*) FILTER (WHERE b.active) OVER w > 1
         THEN chr(64 + (row_number() OVER (PARTITION BY b."raceId", b.d, b."stageNumber", b.active
                                           ORDER BY b."neutralStartTimeUtc" NULLS LAST, b.id))::int)
    END AS suffix,
    -- Tabla única de categoría: espejo de categoryRank (js/services/race-order.js).
    CASE WHEN b.name_es ILIKE '%giro de italia%' THEN 0.1 WHEN b.name_es ILIKE '%tour de francia%' THEN 0.2
         WHEN b.name_es ILIKE '%la vuelta%' THEN 0.3
         WHEN b."uciCategory" IN ('1.2U', '2.2U') AND b.name_es ILIKE '%tour del porvenir%' THEN 8.5
         WHEN b."uciCategory" = 'CC' AND b.name_es !~* 'europa|europe' THEN 14.5
         WHEN b."uciCategory" IN ('1.Pro', '2.Pro', '1.1', '2.1') AND upper(coalesce(b.race_cc, '')) IN ('CN','TH','JP','TW','KR','HK','AZ')
              AND b.name_es NOT ILIKE '%japan cup%' THEN 10.5
         ELSE coalesce(('{"WC":1,"CC":2,"1.UWT":3,"2.UWT":4,"CN":4.5,"1.WWT":5,"2.WWT":6,"1.Pro":7,"2.Pro":8,"1.1":9,"2.1":10,"1.2":11,"2.2":12,"1.2U":13,"2.2U":14}'::jsonb ->> b."uciCategory")::numeric, 99)
    END AS category_rank
  FROM road b
  WINDOW w AS (PARTITION BY b."raceId", b.d, b."stageNumber")
),
road_items AS (
  SELECT b.d, b.id, b.active,
    ARRAY[CASE WHEN b.active THEN 0 ELSE 1 END, CASE WHEN b.gt THEN 0 ELSE 1 END,
          b.category_rank, CASE WHEN b.gender = 'female' THEN 2 ELSE 1 END,
          coalesce(extract(epoch FROM b."neutralStartTimeUtc"), 1e12)::numeric]::numeric[] AS sort_key,
    b.race_name, b.suffix,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'road',
      'id', b.id,
      'raceId', b."raceId",
      'link', 'calendariociclismo://stage/' || b.id,
      'name', b.race_name,
      'countryCode', b.cc,
      'category', b."uciCategory",
      'gender', b.gender,
      'grandTour', b.gt,
      'state', CASE WHEN b."isCancelledDay" THEN 'cancelled' WHEN b."isRestDay" THEN 'rest' ELSE 'race' END,
      'stageNumber', b."stageNumber",
      'stageLabel', CASE
        WHEN b."isRestDay" THEN CASE WHEN p.en THEN 'Rest day' ELSE 'Jornada de descanso' END
        WHEN b."stageNumber" IS NULL THEN NULL
        WHEN b."stageNumber" = 0 THEN CASE WHEN p.en THEN 'Prologue' ELSE 'Prólogo' END
        ELSE CASE WHEN p.en THEN 'Stage ' ELSE 'Etapa ' END || b."stageNumber" || coalesce(b.suffix, '') END,
      'primaryType', b."primaryType",
      'typeLabel', CASE
        WHEN b."isRestDay" OR coalesce(b."primaryType", '') = '' THEN NULL
        WHEN b."primaryType" = 'sterrato' AND upper(coalesce(b.race_cc, '')) = 'FR' THEN 'Ribinou'
        WHEN b."primaryType" = 'flat' AND b."secondaryType" = 'summit_finish' THEN CASE WHEN p.en THEN 'One-Climb' ELSE 'Monopuerto' END
        WHEN b."primaryType" = 'itt' AND b."secondaryType" IN ('chrono_climb', 'summit_finish') THEN l.t ->> 'chrono_climb'
        WHEN b."primaryType" IN ('itt', 'ttt') OR coalesce(b."secondaryType", '') = ''
          THEN coalesce(l.t ->> b."primaryType", b."primaryType")
        ELSE coalesce(l.t ->> b."primaryType", b."primaryType") || ' · ' || coalesce(l.t ->> b."secondaryType", b."secondaryType")
      END,
      'distanceKm', b."distanceKm",
      'route', CASE
        WHEN nullif(b.start_loc, '') IS NOT NULL AND nullif(b.finish_loc, '') IS NOT NULL AND b.start_loc <> b.finish_loc
          THEN b.start_loc || ' – ' || b.finish_loc
        ELSE coalesce(nullif(b.start_loc, ''), nullif(b.finish_loc, '')) END,
      'startUtc', b."neutralStartTimeUtc",
      'finishUtc', b."estimatedFinishTimeUtc",
      'raceStatus', b."raceStatus",
      'tv', jsonb_strip_nulls(jsonb_build_object(
        'status', CASE
          WHEN tv.n_vis > 0 AND tv.start_utc IS NOT NULL THEN 'time'
          WHEN tv.n_vis > 0 THEN 'confirmed'
          WHEN b."tvStatus" = 'unavailable_es' THEN CASE WHEN 'ES' = ANY(p.groups) THEN 'unavailable_es' END
          WHEN tv.n_all > 0 THEN NULL
          WHEN b."tvStatus" = 'none' THEN 'none'
          WHEN b."tvStatus" = 'pending' THEN 'pending'
          WHEN b."tvStatus" IN ('confirmed', 'confirmed_time', 'confirmed_notime') THEN 'confirmed'
        END,
        'channel', tv.channels[1],
        'channels', to_jsonb(tv.channels),
        'startUtc', tv.start_utc)),
      'liveTextUrl', (SELECT a.url FROM public.assets a
                        WHERE a."raceDayId" = b.id AND a.type = 'live_text' AND coalesce(a.url, '') <> ''
                        ORDER BY a.id LIMIT 1),
      'hasResults', st.id IS NOT NULL,
      -- Sin spoilers: solo los accesos de Hoy (copa → resultados, TV → Revive).
      'resultsLink', CASE WHEN st.id IS NOT NULL
        THEN 'calendariociclismo://results/' || b."raceId" || '/' || coalesce(st."stageNumber"::text, 'final') || coalesce(b.suffix, '') END,
      'reviveUrl', CASE WHEN st.id IS NOT NULL THEN (
        SELECT bc.url FROM public.broadcasts bc
         WHERE bc."raceDayId" = b.id AND coalesce(bc.url, '') <> ''
           AND (coalesce(bc."showInRevive", false)
             OR lower(coalesce(bc.channel, '')) ~ '(eurosport|hbo max)'
             OR bc.url ~* '^https?://([^/]*\.)?(youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com|tiktok\.com|twitch\.tv|kick\.com|twitter\.com|x\.com)(/|$)'
             OR bc.url ~* '^https://etbon\.eus/m/')
         ORDER BY bc."sortOrder" NULLS LAST, bc.id LIMIT 1) END
    )) AS item
  FROM road_ranked b
  JOIN days ON days.d = b.d
  CROSS JOIN params p
  CROSS JOIN labels l
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE coalesce(bc.channel, '') <> '') AS n_all,
           count(*) FILTER (WHERE coalesce(bc.channel, '') <> '' AND (coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups))) AS n_vis,
           min(bc."startTimeUtc") FILTER (WHERE coalesce(bc.channel, '') <> '' AND (coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups))) AS start_utc,
           (array_agg(bc.channel ORDER BY bc."sortOrder" NULLS LAST, bc.id)
              FILTER (WHERE coalesce(bc.channel, '') <> '' AND (coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups))))[1:2] AS channels
      FROM public.broadcasts bc
     WHERE bc."raceDayId" = b.id
  ) tv ON b.active
  LEFT JOIN LATERAL (
    SELECT s.id, s."stageNumber"
      FROM public.race_uci_stages s
     WHERE b.active AND s."raceId" = b."raceId" AND s."keepForWeb" AND coalesce(s."rowCount", 0) > 0
       AND ((s."raceDayId" = b.id AND s."classKind" = 'stage')
         OR (s."raceDayId" IS NULL AND b."stageNumber" IS NOT NULL AND s."stageNumber" = b."stageNumber"
             AND s."classKind" = 'stage' AND s.scope = 'stage')
         OR (b."stageNumber" IS NULL AND (s."raceDayId" = b.id OR s."raceDayId" IS NULL)
             AND s."stageNumber" IS NULL AND s."classKind" IN ('stage', 'gc')))
     ORDER BY (s."raceDayId" IS NOT NULL) DESC, (s."classKind" = 'stage') DESC
     LIMIT 1
  ) st ON true
),
-- ── Ciclocross ───────────────────────────────────────────────────────────
cx_race AS (
  SELECT r.id, r.class, lower(r."countryCode") AS cc, r."isCancelled",
         CASE WHEN p.en THEN coalesce(nullif(r."nameEn", ''), r.name) ELSE r.name END AS race_name,
         CASE WHEN t.id IS NULL THEN NULL
              WHEN p.en THEN coalesce(nullif(t."nameEn", ''), t.name) ELSE t.name END AS tournament,
         r."dateKey" AS race_date
    FROM public.cx_races r
    LEFT JOIN public.cx_tournaments t ON t.id = r."tournamentId"
    CROSS JOIN params p
   WHERE 'cx' = ANY(p.disc)
     AND r."editorialStatus" = 'published'
     AND r."dateKey" <= p.d0 + p.horizon
     AND coalesce(r."endDateKey", r."dateKey") >= p.d0
     AND NOT (p.en AND r.class = 'NAC')
     AND CASE WHEN p_cx_race_ids IS NOT NULL THEN r.id = ANY(p_cx_race_ids)
              ELSE CASE p.cxf
                WHEN 'spain' THEN lower(coalesce(r."countryCode", '')) LIKE 'es%'
                WHEN 'pro' THEN r.class NOT IN ('CN', 'NAC')
                WHEN 'big' THEN r.class IN ('CM', 'CDM', 'CC')
                  OR regexp_replace(lower(coalesce(t.slug, '') || ' ' || coalesce(t.name, '')), '[^a-z0-9]', '', 'g')
                     ~ '(superprestige|x2o|worldcup|copadelmundo|exactcross|hgcross)'
                ELSE true END END
),
cx_session AS (
  SELECT c."raceId", coalesce(c."dateKey", r.race_date) AS d, c.category, c."startTimeUtc",
         CASE WHEN c."durationRuleVersion" = '2026-07-01' AND coalesce(c."durationMinutes", 0) > 0
               AND (c."durationFormat" = 'individual' OR (c."durationFormat" = 'WE_WJ' AND c.category IN ('WE', 'WJ')))
              THEN c."startTimeUtc" + make_interval(mins => c."durationMinutes") END AS finish_utc,
         r."isCancelled" OR c."isCancelled" AS cancelled,
         c."resultsStatus" IN ('official', 'provisional') AS has_results,
         array_position(ARRAY['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ'], c.category) AS cat_order
    FROM public.cx_race_categories c
    JOIN cx_race r ON r.id = c."raceId"
   WHERE c.category IN ('ME', 'WE', 'MU', 'WU', 'MJ', 'WJ')
),
cx_day AS (
  SELECT s."raceId", s.d FROM cx_session s
  UNION
  SELECT r.id, r.race_date FROM cx_race r
   WHERE NOT EXISTS (SELECT 1 FROM cx_session s WHERE s."raceId" = r.id)
),
cx_items AS (
  SELECT x.d, x."raceId" AS id, NOT all_cancelled AS active,
    ARRAY[CASE WHEN all_cancelled THEN 1 ELSE 0 END,
          coalesce(array_position(ARRAY['CM', 'CDM', 'CC', 'C1', 'C2', 'CN', 'NAC'], r.class), 8),
          coalesce(extract(epoch FROM first_start), 1e12)]::numeric[] AS sort_key,
    r.race_name,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'cx',
      'id', r.id,
      'raceId', r.id,
      'link', 'calendariociclismo://cxRace/' || r.id,
      'name', r.race_name,
      'countryCode', r.cc,
      'category', r.class,
      'tournament', r.tournament,
      'state', CASE WHEN all_cancelled THEN 'cancelled' ELSE 'race' END,
      'startUtc', first_start,
      'finishUtc', last_finish,
      'sessions', sessions,
      'hasResults', any_results,
      'resultsLink', CASE WHEN any_results THEN 'calendariociclismo://cxRace/' || r.id || coalesce('#' || results_cat, '') END,
      'reviveUrl', CASE WHEN any_results THEN (
        SELECT bc.url FROM public.cx_broadcasts bc
         WHERE bc."raceId" = x."raceId" AND coalesce(bc.url, '') <> ''
           AND (coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups))
           AND (coalesce(bc."showInRevive", false) OR (coalesce(bc."isSporza", false) AND NOT all_cancelled))
         ORDER BY bc."sortOrder" NULLS LAST, bc.id LIMIT 1) END,
      'tv', jsonb_strip_nulls(jsonb_build_object(
        'status', CASE WHEN tv.n_vis > 0 AND tv.start_utc IS NOT NULL THEN 'time' WHEN tv.n_vis > 0 THEN 'confirmed' END,
        'channel', tv.channels[1],
        'channels', to_jsonb(tv.channels),
        'startUtc', tv.start_utc))
    )) AS item
  FROM cx_day x
  JOIN days ON days.d = x.d
  JOIN cx_race r ON r.id = x."raceId"
  CROSS JOIN params p
  CROSS JOIN LATERAL (
    SELECT coalesce(bool_and(s.cancelled), r."isCancelled") AS all_cancelled,
           min(s."startTimeUtc") FILTER (WHERE NOT s.cancelled) AS first_start,
           max(s.finish_utc) FILTER (WHERE NOT s.cancelled) AS last_finish,
           coalesce(bool_or(s.has_results), false) AS any_results,
           (array_agg(s.category ORDER BY s.cat_order) FILTER (WHERE s.has_results))[1] AS results_cat,
           array_agg(s.category) FILTER (WHERE NOT s.cancelled) AS cats,
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'category', s.category,
             'label', CASE WHEN p.en THEN
                 ('{"ME":"Men Elite","WE":"Women Elite","MU":"Men U23","WU":"Women U23","MJ":"Men Junior","WJ":"Women Junior"}'::jsonb ->> s.category)
               ELSE
                 ('{"ME":"Élite masc.","WE":"Élite fem.","MU":"Sub-23 masc.","WU":"Sub-23 fem.","MJ":"Júnior masc.","WJ":"Júnior fem."}'::jsonb ->> s.category)
               END,
             'elite', s.category IN ('ME', 'WE'),
             'startUtc', s."startTimeUtc",
             'finishUtc', s.finish_utc,
             'cancelled', s.cancelled,
             'hasResults', s.has_results))
             ORDER BY s."startTimeUtc" NULLS LAST, s.cat_order), '[]'::jsonb) AS sessions
      FROM cx_session s
     WHERE s."raceId" = x."raceId" AND s.d = x.d
  ) agg
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups)) AS n_vis,
           min(bc."startTimeUtc") FILTER (WHERE coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups)) AS start_utc,
           (array_agg(DISTINCT bc.channel) FILTER (WHERE coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups)))[1:2] AS channels
      FROM public.cx_broadcasts bc
     WHERE bc."raceId" = x."raceId" AND coalesce(bc.channel, '') <> ''
       AND (coalesce(bc.category, '') = '' OR bc.category = ANY(coalesce(agg.cats, '{}')))
       AND (bc."startTimeUtc" IS NULL OR (bc."startTimeUtc" AT TIME ZONE 'UTC')::date BETWEEN x.d - 1 AND x.d + 1)
  ) tv ON true
),
items AS (
  SELECT d, 0 AS disc_order, sort_key, race_name, item, active FROM road_items
  UNION ALL
  SELECT d, 1, sort_key, race_name, item, active FROM cx_items
),
-- ── Próxima cita posterior a cada día ────────────────────────────────────
next_dates AS (
  SELECT days.d AS day,
         (SELECT min(nd) FROM (
            SELECT min(b.d) AS nd FROM road b WHERE b.active AND b.d > days.d
            UNION ALL
            SELECT min(s.d) FROM cx_session s WHERE NOT s.cancelled AND s.d > days.d
            UNION ALL
            SELECT min(r.race_date) FROM cx_race r
             WHERE NOT r."isCancelled" AND r.race_date > days.d
               AND NOT EXISTS (SELECT 1 FROM cx_session s WHERE s."raceId" = r.id)
          ) q) AS nd
    FROM days
),
next_item AS (
  SELECT n.day, n.nd,
    (SELECT jsonb_strip_nulls(jsonb_build_object(
        'date', n.nd, 'kind', c.kind, 'id', c.id, 'link', c.link, 'name', c.name,
        'countryCode', c.cc, 'category', c.category, 'stageLabel', c.stage_label, 'startUtc', c.start_utc,
        'tvStartUtc', c.tv_start, 'tvChannel', c.tv_channel))
       FROM (
         SELECT 'road' AS kind, b.id, 'calendariociclismo://stage/' || b.id AS link, b.race_name AS name, b.cc,
                b."uciCategory" AS category,
                CASE WHEN b."stageNumber" IS NULL THEN NULL
                     WHEN b."stageNumber" = 0 THEN CASE WHEN p.en THEN 'Prologue' ELSE 'Prólogo' END
                     ELSE CASE WHEN p.en THEN 'Stage ' ELSE 'Etapa ' END || b."stageNumber" END AS stage_label,
                b."neutralStartTimeUtc" AS start_utc,
                (SELECT min(bc."startTimeUtc") FROM public.broadcasts bc
                  WHERE bc."raceDayId" = b.id AND coalesce(bc.channel, '') <> ''
                    AND (coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups))) AS tv_start,
                (SELECT bc.channel FROM public.broadcasts bc
                  WHERE bc."raceDayId" = b.id AND coalesce(bc.channel, '') <> ''
                    AND (coalesce(bc.country, '') = '' OR bc.country = ANY(p.groups))
                  ORDER BY bc."sortOrder" NULLS LAST, bc.id LIMIT 1) AS tv_channel,
                ARRAY[0, CASE WHEN b.gt THEN 0 ELSE 1 END, b.category_rank,
                      CASE WHEN b.gender = 'female' THEN 2 ELSE 1 END,
                      coalesce(extract(epoch FROM b."neutralStartTimeUtc"), 1e12)::numeric]::numeric[] AS sort_key
           FROM road_ranked b
          WHERE b.active AND b.d = n.nd
         UNION ALL
         SELECT 'cx', r.id, 'calendariociclismo://cxRace/' || r.id, r.race_name, r.cc, r.class, NULL,
                (SELECT min(s."startTimeUtc") FROM cx_session s WHERE s."raceId" = r.id AND s.d = n.nd AND NOT s.cancelled),
                NULL, NULL,
                ARRAY[1, coalesce(array_position(ARRAY['CM', 'CDM', 'CC', 'C1', 'C2', 'CN', 'NAC'], r.class), 8)]::numeric[]
           FROM cx_race r
          WHERE NOT r."isCancelled"
            AND (EXISTS (SELECT 1 FROM cx_session s WHERE s."raceId" = r.id AND s.d = n.nd AND NOT s.cancelled)
              OR (r.race_date = n.nd AND NOT EXISTS (SELECT 1 FROM cx_session s WHERE s."raceId" = r.id)))
       ) c
      ORDER BY c.kind = 'cx', c.sort_key, c.name
      LIMIT 1) AS item
  FROM next_dates n
  CROSS JOIN params p
  WHERE n.nd IS NOT NULL
)
SELECT jsonb_build_object(
  'version', 1,
  'generatedAt', now(),
  'locale', CASE WHEN p.en THEN 'en' ELSE 'es' END,
  'days', coalesce((
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'date', days.d,
      'items', coalesce((
        SELECT jsonb_agg(i.item ORDER BY i.disc_order, i.sort_key, i.race_name)
          FROM items i WHERE i.d = days.d), '[]'::jsonb),
      'next', (SELECT ni.item FROM next_item ni WHERE ni.day = days.d)))
      ORDER BY days.d)
    FROM days), '[]'::jsonb))
FROM params p;
$$;

REVOKE ALL ON FUNCTION public.widget_day(date, integer, text, text[], text, text[], text[], text[], text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_day(date, integer, text, text[], text, text[], text[], text[], text[], text) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
