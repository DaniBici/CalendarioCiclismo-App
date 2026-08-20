ALTER TABLE race_days
  ADD COLUMN IF NOT EXISTS "profileSummits"   JSONB,
  ADD COLUMN IF NOT EXISTS "profileWaypoints" JSONB;
