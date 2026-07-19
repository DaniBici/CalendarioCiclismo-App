-- races: English name, English slug, translations JSONB
ALTER TABLE races ADD COLUMN IF NOT EXISTS "nameEn" TEXT;
ALTER TABLE races ADD COLUMN IF NOT EXISTS "slugEn" TEXT UNIQUE;
ALTER TABLE races ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

-- race_days: English city names, English slug, translations JSONB
ALTER TABLE race_days ADD COLUMN IF NOT EXISTS "startLocationEn" TEXT;
ALTER TABLE race_days ADD COLUMN IF NOT EXISTS "finishLocationEn" TEXT;
ALTER TABLE race_days ADD COLUMN IF NOT EXISTS "slugEn" TEXT UNIQUE;
ALTER TABLE race_days ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

-- broadcasts: country grouping (ES / LATAM / INT) + translations JSONB
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS country TEXT
  CHECK (country IN ('ES', 'LATAM', 'INT'));
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_broadcasts_country ON broadcasts (country);

-- challenge_groups: translations JSONB
ALTER TABLE challenge_groups ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

-- teams: translations JSONB
ALTER TABLE teams ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;
