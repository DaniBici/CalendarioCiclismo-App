-- ═══════════════════════════════════════════════════════════════════
--  CALENDARIO CICLISMO — Limpieza de tvStatus pending sin datos
--
--  Pone a NULL el tvStatus de jornadas que tienen 'pending' pero
--  no tienen ningún broadcast asociado (nunca se revisó la TV).
--  El valor NULL significa "sin información de TV", distinto de
--  'pending' (en revisión) o 'none' (sin retransmisión confirmada).
-- ═══════════════════════════════════════════════════════════════════

UPDATE race_days
SET    "tvStatus" = NULL
WHERE  "tvStatus" = 'pending'
  AND  id NOT IN (
         SELECT DISTINCT "raceDayId"
         FROM   broadcasts
         WHERE  "raceDayId" IS NOT NULL
       );
