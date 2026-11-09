-- Datos del calendario publicado: carreras y jornadas de cada temporada, grupos y lo que
-- lee el modal de las pruebas sin página. Mismas columnas que js/temporada.js y
-- js/calendario-mes.js, con el mismo JSON que la API. Solo lectura.
set local timezone = 'UTC';
with carreras as (
  select r.* from races r where r.year >= 2026
), jornadas as (
  select d.* from race_days d where d."editorialStatus" = 'published' and d."dateKey" >= '2026-01-01'
), con_modal as (
  select d.id, d."raceId" from jornadas d join carreras r on r.id = d."raceId"
   where r."raceFormat" = 'one_day'
     and (r."isNoClickable" or not coalesce(d."hasAssets", false) or d."profileNotViewable" or d."elevationProfile"->'points'->1 is null)
)
select
  (select coalesce(json_agg(json_build_object('id', r.id, 'name', r.name, 'nameEn', r."nameEn", 'slug', r.slug, 'slugEn', r."slugEn", 'year', r.year,
            'startDate', r."startDate", 'endDate', r."endDate", 'raceFormat', r."raceFormat", 'uciCategory', r."uciCategory", 'gender', r.gender,
            'countryCode', r."countryCode", 'colorHex', r."colorHex", 'logoUrl', r."logoUrl", 'hideFlag', r."hideFlag", 'isCancelled', r."isCancelled",
            'isNoClickable', r."isNoClickable", 'websiteUrl', r."websiteUrl") order by r.id), '[]'::json) from carreras r) as races,
  (select coalesce(json_agg(json_build_object('id', d.id, 'raceId', d."raceId", 'dateKey', d."dateKey", 'stageNumber', d."stageNumber", 'slug', d.slug, 'slugEn', d."slugEn",
            'hasAssets', d."hasAssets", 'profileNotViewable', d."profileNotViewable", 'profilePoint', d."elevationProfile"->'points'->1,
            'startLocation', d."startLocation", 'startLocationEn', d."startLocationEn", 'finishLocation', d."finishLocation", 'finishLocationEn', d."finishLocationEn",
            'countryCode', d."countryCode", 'primaryType', d."primaryType", 'isRestDay', d."isRestDay", 'isCancelledDay', d."isCancelledDay", 'distanceKm', d."distanceKm",
            'neutralStartTimeUtc', d."neutralStartTimeUtc", 'estimatedFinishTimeUtc', d."estimatedFinishTimeUtc", 'tvStatus', d."tvStatus",
            'description', left(d.description, 1), 'notes', left(d.notes, 1)) order by d.id), '[]'::json) from jornadas d) as race_days,
  (select coalesce(json_agg(to_json(g) order by g.id), '[]'::json) from challenge_groups g) as challenge_groups,
  (select coalesce(json_agg(json_build_object(
            'id', m.id,
            'race', (select to_json(r) from carreras r where r.id = m."raceId"),
            'rd', (select to_json(d) from jornadas d where d.id = m.id),
            'broadcasts', coalesce((select json_agg(to_json(b) order by b."sortOrder") from broadcasts b where b."raceDayId" = m.id), '[]'::json),
            'assets', coalesce((select json_agg(to_json(a) order by a.id) from assets a where a."raceDayId" = m.id), '[]'::json),
            'clasificaciones', coalesce((select json_agg(json_build_object('raceId', u."raceId", 'raceDayId', u."raceDayId", 'stageNumber', u."stageNumber", 'keepForWeb', u."keepForWeb", 'rowCount', u."rowCount"))
                                  from race_uci_stages u where u."raceId" = m."raceId" and u."keepForWeb" and u."rowCount" > 0), '[]'::json),
            'equipos', (select count(*) from startlist_teams l where l."raceId" = m."raceId"))
          order by m.id), '[]'::json) from con_modal m) as modal;
