-- Tabla today_highlights — cintillo manual editado desde panel admin
-- Sustituye la lógica automática (WorldTour 15d) del cintillo web.
-- Consumida por web (js/app.js) + iOS (TodayHighlightsBanner) + Android (TodayHighlightsBanner).

CREATE TABLE IF NOT EXISTS public.today_highlights (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  position INTEGER NOT NULL DEFAULT 0,
  "targetType" TEXT NOT NULL CHECK ("targetType" IN ('raceDay','startlist','startOrder')),
  "raceId" TEXT REFERENCES public.races(id) ON DELETE CASCADE,
  "raceDayId" TEXT REFERENCES public.race_days(id) ON DELETE CASCADE,
  "customTitle" TEXT,
  "customTitleEn" TEXT,
  "customDetail" TEXT,
  "customDetailEn" TEXT,
  "visibleFrom" DATE,
  "visibleUntil" DATE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT today_highlights_target_check CHECK (
    ("targetType" = 'startlist' AND "raceId" IS NOT NULL) OR
    ("targetType" IN ('raceDay','startOrder') AND "raceDayId" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_today_highlights_position
  ON public.today_highlights(position);

CREATE INDEX IF NOT EXISTS idx_today_highlights_visibility
  ON public.today_highlights("visibleFrom", "visibleUntil");

-- Trigger updatedAt
CREATE OR REPLACE FUNCTION public.today_highlights_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_today_highlights_updated_at ON public.today_highlights;
CREATE TRIGGER trg_today_highlights_updated_at
  BEFORE UPDATE ON public.today_highlights
  FOR EACH ROW EXECUTE FUNCTION public.today_highlights_set_updated_at();

-- RLS: lectura pública, escritura autenticados
ALTER TABLE public.today_highlights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS today_highlights_select_public ON public.today_highlights;
CREATE POLICY today_highlights_select_public
  ON public.today_highlights FOR SELECT
  USING (true);

DROP POLICY IF EXISTS today_highlights_insert_authed ON public.today_highlights;
CREATE POLICY today_highlights_insert_authed
  ON public.today_highlights FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS today_highlights_update_authed ON public.today_highlights;
CREATE POLICY today_highlights_update_authed
  ON public.today_highlights FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS today_highlights_delete_authed ON public.today_highlights;
CREATE POLICY today_highlights_delete_authed
  ON public.today_highlights FOR DELETE
  TO authenticated
  USING (true);

COMMENT ON TABLE public.today_highlights IS
  'Cintillo manual editado desde panel admin. Sustituye la query automática WorldTour 15d del cintillo web. Cada fila apunta a una jornada, startlist u orden de salida.';

COMMENT ON COLUMN public.today_highlights."targetType" IS
  'Tipo de destino: raceDay (detalle jornada), startlist (inscritos), startOrder (orden de salida). Define qué URL se renderiza.';
