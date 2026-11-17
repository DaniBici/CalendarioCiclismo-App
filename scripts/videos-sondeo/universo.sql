-- Universo del sondeo de vídeos: jornadas de carretera ya disputadas, sin día de
-- descanso ni cancelada, de las carreras WorldTour de la temporada.
-- Para ampliar a otras categorías, cambiar la lista de uciCategory.
-- Uso: node scripts/db/sql.mjs --read-only --file scripts/videos-sondeo/universo.sql > dias.json
select rd.id as "dayId",
       rd."dateKey",
       rd."stageNumber",
       rd.slug as "daySlug",
       rd."startLocation",
       rd."finishLocation",
       r.id as "raceId",
       r.name,
       r."nameEn",
       r."originalName",
       r.gender,
       r."uciCategory",
       r."isGrandTour",
       r."websiteUrl",
       (select count(*) from race_days x
         where x."raceId" = r.id
           and not coalesce(x."isRestDay", false)
           and not coalesce(x."isCancelledDay", false)) as "ridingDays",
       coalesce(yt.fixed, false) as "ytFixed",
       coalesce(yt.urls, '[]'::jsonb) as "ytUrls",
       coalesce(v.n, 0) as "videos"
  from races r
  join race_days rd on rd."raceId" = r.id
  -- ytFixed: emisión de YouTube con vídeo fijo, insertable y visible en Europa
  -- (country ALL, EUROPA o ES). Una emisión LATAM (p. ej. Age of Sports) no cubre
  -- la jornada. ytUrls guarda todas las de YouTube para comprobar su geobloqueo.
  left join lateral (
    select coalesce(bool_or(b.country in ('ALL', 'EUROPA', 'ES') and coalesce(b.embeddable, true)), false) as fixed,
           jsonb_agg(jsonb_build_object('url', b.url, 'country', b.country, 'channel', b.channel)) as urls
      from broadcasts b
     where b."raceDayId" = rd.id
       and b.url ~* '(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/live/)') yt on true
  left join lateral (
    select count(*) as n from race_day_videos x where x."raceDayId" = rd.id) v on true
 where r.year = 2026
   and r."uciCategory" in ('1.UWT', '2.UWT', '1.WWT', '2.WWT')
   and not coalesce(r."isCancelled", false)
   and not coalesce(rd."isRestDay", false)
   and not coalesce(rd."isCancelledDay", false)
   and rd."dateKey" < to_char(current_date, 'YYYY-MM-DD')
 order by r.gender desc, r."startDate", rd."dateKey";
