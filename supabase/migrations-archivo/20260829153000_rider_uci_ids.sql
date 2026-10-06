-- Identificador estable de ficha de corredor en la UCI.
--
-- `globalRiderId` sigue siendo la identidad interna de Calendario Ciclismo.
-- Este campo conserva el identificador numérico de /rider-details/<id> para
-- resolver futuras fuentes sin depender del dorsal ni del slug del nombre.
-- Se mantiene separado por género porque el catálogo actual también lo está.

ALTER TABLE public.riders_men
  ADD COLUMN IF NOT EXISTS "uciId" text;

ALTER TABLE public.riders_women
  ADD COLUMN IF NOT EXISTS "uciId" text;

COMMENT ON COLUMN public.riders_men."uciId" IS
  'Identificador de la ficha de corredor en la UCI (/rider-details/<id>). No sustituye a globalRiderId.';

COMMENT ON COLUMN public.riders_women."uciId" IS
  'Identificador de la ficha de corredor en la UCI (/rider-details/<id>). No sustituye a globalRiderId.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_riders_men_uci_id
  ON public.riders_men ("uciId")
  WHERE "uciId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_riders_women_uci_id
  ON public.riders_women ("uciId")
  WHERE "uciId" IS NOT NULL;
