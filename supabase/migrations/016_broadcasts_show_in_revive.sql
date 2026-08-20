-- Añade columna showInRevive a broadcasts.
-- Cuando está a true, la emisión aparece en la sección "Revive" aunque no sea
-- Eurosport / HBO Max / YouTube (esos se siguen mostrando siempre).
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS "showInRevive" BOOLEAN NOT NULL DEFAULT false;
