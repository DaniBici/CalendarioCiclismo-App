-- Publicación del Tour de Francia femenino 2027 con la presentación del
-- 22-10-2026 en curso; el Tour de Francia sigue en espera.
--
-- Copia desde las tablas de espera de 20261021112336, 20261021133303 y
-- 20261021134803 las 9 jornadas, los 11 assets (9 profile, 2 ports; ficheros ya
-- en R2) y la entrada del cintillo de la carrera 25384d01, visible desde ahora.
-- Después retira esas filas de las tablas de espera, que conservan solo el Tour
-- de Francia para private.publish_tdf2027_embargo().

INSERT INTO public.race_days (
  id, "raceId", "dateKey", date, slug, "slugEn", "isRestDay", "stageNumber",
  "startLocation", "startLocationEn", "finishLocation", "finishLocationEn",
  "distanceKm", "primaryType", "secondaryType", "countryCode", timezone,
  bonuses, translations, "elevationProfile", "profileSummits", "profileWaypoints",
  "profileNotViewable", "editorialStatus", "hasAssets", "updatedAt")
SELECT
  s.id, s."raceId", s."dateKey", s.date, s.slug, s."slugEn", s."isRestDay", s."stageNumber",
  s."startLocation", s."startLocationEn", s."finishLocation", s."finishLocationEn",
  s."distanceKm", s."primaryType", s."secondaryType", s."countryCode", s.timezone,
  s.bonuses, s.translations, s."elevationProfile", s."profileSummits", s."profileWaypoints",
  s."profileNotViewable", s."editorialStatus", s."hasAssets", now()
FROM private.tdf2027_embargo_race_days s
WHERE s."raceId" = '25384d01-41d8-4222-8782-e5df3a356f7d'
  AND NOT EXISTS (SELECT 1 FROM public.race_days d WHERE d.id = s.id OR d.slug = s.slug);

INSERT INTO public.assets (id, "raceDayId", type, "sourceType", url)
SELECT a.id, a."raceDayId", a.type, a."sourceType", a.url
FROM private.tdf2027_embargo_assets a
JOIN private.tdf2027_embargo_race_days s ON s.id = a."raceDayId"
WHERE s."raceId" = '25384d01-41d8-4222-8782-e5df3a356f7d'
  AND EXISTS (SELECT 1 FROM public.race_days d WHERE d.id = a."raceDayId")
  AND NOT EXISTS (SELECT 1 FROM public.assets x
                  WHERE x.id = a.id OR (x."raceDayId" = a."raceDayId" AND x.type = a.type));

INSERT INTO public.today_highlights (
  id, position, scope, "targetType", "raceId", "customTitle", "customTitleEn",
  "customDetail", "customDetailEn", "visibleFrom", "visibleUntil")
SELECT h.id, h.position, h.scope, h."targetType", h."raceId", h."customTitle", h."customTitleEn",
  h."customDetail", h."customDetailEn", now(), h."visibleUntil"
FROM private.tdf2027_embargo_highlights h
WHERE h."raceId" = '25384d01-41d8-4222-8782-e5df3a356f7d'
  AND NOT EXISTS (SELECT 1 FROM public.today_highlights x WHERE x.id = h.id);

DELETE FROM private.tdf2027_embargo_highlights
WHERE "raceId" = '25384d01-41d8-4222-8782-e5df3a356f7d';

DELETE FROM private.tdf2027_embargo_assets a
USING private.tdf2027_embargo_race_days s
WHERE s.id = a."raceDayId" AND s."raceId" = '25384d01-41d8-4222-8782-e5df3a356f7d';

DELETE FROM private.tdf2027_embargo_race_days
WHERE "raceId" = '25384d01-41d8-4222-8782-e5df3a356f7d';
