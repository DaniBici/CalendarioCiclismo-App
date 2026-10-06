-- Cintillo: destino 'season' (calendario de una temporada). Web abre
-- /calendario/ en la subvista Temporada del año indicado; las apps, la
-- pestaña Calendario en Temporada con ese año. Solo carretera.
-- Sin GRANT nuevos: los privilegios de today_highlights son de tabla.

ALTER TABLE public.today_highlights ADD COLUMN "seasonYear" smallint;
ALTER TABLE public.today_highlights ADD CONSTRAINT today_highlights_season_year_check CHECK (
  ("targetType" = 'season') = ("seasonYear" IS NOT NULL)
  AND ("seasonYear" IS NULL OR "seasonYear" >= 2026)
);
ALTER TABLE public.today_highlights DROP CONSTRAINT today_highlights_targettype_check;
ALTER TABLE public.today_highlights ADD CONSTRAINT today_highlights_targettype_check
  CHECK ("targetType" IN ('raceDay','startlist','startOrder','race','custom','championships','transfers','season','cxRace','cxTournament'));
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
    OR "targetType" IN ('championships','transfers','season')
  ))
);
