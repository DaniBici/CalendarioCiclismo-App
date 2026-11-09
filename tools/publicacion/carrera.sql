-- Datos de las páginas de resultados de unas carreras ($1, lista de ids): las lecturas de
-- tools/site/prerender-resultados.sql acotadas a ellas. Solo lectura.
with escogidas as (
  select r.* from races r where r.id = any($1::text[])
), stages as (
  select u.* from race_uci_stages u where u."raceId" = any($1::text[]) and u."keepForWeb" and u."rowCount" > 0
), filas as (
  select x.* from race_uci_results x join stages u on u.id = x."stageRef"
), jornadas as (
  select d.* from race_days d where d."raceId" = any($1::text[]) and d."editorialStatus" = 'published'
), lista as (
  select s."raceId", s.dorsal, s."firstName", s."lastName", s."countryCode", s."teamId", s."globalRiderId", s.id
    from startlist_riders_resolved s where s."raceId" = any($1::text[])
), equipos_lista as (
  select st.* from startlist_teams st where st."raceId" = any($1::text[])
), fichas as (
  select distinct "globalRiderId" as id from filas where "globalRiderId" is not null
), ficha_men as (
  select m.id, m."firstName", m."lastName", m.nationality, m."currentTeamId" from riders_men m where not m."historicalCatalogOnly" and m.id in (select id from fichas)
), ficha_women as (
  select w.id, w."firstName", w."lastName", w.nationality, w."currentTeamId" from riders_women w where not w."historicalCatalogOnly" and w.id in (select id from fichas)
), ids_equipo as (
  select "teamId" as id from filas where "teamId" is not null
  union select "currentTeamId" from ficha_men where "currentTeamId" is not null
  union select "currentTeamId" from ficha_women where "currentTeamId" is not null
), visibles as (
  select t.* from teams t where not t."historicalCatalogOnly"
), columnas_temporada as (
  select s."teamId", s.year, s.name, s.category, s."headerBg", s."headerText", s."badgeTorsoCenter", s."badgeTorsoSides", s."badgeInnerCircle", s."badgeShorts", s.id from team_seasons s
)
select
  (select coalesce(json_agg(to_json(r) order by r.id), '[]'::json) from escogidas r) as races,
  (select coalesce(json_agg(to_json(d) order by d.id), '[]'::json) from jornadas d) as race_days,
  (select coalesce(json_agg(to_json(a) order by a.id), '[]'::json) from assets a where a."raceDayId" in (select id from jornadas)) as assets,
  (select coalesce(json_agg((to_jsonb(a) || jsonb_build_object('race_days', jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey"))) order by a.id), '[]'::json)
     from assets a join race_days d on d.id = a."raceDayId" where a.type = 'technicalGuide' and d."raceId" = any($1::text[])) as guides,
  (select coalesce(json_agg(to_json(u) order by u.id), '[]'::json) from stages u) as resultados_stages,
  (select coalesce(json_agg(to_json(c) order by c."raceId", c."classKind"), '[]'::json) from race_classifications c where c."raceId" = any($1::text[])) as resultados_classifications,
  (select coalesce(json_agg(json_build_object('raceId', s."raceId", 'dorsal', s.dorsal, 'firstName', s."firstName", 'lastName', s."lastName", 'countryCode', s."countryCode", 'teamId', s."teamId", 'globalRiderId', s."globalRiderId") order by s.id), '[]'::json) from lista s) as resultados_riders,
  (select coalesce(json_agg(json_build_object('id', st.id, 'raceId', st."raceId", 'teamId', st."teamId", 'teamName', st."teamName", 'team', (
              select json_build_object('id', t.id, 'name', t.name, 'category', t.category, 'nameAliases', t."nameAliases", 'badgeTorsoCenter', t."badgeTorsoCenter",
                       'badgeTorsoSides', t."badgeTorsoSides", 'badgeShorts', t."badgeShorts", 'badgeInnerCircle', t."badgeInnerCircle", 'teamKind', t."teamKind",
                       'selectionScope', t."selectionScope", 'countryCode', t."countryCode", 'selectionCode', t."selectionCode",
                       'team_seasons', coalesce((select json_agg(json_build_object('teamId', s."teamId", 'name', s.name, 'category', s.category, 'headerBg', s."headerBg", 'headerText', s."headerText",
                                  'badgeTorsoCenter', s."badgeTorsoCenter", 'badgeTorsoSides', s."badgeTorsoSides", 'badgeInnerCircle', s."badgeInnerCircle", 'badgeShorts', s."badgeShorts") order by s.id)
                           from columnas_temporada s where s."teamId" = t.id and s.year = r.year), '[]'::json))
                from visibles t where t.id = st."teamId")) order by st.id), '[]'::json)
     from equipos_lista st join escogidas r on r.id = st."raceId") as resultados_teams,
  (select coalesce(json_agg(json_build_object('stageRef', x."stageRef", 'rank', x.rank, 'rankText', x."rankText", 'bib', x.bib, 'riderDisplay', x."riderDisplay", 'globalRiderId', x."globalRiderId", 'teamId', x."teamId",
            'resultValue', x."resultValue", 'timeText', x."timeText", 'gapText', x."gapText", 'points', x.points, 'uciPoints', x."uciPoints", 'irm', x.irm, 'sortOrder', x."sortOrder") order by x.id), '[]'::json) from filas x) as resultados_results,
  (select coalesce(json_agg(to_json(m) order by m.id), '[]'::json) from ficha_men m) as resultados_riders_men,
  (select coalesce(json_agg(to_json(w) order by w.id), '[]'::json) from ficha_women w) as resultados_riders_women,
  (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'category', t.category, 'nameAliases', t."nameAliases", 'badgeTorsoCenter', t."badgeTorsoCenter", 'badgeTorsoSides', t."badgeTorsoSides",
            'badgeShorts', t."badgeShorts", 'badgeInnerCircle', t."badgeInnerCircle", 'teamKind', t."teamKind", 'selectionScope', t."selectionScope", 'countryCode', t."countryCode", 'selectionCode', t."selectionCode") order by t.id), '[]'::json)
     from visibles t where t.id in (select id from ids_equipo)) as resultados_team_list,
  (select coalesce(json_agg(json_build_object('teamId', s."teamId", 'year', s.year, 'name', s.name, 'category', s.category, 'headerBg', s."headerBg", 'headerText', s."headerText",
            'badgeTorsoCenter', s."badgeTorsoCenter", 'badgeTorsoSides', s."badgeTorsoSides", 'badgeInnerCircle', s."badgeInnerCircle", 'badgeShorts', s."badgeShorts") order by s.id), '[]'::json)
     from columnas_temporada s where s."teamId" in (select id from ids_equipo)) as resultados_team_seasons;
