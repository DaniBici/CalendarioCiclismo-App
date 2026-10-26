-- Volcado local de tools/site/prerender-resultados.mjs --data (solo lectura):
--   node scripts/db/sql.mjs --read-only --file tools/site/prerender-resultados.sql > datos.json
-- Mismas filas, columnas y orden que las lecturas de resultados del volcado
-- compartido del build (RESULTADOS de tools/site/site_data.py) y el mismo JSON
-- que devuelve PostgREST (horas en UTC con +00:00): el HTML generado y su
-- huella dependen del texto exacto de cada valor. json_agg y no jsonb_agg: con
-- ~350.000 filas, jsonb_agg tarda más de diez minutos. Las tablas con RLS para
-- la clave anónima (teams, riders_*) llevan su mismo filtro. Carreras: las que
-- tienen clasificaciones (keepForWeb, con filas); filas de resultados: las de
-- todas sus clasificaciones (el prerender elige la de cada página).
set local timezone = 'UTC';
with scope as (
  select distinct u."raceId" as id from race_uci_stages u where u."keepForWeb" and u."rowCount" > 0
), stages as (
  select u.* from race_uci_stages u where u."keepForWeb" and u."rowCount" > 0
), visible_teams as (
  select t.* from teams t where not t."historicalCatalogOnly"
)
select
  (select coalesce(json_agg(to_json(r) order by r.id), '[]'::json) from races r) as races,
  (select coalesce(json_agg(to_json(d) order by d.id), '[]'::json)
     from race_days d where d."editorialStatus" = 'published') as race_days,
  (select coalesce(json_agg(to_json(a) order by a.id), '[]'::json) from assets a) as assets,
  (select coalesce(json_agg((to_jsonb(a) || jsonb_build_object('race_days',
            jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey"))) order by a.id), '[]'::json)
     from assets a join race_days d on d.id = a."raceDayId"
    where a.type = 'technicalGuide') as guides,
  (select coalesce(json_agg(to_json(u) order by u.id), '[]'::json) from stages u) as resultados_stages,
  (select coalesce(json_agg(to_json(c) order by c."raceId", c."classKind"), '[]'::json)
     from race_classifications c where c."raceId" in (select id from scope)) as resultados_classifications,
  (select coalesce(json_agg(json_build_object('raceId', s."raceId", 'dorsal', s.dorsal, 'firstName', s."firstName",
            'lastName', s."lastName", 'countryCode', s."countryCode", 'teamId', s."teamId",
            'globalRiderId', s."globalRiderId") order by s.id), '[]'::json)
     from startlist_riders_resolved s where s."raceId" in (select id from scope)) as resultados_riders,
  (select coalesce(json_agg(json_build_object('id', st.id, 'raceId', st."raceId", 'teamId', st."teamId",
            'teamName', st."teamName", 'team', (
              select json_build_object('id', t.id, 'name', t.name, 'category', t.category,
                       'nameAliases', t."nameAliases", 'badgeTorsoCenter', t."badgeTorsoCenter",
                       'badgeTorsoSides', t."badgeTorsoSides", 'badgeShorts', t."badgeShorts",
                       'badgeInnerCircle', t."badgeInnerCircle", 'teamKind', t."teamKind",
                       'selectionScope', t."selectionScope", 'countryCode', t."countryCode",
                       'selectionCode', t."selectionCode",
                       'team_seasons', coalesce((
                         select json_agg(json_build_object('teamId', s."teamId", 'name', s.name,
                                  'category', s.category, 'headerBg', s."headerBg", 'headerText', s."headerText",
                                  'badgeTorsoCenter', s."badgeTorsoCenter", 'badgeTorsoSides', s."badgeTorsoSides",
                                  'badgeInnerCircle', s."badgeInnerCircle", 'badgeShorts', s."badgeShorts")
                                  order by s.id)
                           from team_seasons s where s."teamId" = t.id and s.year = r.year), '[]'::json))
                from visible_teams t where t.id = st."teamId"))
          order by st.id), '[]'::json)
     from startlist_teams st join races r on r.id = st."raceId"
    where st."raceId" in (select id from scope)) as resultados_teams,
  (select coalesce(json_agg(json_build_object('stageRef', x."stageRef", 'rank', x.rank, 'rankText', x."rankText",
            'bib', x.bib, 'riderDisplay', x."riderDisplay", 'globalRiderId', x."globalRiderId", 'teamId', x."teamId",
            'resultValue', x."resultValue", 'timeText', x."timeText", 'gapText', x."gapText", 'points', x.points,
            'uciPoints', x."uciPoints", 'irm', x.irm, 'sortOrder', x."sortOrder") order by x.id), '[]'::json)
     from race_uci_results x join race_uci_stages u on u.id = x."stageRef"
    where u."keepForWeb" and u."rowCount" > 0) as resultados_results,
  (select coalesce(json_agg(json_build_object('id', m.id, 'firstName', m."firstName", 'lastName', m."lastName",
            'nationality', m.nationality, 'currentTeamId', m."currentTeamId") order by m.id), '[]'::json)
     from riders_men m where not m."historicalCatalogOnly") as resultados_riders_men,
  (select coalesce(json_agg(json_build_object('id', w.id, 'firstName', w."firstName", 'lastName', w."lastName",
            'nationality', w.nationality, 'currentTeamId', w."currentTeamId") order by w.id), '[]'::json)
     from riders_women w where not w."historicalCatalogOnly") as resultados_riders_women,
  (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'category', t.category,
            'nameAliases', t."nameAliases", 'badgeTorsoCenter', t."badgeTorsoCenter",
            'badgeTorsoSides', t."badgeTorsoSides", 'badgeShorts', t."badgeShorts",
            'badgeInnerCircle', t."badgeInnerCircle", 'teamKind', t."teamKind",
            'selectionScope', t."selectionScope", 'countryCode', t."countryCode",
            'selectionCode', t."selectionCode") order by t.id), '[]'::json)
     from visible_teams t) as resultados_team_list,
  (select coalesce(json_agg(json_build_object('teamId', s."teamId", 'year', s.year, 'name', s.name,
            'category', s.category, 'headerBg', s."headerBg", 'headerText', s."headerText",
            'badgeTorsoCenter', s."badgeTorsoCenter", 'badgeTorsoSides', s."badgeTorsoSides",
            'badgeInnerCircle', s."badgeInnerCircle", 'badgeShorts', s."badgeShorts") order by s.id), '[]'::json)
     from team_seasons s) as resultados_team_seasons;
