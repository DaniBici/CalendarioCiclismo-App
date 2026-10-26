-- Publicación del Tour de Francia 2027 tras su presentación del 22-10-2026.
--
-- Copia desde las tablas de espera de 20261021112336, 20261021133303 y
-- 20261021134803 las 24 jornadas (21 etapas y 3 días de descanso), los 16
-- assets (7 profile, 9 ports; ficheros ya en R2) y la entrada del cintillo de
-- la carrera 7294e12f, visible desde ahora. El Tour femenino se publicó en
-- 20261022094333, así que las tablas de espera quedan vacías y se retiran con
-- private.publish_tdf2027_embargo(). El build incremental se lanza aparte.

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
WHERE s."raceId" = '7294e12f-9467-4ae9-9c96-156012c03d89'
  AND NOT EXISTS (SELECT 1 FROM public.race_days d WHERE d.id = s.id OR d.slug = s.slug);

INSERT INTO public.assets (id, "raceDayId", type, "sourceType", url)
SELECT a.id, a."raceDayId", a.type, a."sourceType", a.url
FROM private.tdf2027_embargo_assets a
WHERE EXISTS (SELECT 1 FROM public.race_days d WHERE d.id = a."raceDayId")
  AND NOT EXISTS (SELECT 1 FROM public.assets x
                  WHERE x.id = a.id OR (x."raceDayId" = a."raceDayId" AND x.type = a.type));

INSERT INTO public.today_highlights (
  id, position, scope, "targetType", "raceId", "customTitle", "customTitleEn",
  "customDetail", "customDetailEn", "visibleFrom", "visibleUntil")
SELECT h.id, h.position, h.scope, h."targetType", h."raceId", h."customTitle", h."customTitleEn",
  h."customDetail", h."customDetailEn", now(), h."visibleUntil"
FROM private.tdf2027_embargo_highlights h
WHERE NOT EXISTS (SELECT 1 FROM public.today_highlights x WHERE x.id = h.id);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.race_days WHERE "raceId" = '7294e12f-9467-4ae9-9c96-156012c03d89') <> 24
     OR (SELECT count(*) FROM public.assets a JOIN public.race_days d ON d.id = a."raceDayId"
         WHERE d."raceId" = '7294e12f-9467-4ae9-9c96-156012c03d89') <> 16
     OR NOT EXISTS (SELECT 1 FROM public.today_highlights WHERE "raceId" = '7294e12f-9467-4ae9-9c96-156012c03d89') THEN
    RAISE EXCEPTION 'Publicación incompleta del Tour de Francia 2027';
  END IF;
END $$;

DROP FUNCTION private.publish_tdf2027_embargo();
DROP TABLE private.tdf2027_embargo_highlights;
DROP TABLE private.tdf2027_embargo_assets;
DROP TABLE private.tdf2027_embargo_race_days;
