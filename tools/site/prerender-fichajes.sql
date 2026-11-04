-- Volcado local de tools/site/prerender-fichajes.mjs --data (solo lectura):
--   node scripts/db/sql.mjs --read-only --file tools/site/prerender-fichajes.sql > datos.json
-- Mismas filas y columnas que la lectura por API del build (fetchMarket() de
-- js/fichajes.js) para la temporada de mercado 2027 y la temporada en curso
-- 2026, y el mismo JSON que devuelve PostgREST (horas en UTC con +00:00). Al
-- cambiar SEASON en js/fichajes-html.js, cambiar aquí los dos años.
set local timezone = 'UTC';
with params as (
  select 2027 as season, 2026 as prev_season
), moves as (
  select t.* from rider_transfers t, params p where t.season = p.season
), extra as (
  select distinct id from (
    select "fromTeamId" as id from moves union select "toTeamId" from moves
  ) x
   where id is not null
     and id not in (select s."teamId" from team_seasons s, params p where s.year in (p.season, p.prev_season))
)
select
  (select coalesce(jsonb_agg(jsonb_build_object('teamId', s."teamId", 'name', s.name, 'category', s.category,
            'gender', s.gender, 'badgeVisible', s."badgeVisible", 'continuityDoubt', s."continuityDoubt",
            'headerBg', s."headerBg", 'headerText', s."headerText", 'badgeTorsoCenter', s."badgeTorsoCenter",
            'badgeTorsoSides', s."badgeTorsoSides", 'badgeInnerCircle', s."badgeInnerCircle",
            'badgeShorts', s."badgeShorts") order by s."teamId", s.id), '[]'::jsonb)
     from team_seasons s, params p where s.year = p.season) as seasons,
  (select coalesce(jsonb_agg(jsonb_build_object('teamId', s."teamId", 'name', s.name,
            'headerBg', s."headerBg", 'headerText', s."headerText", 'badgeTorsoCenter', s."badgeTorsoCenter",
            'badgeTorsoSides', s."badgeTorsoSides", 'badgeInnerCircle', s."badgeInnerCircle",
            'badgeShorts', s."badgeShorts") order by s."teamId", s.id), '[]'::jsonb)
     from team_seasons s, params p where s.year = p.prev_season) as "prevSeasons",
  (select coalesce(jsonb_agg(to_jsonb(t) order by t."announcedAt" desc, t."createdAt" desc, t.id), '[]'::jsonb)
     from moves t) as transfers,
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'firstName', r."firstName", 'lastName', r."lastName",
            'nationality', r.nationality, 'contractUntil', r."contractUntil", 'birthDate', r."birthDate") order by r.id), '[]'::jsonb)
     from riders_men r where r.id in (select "riderId" from moves where "riderGender" = 'male')) as men,
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'firstName', r."firstName", 'lastName', r."lastName",
            'nationality', r.nationality, 'contractUntil', r."contractUntil", 'birthDate', r."birthDate") order by r.id), '[]'::jsonb)
     from riders_women r where r.id in (select "riderId" from moves where "riderGender" = 'female')) as women,
  (select coalesce(jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name) order by tm.id), '[]'::jsonb)
     from teams tm where tm.id in (select id from extra)) as "extraTeams",
  (select coalesce(jsonb_agg(jsonb_build_object('id', tm.id, 'countryCode', tm."countryCode") order by tm.id), '[]'::jsonb)
     from teams tm where tm.id in (select s."teamId" from team_seasons s, params p where s.year = p.season)) as "teamCountries";
