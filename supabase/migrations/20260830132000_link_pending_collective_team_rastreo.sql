-- Enlaces dirigidos de las filas respaldadas del rastreo colectivo UCI 2026.
-- Los equipos se resuelven por nombre canónico, sexo y no-edición especial;
-- no se hardcodean identificadores generados de equipos nuevos.

CREATE TEMP TABLE _pending_collective_team_rastreo_map (
  race_id text NOT NULL,
  raw_name text NOT NULL,
  canonical_team_name text NOT NULL,
  gender text NOT NULL
) ON COMMIT DROP;

INSERT INTO _pending_collective_team_rastreo_map
  (race_id, raw_name, canonical_team_name, gender) VALUES
  ('Hdp5ApDKdxK35JjE5g27', 'ALPECIN-PREMIER', 'Alpecin-Premier Tech', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'BALOISE VERZEKERINGEN', 'Baloise Verzekeringen - Het Poetsbureau Lions', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'BEAT CC P/B', 'Beat CC p/b Saxo', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'METEC - SOLARWATT P/B', 'Metec - Solarwatt p/b Mantel', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'PAUWELS SAUZEN -', 'Pauwels Sauzen - Altez Industriebouw', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'SOUDAL', 'Soudal Quick-Step', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'TARTELETTO -', 'Tarteletto-Isorex', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'TEAM FLANDERS -', 'Flanders Baloise', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'TEAM PICNIC', 'Picnic PostNL', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'UAE TEAM EMIRATES', 'UAE Team Emirates-XRG', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'UNIBET ROSE', 'Unibet Rose Rockets', 'male'),
  ('Hdp5ApDKdxK35JjE5g27', 'UNO-X', 'Uno-X Mobility', 'male'),
  ('njqLb1bcUyokB5zOsUFV', 'ALPECIN-PREMIER', 'Alpecin-Premier Tech', 'male'),
  ('njqLb1bcUyokB5zOsUFV', 'EF EDUCATION -', 'EF Education-EasyPost', 'male'),
  ('njqLb1bcUyokB5zOsUFV', 'NETCOMPANY', 'Netcompany INEOS', 'male'),
  ('njqLb1bcUyokB5zOsUFV', 'TEAM TEAM FLANDERS FLANDERS - - BALOISE', 'Flanders Baloise', 'male'),
  ('njqLb1bcUyokB5zOsUFV', 'TEAM VISMA | LEASE A', 'Visma | Lease a Bike', 'male'),
  ('njqLb1bcUyokB5zOsUFV', 'TUDOR TUDOR PRO PRO CYCLING CYCLING TEAM', 'Tudor', 'male'),
  ('njqLb1bcUyokB5zOsUFV', 'UNIBET ROSE', 'Unibet Rose Rockets', 'male'),
  ('WiGrn1y70EH7spikAOGW', 'NATIONAL TEAM ESTONIA', 'Estonia', 'male'),
  ('WiGrn1y70EH7spikAOGW', 'NATIONAL TEAM LATVIA', 'Latvia', 'male'),
  ('LCKSRcizS7sGIvbjqLap', 'HITEC PRODUCTS-FLUID CONTROL', 'Hitec Products-Fluid Controls', 'female'),
  ('LCKSRcizS7sGIvbjqLap', 'LABORAL KUTXA-FUNDACION EUSKADI', 'Laboral Kutxa-Euskadi', 'female'),
  ('LCKSRcizS7sGIvbjqLap', 'LIV ALULA JAYCO (C.T.W.)', 'Liv AlUla Jayco Continental', 'female'),
  ('LCKSRcizS7sGIvbjqLap', 'S.MICHEL PREFERENCE HOME AUBER 93', 'St Michel-Preference Home-Auber 93', 'female'),
  ('LCKSRcizS7sGIvbjqLap', 'SELECCIO CATALANA', 'Catalunya', 'female'),
  ('LCKSRcizS7sGIvbjqLap', 'TEAM FARTO-KIROOT', 'Farto Kiroot', 'female'),
  ('LCKSRcizS7sGIvbjqLap', 'TEAM VISMA I LEASE A BIKE', 'Visma | Lease a Bike', 'female'),
  ('rJPcuvTZ9iALSCad8s5J', 'CANYON//SRAM', 'Canyon//SRAM', 'female'),
  ('rJPcuvTZ9iALSCad8s5J', 'CARBONBIKE GIORDANA BY GEN Z', 'Carbonbike Giordana Giofré by Gen Z', 'female'),
  ('rJPcuvTZ9iALSCad8s5J', 'CITYMESH - CUSTOMM PRO CYCLING TEAM', 'Citymesh-Customm', 'female'),
  ('rJPcuvTZ9iALSCad8s5J', 'CYCLINGTEAM VAN EYCK/ BELCO', 'Belco-Van Eyck', 'female'),
  ('rJPcuvTZ9iALSCad8s5J', 'HITEC PRODUCTS-FLUID CONTROL', 'Hitec Products-Fluid Controls', 'female'),
  ('wc3wISt551u3lPoOWlFZ', 'GERMAN NATIONAL TEAM', 'Germany', 'male'),
  ('wc3wISt551u3lPoOWlFZ', 'TEAM STORCK - MRW BAU', 'Storck - MRW Bau', 'male'),
  ('SdyXyCdYBmlfzduo0NHy', 'CANYON//SRAM ZONDACRYPTO GENERATION', 'Canyon//SRAM Generation', 'female'),
  ('SdyXyCdYBmlfzduo0NHy', 'LABORAL KUTXA - FUNDACION EUSKADI', 'Laboral Kutxa-Euskadi', 'female'),
  ('SdyXyCdYBmlfzduo0NHy', 'VENDÉE FEMININE RVC', 'Vendée Féminine', 'female'),
  ('yCUZx212nhhYZKLx14F5', 'BAHRAIN VICTORIUS DEVELOPMENT TEAM', 'Bahrain Victorious Development', 'male'),
  ('yCUZx212nhhYZKLx14F5', 'UNITED STATES OF AMERICA', 'United States', 'male'),
  ('TJwHJ9T2z6aEDsDN5vvM', 'GREAT BRITAIN NATIONAL TEAM', 'Great Britain', 'female'),
  ('TJwHJ9T2z6aEDsDN5vvM', 'HITEC PRODUCTS-FLUID CONTROL', 'Hitec Products-Fluid Controls', 'female'),
  ('W989yUqImXadtXZE2jIz', 'EQUIPO KERN PHARMA', 'Kern Pharma', 'male'),
  ('W989yUqImXadtXZE2jIz', 'HUNGRIAN NATIONAL TEAM', 'Hungary', 'male'),
  ('W989yUqImXadtXZE2jIz', 'RED BULL - BORA - HANSGHROHE', 'Red Bull-BORA-hansgrohe', 'male'),
  ('W989yUqImXadtXZE2jIz', 'ROMANIA NATIONAL TEAM', 'Romania', 'male'),
  ('BZtVX5rhaxW4gtnv9coY', 'ATOM 6-CYCLEUR DE LUXE-AUTO STROO C.T.', 'Atom 6 Bikes - Cycleur de Luxe', 'male'),
  ('BZtVX5rhaxW4gtnv9coY', 'ATT INVESTMENT', 'ATT Investments', 'male'),
  ('BZtVX5rhaxW4gtnv9coY', 'EEW-VDK CYCLINGTEAM', 'EEW-VDK', 'male'),
  ('BZtVX5rhaxW4gtnv9coY', 'LOTTO Kernhaus Outlet Montabaur', 'Lotto Kern-Haus', 'male'),
  ('BZtVX5rhaxW4gtnv9coY', 'METEC-SOLARWATT Continental C.T.', 'Metec - Solarwatt p/b Mantel', 'male'),
  ('WceHUBiLcq06ZS03tRGn', 'DEVELOPMENT TEAM PICNIC POSTNL', 'Development Team Picnic PostNL', 'male'),
  ('WceHUBiLcq06ZS03tRGn', 'GROUPAMA-FDJ UNITED', 'Groupama-FDJ United CT', 'male'),
  ('WceHUBiLcq06ZS03tRGn', 'NAZIONALE ITALIANA', 'Italy', 'male'),
  ('WceHUBiLcq06ZS03tRGn', 'TEAM TECHNIPES #INEMILIAROMAGNA', 'Team Technipes #inEmiliaRomagna Caffè Borbone', 'male'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'AG NECTAR-C.MARCA-S.NATUR', 'AG Néctar-Cundinamarca-Somos Natural', 'male'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'EBSA-EMP DE ENERGIA BOYAC', 'EBSA-Empresa de Energía de Boyacá', 'male'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'FUN.TOUR Y NATIVA-B.RANA', 'Fundecom Tour y Nativa', 'male'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'GOB PUTUMAYO-B.STRONGMAN', 'Gobernación Putumayo-Bicicletas Strongman', 'male'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'TEAM FUNRE VIMA MACHINE', 'Team FunRV Vima Machine', 'male'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'TEAM BUFFAZ GESTION DE PATROMOINE', 'Team Buffaz Gestion de Patrimoine', 'female'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'UKRAINE NATIONAL TEAM', 'Ukraine', 'female'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'USA NATIONAL TEAM', 'United States', 'female'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'VOLKERWESSELS CYCLINGTEAM', 'VolkerWessels', 'female'),
  ('xf4fOKkKHfpd3ryfV4qu', 'POLISH NATIONAL TEAM', 'Poland', 'female'),
  ('xf4fOKkKHfpd3ryfV4qu', 'USA NATIONAL TEAM', 'United States', 'female'),
  ('cd6nQmCLONmZdCaygUS2', 'CANYON//SRAM ZONDACRYPTO', 'Canyon//SRAM', 'female'),
  ('cd6nQmCLONmZdCaygUS2', 'SWISS CYCLING', 'Switzerland', 'female'),
  ('tvXsn05qNn1Waz7V9pEi', 'ALPECIN-PREMIER TECH DEVELOPMENT TEAAPMD', 'Alpecin-Premier Tech Development', 'male'),
  ('tvXsn05qNn1Waz7V9pEi', 'DECATHLON CMA CGM DEVELOPMENT TEADMCD', 'Decathlon CMA CGM Development', 'male'),
  ('tvXsn05qNn1Waz7V9pEi', 'MAYENNE-MONBANA-RAPIDO', 'Mayenne-Monbana-Rapido', 'male'),
  ('tvXsn05qNn1Waz7V9pEi', 'TEAM LOTTO KERN-HAUS OUTLET MONTABAUR', 'Lotto Kern-Haus', 'male'),
  ('tvXsn05qNn1Waz7V9pEi', 'TEAM LOTTO KERN-HAUS OUTLET MONTABLAKUHR', 'Lotto Kern-Haus', 'male'),
  ('qpicxChPFHstBQTd4g7J', 'FRANCE U23', 'France', 'male'),
  ('qpicxChPFHstBQTd4g7J', 'SOUDAL QUICK-STEP', 'Soudal Quick-Step Devo', 'male'),
  ('ouii0TrVPaCfIYQCHbdW', 'EQUIPO KERN PHARMA', 'Kern Pharma', 'male'),
  ('O0bkfpB8NwIGL5LgvtUP', 'CAMPANA IMBALLAGGI-MORBIATO-TRENTINOCMP', 'Campana Imballagi - Morbiato - Trentino', 'male'),
  ('O0bkfpB8NwIGL5LgvtUP', 'TEAM 74 HAUTE SAVOIE T74', 'Team 74 Haute Savoie', 'male'),
  ('O0bkfpB8NwIGL5LgvtUP', 'TEAM TECHNIPES #INEMILIAROMAGNA CAFFÈ TER BORBONE', 'Team Technipes #inEmiliaRomagna Caffè Borbone', 'male'),
  ('O0bkfpB8NwIGL5LgvtUP', 'UC Monaco', 'Union Cycliste Monaco', 'male'),
  ('cQE07YXcgVO9ROWvi90Z', 'AARCO CT', 'Aarco', 'male'),
  ('cQE07YXcgVO9ROWvi90Z', 'COMPETITIVE EDGE RACING', 'Competitive Edge Racing', 'male'),
  ('RYfbJykI6YZBBJ7m7sME', 'EQUIPO KERN PHARMA', 'Kern Pharma', 'male');

CREATE TEMP TABLE _pending_collective_team_rastreo_resolved ON COMMIT DROP AS
SELECT
  m.race_id,
  m.raw_name,
  m.canonical_team_name,
  t.id AS team_id
FROM _pending_collective_team_rastreo_map m
JOIN public.teams t
  ON t.name = m.canonical_team_name
 AND t.gender = m.gender
 AND t."specialEdition" IS NOT TRUE
GROUP BY m.race_id, m.raw_name, m.canonical_team_name, t.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _pending_collective_team_rastreo_map m
    LEFT JOIN _pending_collective_team_rastreo_resolved r
      ON r.race_id = m.race_id
     AND r.raw_name = m.raw_name
    GROUP BY m.race_id, m.raw_name
    HAVING count(r.team_id) <> 1
  ) THEN
    RAISE EXCEPTION 'El manifiesto no tiene exactamente un equipo canónico compatible';
  END IF;
END $$;

CREATE TEMP TABLE _pending_collective_team_rastreo_new_teams ON COMMIT DROP AS
SELECT t.id AS team_id
FROM public.teams t
WHERE t.name IN ('Belco-Van Eyck', 'Mayenne-Monbana-Rapido', 'Team Buffaz Gestion de Patrimonio')
  AND t.gender IN ('male', 'female')
  AND t."specialEdition" IS NOT TRUE;

UPDATE public.startlist_teams st
SET "teamId" = r.team_id
FROM _pending_collective_team_rastreo_resolved r
WHERE st.id = 'sling_8b14ee4a08154a32731b6cd22cc0c65b'
  AND r.race_id = 'njqLb1bcUyokB5zOsUFV'
  AND r.raw_name = 'TEAM VISMA | LEASE A'
  AND st."teamId" = 'team_devo_visma';

UPDATE public.startlist_teams st
SET "teamId" = r.team_id
FROM _pending_collective_team_rastreo_resolved r
WHERE st.id = 'sl_LCKSRcizS7sGIvbjqLap_1781852640211_10'
  AND r.race_id = 'LCKSRcizS7sGIvbjqLap'
  AND r.raw_name = 'LIV ALULA JAYCO (C.T.W.)'
  AND st."teamId" = 'team_1776715134951_nufhxh';

UPDATE public.startlist_teams st
SET "teamId" = r.team_id
FROM _pending_collective_team_rastreo_resolved r
WHERE st.id = 'sl_rJPcuvTZ9iALSCad8s5J_1784106748327_16'
  AND r.race_id = 'rJPcuvTZ9iALSCad8s5J'
  AND r.raw_name = 'CARBONBIKE GIORDANA BY GEN Z'
  AND st."teamId" IS NULL;

UPDATE public.startlist_teams st
SET "teamId" = r.team_id
FROM _pending_collective_team_rastreo_resolved r
WHERE st.id = '026b6f91-ec4e-4139-9f83-aaeff0bf0a69'
  AND r.race_id = 'cQE07YXcgVO9ROWvi90Z'
  AND r.raw_name = 'COMPETITIVE EDGE RACING'
  AND st."teamId" IS NULL;

INSERT INTO public.team_name_aliases (
  id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
)
SELECT DISTINCT ON (r.team_id, public.fold_team_name(m.raw_name))
  'tna_rastreo_' || md5(r.team_id || '|' || public.fold_team_name(m.raw_name) || '|2026'),
  r.team_id,
  m.raw_name,
  public.fold_team_name(m.raw_name),
  2026,
  'official_collective_2026',
  rc."websiteUrl",
  true
FROM _pending_collective_team_rastreo_map m
JOIN _pending_collective_team_rastreo_resolved r
  ON r.race_id = m.race_id AND r.raw_name = m.raw_name
JOIN public.races rc ON rc.id = m.race_id
ORDER BY r.team_id, public.fold_team_name(m.raw_name), m.race_id
ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
  alias = EXCLUDED.alias,
  source = EXCLUDED.source,
  "sourceUrl" = EXCLUDED."sourceUrl",
  verified = EXCLUDED.verified,
  "updatedAt" = now();

UPDATE public.race_uci_results r
SET "teamId" = x.team_id
FROM _pending_collective_team_rastreo_resolved x,
     public.race_uci_stages s,
     private.pending_collective_team_rastreo_20260830_backup b
WHERE b.operation = 'pending-collective-team-rastreo-20260830'
  AND b.entity = 'race_uci_results'
  AND b.row_id = r.id::text
  AND s.id = r."stageRef"
  AND s."raceId" = x.race_id
  AND public.fold_team_name(r."riderDisplay") = public.fold_team_name(x.raw_name)
  AND r."teamId" IS NULL
  AND r."globalRiderId" IS NULL;

INSERT INTO public.team_link_decisions (
  id, "raceId", "occurrenceType", "occurrenceId", "rawName", "foldedName",
  "teamId", action, "matchMethod", source, "sourceUrl", year
)
SELECT
  'tld_' || md5('race_uci_result|' || r.id::text),
  s."raceId",
  'race_uci_result',
  r.id::text,
  r."riderDisplay",
  public.fold_team_name(r."riderDisplay"),
  x.team_id,
  CASE WHEN n.team_id IS NOT NULL THEN 'created' ELSE 'reused' END,
  'official_source_directed',
  'official_collective_2026',
  rc."websiteUrl",
  2026
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN public.races rc ON rc.id = s."raceId"
JOIN _pending_collective_team_rastreo_resolved x
  ON x.race_id = s."raceId"
 AND public.fold_team_name(x.raw_name) = public.fold_team_name(r."riderDisplay")
JOIN private.pending_collective_team_rastreo_20260830_backup b
  ON b.operation = 'pending-collective-team-rastreo-20260830'
 AND b.entity = 'race_uci_results'
 AND b.row_id = r.id::text
LEFT JOIN _pending_collective_team_rastreo_new_teams n ON n.team_id = x.team_id
WHERE r."teamId" = x.team_id
  AND r."globalRiderId" IS NULL
  AND (s."classKind" = 'teams' OR s."isTeamEvent" IS TRUE)
ON CONFLICT ("occurrenceType", "occurrenceId") DO UPDATE SET
  "teamId" = EXCLUDED."teamId",
  action = EXCLUDED.action,
  "matchMethod" = EXCLUDED."matchMethod",
  source = EXCLUDED.source,
  "sourceUrl" = EXCLUDED."sourceUrl",
  year = EXCLUDED.year,
  "updatedAt" = now();
