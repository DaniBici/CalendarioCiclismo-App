-- Add ALL to the country check constraint
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_country_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_country_check
  CHECK (country IN ('ES', 'LATAM', 'INT', 'ALL', 'EUROPA'));

-- Backfill ES: Spanish channels
UPDATE broadcasts SET country = 'ES' WHERE country IS NULL AND (
  channel ILIKE 'Teledeporte%'
  OR channel ILIKE 'RTVE Play%'
  OR channel ILIKE 'Eurosport%HBO Max%'
  OR channel = 'HBO Max'
  OR channel ILIKE 'Esport3%'
  OR channel ILIKE 'ETB1%'
  OR channel ILIKE 'TVG%'
  OR channel ILIKE 'A Galega%'
  OR channel ILIKE 'RTPA%'
  OR channel ILIKE 'Canal Deporte%'
  OR channel = 'G2'
  OR channel ILIKE 'G2%'
);

-- Backfill ALL: everything that is not ES (YouTube, international, LATAM, etc.)
UPDATE broadcasts SET country = 'ALL' WHERE country IS NULL;
