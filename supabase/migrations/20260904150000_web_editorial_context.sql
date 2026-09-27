-- Contratos aditivos para la web. Las apps existentes conservan sus columnas.
ALTER TABLE public.race_series ADD COLUMN "featuredPriority" integer
  CHECK ("featuredPriority" IS NULL OR "featuredPriority" IN (1,2));

CREATE TABLE public.daily_featured_races (
  "dateKey" text PRIMARY KEY CHECK ("dateKey" ~ '^\d{4}-\d{2}-\d{2}$'),
  "raceId" text NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.daily_featured_races ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_featured_read ON public.daily_featured_races FOR SELECT USING (true);
CREATE POLICY daily_featured_admin ON public.daily_featured_races FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
GRANT SELECT ON public.daily_featured_races TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.daily_featured_races TO authenticated;

CREATE FUNCTION public.validate_daily_featured_race() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.race_days d WHERE d."raceId"=NEW."raceId" AND d."dateKey"=NEW."dateKey") THEN
    RAISE EXCEPTION 'La carrera no tiene jornada en la fecha seleccionada';
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_daily_featured_race() FROM PUBLIC;
CREATE TRIGGER validate_daily_featured BEFORE INSERT OR UPDATE ON public.daily_featured_races
  FOR EACH ROW EXECUTE FUNCTION public.validate_daily_featured_race();

CREATE FUNCTION public.featured_races_for_dates(date_keys text[]) RETURNS TABLE("dateKey" text,"raceId" text,manual boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT dates.day, pick.id, pick.manual
  FROM (SELECT DISTINCT unnest(date_keys) AS day) dates
  CROSS JOIN LATERAL (
    SELECT r.id, (f."raceId"=r.id) IS TRUE AS manual
    FROM public.races r
    JOIN public.race_days d ON d."raceId"=r.id AND d."dateKey"=dates.day
    LEFT JOIN public.daily_featured_races f ON f."dateKey"=dates.day
    LEFT JOIN public.race_series s ON s.id=r."raceSeriesId"
    WHERE d."editorialStatus"='published'
      AND (f."raceId"=r.id OR (s."featuredPriority" IS NOT NULL AND r.gender='male'))
    ORDER BY (f."raceId"=r.id) DESC NULLS LAST, s."featuredPriority", r.id
    LIMIT 1
  ) pick
$$;
REVOKE ALL ON FUNCTION public.featured_races_for_dates(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.featured_races_for_dates(text[]) TO anon, authenticated;

CREATE TABLE public.race_classifications (
  "raceId" text NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  "classKind" text NOT NULL CHECK ("classKind" <> ''),
  position integer NOT NULL DEFAULT 0,
  "labelEs" text,
  "labelEn" text,
  "colorHex" text CHECK ("colorHex" IS NULL OR "colorHex" ~ '^#[0-9A-Fa-f]{6}$'),
  "colorSource" jsonb,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("raceId","classKind"),
  CHECK ("classKind" <> 'stage' OR "colorHex" IS NULL)
);
ALTER TABLE public.race_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY race_classifications_read ON public.race_classifications FOR SELECT USING (true);
CREATE POLICY race_classifications_admin ON public.race_classifications FOR ALL TO authenticated
  USING ((SELECT private.is_admin())) WITH CHECK ((SELECT private.is_admin()));
GRANT SELECT ON public.race_classifications TO anon, authenticated, cc_results_worker;
GRANT INSERT, UPDATE, DELETE ON public.race_classifications TO authenticated;

-- La configuración completa el inventario publicado, sin crear cuadros ficticios.
INSERT INTO public.race_classifications ("raceId","classKind",position)
SELECT DISTINCT "raceId","classKind", CASE "classKind" WHEN 'stage' THEN 0 WHEN 'gc' THEN 1
  WHEN 'points' THEN 2 WHEN 'kom' THEN 3 WHEN 'youth' THEN 4 WHEN 'teams' THEN 5 ELSE 10 END
FROM public.race_uci_stages WHERE "keepForWeb"
ON CONFLICT DO NOTHING;

ALTER TABLE public.race_days
  ADD COLUMN "raceStatus" text CHECK ("raceStatus" IS NULL OR "raceStatus" IN ('scheduled','running','finished')),
  ADD COLUMN "competitiveDistanceKm" numeric CHECK ("competitiveDistanceKm" > 0),
  ADD COLUMN "timingPolicy" text NOT NULL DEFAULT 'standard' CHECK ("timingPolicy" IN ('standard','neutralized','manual')),
  ADD COLUMN "raceTimeSeconds" numeric CHECK ("raceTimeSeconds" > 0),
  ADD COLUMN "averageSpeedKmh" numeric CHECK ("averageSpeedKmh" > 0),
  ADD COLUMN "timeLimitSeconds" numeric CHECK ("timeLimitSeconds" > 0),
  ADD COLUMN "timeLimitBasis" jsonb,
  ADD COLUMN "metricsUpdatedAt" timestamptz;

COMMENT ON COLUMN public.race_days."timeLimitSeconds" IS
  'Duración máxima autorizada en segundos desde salida competitiva. Solo se publica con timeLimitBasis válido. El reglamento de La Vuelta 2026 se estudia por separado.';
COMMENT ON COLUMN public.race_days."raceStatus" IS
  'Estado confirmado editorialmente. Nunca inferir finished de estimatedFinishTimeUtc.';
