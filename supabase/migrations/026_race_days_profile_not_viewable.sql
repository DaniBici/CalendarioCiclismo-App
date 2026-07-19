-- Toggle "No visualizable": cuando TRUE no se genera página pública de perfil
-- ni se sustituye el botón de perfil en la página de jornada.
ALTER TABLE race_days
  ADD COLUMN IF NOT EXISTS "profileNotViewable" BOOLEAN NOT NULL DEFAULT FALSE;
