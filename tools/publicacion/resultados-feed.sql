-- Datos de Últimos resultados en la temporada (RESULTS_SEASON_START): las lecturas de
-- js/services/result-feed-entries.js y result-feed-context.js en una sola consulta,
-- con el mismo JSON que la API, más el ránking UCI. Solo lectura.
set local timezone = 'UTC';
with carreras as (
  select r.* from races r where r."endDate" is null or r."endDate" >= '2026-01-01'
), clasificaciones as (
  select u.* from race_uci_stages u join carreras c on c.id = u."raceId" where u."keepForWeb" and u."rowCount" > 0
), ganadores as (
  select x."stageRef", x."raceId", x.bib, x."globalRiderId", x."teamId", x."riderDisplay", x.irm, x.rank
    from race_uci_results x join clasificaciones u on u.id = x."stageRef" where x.rank = 1
), jornadas as (
  select d.* from race_days d join carreras c on c.id = d."raceId" where d."editorialStatus" = 'published'
), inscritos as (
  select distinct on (s.id) s.id, s."raceId", s.dorsal, s."globalRiderId", s."firstName", s."lastName", s."countryCode", s."teamId"
    from startlist_riders_resolved s join ganadores g on g."raceId" = s."raceId"
     and (g."globalRiderId" = s."globalRiderId" or g.bib::text = s.dorsal::text)
), equipos_lista as (
  select l.id, l."teamId", l."teamName" from startlist_teams l where l.id in (select "teamId" from inscritos)
), fichas as (
  select "globalRiderId" as id from ganadores where "globalRiderId" is not null
  union select "globalRiderId" from inscritos where "globalRiderId" is not null
)
select
  (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'nameEn', c."nameEn", 'slug', c.slug, 'slugEn', c."slugEn",
            'year', c.year, 'countryCode', c."countryCode", 'gender', c.gender, 'raceFormat', c."raceFormat", 'uciCategory', c."uciCategory",
            'colorHex', c."colorHex", 'isGrandTour', c."isGrandTour", 'startDate', c."startDate", 'endDate', c."endDate", 'logoUrl', c."logoUrl")
          order by c.id), '[]'::json) from carreras c) as races,
  (select coalesce(json_agg(json_build_object('id', u.id, 'raceId', u."raceId", 'raceDayId', u."raceDayId", 'stageNumber', u."stageNumber",
            'classKind', u."classKind", 'stageDate', u."stageDate", 'winnerName', u."winnerName", 'isFinalClassification', u."isFinalClassification",
            'publicationStatus', u."publicationStatus", 'updatedAt', u."updatedAt", 'keepForWeb', u."keepForWeb", 'rowCount', u."rowCount")
          order by u.id), '[]'::json) from clasificaciones u) as race_uci_stages,
  (select coalesce(json_agg(json_build_object('id', d.id, 'raceId', d."raceId", 'dateKey', d."dateKey", 'stageNumber', d."stageNumber",
            'isRestDay', d."isRestDay", 'isCancelledDay', d."isCancelledDay", 'estimatedFinishTimeUtc', d."estimatedFinishTimeUtc",
            'neutralStartTimeUtc', d."neutralStartTimeUtc", 'realStartTimeUtc', d."realStartTimeUtc", 'distanceKm', d."distanceKm",
            'elevationGain', d."elevationProfile"->'elevationGain', 'primaryType', d."primaryType", 'secondaryType', d."secondaryType",
            'countryCode', d."countryCode", 'raceStatus', d."raceStatus", 'profileNotViewable', d."profileNotViewable",
            'editorialStatus', d."editorialStatus") order by d.id), '[]'::json) from jornadas d) as race_days,
  (select coalesce(json_agg(to_json(k) order by k."raceId", k."classKind"), '[]'::json)
     from race_classifications k join carreras c on c.id = k."raceId") as race_classifications,
  (select coalesce(json_agg(to_json(g) order by g."stageRef"), '[]'::json) from ganadores g) as race_uci_results,
  (select coalesce(json_agg(json_build_object('id', m.id, 'firstName', m."firstName", 'lastName', m."lastName", 'nationality', m.nationality) order by m.id), '[]'::json)
     from riders_men m where not m."historicalCatalogOnly" and m.id in (select id from fichas)) as riders_men,
  (select coalesce(json_agg(json_build_object('id', w.id, 'firstName', w."firstName", 'lastName', w."lastName", 'nationality', w.nationality) order by w.id), '[]'::json)
     from riders_women w where not w."historicalCatalogOnly" and w.id in (select id from fichas)) as riders_women,
  (select coalesce(json_agg(to_json(s) order by s.id), '[]'::json) from inscritos s) as startlist_riders_resolved,
  (select coalesce(json_agg(to_json(l) order by l.id), '[]'::json) from equipos_lista l) as startlist_teams,
  (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'teamKind', t."teamKind", 'selectionScope', t."selectionScope",
            'countryCode', t."countryCode", 'selectionCode', t."selectionCode") order by t.id), '[]'::json)
     from teams t where not t."historicalCatalogOnly"
      and (t.id in (select "teamId" from equipos_lista) or t.id in (select "teamId" from ganadores))) as teams,
  (select coalesce(json_agg(to_json(f) order by f."dateKey", f."raceId"), '[]'::json)
     from featured_races_for_dates((select array_agg(distinct d."dateKey") from jornadas d where d."dateKey" >= '2026-01-01')) f) as featured,
  (select coalesce(json_agg(json_build_object('gender', r.gender, 'rank', r.rank, 'previousRank', r."previousRank", 'uciTeamId', r."uciTeamId",
            'teamId', r."teamId", 'teamCategory', r."teamCategory", 'sourceName', r."sourceName", 'displayName', r."displayName",
            'teamCode', r."teamCode", 'countryCode', r."countryCode", 'points', r.points, 'rankingDate', r."rankingDate", 'sourceUrl', r."sourceUrl")
          order by r.gender, r.rank), '[]'::json) from uci_team_rankings r) as uci_team_rankings;
