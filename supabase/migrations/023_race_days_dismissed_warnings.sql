-- Permite ocultar avisos concretos de "datos faltantes" en la zona de tareas
-- del panel de administración. El array contiene claves estables (no etiquetas
-- localizadas) por jornada: 'startLocation', 'distanceKm', 'primaryType',
-- 'times', 'tv', 'assets', 'roadbook', 'profile', 'map', 'startOrder',
-- 'live_text', 'inscritos', 'website', 'bcNoTime', 'bcNoLink'.
ALTER TABLE race_days
  ADD COLUMN IF NOT EXISTS "dismissedWarnings" JSONB NOT NULL DEFAULT '[]'::jsonb;
