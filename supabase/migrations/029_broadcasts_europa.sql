-- Add EUROPA group to broadcasts.country; reclassify Eurosport/HBO Max from ES → EUROPA

-- 1. Drop old constraint and add the new one (ALL, ES, LATAM, EUROPA)
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_country_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_country_check
  CHECK (country IN ('ALL', 'ES', 'LATAM', 'EUROPA'));

-- 2. Migrate legacy INT values to ALL
UPDATE broadcasts SET country = 'ALL' WHERE country = 'INT';

-- 3. Move Eurosport and HBO Max from ES → EUROPA
UPDATE broadcasts SET country = 'EUROPA'
WHERE country = 'ES' AND (
  channel ILIKE 'Eurosport%'
  OR channel = 'HBO Max'
  OR channel ILIKE 'HBO Max%'
  OR channel ILIKE 'Max %'
  OR channel ILIKE 'play.max%'
);
