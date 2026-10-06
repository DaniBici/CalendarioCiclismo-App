-- Recuperada el 2026-09-28 de supabase_migrations.schema_migrations.statements
-- (versión 20260623161638, nombre 110_race_days_inherit_slug_from_oneday_race). Texto aplicado en producción, sin cambios.

-- Red de seguridad: en carreras de un día, una jornada (race_day) debe compartir el
-- slug ES del race padre. El seeding ad-hoc por MCP (p. ej. el pipeline de Campeonatos
-- Nacionales, ver memoria project_cn_uci_dump_pipeline) insertaba race_days rellenando
-- slugEn pero dejándose slug ES en NULL → las URLs caían a /jornada.html?id=<uuid>
-- (sin SEO, sin App Link nativo). Este trigger hereda el slug ES del padre cuando viene
-- NULL, igual que ya hacían (a mano) las 349 one-day correctas y como hace el editor
-- del panel. NO toca stage races (cada etapa tiene su propio slug) ni pisa un slug provisto.

CREATE OR REPLACE FUNCTION public.race_day_inherit_slug_from_oneday_race()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_race_format text;
  v_race_slug   text;
BEGIN
  -- Solo intervenimos si la jornada no trae slug ES.
  IF NEW.slug IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."raceId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r."raceFormat", r.slug
    INTO v_race_format, v_race_slug
  FROM public.races r
  WHERE r.id = NEW."raceId";

  -- Solo en carreras de un día: ahí la jornada es la prueba y comparte el slug del race.
  -- En stage races cada etapa lleva su propio slug → no heredar.
  IF v_race_format = 'one_day' AND v_race_slug IS NOT NULL THEN
    NEW.slug := v_race_slug;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS race_days_inherit_slug_oneday ON public.race_days;

CREATE TRIGGER race_days_inherit_slug_oneday
  BEFORE INSERT OR UPDATE OF slug, "raceId"
  ON public.race_days
  FOR EACH ROW
  EXECUTE FUNCTION public.race_day_inherit_slug_from_oneday_race();
