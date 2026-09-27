-- Backup privado previo al rastreo dirigido de pendientes colectivos UCI 2026.
-- No incluye filas de corredores ni crea startlists.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.pending_collective_team_rastreo_20260830_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_id text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  row_data jsonb NOT NULL,
  PRIMARY KEY (operation, entity, row_id)
);

COMMENT ON TABLE private.pending_collective_team_rastreo_20260830_backup IS
  'Backup privado del rastreo dirigido de enlaces de equipos de clasificaciones colectivas UCI 2026 del 2026-08-30.';

ALTER TABLE private.pending_collective_team_rastreo_20260830_backup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.pending_collective_team_rastreo_20260830_backup
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.pending_collective_team_rastreo_20260830_backup TO service_role;

CREATE TEMP TABLE _pending_collective_team_rastreo_map (
  race_id text NOT NULL,
  raw_name text NOT NULL,
  team_id text NOT NULL
) ON COMMIT DROP;

INSERT INTO _pending_collective_team_rastreo_map (race_id, raw_name, team_id) VALUES
  ('Hdp5ApDKdxK35JjE5g27', 'ALPECIN-PREMIER', 'team_1776703130449_us300h'),
  ('Hdp5ApDKdxK35JjE5g27', 'BALOISE VERZEKERINGEN', 'team_d93eff8f7d77423b'),
  ('Hdp5ApDKdxK35JjE5g27', 'BEAT CC P/B', 'team_1776750177297_6bmqkr'),
  ('Hdp5ApDKdxK35JjE5g27', 'METEC - SOLARWATT P/B', 'team_a86ed7e6dea142b8'),
  ('Hdp5ApDKdxK35JjE5g27', 'PAUWELS SAUZEN -', 'team_1779569333053_nga28l'),
  ('Hdp5ApDKdxK35JjE5g27', 'SOUDAL', 'team_1776703755811_lbaphb'),
  ('Hdp5ApDKdxK35JjE5g27', 'TARTELETTO -', 'team_1776750269864_jdyjug'),
  ('Hdp5ApDKdxK35JjE5g27', 'TEAM FLANDERS -', 'team_1776704981490_lf9yf0'),
  ('Hdp5ApDKdxK35JjE5g27', 'TEAM PICNIC', 'team_1776703895660_c8mgkk'),
  ('Hdp5ApDKdxK35JjE5g27', 'UAE TEAM EMIRATES', 'team_1776702951716_ezxsdy'),
  ('Hdp5ApDKdxK35JjE5g27', 'UNIBET ROSE', 'team_1776705190489_lx26od'),
  ('Hdp5ApDKdxK35JjE5g27', 'UNO-X', 'team_1776703993260_yubupk'),
  ('njqLb1bcUyokB5zOsUFV', 'ALPECIN-PREMIER', 'team_1776703130449_us300h'),
  ('njqLb1bcUyokB5zOsUFV', 'EF EDUCATION -', 'team_1776703309015_k4ixyq'),
  ('njqLb1bcUyokB5zOsUFV', 'NETCOMPANY', 'team_1777379215624_qymkfj'),
  ('njqLb1bcUyokB5zOsUFV', 'TEAM TEAM FLANDERS FLANDERS - - BALOISE', 'team_1776704981490_lf9yf0'),
  ('njqLb1bcUyokB5zOsUFV', 'TEAM VISMA | LEASE A', 'team_1776702578134_2wdzno'),
  ('njqLb1bcUyokB5zOsUFV', 'TUDOR TUDOR PRO PRO CYCLING CYCLING TEAM', 'team_1776704584941_aeypqm'),
  ('njqLb1bcUyokB5zOsUFV', 'UNIBET ROSE', 'team_1776705190489_lx26od'),
  ('WiGrn1y70EH7spikAOGW', 'NATIONAL TEAM ESTONIA', 'team_ntm_estonia'),
  ('WiGrn1y70EH7spikAOGW', 'NATIONAL TEAM LATVIA', 'team_ntm_latvia'),
  ('LCKSRcizS7sGIvbjqLap', 'HITEC PRODUCTS-FLUID CONTROL', 'team_63c5c079e3f5445f'),
  ('LCKSRcizS7sGIvbjqLap', 'LABORAL KUTXA-FUNDACION EUSKADI', 'team_1776715516916_9d8gwc'),
  ('LCKSRcizS7sGIvbjqLap', 'LIV ALULA JAYCO (C.T.W.)', 'team_b6c3e8dab28d43fd'),
  ('LCKSRcizS7sGIvbjqLap', 'S.MICHEL PREFERENCE HOME AUBER 93', 'team_female_st_michel_auber93'),
  ('LCKSRcizS7sGIvbjqLap', 'SELECCIO CATALANA', 'team_1781626033107_21eyg9'),
  ('LCKSRcizS7sGIvbjqLap', 'TEAM FARTO-KIROOT', 'team_1779710931026_py6z9w'),
  ('LCKSRcizS7sGIvbjqLap', 'TEAM VISMA I LEASE A BIKE', 'team_female_visma'),
  ('rJPcuvTZ9iALSCad8s5J', 'CANYON//SRAM', 'team_canyon_sram_pre_july_2026'),
  ('rJPcuvTZ9iALSCad8s5J', 'CARBONBIKE GIORDANA BY GEN Z', 'team_auto_80c6a8672976a1774ed01c3cf9f3fdd0'),
  ('rJPcuvTZ9iALSCad8s5J', 'CITYMESH - CUSTOMM PRO CYCLING TEAM', 'team_1776715943597_af6cmv'),
  ('rJPcuvTZ9iALSCad8s5J', 'CYCLINGTEAM VAN EYCK/ BELCO', 'team_auto_belco_van_eyck_2026'),
  ('rJPcuvTZ9iALSCad8s5J', 'HITEC PRODUCTS-FLUID CONTROL', 'team_63c5c079e3f5445f'),
  ('wc3wISt551u3lPoOWlFZ', 'GERMAN NATIONAL TEAM', 'team_41f3f554132f42e6'),
  ('wc3wISt551u3lPoOWlFZ', 'TEAM STORCK - MRW BAU', 'team_1776792153097_0avoqz'),
  ('SdyXyCdYBmlfzduo0NHy', 'CANYON//SRAM ZONDACRYPTO GENERATION', 'team_canyon_sram_generation_pre_july_2026'),
  ('SdyXyCdYBmlfzduo0NHy', 'LABORAL KUTXA - FUNDACION EUSKADI', 'team_1776715516916_9d8gwc'),
  ('SdyXyCdYBmlfzduo0NHy', 'VENDÉE FEMININE RVC', 'team_1dcb883de4444367'),
  ('yCUZx212nhhYZKLx14F5', 'BAHRAIN VICTORIUS DEVELOPMENT TEAM', 'team_devo_bahrain'),
  ('yCUZx212nhhYZKLx14F5', 'UNITED STATES OF AMERICA', 'team_1777713269530_9keczg'),
  ('TJwHJ9T2z6aEDsDN5vvM', 'GREAT BRITAIN NATIONAL TEAM', 'team_ntw_great-britain'),
  ('TJwHJ9T2z6aEDsDN5vvM', 'HITEC PRODUCTS-FLUID CONTROL', 'team_63c5c079e3f5445f'),
  ('W989yUqImXadtXZE2jIz', 'EQUIPO KERN PHARMA', 'team_1776714278457_r96u02'),
  ('W989yUqImXadtXZE2jIz', 'HUNGRIAN NATIONAL TEAM', 'team_ntm_hungary'),
  ('W989yUqImXadtXZE2jIz', 'RED BULL - BORA - HANSGHROHE', 'team_1776703052816_uexbsk'),
  ('W989yUqImXadtXZE2jIz', 'ROMANIA NATIONAL TEAM', 'team_ntm_romania'),
  ('BZtVX5rhaxW4gtnv9coY', 'ATOM 6-CYCLEUR DE LUXE-AUTO STROO C.T.', 'team_1777987180489_2xmold'),
  ('BZtVX5rhaxW4gtnv9coY', 'ATT INVESTMENT', 'team_1776778841056_se564m'),
  ('BZtVX5rhaxW4gtnv9coY', 'EEW-VDK CYCLINGTEAM', 'team_5338bde2c0024175'),
  ('BZtVX5rhaxW4gtnv9coY', 'LOTTO Kernhaus Outlet Montabaur', 'team_1780549154325_yxklvn'),
  ('BZtVX5rhaxW4gtnv9coY', 'METEC-SOLARWATT Continental C.T.', 'team_a86ed7e6dea142b8'),
  ('WceHUBiLcq06ZS03tRGn', 'DEVELOPMENT TEAM PICNIC POSTNL', 'team_devo_picnic'),
  ('WceHUBiLcq06ZS03tRGn', 'GROUPAMA-FDJ UNITED', 'team_1780912000096_rcetxi'),
  ('WceHUBiLcq06ZS03tRGn', 'NAZIONALE ITALIANA', 'team_1776706214852_30iwwq'),
  ('WceHUBiLcq06ZS03tRGn', 'TEAM TECHNIPES #INEMILIAROMAGNA', 'team_1780912000021_rwxlc7'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'AG NECTAR-C.MARCA-S.NATUR', 'team_auto_37ebffc5c58b19f158296e50bf517330'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'EBSA-EMP DE ENERGIA BOYAC', 'team_auto_9944a9a4cd1e35c07942cd9e469c8af4'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'FUN.TOUR Y NATIVA-B.RANA', 'team_auto_87c2044ecb4523ec614cccc99f0bd112'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'GOB PUTUMAYO-B.STRONGMAN', 'team_auto_17b1b958604564ff54d7dcef9b2502c0'),
  ('7w2Hpx7eqmhK4P2bvlkR', 'TEAM FUNRE VIMA MACHINE', 'team_auto_39359626ad0e6560039e6775748672ed'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'TEAM BUFFAZ GESTION DE PATROMOINE', 'team_auto_buffaz_gestion_patrimoine_2026'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'UKRAINE NATIONAL TEAM', 'team_ntw_ukraine'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'USA NATIONAL TEAM', 'team_ntw_united_states'),
  ('SfvJ5yGQzAxj2ptaEYCV', 'VOLKERWESSELS CYCLINGTEAM', 'team_1776715791581_5z1fd7'),
  ('xf4fOKkKHfpd3ryfV4qu', 'POLISH NATIONAL TEAM', 'team_1785562320031_2t109k'),
  ('xf4fOKkKHfpd3ryfV4qu', 'USA NATIONAL TEAM', 'team_ntw_united_states'),
  ('cd6nQmCLONmZdCaygUS2', 'CANYON//SRAM ZONDACRYPTO', 'team_canyon_sram_pre_july_2026'),
  ('cd6nQmCLONmZdCaygUS2', 'SWISS CYCLING', 'team_ntw_switzerland'),
  ('tvXsn05qNn1Waz7V9pEi', 'ALPECIN-PREMIER TECH DEVELOPMENT TEAAPMD', 'team_devo_alpecin'),
  ('tvXsn05qNn1Waz7V9pEi', 'DECATHLON CMA CGM DEVELOPMENT TEADMCD', 'team_devo_decathlon'),
  ('tvXsn05qNn1Waz7V9pEi', 'MAYENNE-MONBANA-RAPIDO', 'team_auto_mayenne_monbana_rapido_2026'),
  ('tvXsn05qNn1Waz7V9pEi', 'TEAM LOTTO KERN-HAUS OUTLET MONTABAUR', 'team_1780549154325_yxklvn'),
  ('tvXsn05qNn1Waz7V9pEi', 'TEAM LOTTO KERN-HAUS OUTLET MONTABLAKUHR', 'team_1780549154325_yxklvn'),
  ('qpicxChPFHstBQTd4g7J', 'FRANCE U23', 'team_ntm_france'),
  ('qpicxChPFHstBQTd4g7J', 'SOUDAL QUICK-STEP', 'team_devo_soudal'),
  ('ouii0TrVPaCfIYQCHbdW', 'EQUIPO KERN PHARMA', 'team_1776714278457_r96u02'),
  ('O0bkfpB8NwIGL5LgvtUP', 'CAMPANA IMBALLAGGI-MORBIATO-TRENTINOCMP', 'team_1780912000015_59fxnj'),
  ('O0bkfpB8NwIGL5LgvtUP', 'TEAM 74 HAUTE SAVOIE T74', 'team_auto_d0c85d2533ce816903e6c5e6dc475722'),
  ('O0bkfpB8NwIGL5LgvtUP', 'TEAM TECHNIPES #INEMILIAROMAGNA CAFFÈ TER BORBONE', 'team_1780912000021_rwxlc7'),
  ('O0bkfpB8NwIGL5LgvtUP', 'UC Monaco', 'team_auto_c17788455bdc2d3a59417c07e4169d70'),
  ('cQE07YXcgVO9ROWvi90Z', 'AARCO CT', 'team_7ae986cd914e47f2'),
  ('cQE07YXcgVO9ROWvi90Z', 'COMPETITIVE EDGE RACING', 'team_1780912000039_acvdtg'),
  ('RYfbJykI6YZBBJ7m7sME', 'EQUIPO KERN PHARMA', 'team_1776714278457_r96u02');

INSERT INTO private.pending_collective_team_rastreo_20260830_backup
  (operation, entity, row_id, backed_up_at, row_data)
SELECT
  'pending-collective-team-rastreo-20260830',
  'race_uci_results',
  r.id::text,
  transaction_timestamp(),
  to_jsonb(r)
FROM public.race_uci_results r
JOIN public.race_uci_stages s ON s.id = r."stageRef"
JOIN public.races rc ON rc.id = s."raceId"
JOIN _pending_collective_team_rastreo_map m
  ON m.race_id = s."raceId"
 AND public.fold_team_name(m.raw_name) = public.fold_team_name(r."riderDisplay")
WHERE rc."year" = 2026
  AND (s."classKind" = 'teams' OR s."isTeamEvent" IS TRUE)
  AND r."globalRiderId" IS NULL
  AND r."teamId" IS NULL
ON CONFLICT (operation, entity, row_id) DO NOTHING;

INSERT INTO private.pending_collective_team_rastreo_20260830_backup
  (operation, entity, row_id, backed_up_at, row_data)
SELECT
  'pending-collective-team-rastreo-20260830',
  'startlist_teams',
  st.id,
  transaction_timestamp(),
  to_jsonb(st)
FROM public.startlist_teams st
WHERE st.id IN (
  'sling_8b14ee4a08154a32731b6cd22cc0c65b',
  'sl_LCKSRcizS7sGIvbjqLap_1781852640211_10',
  'sl_rJPcuvTZ9iALSCad8s5J_1784106748327_16',
  'sl_rJPcuvTZ9iALSCad8s5J_1784106748327_18',
  'efab832e-d610-48fd-9de9-444f2be5f132',
  '7a32d089-650d-48a5-a1c6-f4d7effee008',
  '026b6f91-ec4e-4139-9f83-aaeff0bf0a69'
)
ON CONFLICT (operation, entity, row_id) DO NOTHING;
