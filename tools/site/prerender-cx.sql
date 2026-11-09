-- Volcado local de tools/site/prerender-cx.mjs --data (solo lectura):
--   node scripts/db/sql.mjs --read-only --file tools/site/prerender-cx.sql > datos.json
-- Mismas filas, columnas y orden que la lectura por API del build (las de
-- js/cx-race.js en bloque) y el mismo JSON que devuelve PostgREST (jsonb, horas
-- en UTC con +00:00): el HTML generado y su huella dependen del texto exacto de
-- cada valor.
set local timezone = 'UTC';
with races as (
  select r.* from cx_races r where r."editorialStatus" = 'published'
)
select
  (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
            'cx_race_categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.id)
                                              from cx_race_categories c where c."raceId" = r.id), '[]'::jsonb),
            'cx_tournaments', (select to_jsonb(t) from cx_tournaments t where t.id = r."tournamentId"))
          order by r.id), '[]'::jsonb)
     from races r) as races,
  (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'nameAliases', t."nameAliases",
            'uciCode', t."uciCode", 'colorHex', t."colorHex", 'headerBg', t."headerBg", 'headerText', t."headerText",
            'badgeTorsoCenter', t."badgeTorsoCenter", 'badgeTorsoSides', t."badgeTorsoSides",
            'badgeInnerCircle', t."badgeInnerCircle", 'badgeShorts', t."badgeShorts") order by t.id), '[]'::jsonb)
     from cx_teams t) as teams,
  (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
     from cx_broadcasts b where b."raceId" in (select id from races)) as broadcasts,
  (select coalesce(jsonb_agg(to_jsonb(v) order by v.id), '[]'::jsonb)
     from cx_videos v where v."raceId" in (select id from races)) as videos,
  (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
     from cx_startlist_riders s where s."raceId" in (select id from races)) as inscritos,
  (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb)
     from cx_results x where x."raceId" in (select id from races)) as results,
  (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'type', a.type, 'url', a.url, 'cxRaceId', a."cxRaceId")
          order by a.id), '[]'::jsonb)
     from assets a where a."cxRaceId" in (select id from races)) as assets,
  (select coalesce(jsonb_agg(to_jsonb(s) order by s.category, s."tournamentId"), '[]'::jsonb)
     from cx_standings_state s where s."seasonKey" in (select "seasonKey" from races)) as states,
  (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
     from cx_tournament_standings s where s."seasonKey" in (select "seasonKey" from races)) as standings,
  (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'nameEn', t."nameEn", 'slug', t.slug,
            'seasonKey', t."seasonKey", 'logoUrl', t."logoUrl", 'pointsScheme', t."pointsScheme") order by t.id), '[]'::jsonb)
     from cx_tournaments t) as tournaments,
  (select coalesce(jsonb_agg(jsonb_build_object('cxRaceId', f."cxRaceId") order by f."cxRaceId"), '[]'::jsonb)
     from cx_race_featured f) as featured,
  -- Agenda de la temporada (CX_AGENDA_SELECT de js/services/cx-data.js, del 1 de
  -- agosto al último día de febrero), por dateKey e id.
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
     from races r
    where r."dateKey" between (left(r."seasonKey", 4) || '-08-01')::date
                          and ((left(r."seasonKey", 4)::int + 1)::text || '-03-01')::date - 1) as agenda;
