-- Ampliación de grupos en broadcasts.country.
-- Antes: ALL | ES | LATAM | EUROPA
-- Ahora: añadimos grupos europeos por país/zona (PT, FR, BE, NL, IT, DE_AT_CH, UK_IE, SCANDI, EE)
-- y grupos extracontinentales (NORTEAM, ASIAPAC, AFRICA, MENA).
-- EUROPA se mantiene como pan-europeo (Eurosport / HBO Max / TNT Sports paneuropeo).
-- No hay backfill: los valores existentes siguen siendo válidos.

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_country_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_country_check
  CHECK (country IN (
    'ALL',
    'ES', 'EUROPA', 'PT', 'FR', 'BE', 'NL', 'IT', 'DE_AT_CH', 'UK_IE', 'SCANDI', 'EE',
    'LATAM', 'NORTEAM', 'ASIAPAC', 'AFRICA', 'MENA'
  ));
