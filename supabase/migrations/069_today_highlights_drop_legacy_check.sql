-- Bug en migración 068: el DROP CONSTRAINT no eliminó el constraint
-- original `today_highlights_targetType_check` (camelCase) porque PostgreSQL
-- normaliza identifiers sin comillas a lowercase. El constraint quedó
-- duplicado y el viejo (sin 'race') seguía vetando inserciones.

ALTER TABLE public.today_highlights
  DROP CONSTRAINT IF EXISTS "today_highlights_targetType_check";

-- Tras esta migración solo queda `today_highlights_targettype_check` (lowercase,
-- creado por 068) que acepta 'raceDay','startlist','startOrder','race'.
