-- Datos de la portada de ciclocross: agenda y rondas de cada temporada, destacadas
-- y lo que lee el cintillo. Mismas filas y JSON que la API (CX_AGENDA_SELECT de
-- js/services/cx-data.js y prerender-cx.sql). Solo lectura.
with publicadas as (
  select r.* from cx_races r where r."editorialStatus" = 'published'
), destacadas as (
  select coalesce(jsonb_agg(jsonb_build_object('cxRaceId', f."cxRaceId") order by f."cxRaceId"), '[]'::jsonb) as filas from cx_race_featured f
), cintillo as (
  select * from today_highlights
)
select
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'nameEn', r."nameEn", 'slug', r.slug,
            'slugEn', r."slugEn", 'seasonKey', r."seasonKey", 'dateKey', r."dateKey", 'endDateKey', r."endDateKey",
            'class', r.class, 'countryCode', r."countryCode", 'venue', r.venue, 'tournamentId', r."tournamentId",
            'colorHex', r."colorHex", 'logoUrl', r."logoUrl", 'isCancelled', r."isCancelled", 'timezone', r.timezone, 'tvStatus', r."tvStatus",
            'assets', coalesce((select jsonb_agg(jsonb_build_object('type', a.type, 'url', a.url) order by a.id)
                                  from assets a where a."cxRaceId" = r.id), '[]'::jsonb),
            'cx_tournaments', (select jsonb_build_object('id', t.id, 'name', t.name, 'nameEn', t."nameEn", 'slug', t.slug,
                                        'colorHex', t."colorHex", 'logoUrl', t."logoUrl")
                                 from cx_tournaments t where t.id = r."tournamentId"),
            'cx_race_categories', coalesce((select jsonb_agg(jsonb_build_object('category', c.category,
                                        'startTimeUtc', c."startTimeUtc", 'dateKey', c."dateKey", 'sortOrder', c."sortOrder",
                                        'isCancelled', c."isCancelled", 'resultsStatus', c."resultsStatus",
                                        'winnerName', c."winnerName", 'durationFormat', c."durationFormat",
                                        'durationRuleVersion', c."durationRuleVersion", 'durationMinutes', c."durationMinutes",
                                        'durationRuleSourceUrl', c."durationRuleSourceUrl",
                                        'startlistImportedAt', c."startlistImportedAt") order by c.id)
                                        from cx_race_categories c where c."raceId" = r.id), '[]'::jsonb),
            'cx_broadcasts', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'category', b.category,
                                        'channel', b.channel, 'startTimeUtc', b."startTimeUtc", 'url', b.url,
                                        'country', b.country, 'sortOrder', b."sortOrder", 'embeddable', b.embeddable)
                                        order by b.id) from cx_broadcasts b where b."raceId" = r.id), '[]'::jsonb),
            'cx_videos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'category', v.category, 'url', v.url,
                                        'sortOrder', v."sortOrder") order by v.id)
                                        from cx_videos v where v."raceId" = r.id), '[]'::jsonb))
          order by r."dateKey", r.id), '[]'::jsonb)
     from publicadas r
    where r."dateKey" between (left(r."seasonKey", 4) || '-08-01')::date
                          and ((left(r."seasonKey", 4)::int + 1)::text || '-03-01')::date - 1) as agenda,
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'tournamentId', r."tournamentId", 'dateKey', r."dateKey",
            'seasonKey', r."seasonKey", 'isCancelled', r."isCancelled",
            'cx_race_categories', coalesce((select jsonb_agg(jsonb_build_object('dateKey', c."dateKey",
                                        'startTimeUtc', c."startTimeUtc", 'isCancelled', c."isCancelled") order by c.id)
                                        from cx_race_categories c where c."raceId" = r.id), '[]'::jsonb))
          order by r.id), '[]'::jsonb)
     from publicadas r
    where r."dateKey" between (left(r."seasonKey", 4) || '-08-01')::date
                          and ((left(r."seasonKey", 4)::int + 1)::text || '-03-01')::date - 1) as rondas,
  (select filas from destacadas) as featured,
  (select coalesce(jsonb_agg(to_jsonb(h) order by h.position), '[]'::jsonb) from cintillo h) as today_highlights,
  (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'nameEn', r."nameEn", 'logoUrl', r."logoUrl",
            'slug', r.slug, 'slugEn', r."slugEn", 'hideFlag', r."hideFlag", 'countryCode', r."countryCode",
            'startlistImportedAt', r."startlistImportedAt")), '[]'::jsonb)
     from races r where r.id in (select "raceId" from cintillo where "raceId" is not null)) as races,
  (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'raceId', d."raceId", 'slug', d.slug, 'slugEn', d."slugEn",
            'date', d.date, 'stageNumber', d."stageNumber", 'startLocation', d."startLocation", 'finishLocation', d."finishLocation",
            'race', (select jsonb_build_object('id', r.id, 'name', r.name, 'nameEn', r."nameEn", 'logoUrl', r."logoUrl",
                       'slug', r.slug, 'slugEn', r."slugEn", 'hideFlag', r."hideFlag", 'countryCode', r."countryCode",
                       'startlistImportedAt', r."startlistImportedAt") from races r where r.id = d."raceId"))), '[]'::jsonb)
     from race_days d where d.id in (select "raceDayId" from cintillo where "raceDayId" is not null)) as race_days,
  (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'nameEn', t."nameEn", 'slug', t.slug,
            'seasonKey', t."seasonKey", 'logoUrl', t."logoUrl")), '[]'::jsonb)
     from cx_tournaments t where t.id in (select "cxTournamentId" from cintillo where "cxTournamentId" is not null)) as cx_tournaments
