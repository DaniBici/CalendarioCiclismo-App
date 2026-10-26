-- Cintillo del Tour de Francia 2027 (masculino y femenino) en espera del
-- embargo del 22-10-2026, junto a las jornadas y los assets de 20261021112336
-- y 20261021133303.
--
-- today_highlights admite lectura pública aunque visibleFrom sea futuro, y los
-- textos citan el recorrido: las entradas esperan en
-- private.tdf2027_embargo_highlights y la función de publicación las copia a
-- las 10:00 UTC, después de jornadas y assets. Su visibleFrom (10:05 UTC) y
-- visibleUntil fijan la ventana del cintillo; el trabajo pg_cron no cambia.

CREATE TABLE private.tdf2027_embargo_highlights (LIKE public.today_highlights INCLUDING DEFAULTS);
ALTER TABLE private.tdf2027_embargo_highlights ADD PRIMARY KEY (id);
REVOKE ALL ON TABLE private.tdf2027_embargo_highlights FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.tdf2027_embargo_highlights TO cc_agent;

CREATE OR REPLACE FUNCTION private.publish_tdf2027_embargo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
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
  WHERE NOT EXISTS (SELECT 1 FROM public.race_days d WHERE d.id = s.id OR d.slug = s.slug);
  GET DIAGNOSTICS n = ROW_COUNT;
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
    h."customDetail", h."customDetailEn", h."visibleFrom", h."visibleUntil"
  FROM private.tdf2027_embargo_highlights h
  WHERE NOT EXISTS (SELECT 1 FROM public.today_highlights x WHERE x.id = h.id);
  BEGIN
    PERFORM public._dispatch_web_pages_workflows();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Jornadas publicadas sin build de la web: %', SQLERRM;
  END;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION private.publish_tdf2027_embargo() FROM PUBLIC, anon, authenticated;
