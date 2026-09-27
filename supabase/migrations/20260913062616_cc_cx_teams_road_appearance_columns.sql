-- Columnas cromáticas de equipos CX alineadas con carretera (teams).
-- Aplicada en producción el 2026-09-13 (registro 20260913062616
-- cc_cx_teams_road_appearance_columns); el archivo sincroniza el historial
-- del repositorio con el estado ya aplicado.
ALTER TABLE public.cx_teams
  ADD COLUMN IF NOT EXISTS "headerBg"         TEXT NOT NULL DEFAULT '#1f2937',
  ADD COLUMN IF NOT EXISTS "headerText"       TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS "badgeTorsoCenter" TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS "badgeTorsoSides"  TEXT NOT NULL DEFAULT '#000000',
  ADD COLUMN IF NOT EXISTS "badgeInnerCircle" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "badgeShorts"      TEXT NOT NULL DEFAULT '#000000';
