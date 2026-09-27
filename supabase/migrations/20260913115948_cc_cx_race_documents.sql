-- CC-CX: documentos de carrera CX en la tabla común `assets`.
-- Dos huecos por carrera CX (technicalGuide = Libro de Ruta, map = Mapa);
-- la web oficial vive en cx_races."websiteUrl" y no se duplica aquí.

ALTER TABLE public.assets
  ADD COLUMN "cxRaceId" text REFERENCES public.cx_races(id) ON DELETE CASCADE;

-- La propiedad pasa a ser excluyente: jornada (carretera) o carrera CX.
ALTER TABLE public.assets ALTER COLUMN "raceDayId" DROP NOT NULL;

-- Cada fila pertenece a una jornada (carretera) o a una carrera CX, nunca a ambas.
ALTER TABLE public.assets
  ADD CONSTRAINT assets_owner_check CHECK (("raceDayId" IS NOT NULL) <> ("cxRaceId" IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_assets_cxraceid_type ON public.assets ("cxRaceId", type);

-- El trigger anti-duplicados pasa a delimitar por propietario real de la fila:
-- (raceDayId, cxRaceId) con nulos comparados de forma total, de modo que una
-- carrera CX tampoco admita dos assets del mismo tipo.
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

  -- Serializa inserciones concurrentes de la misma combinación propietario + tipo.
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

REVOKE ALL ON FUNCTION public.prevent_duplicate_asset_type() FROM PUBLIC;

DROP TRIGGER IF EXISTS prevent_duplicate_asset_type ON public.assets;

CREATE TRIGGER prevent_duplicate_asset_type
BEFORE INSERT OR UPDATE OF "raceDayId", "cxRaceId", type ON public.assets
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_asset_type();

NOTIFY pgrst, 'reload schema';
