-- Volcado local de tools/site/prerender-jornadas.mjs --data (solo lectura):
--   node scripts/db/sql.mjs --read-only --file tools/site/prerender-jornadas.sql > datos.json
-- Mismas filas que la lectura por API del build y el mismo JSON que devuelve
-- PostgREST (jsonb, horas en UTC con +00:00): el HTML generado y su huella
-- dependen del texto exacto de cada valor.
set local timezone = 'UTC';
select
  (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb)
     from race_days d where d."editorialStatus" = 'published') as days,
  (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb)
     from races r) as races,
  (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
     from broadcasts b) as broadcasts,
  (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb)
     from assets a) as assets,
  (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('race_days',
            jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey")) order by a.id), '[]'::jsonb)
     from assets a join race_days d on d.id = a."raceDayId"
    where a.type = 'technicalGuide') as guides,
  (select coalesce(jsonb_agg(jsonb_build_object('raceId', u."raceId", 'raceDayId', u."raceDayId",
            'stageNumber', u."stageNumber") order by u.id), '[]'::jsonb)
     from race_uci_stages u where u."keepForWeb" and u."rowCount" > 0) as uci;
