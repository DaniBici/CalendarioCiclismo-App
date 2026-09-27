-- Cintillo independiente por sección: carretera y ciclocross dejan de compartir
-- entradas. Cada fila declara su `scope` y los destinos CX ganan la página de
-- torneo (`cxTournament`) además de la ficha de prueba (`cxRace`).
-- No cambia la resolución ni el render de carretera: las filas existentes y las
-- nuevas de carretera conservan `scope = 'road'` (valor por defecto).

ALTER TABLE public.today_highlights
  ADD COLUMN scope text NOT NULL DEFAULT 'road',
  ADD COLUMN "cxTournamentId" text REFERENCES public.cx_tournaments(id) ON DELETE CASCADE;

-- Compatibilidad con las filas CX ya existentes del cintillo compartido.
UPDATE public.today_highlights SET scope = 'cx' WHERE "targetType" = 'cxRace';

ALTER TABLE public.today_highlights
  ADD CONSTRAINT today_highlights_scope_check CHECK (scope IN ('road','cx'));
ALTER TABLE public.today_highlights DROP CONSTRAINT today_highlights_targettype_check;
ALTER TABLE public.today_highlights ADD CONSTRAINT today_highlights_targettype_check
  CHECK ("targetType" IN ('raceDay','startlist','startOrder','race','custom','championships','transfers','cxRace','cxTournament'));
ALTER TABLE public.today_highlights DROP CONSTRAINT today_highlights_target_check;
ALTER TABLE public.today_highlights ADD CONSTRAINT today_highlights_target_check CHECK (
  (scope = 'cx' AND (
    ("targetType" = 'cxRace' AND "cxRaceId" IS NOT NULL AND "cxTournamentId" IS NULL
      AND "raceId" IS NULL AND "raceDayId" IS NULL AND "customUrl" IS NULL)
    OR ("targetType" = 'cxTournament' AND "cxTournamentId" IS NOT NULL AND "cxRaceId" IS NULL
      AND "raceId" IS NULL AND "raceDayId" IS NULL AND "customUrl" IS NULL)
  ))
  OR (scope = 'road' AND "cxRaceId" IS NULL AND "cxTournamentId" IS NULL AND (
    ("targetType" IN ('startlist','race') AND "raceId" IS NOT NULL)
    OR ("targetType" IN ('raceDay','startOrder') AND "raceDayId" IS NOT NULL)
    OR ("targetType" = 'custom' AND "customUrl" IS NOT NULL)
    OR "targetType" IN ('championships','transfers')
  ))
);

CREATE INDEX today_highlights_scope_position_idx ON public.today_highlights(scope, position);
CREATE INDEX today_highlights_cx_tournament_idx ON public.today_highlights("cxTournamentId") WHERE "cxTournamentId" IS NOT NULL;

COMMENT ON COLUMN public.today_highlights.scope IS 'Sección del cintillo: road (Hoy/carretera) o cx (sección Ciclocross). Independiza ambas superficies.';
COMMENT ON COLUMN public.today_highlights."cxTournamentId" IS 'Destino CX a la página de torneo (/ciclocross/torneos/<slug>/, /en/cyclocross/series/<slug>/).';

NOTIFY pgrst, 'reload schema';
