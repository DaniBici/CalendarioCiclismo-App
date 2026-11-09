-- Plantillas de los equipos del mercado: lo que loadRoster() de js/fichajes.js lee equipo a
-- equipo, de una vez. Mismos años que tools/site/prerender-fichajes.sql.
set local timezone = 'UTC';
with equipos as (
  select "teamId", coalesce(nullif(gender::text, ''), case when category in ('WT', 'PT') then 'male' else 'female' end) as genero
    from team_seasons
   where year = 2027 and category in ('WT', 'PT', 'WWT', 'PRW')
), afiliaciones as (
  select a."teamId", a."riderId", a."riderGender", a."dateTo", coalesce(nullif(a."riderGender", ''), e.genero) as tabla
    from rider_team_affiliations a
    join equipos e on e."teamId" = a."teamId"
   where a."affiliationType" = 'regular' and a.year = 2027
)
select
  (select coalesce(jsonb_agg(jsonb_build_object('teamId', a."teamId", 'riderId', a."riderId", 'riderGender', a."riderGender",
            'dateTo', a."dateTo") order by a."teamId", a."riderId"), '[]'::jsonb)
     from afiliaciones a) as afiliaciones,
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'firstName', r."firstName", 'lastName', r."lastName",
            'nationality', r.nationality, 'currentTeamId', r."currentTeamId") order by r.id), '[]'::jsonb)
     from riders_men r where r.id in (select "riderId" from afiliaciones where tabla = 'male')) as "plantillaHombres",
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'firstName', r."firstName", 'lastName', r."lastName",
            'nationality', r.nationality, 'currentTeamId', r."currentTeamId") order by r.id), '[]'::jsonb)
     from riders_women r where r.id in (select "riderId" from afiliaciones where tabla = 'female')) as "plantillaMujeres";
