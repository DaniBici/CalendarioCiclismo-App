-- ═══════════════════════════════════════════════════════════════════
--  races.startlistProvisional — marca una lista de inscritos como
--  "provisional". El render (web e iOS/Android) sustituye la etiqueta
--  "Inscritos/Inscritas" por "Lista provisional" manteniendo el mismo
--  icono y comportamiento.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS "startlistProvisional" BOOLEAN NOT NULL DEFAULT FALSE;
