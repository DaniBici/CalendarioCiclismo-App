-- F4: categoría opcional CX y destino propio para el único emisor send-push.
ALTER TABLE public.push_subscription_categories
  DROP CONSTRAINT chk_push_subscription_categories_category,
  ADD CONSTRAINT chk_push_subscription_categories_category
    CHECK (category IN ('general','race_start','tv_start','results','cyclocross'));
ALTER TABLE public.push_notifications
  DROP CONSTRAINT chk_push_notifications_category,
  ADD CONSTRAINT chk_push_notifications_category
    CHECK (category IN ('general','race_start','tv_start','results','cyclocross')),
  ADD COLUMN "cxRaceId" text REFERENCES public.cx_races(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_push_notifications_cx_target CHECK (
    ("cxRaceId" IS NULL OR category = 'cyclocross') AND
    (category <> 'cyclocross' OR ("raceId" IS NULL AND "raceDayId" IS NULL))
  );
ALTER TABLE public.scheduled_push_notifications
  DROP CONSTRAINT chk_scheduled_push_notifications_category,
  ADD CONSTRAINT chk_scheduled_push_notifications_category
    CHECK (category IN ('general','race_start','tv_start','results','cyclocross')),
  ADD COLUMN "cxRaceId" text REFERENCES public.cx_races(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_scheduled_push_notifications_cx_target CHECK (
    ("cxRaceId" IS NULL OR category = 'cyclocross') AND
    (category <> 'cyclocross' OR ("raceId" IS NULL AND "raceDayId" IS NULL))
  );
CREATE INDEX push_notifications_cx_race_idx ON public.push_notifications("cxRaceId") WHERE "cxRaceId" IS NOT NULL;
CREATE INDEX scheduled_push_notifications_cx_race_idx ON public.scheduled_push_notifications("cxRaceId") WHERE "cxRaceId" IS NOT NULL;

-- RLS y políticas administrativas endurecidas existentes se conservan.
ALTER TABLE public.push_subscription_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_push_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ("cxRaceId") ON public.push_notifications TO anon, authenticated, service_role;
GRANT INSERT ("cxRaceId"), UPDATE ("cxRaceId") ON public.push_notifications TO authenticated, service_role;
GRANT SELECT ("cxRaceId"), INSERT ("cxRaceId"), UPDATE ("cxRaceId") ON public.scheduled_push_notifications TO authenticated, service_role;
COMMENT ON COLUMN public.push_notifications."cxRaceId" IS 'Destino CX propio; categoría cyclocross, sin IDs de carretera. Historial público sin suscripciones.';
COMMENT ON COLUMN public.scheduled_push_notifications."cxRaceId" IS 'Destino CX propio. send-push comprueba publicación, cancelación y agosto-febrero al despachar; no hereda filtros de carretera.';
