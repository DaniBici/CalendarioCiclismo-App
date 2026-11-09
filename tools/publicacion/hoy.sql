-- Agenda de Hoy de carretera en la ventana publicada (30 días atrás, 90 adelante): lo que leen
-- loadDay(), fetchActiveRaces() y ensureYearRacesCached() de js/app.js, con el JSON de la API.
set local timezone = 'UTC';
with ventana as (
  select (current_date - 30)::text as desde, (current_date + 90)::text as hasta
), dias as (
  select d.* from race_days d, ventana v
   where d."editorialStatus" = 'published' and d."dateKey" between v.desde and v.hasta
)
select
  (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb) from dias d) as days,
  (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from races r where r.id in (select "raceId" from dias)) as races,
  (select coalesce(jsonb_agg(to_jsonb(b) order by b."sortOrder", b.id), '[]'::jsonb) from broadcasts b where b."raceDayId" in (select id from dias)) as broadcasts,
  (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'raceDayId', a."raceDayId", 'type', a.type, 'url', a.url) order by a.id), '[]'::jsonb)
     from assets a where a."raceDayId" in (select id from dias)) as assets,
  (select coalesce(jsonb_agg(jsonb_build_object('raceId', s."raceId", 'raceDayId', s."raceDayId", 'stageNumber', s."stageNumber") order by s."raceId", s."stageNumber"), '[]'::jsonb)
     from race_uci_stages s where s."keepForWeb" and s."rowCount" > 0 and s."raceId" in (select "raceId" from dias)) as stages,
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'nameEn', r."nameEn", 'slug', r.slug, 'slugEn', r."slugEn", 'year', r.year,
            'startDate', r."startDate", 'endDate', r."endDate", 'raceFormat', r."raceFormat", 'uciCategory', r."uciCategory", 'gender', r.gender,
            'countryCode', r."countryCode", 'colorHex', r."colorHex", 'logoUrl', r."logoUrl", 'hideFlag', r."hideFlag", 'isCancelled', r."isCancelled",
            'isNoClickable', r."isNoClickable") order by r.id), '[]'::jsonb)
     from races r, ventana v where r."startDate" <= v.hasta and r."endDate" >= v.desde) as activas,
  (select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'year', r.year, 'startDate', r."startDate", 'endDate', r."endDate", 'raceFormat', r."raceFormat",
            'uciCategory', r."uciCategory", 'gender', r.gender, 'countryCode', r."countryCode", 'isCancelled', r."isCancelled") order by r.id), '[]'::jsonb)
     from races r, ventana v where r.year between left(v.desde, 4)::int and left(v.hasta, 4)::int) as anio,
  (select coalesce(jsonb_agg(jsonb_build_object('dateKey', f."dateKey", 'raceId', f."raceId") order by f."dateKey", f."raceId"), '[]'::jsonb)
     from featured_races_for_dates(array(select distinct "dateKey" from dias)) f) as featured;
