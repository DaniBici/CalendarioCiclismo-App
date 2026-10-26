-- Assets del Tour de Francia 2027 (perfiles y fichas de puertos) en espera del
-- embargo del 22-10-2026, junto a las jornadas de 20261021112336.
--
-- Las filas esperan en private.tdf2027_embargo_assets, sin lectura pública. Los
-- ficheros se suben a R2 a las 10:00 UTC desde el VPS con URL prefirmadas
-- (tarea at en /root/maintenance/tdf2027-embargo). La función de publicación
-- copia las filas de assets después de las jornadas y antes de lanzar el build
-- de la web; el trabajo pg_cron tdf2027-embargo no cambia.

CREATE TABLE private.tdf2027_embargo_assets (LIKE public.assets INCLUDING DEFAULTS);
ALTER TABLE private.tdf2027_embargo_assets ADD PRIMARY KEY (id);
REVOKE ALL ON TABLE private.tdf2027_embargo_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.tdf2027_embargo_assets TO cc_agent;

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
  BEGIN
    PERFORM public._dispatch_web_pages_workflows();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Jornadas publicadas sin build de la web: %', SQLERRM;
  END;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION private.publish_tdf2027_embargo() FROM PUBLIC, anon, authenticated;
