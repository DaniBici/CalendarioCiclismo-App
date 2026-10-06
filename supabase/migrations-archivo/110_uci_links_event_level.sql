-- 110 — race_uci_links."uciRaceId": enlace UCI a nivel de PRUEBA (no solo de competición).
--
-- PROBLEMA. La UCI publica un Campeonato Nacional entero bajo UN único competitionId en
-- DataRide (p. ej. Hungría = #77913). Dentro de esa competición, cada prueba (línea/CRI ×
-- élite/sub23 × M/F) es un "race" separado con su propio race.Id de DataRide (p. ej. 265479
-- = "Men Under 23 - Individual Road Race") y su RaceTypeCode (IRR/ITT/TTT). En NUESTRA BD,
-- en cambio, cada prueba CN es su PROPIA ficha (races/race_days, raceFormat='one_day',
-- uciCategory='CN'): 6-7 fichas por país. El índice único uq_race_uci_links_competition
-- (UNIQUE(competitionId, disciplineId), migración 081) impide que esas 6-7 fichas compartan
-- el mismo competitionId → todas colisionaban y no se podían enlazar a la UCI (se volcaban
-- por PDF, source='pdf'). El matcher (uci-match-poc.mjs) las mandaba a 'ambiguous'.
--
-- SOLUCIÓN. Permitir enlazar cada ficha a una PRUEBA concreta dentro de la competición:
-- nueva columna uciRaceId = el race.Id de DataRide del evento. La unicidad pasa a ser por
-- (competitionId, disciplineId, uciRaceId), así N pruebas de un mismo competitionId conviven.
--
-- SENTINELA 0 (clave). uciRaceId es NOT NULL DEFAULT 0; 0 = "competición ENTERA" — el
-- comportamiento de SIEMPRE para todo lo no-CN (vueltas, clásicas, etc.): se enlaza la
-- competición completa, no una prueba suelta. 0 nunca es un race.Id real de DataRide (son
-- positivos grandes, p. ej. 265479). Se usa un sentinela explícito (no NULL + dos índices
-- parciales) a propósito: con NULL, una fila CN que por error quedara con uciRaceId NULL
-- recaería en la unicidad "competición entera" y RE-introduciría la colisión que esto
-- elimina, de forma silenciosa. Con NOT NULL DEFAULT 0 toda fila participa en un único
-- índice uniforme y "olvidé poner el id de prueba" es imposible de confundir con "es una
-- competición entera". La PK sigue siendo raceId (1 ficha = 1 enlace) → el ON CONFLICT
-- (raceId) del upsert y del panel NO cambia.
--
-- Aditivo, sin downtime. Todo lo enlazado hasta hoy queda con uciRaceId=0 (= competición
-- entera, su semántica actual). El nuevo valor !=0 solo lo usan las fichas CN.

ALTER TABLE public.race_uci_links
  ADD COLUMN IF NOT EXISTS "uciRaceId" INTEGER NOT NULL DEFAULT 0;

-- Saneo de invariante (por si alguna fila preexistente quedara NULL en un entorno raro):
UPDATE public.race_uci_links SET "uciRaceId" = 0 WHERE "uciRaceId" IS NULL;

-- Sustituir la unicidad por-competición por la unicidad por-(competición, prueba).
-- Con uciRaceId=0 para todo lo no-CN, esto preserva EXACTAMENTE la garantía anterior
-- (una competición entera no puede colgar de dos carreras) y además deja que varias
-- pruebas (uciRaceId distinto) de un mismo competitionId coexistan.
DROP INDEX IF EXISTS public.uq_race_uci_links_competition;

CREATE UNIQUE INDEX IF NOT EXISTS uq_race_uci_links_comp_event
  ON public.race_uci_links ("competitionId", "disciplineId", "uciRaceId");

COMMENT ON COLUMN public.race_uci_links."uciRaceId" IS
  'race.Id de DataRide de la PRUEBA concreta dentro de la competición (p. ej. 265479 = "Men '
  'Under 23 - IRR" dentro del CN húngaro #77913). 0 = competición ENTERA (todo lo no-CN: '
  'vueltas, clásicas… comportamiento de siempre). Solo las fichas CN usan un valor !=0. La '
  'unicidad es (competitionId, disciplineId, uciRaceId): N pruebas por competición conviven.';
