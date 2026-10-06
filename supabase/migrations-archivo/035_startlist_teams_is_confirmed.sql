-- Permite marcar un equipo de una lista provisional como confirmado.
-- Solo tiene efecto visual cuando races.startlistProvisional = true.
ALTER TABLE startlist_teams ADD COLUMN IF NOT EXISTS "isConfirmed" BOOLEAN DEFAULT FALSE;
