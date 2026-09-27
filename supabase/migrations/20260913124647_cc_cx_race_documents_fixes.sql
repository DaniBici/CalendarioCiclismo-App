-- Correcciones aplicadas tras la primera ejecución de cc_cx_race_documents:
-- - "raceDayId" pasa a admitir nulos (propiedad excluyente jornada/carrera CX).
-- - El marcador del propietario ausente es chr(1): chr(0) no es válido en text.
ALTER TABLE public.assets ALTER COLUMN "raceDayId" DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_asset_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  owner_key text;
BEGIN
  IF new.type IS NULL THEN
    RETURN new;
  END IF;

  -- chr(1) distingue el propietario ausente; chr(0) no es válido en text.
  owner_key := coalesce(new."raceDayId", chr(1)) || chr(31) || coalesce(new."cxRaceId", chr(1));

  PERFORM pg_advisory_xact_lock(hashtextextended(owner_key || chr(31) || new.type, 0));

  IF EXISTS (
    SELECT 1
    FROM public.assets a
    WHERE a.type = new.type
      AND a.id IS DISTINCT FROM new.id
      AND a."raceDayId" IS NOT DISTINCT FROM new."raceDayId"
      AND a."cxRaceId" IS NOT DISTINCT FROM new."cxRaceId"
  ) THEN
    RAISE EXCEPTION USING
      errcode = 'unique_violation',
      message = 'Ya existe un asset de este tipo en la jornada';
  END IF;

  RETURN new;
END;
$$;
