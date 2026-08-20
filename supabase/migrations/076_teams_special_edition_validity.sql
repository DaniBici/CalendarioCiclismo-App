-- ═══════════════════════════════════════════════════════════════════
--  VIGENCIA DE LOS MAILLOTS specialEdition — teams.specialEdition{ValidFrom,ValidTo,RaceId}
--
--  Algunos equipos tienen una ficha `specialEdition=true` que representa
--  una DENOMINACIÓN/DISEÑO vigente solo durante un tramo de la temporada
--  o en una carrera concreta. Ejemplos 2026:
--    - INEOS Grenadiers → nombre del equipo HASTA abril (luego Netcompany INEOS).
--    - Canyon//SRAM zondacrypto → HASTA el Giro (luego cae el sponsor).
--    - Uno-X amarillo / Lotto Ladies → maillot especial SOLO en La Vuelta Femenina.
--
--  Hasta ahora esa vigencia era IMPLÍCITA (solo se deducía de a qué carreras
--  asignaba el editor la ficha). Esto la hace EXPLÍCITA y validable:
--    - Patrón TRAMO temporal → rango [validFrom..validTo] (validFrom NULL = desde inicio de temporada).
--    - Patrón maillot de UNA carrera → specialEditionRaceId (FK a races).
--  Regla del modelo: se usa rango O raceId, no ambos.
--
--  El RENDER no cambia (sigue obedeciendo startlist_teams.teamId, que ya
--  apunta a la denominación correcta por fecha). Estos campos son metadato
--  para DOCUMENTAR la vigencia y permitir al panel VALIDAR de forma
--  bloqueante la asignación de un specialEdition a una startlist.
--
--  Va SOLO en `teams` (la ficha specialEdition es una identidad estable);
--  nullable, sin default → equipos normales no se ven afectados. Las columnas
--  viajan gratis por select('*'); el decode tolerante de apps las ignora.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS "specialEditionValidFrom" date,
  ADD COLUMN IF NOT EXISTS "specialEditionValidTo"   date,
  ADD COLUMN IF NOT EXISTS "specialEditionRaceId"    text
    REFERENCES races(id) ON DELETE SET NULL;

COMMENT ON COLUMN teams."specialEditionValidFrom" IS
  'Solo para specialEdition=true (patrón tramo). Inicio de vigencia del maillot. '
  'NULL = vigente desde el inicio de la temporada.';
COMMENT ON COLUMN teams."specialEditionValidTo" IS
  'Solo para specialEdition=true (patrón tramo). Fin de vigencia del maillot (inclusive).';
COMMENT ON COLUMN teams."specialEditionRaceId" IS
  'Solo para specialEdition=true (patrón maillot de una carrera). FK a la carrera '
  'concreta donde aplica el diseño especial. Excluyente con el rango validFrom/validTo.';

-- Índice: el panel busca specialEdition por carrera al validar una asignación.
CREATE INDEX IF NOT EXISTS idx_teams_special_edition_race
  ON teams ("specialEditionRaceId")
  WHERE "specialEditionRaceId" IS NOT NULL;
