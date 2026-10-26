-- Volcado local de tools/site/prerender-inscritos.mjs --data (solo lectura):
--   node scripts/db/sql.mjs --read-only --file tools/site/prerender-inscritos.sql > datos.json
-- Mismas filas y orden que la lectura por API del build para las carreras con
-- lista que terminan desde hace 7 días (UTC) o después, y el mismo JSON que
-- devuelve PostgREST (jsonb, horas en UTC con +00:00): el HTML generado y su
-- huella dependen del texto exacto de cada valor. Para comprobar otras
-- carreras, cambiar `since` y pasar el mismo día al script con --since; con
-- `since` null, todas las carreras con lista (--scope listas).
set local timezone = 'UTC';
with params as (
  select (current_date - 7)::text as since
), scope as (
  select r.* from races r, params p
   where (p.since is null or coalesce(r."endDate", r."startDate") >= p.since)
     and exists (select 1 from startlist_teams t where t."raceId" = r.id)
), stages as (
  select u.* from race_uci_stages u
   where u."raceId" in (select id from scope) and u."classKind" = 'stage'
)
select
  (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from scope r) as races,
  (select coalesce(jsonb_agg(to_jsonb(st) || jsonb_build_object('team', (
            select to_jsonb(t) || jsonb_build_object('team_seasons', coalesce((
                     select jsonb_agg(to_jsonb(s) order by s.id) from team_seasons s where s."teamId" = t.id), '[]'::jsonb))
              from teams t where t.id = st."teamId"))
          order by st."sortOrder", st.id), '[]'::jsonb)
     from startlist_teams st where st."raceId" in (select id from scope)) as teams,
  (select coalesce(jsonb_agg(to_jsonb(s) order by s.dorsal, s.id), '[]'::jsonb)
     from startlist_riders_resolved s
    where s."raceId" in (select id from scope) and s."teamId" is not null) as riders,
  (select coalesce(jsonb_agg(jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey", 'isRestDay', d."isRestDay")
          order by d."dateKey", d.id), '[]'::jsonb)
     from race_days d
    where d."raceId" in (select id from scope) and d."editorialStatus" = 'published') as days,
  (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'raceId', u."raceId", 'stageNumber', u."stageNumber",
            'rowCount', u."rowCount") order by u.id), '[]'::jsonb)
     from stages u) as stages,
  (select coalesce(jsonb_agg(jsonb_build_object('globalRiderId', x."globalRiderId", 'irm', x.irm, 'stageRef', x."stageRef")
          order by x.id), '[]'::jsonb)
     from race_uci_results x
    where x."stageRef" in (select id from stages where "rowCount" > 0)
      and x."globalRiderId" is not null and x.irm is not null) as results,
  (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('assets', coalesce((
            select jsonb_agg(to_jsonb(a) order by a.id) from assets a where a."raceDayId" = d.id), '[]'::jsonb))
          order by d."dateKey", d.id), '[]'::jsonb)
     from race_days d
    where d."raceId" in (select id from scope where "raceFormat" = 'one_day')
      and d."editorialStatus" = 'published') as "oneDays",
  (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('race_days',
            jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey")) order by a.id), '[]'::jsonb)
     from assets a join race_days d on d.id = a."raceDayId"
    where a.type = 'technicalGuide' and d."raceId" in (select id from scope)) as guides;
