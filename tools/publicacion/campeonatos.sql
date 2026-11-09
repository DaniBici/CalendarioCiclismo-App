-- Campeonatos Nacionales: lo que lee init() de js/campeonatos.js, con el JSON de la API. El año y
-- las fechas de la página (CAMP de js/campeonatos-config.js) se aplican al publicar.
set local timezone = 'UTC';
with carreras as (
  select r.* from races r where r."uciCategory" = 'CN' and r.year >= 2026
), dias as (
  select d.* from race_days d where d."editorialStatus" = 'published' and d."raceId" in (select id from carreras)
)
select
  (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from carreras r) as races,
  (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb) from dias d) as days,
  (select coalesce(jsonb_agg(to_jsonb(b) order by b."sortOrder", b.id), '[]'::jsonb) from broadcasts b where b."raceDayId" in (select id from dias)) as broadcasts,
  (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from assets a where a."raceDayId" in (select id from dias)) as assets,
  (select coalesce(jsonb_agg(jsonb_build_object('raceId', s."raceId", 'raceDayId', s."raceDayId", 'stageNumber', s."stageNumber") order by s."raceId", s."stageNumber"), '[]'::jsonb)
     from race_uci_stages s where s."keepForWeb" and s."rowCount" > 0 and s."raceId" in (select id from carreras)) as stages;
