-- Destacadas de ciclocross: selección editorial manual (corona del panel).
-- Una fila marca la prueba como destacada; sin regla automática. Una prueba
-- destacada encabeza su día en la vista Hoy de Ciclocross y en la pestaña
-- Ciclocross de Resultados (web y apps 5.1); el resto conserva el orden
-- canónico.
CREATE TABLE public.cx_race_featured (
  "cxRaceId" text PRIMARY KEY REFERENCES public.cx_races(id) ON DELETE CASCADE,
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cx_race_featured ENABLE ROW LEVEL SECURITY;
CREATE POLICY cx_race_featured_read ON public.cx_race_featured
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY cx_race_featured_admin ON public.cx_race_featured
  FOR ALL TO authenticated USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));
GRANT SELECT ON public.cx_race_featured TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.cx_race_featured TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cx_race_featured TO cc_agent;
