-- Perfiles en imagen y logos alojados en assets.calendariociclismo.app.
--
-- Decisión de Dani (2026-09-29): los perfiles existentes en PDF o WEBP y los
-- logos externos se conservan; desde ahora un perfil nuevo o sustituido es
-- JPG o PNG y un logo nuevo o sustituido vive en la zona de assets propia.
-- Los triggers solo validan filas nuevas o valores cambiados.

CREATE OR REPLACE FUNCTION private.guard_profile_image_format()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.type = 'profile' AND NEW.url IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.url IS DISTINCT FROM OLD.url OR NEW.type IS DISTINCT FROM OLD.type)
     AND NEW.url !~* '\.(jpe?g|png)([?#].*)?$' THEN
    RAISE EXCEPTION 'El perfil debe ser una imagen JPG o PNG: %', NEW.url USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.guard_logo_hosted()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  new_url text := nullif(btrim(to_jsonb(NEW) ->> TG_ARGV[0]), '');
  old_url text := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> TG_ARGV[0] END;
BEGIN
  IF new_url IS NOT NULL AND new_url IS DISTINCT FROM old_url
     AND new_url NOT LIKE 'https://assets.calendariociclismo.app/%' THEN
    RAISE EXCEPTION 'El logo debe alojarse en https://assets.calendariociclismo.app/: %', new_url USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.guard_profile_image_format() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_logo_hosted() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_profile_image_format
  BEFORE INSERT OR UPDATE OF url, type ON public.assets
  FOR EACH ROW EXECUTE FUNCTION private.guard_profile_image_format();

CREATE TRIGGER guard_logo_hosted
  BEFORE INSERT OR UPDATE OF "logoUrl" ON public.races
  FOR EACH ROW EXECUTE FUNCTION private.guard_logo_hosted('logoUrl');
CREATE TRIGGER guard_logo_hosted
  BEFORE INSERT OR UPDATE OF "logoUrl" ON public.cx_races
  FOR EACH ROW EXECUTE FUNCTION private.guard_logo_hosted('logoUrl');
CREATE TRIGGER guard_logo_hosted
  BEFORE INSERT OR UPDATE OF "logoUrl" ON public.cx_tournaments
  FOR EACH ROW EXECUTE FUNCTION private.guard_logo_hosted('logoUrl');
CREATE TRIGGER guard_logo_hosted
  BEFORE INSERT OR UPDATE OF "logoUrl" ON public.challenge_groups
  FOR EACH ROW EXECUTE FUNCTION private.guard_logo_hosted('logoUrl');
CREATE TRIGGER guard_logo_hosted
  BEFORE INSERT OR UPDATE OF "customLogo" ON public.today_highlights
  FOR EACH ROW EXECUTE FUNCTION private.guard_logo_hosted('customLogo');
