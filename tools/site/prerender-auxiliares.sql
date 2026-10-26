-- Volcado local de tools/site/prerender-auxiliares.mjs --data (solo lectura):
--   node scripts/db/sql.mjs --read-only --file tools/site/prerender-auxiliares.sql > datos.json
-- Mismas filas, columnas y orden que la lectura del build (volcado compartido
-- y ORDEN de tools/site/site_data.py) y el mismo JSON que devuelve PostgREST
-- (horas en UTC con +00:00): el HTML generado y su huella dependen del texto
-- exacto de cada valor. Equipos del catálogo con el filtro de la clave
-- anónima (sin historicalCatalogOnly). start_order_entries_resolved se lee con
-- el rol de agentes, que no aplica RLS: el 2026-10-22, ninguna fila casaba con
-- una ficha o un equipo ocultos a la clave anónima.
set local timezone = 'UTC';
with orden_days as (
  select d.id, d."raceId" from race_days d
   where d."editorialStatus" = 'published' and d."startOrderImportedAt" is not null
), visible_teams as (
  select t.* from teams t where not t."historicalCatalogOnly"
)
select
  (select coalesce(json_agg(to_json(d) order by d.id), '[]'::json)
     from race_days d where d."editorialStatus" = 'published') as days,
  (select coalesce(json_agg(to_json(r) order by r.id), '[]'::json) from races r) as races,
  (select coalesce(json_agg(to_json(a) order by a.id), '[]'::json) from assets a) as assets,
  (select coalesce(json_agg((to_jsonb(a) || jsonb_build_object('race_days',
            jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey"))) order by a.id), '[]'::json)
     from assets a join race_days d on d.id = a."raceDayId"
    where a.type = 'technicalGuide') as guides,
  (select coalesce(json_agg(to_json(e) order by e."sortOrder", e.id), '[]'::json)
     from start_order_entries_resolved e where e."raceDayId" in (select id from orden_days)) as orden_entries,
  (select coalesce(json_agg(json_build_object('raceId', st."raceId", 'teamId', st."teamId", 'team', (
              select jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
                       'nameAliases', t."nameAliases", 'badgeTorsoCenter', t."badgeTorsoCenter",
                       'badgeTorsoSides', t."badgeTorsoSides", 'badgeShorts', t."badgeShorts",
                       'badgeInnerCircle', t."badgeInnerCircle", 'teamKind', t."teamKind",
                       'selectionScope', t."selectionScope", 'countryCode', t."countryCode",
                       'selectionCode', t."selectionCode")
                     || case when r.year is null then '{}'::jsonb else jsonb_build_object('team_seasons', coalesce((
                         select jsonb_agg(jsonb_build_object('teamId', s."teamId", 'name', s.name,
                                  'category', s.category, 'headerBg', s."headerBg", 'headerText', s."headerText",
                                  'badgeTorsoCenter', s."badgeTorsoCenter", 'badgeTorsoSides', s."badgeTorsoSides",
                                  'badgeInnerCircle', s."badgeInnerCircle", 'badgeShorts', s."badgeShorts")
                                  order by s.id)
                           from team_seasons s where s."teamId" = t.id and s.year = r.year), '[]'::jsonb)) end
                from visible_teams t where t.id = st."teamId"))
          order by st.id), '[]'::json)
     from startlist_teams st join races r on r.id = st."raceId"
    where st."raceId" in (select "raceId" from orden_days)) as orden_teams;
