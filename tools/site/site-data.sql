-- Volcado compartido en local (solo lectura), equivalente a site_data.fetch():
--   node scripts/db/sql.mjs --read-only --file tools/site/site-data.sql > datos.json
--   python3 tools/site/site_data.py --from-sql datos.json <directorio>
-- Mismas filas, columnas y orden por id que la lectura por API, con las horas
-- en UTC (+00:00) como las devuelve PostgREST. Las relaciones embebidas de
-- cx_races salen sin orden, como en la API.
-- Lecturas del prerender de inscritos (inscritos_*): carreras con lista que
-- terminan (o empiezan, sin fecha de fin) desde `since`, la ventana de
-- PRERENDER_INSCRITOS=es|all (hoy, UTC, menos 7 días); con `since` null, todas
-- las carreras con lista (listas). En jsonb, como prerender-inscritos.sql; cada
-- carrera conserva el orden de la API (equipos por sortOrder e id, corredores
-- por dorsal e id, etapas y abandonos por id).
set local timezone = 'UTC';
with params as (
  select (current_date - 7)::text as since
), inscritos as (
  select r.* from races r, params p
   where (p.since is null or coalesce(r."endDate", r."startDate") >= p.since)
     and exists (select 1 from startlist_teams t where t."raceId" = r.id)
), inscritos_stages as (
  select u.* from race_uci_stages u
   where u."raceId" in (select id from inscritos) and u."classKind" = 'stage'
)
select
  (select coalesce(json_agg(to_json(r) order by r.id), '[]') from races r) as races,
  (select coalesce(json_agg(to_json(d) order by d.id), '[]')
     from race_days d where d."editorialStatus" = 'published') as race_days,
  (select coalesce(json_agg(json_build_object('raceId', u."raceId", 'raceDayId', u."raceDayId",
            'stageNumber', u."stageNumber", 'updatedAt', u."updatedAt", 'rowCount', u."rowCount",
            'keepForWeb', u."keepForWeb") order by u.id), '[]')
     from race_uci_stages u where u."keepForWeb") as race_uci_stages,
  (select coalesce(json_agg(json_build_object('raceId', t."raceId") order by t.id), '[]')
     from startlist_teams t) as startlist_teams,
  (select coalesce(json_agg(to_json(a) order by a.id), '[]') from assets a) as assets,
  (select coalesce(json_agg(json_build_object(
            'id', c.id, 'name', c.name, 'nameEn', c."nameEn", 'slug', c.slug, 'slugEn', c."slugEn",
            'seasonKey', c."seasonKey", 'dateKey', c."dateKey", 'endDateKey', c."endDateKey",
            'class', c.class, 'countryCode', c."countryCode", 'venue', c.venue,
            'websiteUrl', c."websiteUrl", 'logoUrl', c."logoUrl", 'isCancelled', c."isCancelled",
            'createdAt', c."createdAt", 'updatedAt', c."updatedAt",
            'cx_tournaments', (select json_build_object('id', t.id, 'name', t.name, 'nameEn', t."nameEn",
                                 'slug', t.slug, 'seasonKey', t."seasonKey", 'logoUrl', t."logoUrl",
                                 'updatedAt', t."updatedAt")
                                 from cx_tournaments t
                                where t.id = c."tournamentId" and t."seasonKey" = c."seasonKey"),
            'cx_race_categories', coalesce((select json_agg(json_build_object('category', k.category,
                                 'dateKey', k."dateKey", 'startTimeUtc', k."startTimeUtc",
                                 'isCancelled', k."isCancelled", 'resultsStatus', k."resultsStatus"))
                                 from cx_race_categories k where k."raceId" = c.id), '[]'),
            'cx_videos', coalesce((select json_agg(json_build_object('id', v.id, 'url', v.url))
                                 from cx_videos v where v."raceId" = c.id), '[]')
          ) order by c.id), '[]')
     from cx_races c where c."editorialStatus" = 'published') as cx_races,
  (select coalesce(json_agg(to_json(b) order by b.id), '[]') from broadcasts b) as broadcasts,
  (select coalesce(json_agg((to_jsonb(a) || jsonb_build_object('race_days',
            jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey"))) order by a.id), '[]')
     from assets a join race_days d on d.id = a."raceDayId"
    where a.type = 'technicalGuide') as guides,
  (select coalesce(json_agg(to_json(s)), '[]') from startlist_counts() s) as startlist_counts,
  (select since from params) as inscritos_since,
  (select coalesce(jsonb_agg(to_jsonb(st) || jsonb_build_object('team', (
            select to_jsonb(t) || jsonb_build_object('team_seasons', coalesce((
                     select jsonb_agg(to_jsonb(s) order by s.id) from team_seasons s where s."teamId" = t.id), '[]'::jsonb))
              from teams t where t.id = st."teamId"))
          order by st."sortOrder", st.id), '[]'::jsonb)
     from startlist_teams st where st."raceId" in (select id from inscritos)) as inscritos_teams,
  (select coalesce(jsonb_agg(to_jsonb(s) order by s.dorsal, s.id), '[]'::jsonb)
     from startlist_riders_resolved s
    where s."raceId" in (select id from inscritos) and s."teamId" is not null) as inscritos_riders,
  (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'raceId', u."raceId", 'stageNumber', u."stageNumber",
            'rowCount', u."rowCount") order by u.id), '[]'::jsonb)
     from inscritos_stages u) as inscritos_stages,
  (select coalesce(jsonb_agg(jsonb_build_object('globalRiderId', x."globalRiderId", 'irm', x.irm, 'stageRef', x."stageRef")
          order by x.id), '[]'::jsonb)
     from race_uci_results x
    where x."stageRef" in (select id from inscritos_stages where "rowCount" > 0)
      and x."globalRiderId" is not null and x.irm is not null) as inscritos_results;
