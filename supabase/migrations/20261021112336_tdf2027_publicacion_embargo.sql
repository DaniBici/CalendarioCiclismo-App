-- Publicación diferida de las jornadas del Tour de Francia 2027 (masculino y
-- femenino), presentado el 22-10-2026 bajo embargo hasta las 12:00 de Madrid.
--
-- Las jornadas esperan en private.tdf2027_embargo_race_days, fuera de la API y
-- sin lectura pública. El trabajo pg_cron 'tdf2027-embargo' (cron.timezone GMT)
-- se ejecuta a las 10:00 UTC del 22-10-2026: copia las filas a race_days, lanza
-- el build completo de la web y se desprograma. La condición de fecha impide
-- que se repita el 22-10 de otro año si la ejecución falla antes de
-- desprogramarse.

CREATE TABLE private.tdf2027_embargo_race_days (LIKE public.race_days INCLUDING DEFAULTS);
ALTER TABLE private.tdf2027_embargo_race_days ADD PRIMARY KEY (id);
REVOKE ALL ON TABLE private.tdf2027_embargo_race_days FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.tdf2027_embargo_race_days TO cc_agent;

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
  BEGIN
    PERFORM public._dispatch_web_pages_workflows();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Jornadas publicadas sin build de la web: %', SQLERRM;
  END;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION private.publish_tdf2027_embargo() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('tdf2027-embargo', '0 10 22 10 *', $job$
  SELECT private.publish_tdf2027_embargo() WHERE now() < timestamptz '2026-10-23 00:00+00';
  SELECT cron.unschedule('tdf2027-embargo');
$job$);
