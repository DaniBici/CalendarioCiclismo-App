-- Consolida las identidades longitudinales de equipos UCI 2020-2026.
-- Generado desde el manifiesto dirigido; tres cruces ambiguos permanecen pendientes.
BEGIN;

CREATE TABLE private.repair_team_continuity_20260907_backup (
  entity text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY(entity,row_key)
);
ALTER TABLE private.repair_team_continuity_20260907_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.repair_team_continuity_20260907_backup FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT,INSERT ON TABLE private.repair_team_continuity_20260907_backup TO service_role;
COMMENT ON TABLE private.repair_team_continuity_20260907_backup IS
  'Backup recuperable previo a consolidar identidades longitudinales de equipos UCI 2020-2026.';

CREATE TEMP TABLE _team_continuity_merge(
  source_id text PRIMARY KEY,
  target_id text NOT NULL,
  gender text NOT NULL CHECK(gender IN ('male','female')),
  CHECK(source_id<>target_id)
) ON COMMIT DROP;
INSERT INTO _team_continuity_merge(source_id,target_id,gender) VALUES
  ('uci-hist-female-2020-13998', 'team_uae_l_imad_2026', 'female'),
  ('uci-hist-female-2021-15266', 'team_uae_l_imad_2026', 'female'),
  ('uci-hist-female-2022-17201', 'team_uae_l_imad_2026', 'female'),
  ('uci-hist-female-2023-17691', 'team_uae_l_imad_2026', 'female'),
  ('uci-hist-female-2024-19528', 'team_uae_l_imad_2026', 'female'),
  ('uci-hist-female-2025-20281', 'team_uae_l_imad_2026', 'female'),
  ('uci-hist-female-2020-13999', 'team_1780079086533_019dq3', 'female'),
  ('uci-hist-female-2025-20405', 'team_1780079086533_019dq3', 'female'),
  ('uci-hist-female-2021-15270', 'uci-hist-female-2020-14000', 'female'),
  ('uci-hist-female-2022-17193', 'uci-hist-female-2020-14000', 'female'),
  ('uci-hist-female-2023-17685', 'uci-hist-female-2020-14000', 'female'),
  ('uci-hist-female-2020-14001', 'team_1776715017170_w96ftz', 'female'),
  ('uci-hist-female-2022-17621', 'team_1776715017170_w96ftz', 'female'),
  ('uci-hist-female-2023-17680', 'team_1776715017170_w96ftz', 'female'),
  ('uci-hist-female-2024-19520', 'team_1776715017170_w96ftz', 'female'),
  ('uci-hist-female-2020-14004', 'team_female_picnic_postnl', 'female'),
  ('uci-hist-female-2021-15272', 'team_female_picnic_postnl', 'female'),
  ('uci-hist-female-2022-17197', 'team_female_picnic_postnl', 'female'),
  ('uci-hist-female-2023-19370', 'team_female_picnic_postnl', 'female'),
  ('uci-hist-female-2024-19530', 'team_female_picnic_postnl', 'female'),
  ('uci-hist-female-2020-14005', 'team_female_lidl_trek', 'female'),
  ('uci-hist-female-2021-15274', 'team_female_lidl_trek', 'female'),
  ('uci-hist-female-2022-17200', 'team_female_lidl_trek', 'female'),
  ('uci-hist-female-2021-15809', 'uci-hist-female-2020-14163', 'female'),
  ('uci-hist-female-2022-17224', 'uci-hist-female-2020-14163', 'female'),
  ('uci-hist-female-2021-15392', 'uci-hist-female-2020-14165', 'female'),
  ('uci-hist-female-2021-15391', 'uci-hist-female-2020-14166', 'female'),
  ('uci-hist-female-2021-15393', 'uci-hist-female-2020-14169', 'female'),
  ('uci-hist-female-2021-15403', 'uci-hist-female-2020-14170', 'female'),
  ('uci-hist-female-2022-17242', 'uci-hist-female-2020-14170', 'female'),
  ('uci-hist-female-2023-18530', 'uci-hist-female-2020-14170', 'female'),
  ('uci-hist-female-2022-17245', 'uci-hist-female-2020-14171', 'female'),
  ('uci-hist-female-2023-18533', 'uci-hist-female-2020-14171', 'female'),
  ('uci-hist-female-2021-15429', 'uci-hist-female-2020-14172', 'female'),
  ('uci-hist-female-2022-17246', 'uci-hist-female-2020-14172', 'female'),
  ('uci-hist-female-2021-15406', 'uci-hist-female-2020-14173', 'female'),
  ('uci-hist-female-2022-17247', 'uci-hist-female-2020-14173', 'female'),
  ('uci-hist-female-2023-18536', 'uci-hist-female-2020-14173', 'female'),
  ('uci-hist-female-2024-19519', 'uci-hist-female-2020-14173', 'female'),
  ('uci-hist-female-2021-15408', 'uci-hist-female-2020-14174', 'female'),
  ('uci-hist-female-2022-17250', 'uci-hist-female-2020-14174', 'female'),
  ('uci-hist-female-2020-14176', 'team_1777713194176_mw2hp4', 'female'),
  ('uci-hist-female-2021-15414', 'team_1777713194176_mw2hp4', 'female'),
  ('uci-hist-female-2022-17251', 'team_1777713194176_mw2hp4', 'female'),
  ('uci-hist-female-2023-18543', 'team_1777713194176_mw2hp4', 'female'),
  ('uci-hist-female-2024-19571', 'team_1777713194176_mw2hp4', 'female'),
  ('uci-hist-female-2025-20399', 'team_1777713194176_mw2hp4', 'female'),
  ('uci-hist-female-2020-14178', 'team_1776715859864_hblh1m', 'female'),
  ('uci-hist-female-2021-15395', 'uci-hist-female-2020-14184', 'female'),
  ('uci-hist-female-2022-17238', 'uci-hist-female-2020-14184', 'female'),
  ('uci-hist-female-2020-14186', 'team_1776715284567_76xqkf', 'female'),
  ('uci-hist-female-2021-15273', 'team_1776715284567_76xqkf', 'female'),
  ('uci-hist-female-2020-14187', 'team_1776714655588_6ae9cr', 'female'),
  ('uci-hist-female-2021-15417', 'team_1776714655588_6ae9cr', 'female'),
  ('uci-hist-female-2022-17616', 'team_1776714655588_6ae9cr', 'female'),
  ('uci-hist-female-2023-18516', 'team_1776714655588_6ae9cr', 'female'),
  ('uci-hist-female-2024-19517', 'team_1776714655588_6ae9cr', 'female'),
  ('uci-hist-female-2021-15416', 'uci-hist-female-2020-14188', 'female'),
  ('uci-hist-female-2022-17258', 'uci-hist-female-2020-14188', 'female'),
  ('uci-hist-female-2023-18547', 'uci-hist-female-2020-14188', 'female'),
  ('uci-hist-female-2024-19578', 'uci-hist-female-2020-14188', 'female'),
  ('uci-hist-female-2025-20410', 'uci-hist-female-2020-14189', 'female'),
  ('uci-hist-female-2021-15422', 'uci-hist-female-2020-14193', 'female'),
  ('uci-hist-female-2022-17190', 'uci-hist-female-2020-14194', 'female'),
  ('uci-hist-female-2021-15804', 'uci-hist-female-2020-14195', 'female'),
  ('uci-hist-female-2022-17426', 'uci-hist-female-2020-14195', 'female'),
  ('uci-hist-female-2021-15443', 'uci-hist-female-2020-14196', 'female'),
  ('uci-hist-female-2022-17263', 'uci-hist-female-2020-14196', 'female'),
  ('uci-hist-female-2021-15800', 'uci-hist-female-2020-14198', 'female'),
  ('uci-hist-female-2020-14201', 'team_1777723184117_2a5qpg', 'female'),
  ('uci-hist-female-2021-15423', 'uci-hist-female-2020-14203', 'female'),
  ('uci-hist-female-2021-15444', 'uci-hist-female-2020-14217', 'female'),
  ('uci-hist-female-2022-17431', 'uci-hist-female-2020-14218', 'female'),
  ('uci-hist-female-2024-19823', 'uci-hist-female-2020-14218', 'female'),
  ('uci-hist-female-2025-20307', 'uci-hist-female-2020-14218', 'female'),
  ('uci-hist-female-2021-15398', 'uci-hist-female-2020-14229', 'female'),
  ('uci-hist-female-2022-17240', 'uci-hist-female-2020-14229', 'female'),
  ('uci-hist-female-2021-15840', 'uci-hist-female-2020-14250', 'female'),
  ('uci-hist-female-2020-15079', 'team_1776715068053_p0pqch', 'female'),
  ('uci-hist-female-2021-15866', 'team_1776715068053_p0pqch', 'female'),
  ('uci-hist-female-2022-17227', 'team_1776715068053_p0pqch', 'female'),
  ('uci-hist-female-2023-17681', 'team_1776715068053_p0pqch', 'female'),
  ('uci-hist-female-2025-20272', 'team_1776715068053_p0pqch', 'female'),
  ('uci-hist-female-2020-15182', 'team_1776715134951_nufhxh', 'female'),
  ('uci-hist-female-2021-15277', 'team_1776715134951_nufhxh', 'female'),
  ('uci-hist-female-2023-17730', 'team_1776715134951_nufhxh', 'female'),
  ('uci-hist-female-2024-19524', 'team_1776715134951_nufhxh', 'female'),
  ('uci-hist-female-2025-20275', 'team_1776715134951_nufhxh', 'female'),
  ('uci-hist-male-2020-13980', 'team_1776703256882_74u3ve', 'male'),
  ('uci-hist-male-2021-15234', 'team_1776703256882_74u3ve', 'male'),
  ('uci-hist-male-2022-17171', 'team_1776703256882_74u3ve', 'male'),
  ('uci-hist-male-2023-17712', 'team_1776703256882_74u3ve', 'male'),
  ('uci-hist-male-2024-19539', 'team_1776703256882_74u3ve', 'male'),
  ('uci-hist-male-2025-20239', 'team_1776703256882_74u3ve', 'male'),
  ('uci-hist-male-2020-13981', 'team_1776704087509_e6azyq', 'male'),
  ('uci-hist-male-2021-15801', 'team_1776704087509_e6azyq', 'male'),
  ('uci-hist-male-2022-17172', 'team_1776704087509_e6azyq', 'male'),
  ('uci-hist-male-2023-17714', 'team_1776704087509_e6azyq', 'male'),
  ('uci-hist-male-2024-19535', 'team_1776704087509_e6azyq', 'male'),
  ('uci-hist-male-2025-20251', 'team_1776704087509_e6azyq', 'male'),
  ('uci-hist-male-2020-13983', 'team_1776703052816_uexbsk', 'male'),
  ('uci-hist-male-2024-20183', 'team_1776703052816_uexbsk', 'male'),
  ('uci-hist-male-2025-20246', 'team_1776703052816_uexbsk', 'male'),
  ('uci-hist-male-2020-13987', 'team_1776703309015_k4ixyq', 'male'),
  ('uci-hist-male-2021-15238', 'team_1776703309015_k4ixyq', 'male'),
  ('uci-hist-male-2022-17222', 'team_1776703309015_k4ixyq', 'male'),
  ('uci-hist-male-2020-13988', 'team_1776703473947_q1b5i9', 'male'),
  ('uci-hist-male-2021-15240', 'team_1776703473947_q1b5i9', 'male'),
  ('uci-hist-male-2022-17177', 'team_1776703473947_q1b5i9', 'male'),
  ('uci-hist-male-2023-17720', 'team_1776703473947_q1b5i9', 'male'),
  ('uci-hist-male-2024-19541', 'team_1776703473947_q1b5i9', 'male'),
  ('uci-hist-male-2025-20241', 'team_1776703473947_q1b5i9', 'male'),
  ('uci-hist-male-2020-13989', 'team_1776703552614_pyqigh', 'male'),
  ('uci-hist-male-2021-15244', 'team_1776703552614_pyqigh', 'male'),
  ('uci-hist-male-2022-17182', 'team_1776703552614_pyqigh', 'male'),
  ('uci-hist-male-2023-17704', 'team_1776703552614_pyqigh', 'male'),
  ('uci-hist-male-2025-20288', 'team_1776703552614_pyqigh', 'male'),
  ('uci-hist-male-2020-13990', 'team_1776703840961_zz7puu', 'male'),
  ('uci-hist-male-2021-15276', 'team_1776703840961_zz7puu', 'male'),
  ('uci-hist-male-2023-17731', 'team_1776703840961_zz7puu', 'male'),
  ('uci-hist-male-2020-13995', 'team_1776703895660_c8mgkk', 'male'),
  ('uci-hist-male-2021-15245', 'team_1776703895660_c8mgkk', 'male'),
  ('uci-hist-male-2022-17186', 'team_1776703895660_c8mgkk', 'male'),
  ('uci-hist-male-2023-19371', 'team_1776703895660_c8mgkk', 'male'),
  ('uci-hist-male-2024-19547', 'team_1776703895660_c8mgkk', 'male'),
  ('uci-hist-male-2020-13996', 'team_1776702799483_dan5zs', 'male'),
  ('uci-hist-male-2020-13997', 'team_1776702951716_ezxsdy', 'male'),
  ('uci-hist-male-2022-17208', 'uci-hist-male-2020-14006', 'male'),
  ('uci-hist-male-2020-14009', 'team_1776705387471_62ymrg', 'male'),
  ('uci-hist-male-2023-17701', 'team_1776705387471_62ymrg', 'male'),
  ('uci-hist-male-2024-19515', 'team_1776705387471_62ymrg', 'male'),
  ('uci-hist-male-2025-20298', 'team_1776705387471_62ymrg', 'male'),
  ('uci-hist-male-2021-15230', 'uci-hist-male-2020-14012', 'male'),
  ('uci-hist-male-2022-17179', 'uci-hist-male-2020-14012', 'male'),
  ('uci-hist-male-2023-17722', 'uci-hist-male-2020-14012', 'male'),
  ('uci-hist-male-2024-19543', 'uci-hist-male-2020-14012', 'male'),
  ('uci-hist-male-2025-20243', 'uci-hist-male-2020-14012', 'male'),
  ('uci-hist-male-2021-15258', 'uci-hist-male-2020-14014', 'male'),
  ('uci-hist-male-2021-15259', 'uci-hist-male-2020-14016', 'male'),
  ('uci-hist-male-2022-17214', 'uci-hist-male-2020-14016', 'male'),
  ('uci-hist-male-2020-14017', 'team_1776704981490_lf9yf0', 'male'),
  ('uci-hist-male-2021-15260', 'team_1776704981490_lf9yf0', 'male'),
  ('uci-hist-male-2022-17215', 'team_1776704981490_lf9yf0', 'male'),
  ('uci-hist-male-2020-14018', 'team_1776714541189_3v5tpl', 'male'),
  ('uci-hist-male-2021-15262', 'team_1776714541189_3v5tpl', 'male'),
  ('uci-hist-male-2022-17217', 'team_1776714541189_3v5tpl', 'male'),
  ('uci-hist-male-2023-17708', 'team_1776714541189_3v5tpl', 'male'),
  ('uci-hist-male-2024-19511', 'team_1776714541189_3v5tpl', 'male'),
  ('uci-hist-male-2025-20291', 'team_1776714541189_3v5tpl', 'male'),
  ('uci-hist-male-2020-14019', 'team_1776705081939_olxbwj', 'male'),
  ('uci-hist-male-2021-17078', 'team_1776705081939_olxbwj', 'male'),
  ('uci-hist-male-2022-17218', 'team_1776705081939_olxbwj', 'male'),
  ('uci-hist-male-2023-17709', 'team_1776705081939_olxbwj', 'male'),
  ('uci-hist-male-2024-19512', 'team_1776705081939_olxbwj', 'male'),
  ('uci-hist-male-2025-20294', 'team_1776705081939_olxbwj', 'male'),
  ('uci-hist-male-2023-17726', 'uci-hist-male-2020-14024', 'male'),
  ('uci-hist-male-2024-19534', 'uci-hist-male-2020-14024', 'male'),
  ('uci-hist-male-2025-20236', 'uci-hist-male-2020-14024', 'male'),
  ('uci-hist-male-2020-14050', 'team_1776703625379_kbsull', 'male'),
  ('uci-hist-male-2021-15242', 'team_1776703625379_kbsull', 'male'),
  ('uci-hist-male-2022-17418', 'team_1776703625379_kbsull', 'male'),
  ('uci-hist-male-2023-17703', 'team_1776703625379_kbsull', 'male'),
  ('uci-hist-male-2024-19506', 'team_1776703625379_kbsull', 'male'),
  ('uci-hist-male-2025-20287', 'team_1776703625379_kbsull', 'male'),
  ('uci-hist-male-2020-14052', 'team_1777987414743_fxcezb', 'male'),
  ('uci-hist-male-2024-19784', 'team_1777987414743_fxcezb', 'male'),
  ('uci-hist-male-2021-15382', 'uci-hist-male-2020-14054', 'male'),
  ('uci-hist-male-2020-14055', 'team_1779567438179_cyzw6p', 'male'),
  ('uci-hist-male-2021-15340', 'team_1779567438179_cyzw6p', 'male'),
  ('uci-hist-male-2022-17342', 'team_1779567438179_cyzw6p', 'male'),
  ('uci-hist-male-2023-18452', 'team_1779567438179_cyzw6p', 'male'),
  ('uci-hist-male-2024-19763', 'team_1779567438179_cyzw6p', 'male'),
  ('uci-hist-male-2025-20603', 'team_1779567438179_cyzw6p', 'male'),
  ('uci-hist-male-2021-15366', 'uci-hist-male-2020-14059', 'male'),
  ('uci-hist-male-2022-17412', 'uci-hist-male-2020-14059', 'male'),
  ('uci-hist-male-2023-18571', 'uci-hist-male-2020-14059', 'male'),
  ('uci-hist-male-2021-15799', 'uci-hist-male-2020-14060', 'male'),
  ('uci-hist-male-2022-17427', 'uci-hist-male-2020-14060', 'male'),
  ('uci-hist-male-2020-14061', 'team_1776750177297_6bmqkr', 'male'),
  ('uci-hist-male-2021-15359', 'team_1776750177297_6bmqkr', 'male'),
  ('uci-hist-male-2021-15334', 'uci-hist-male-2020-14062', 'male'),
  ('uci-hist-male-2020-14063', 'team_1780912000049_lk6fb1', 'male'),
  ('uci-hist-male-2020-14065', 'team_1777987227167_2bmfik', 'male'),
  ('uci-hist-male-2021-15325', 'team_1777987227167_2bmfik', 'male'),
  ('uci-hist-male-2020-14066', 'team_1780912000078_ylpfa3', 'male'),
  ('uci-hist-male-2021-15442', 'team_1780912000078_ylpfa3', 'male'),
  ('uci-hist-male-2024-20058', 'team_1780912000078_ylpfa3', 'male'),
  ('uci-hist-male-2021-15316', 'uci-hist-male-2020-14067', 'male'),
  ('uci-hist-male-2022-17318', 'uci-hist-male-2020-14067', 'male'),
  ('uci-hist-male-2021-15303', 'uci-hist-male-2020-14069', 'male'),
  ('uci-hist-male-2021-15332', 'uci-hist-male-2020-14070', 'male'),
  ('uci-hist-male-2022-17338', 'uci-hist-male-2020-14070', 'male'),
  ('uci-hist-male-2023-18439', 'uci-hist-male-2020-14070', 'male'),
  ('uci-hist-male-2024-19757', 'uci-hist-male-2020-14070', 'male'),
  ('uci-hist-male-2021-15324', 'uci-hist-male-2020-14071', 'male'),
  ('uci-hist-male-2020-14074', 'team_1777987336323_g7fhpe', 'male'),
  ('uci-hist-male-2021-15839', 'uci-hist-male-2020-14077', 'male'),
  ('uci-hist-male-2024-19863', 'uci-hist-male-2020-14078', 'male'),
  ('uci-hist-male-2020-14079', 'team_1780912000005_z8ue04', 'male'),
  ('uci-hist-male-2021-15304', 'team_1780912000005_z8ue04', 'male'),
  ('uci-hist-male-2025-20601', 'uci-hist-male-2020-14080', 'male'),
  ('uci-hist-male-2021-15301', 'uci-hist-male-2020-14083', 'male'),
  ('uci-hist-male-2022-17301', 'uci-hist-male-2020-14083', 'male'),
  ('uci-hist-male-2020-14086', 'team_1777987274404_wwtkcv', 'male'),
  ('uci-hist-male-2022-17278', 'team_1777987274404_wwtkcv', 'male'),
  ('uci-hist-male-2021-15832', 'uci-hist-male-2020-14091', 'male'),
  ('uci-hist-male-2020-14092', 'team_1779566640323_3yohji', 'male'),
  ('uci-hist-male-2021-15822', 'team_1779566640323_3yohji', 'male'),
  ('uci-hist-male-2020-14093', 'team_1776705783470_ii0i0m', 'male'),
  ('uci-hist-male-2021-15255', 'team_1776705783470_ii0i0m', 'male'),
  ('uci-hist-male-2022-17209', 'team_1776705783470_ii0i0m', 'male'),
  ('uci-hist-male-2023-17698', 'team_1776705783470_ii0i0m', 'male'),
  ('uci-hist-male-2024-19516', 'team_1776705783470_ii0i0m', 'male'),
  ('uci-hist-male-2020-14094', 'team_1780912000064_tvoibe', 'male'),
  ('uci-hist-male-2021-15345', 'team_1780912000064_tvoibe', 'male'),
  ('uci-hist-male-2022-17358', 'team_1780912000064_tvoibe', 'male'),
  ('uci-hist-male-2023-18465', 'team_1780912000064_tvoibe', 'male'),
  ('uci-hist-male-2024-20069', 'team_1780912000064_tvoibe', 'male'),
  ('uci-hist-male-2025-20478', 'team_1780912000064_tvoibe', 'male'),
  ('uci-hist-male-2021-15348', 'uci-hist-male-2020-14095', 'male'),
  ('uci-hist-male-2022-17357', 'uci-hist-male-2020-14095', 'male'),
  ('uci-hist-male-2023-18461', 'uci-hist-male-2020-14095', 'male'),
  ('uci-hist-male-2020-14097', 'team_ct_credibom', 'male'),
  ('uci-hist-male-2021-15431', 'team_ct_credibom', 'male'),
  ('uci-hist-male-2022-17385', 'team_ct_credibom', 'male'),
  ('uci-hist-male-2023-18492', 'team_ct_credibom', 'male'),
  ('uci-hist-male-2021-15372', 'uci-hist-male-2020-14099', 'male'),
  ('uci-hist-male-2022-17391', 'uci-hist-male-2020-14099', 'male'),
  ('uci-hist-male-2023-18497', 'uci-hist-male-2020-14099', 'male'),
  ('uci-hist-male-2021-15424', 'uci-hist-male-2020-14102', 'male'),
  ('uci-hist-male-2021-15823', 'uci-hist-male-2020-14103', 'male'),
  ('uci-hist-male-2022-17588', 'uci-hist-male-2020-14103', 'male'),
  ('uci-hist-male-2023-18451', 'uci-hist-male-2020-14103', 'male'),
  ('uci-hist-male-2024-20060', 'uci-hist-male-2020-14103', 'male'),
  ('uci-hist-male-2025-20488', 'uci-hist-male-2020-14103', 'male'),
  ('uci-hist-male-2021-15810', 'uci-hist-male-2020-14105', 'male'),
  ('uci-hist-male-2021-15291', 'uci-hist-male-2020-14108', 'male'),
  ('uci-hist-male-2021-15365', 'uci-hist-male-2020-14109', 'male'),
  ('uci-hist-male-2021-15313', 'uci-hist-male-2020-14111', 'male'),
  ('uci-hist-male-2021-15280', 'uci-hist-male-2020-14112', 'male'),
  ('uci-hist-male-2022-17269', 'uci-hist-male-2020-14112', 'male'),
  ('uci-hist-male-2021-15337', 'uci-hist-male-2020-14113', 'male'),
  ('uci-hist-male-2022-17332', 'uci-hist-male-2020-14113', 'male'),
  ('uci-hist-male-2021-15370', 'uci-hist-male-2020-14118', 'male'),
  ('uci-hist-male-2022-17389', 'uci-hist-male-2020-14118', 'male'),
  ('uci-hist-male-2021-15321', 'uci-hist-male-2020-14119', 'male'),
  ('uci-hist-male-2022-17320', 'uci-hist-male-2020-14119', 'male'),
  ('uci-hist-male-2023-18426', 'uci-hist-male-2020-14119', 'male'),
  ('uci-hist-male-2021-15318', 'uci-hist-male-2020-14120', 'male'),
  ('uci-hist-male-2021-15357', 'uci-hist-male-2020-14122', 'male'),
  ('uci-hist-male-2022-17352', 'uci-hist-male-2020-14123', 'male'),
  ('uci-hist-male-2024-19865', 'uci-hist-male-2020-14123', 'male'),
  ('uci-hist-male-2020-14124', 'team_1779567553440_15ldy3', 'male'),
  ('uci-hist-male-2024-19765', 'team_1779567553440_15ldy3', 'male'),
  ('uci-hist-male-2025-20620', 'team_1779567553440_15ldy3', 'male'),
  ('uci-hist-male-2021-15805', 'uci-hist-male-2020-14125', 'male'),
  ('uci-hist-male-2021-15279', 'uci-hist-male-2020-14128', 'male'),
  ('uci-hist-male-2020-14129', 'team_1776715734864_9thio7', 'male'),
  ('uci-hist-male-2021-15315', 'team_1776715734864_9thio7', 'male'),
  ('uci-hist-male-2021-15319', 'uci-hist-male-2020-14130', 'male'),
  ('uci-hist-male-2020-14131', 'team_1776750269864_jdyjug', 'male'),
  ('uci-hist-male-2021-15312', 'uci-hist-male-2020-14132', 'male'),
  ('uci-hist-male-2022-17312', 'uci-hist-male-2020-14132', 'male'),
  ('uci-hist-male-2021-15281', 'uci-hist-male-2020-14134', 'male'),
  ('uci-hist-male-2022-17270', 'uci-hist-male-2020-14134', 'male'),
  ('uci-hist-male-2021-15338', 'uci-hist-male-2020-14135', 'male'),
  ('uci-hist-male-2023-18454', 'uci-hist-male-2020-14135', 'male'),
  ('uci-hist-male-2020-14137', 'team_1776705480088_lg1a43', 'male'),
  ('uci-hist-male-2024-19755', 'team_1776705480088_lg1a43', 'male'),
  ('uci-hist-male-2025-20349', 'team_1776705480088_lg1a43', 'male'),
  ('uci-hist-male-2021-15360', 'uci-hist-male-2020-14138', 'male'),
  ('uci-hist-male-2021-15282', 'uci-hist-male-2020-14139', 'male'),
  ('uci-hist-male-2022-17277', 'uci-hist-male-2020-14139', 'male'),
  ('uci-hist-male-2020-14140', 'team_1776778499068_o0dkh6', 'male'),
  ('uci-hist-male-2021-15339', 'uci-hist-male-2020-14143', 'male'),
  ('uci-hist-male-2022-17344', 'uci-hist-male-2020-14143', 'male'),
  ('uci-hist-male-2023-18453', 'uci-hist-male-2020-14143', 'male'),
  ('uci-hist-male-2020-14144', 'team_1776706059069_a0p3ap', 'male'),
  ('uci-hist-male-2021-15353', 'team_1779566490365_etxyut', 'male'),
  ('uci-hist-male-2021-15298', 'uci-hist-male-2020-14147', 'male'),
  ('uci-hist-male-2022-17299', 'uci-hist-male-2020-14147', 'male'),
  ('uci-hist-male-2023-18394', 'uci-hist-male-2020-14147', 'male'),
  ('uci-hist-male-2024-19722', 'uci-hist-male-2020-14147', 'male'),
  ('uci-hist-male-2021-15347', 'uci-hist-male-2020-14151', 'male'),
  ('uci-hist-male-2022-17356', 'uci-hist-male-2020-14151', 'male'),
  ('uci-hist-male-2023-18464', 'uci-hist-male-2020-14151', 'male'),
  ('uci-hist-male-2024-19848', 'uci-hist-male-2020-14151', 'male'),
  ('uci-hist-male-2025-20630', 'uci-hist-male-2020-14151', 'male'),
  ('uci-hist-male-2021-15342', 'uci-hist-male-2020-14152', 'male'),
  ('uci-hist-male-2022-17349', 'uci-hist-male-2020-14152', 'male'),
  ('uci-hist-male-2023-18458', 'uci-hist-male-2020-14152', 'male'),
  ('uci-hist-male-2024-19776', 'uci-hist-male-2020-14152', 'male'),
  ('uci-hist-male-2025-20354', 'uci-hist-male-2020-14152', 'male'),
  ('uci-hist-male-2021-15364', 'uci-hist-male-2020-14155', 'male'),
  ('uci-hist-male-2022-17379', 'uci-hist-male-2020-14155', 'male'),
  ('uci-hist-male-2023-18491', 'uci-hist-male-2020-14155', 'male'),
  ('uci-hist-male-2021-15294', 'uci-hist-male-2020-14160', 'male'),
  ('uci-hist-male-2022-17294', 'uci-hist-male-2020-14160', 'male'),
  ('uci-hist-male-2021-15350', 'uci-hist-male-2020-14162', 'male'),
  ('uci-hist-male-2021-17077', 'uci-hist-male-2020-14197', 'male'),
  ('uci-hist-male-2021-15297', 'uci-hist-male-2020-14206', 'male'),
  ('uci-hist-male-2021-15877', 'uci-hist-male-2020-14207', 'male'),
  ('uci-hist-male-2022-17425', 'uci-hist-male-2020-14207', 'male'),
  ('uci-hist-male-2021-15302', 'uci-hist-male-2020-14213', 'male'),
  ('uci-hist-male-2020-14223', 'team_1776703182999_kk2zsf', 'male'),
  ('uci-hist-male-2020-14224', 'team_1776792069601_gdgq3j', 'male'),
  ('uci-hist-male-2022-17328', 'team_1776792069601_gdgq3j', 'male'),
  ('uci-hist-male-2020-14225', 'team_1780912000070_7nenqh', 'male'),
  ('uci-hist-male-2021-15375', 'team_1780912000070_7nenqh', 'male'),
  ('uci-hist-male-2022-17398', 'team_1780912000070_7nenqh', 'male'),
  ('uci-hist-male-2020-14226', 'team_1776703130449_us300h', 'male'),
  ('uci-hist-male-2021-15247', 'team_1776703130449_us300h', 'male'),
  ('uci-hist-male-2022-17619', 'team_1776703130449_us300h', 'male'),
  ('uci-hist-male-2023-17713', 'team_1776703130449_us300h', 'male'),
  ('uci-hist-male-2024-19533', 'team_1776703130449_us300h', 'male'),
  ('uci-hist-male-2025-20235', 'team_1776703130449_us300h', 'male'),
  ('uci-hist-male-2022-17373', 'uci-hist-male-2020-14231', 'male'),
  ('uci-hist-male-2021-15351', 'uci-hist-male-2020-14233', 'male'),
  ('uci-hist-male-2022-17361', 'uci-hist-male-2020-14233', 'male'),
  ('uci-hist-male-2021-15873', 'uci-hist-male-2020-14235', 'male'),
  ('uci-hist-male-2022-17622', 'uci-hist-male-2020-14235', 'male'),
  ('uci-hist-male-2023-18576', 'uci-hist-male-2020-14235', 'male'),
  ('uci-hist-male-2021-15330', 'uci-hist-male-2020-14238', 'male'),
  ('uci-hist-male-2022-17330', 'uci-hist-male-2020-14238', 'male'),
  ('uci-hist-male-2020-14239', 'team_1780912000032_tlnxdt', 'male'),
  ('uci-hist-male-2023-18560', 'team_1780912000032_tlnxdt', 'male'),
  ('uci-hist-male-2021-15367', 'uci-hist-male-2020-14240', 'male'),
  ('uci-hist-male-2022-17381', 'uci-hist-male-2020-14240', 'male'),
  ('uci-hist-male-2022-17435', 'uci-hist-male-2020-14242', 'male'),
  ('uci-hist-male-2021-17074', 'uci-hist-male-2020-14244', 'male'),
  ('uci-hist-male-2022-17380', 'uci-hist-male-2020-14244', 'male'),
  ('uci-hist-male-2023-18490', 'uci-hist-male-2020-14244', 'male'),
  ('uci-hist-male-2024-19793', 'uci-hist-male-2020-14244', 'male'),
  ('uci-hist-male-2020-14247', 'team_1779566943186_rzw6wx', 'male'),
  ('uci-hist-male-2021-15824', 'team_1779566943186_rzw6wx', 'male'),
  ('uci-hist-male-2022-17345', 'team_1779566943186_rzw6wx', 'male'),
  ('uci-hist-male-2023-18447', 'team_1779566943186_rzw6wx', 'male'),
  ('uci-hist-male-2024-19768', 'team_1779566943186_rzw6wx', 'male'),
  ('uci-hist-male-2025-20787', 'team_1779566943186_rzw6wx', 'male'),
  ('uci-hist-male-2021-15432', 'uci-hist-male-2020-14249', 'male'),
  ('uci-hist-male-2022-17436', 'uci-hist-male-2020-14249', 'male'),
  ('uci-hist-male-2023-19356', 'uci-hist-male-2020-14249', 'male'),
  ('uci-hist-male-2020-14251', 'team_1780912000061_9n05dz', 'male'),
  ('uci-hist-male-2021-15373', 'team_1780912000061_9n05dz', 'male'),
  ('uci-hist-male-2022-17392', 'team_1780912000061_9n05dz', 'male'),
  ('uci-hist-male-2020-14255', 'team_1780912000035_i2jqtf', 'male'),
  ('uci-hist-male-2021-15320', 'team_1780912000035_i2jqtf', 'male'),
  ('uci-hist-male-2022-17321', 'team_1780912000035_i2jqtf', 'male'),
  ('uci-hist-male-2023-18425', 'team_1780912000035_i2jqtf', 'male'),
  ('uci-hist-male-2025-20337', 'team_1780912000035_i2jqtf', 'male'),
  ('uci-hist-male-2020-14256', 'team_1780549154325_yxklvn', 'male'),
  ('uci-hist-male-2021-15384', 'uci-hist-male-2020-14258', 'male'),
  ('uci-hist-male-2021-15817', 'uci-hist-male-2020-15064', 'male'),
  ('uci-hist-male-2022-17432', 'uci-hist-male-2020-15064', 'male'),
  ('uci-hist-male-2020-15068', 'team_1780912000029_vwws8x', 'male'),
  ('uci-hist-male-2025-20618', 'team_1780912000029_vwws8x', 'male'),
  ('uci-hist-male-2021-15837', 'uci-hist-male-2020-15069', 'male'),
  ('uci-hist-male-2021-15355', 'uci-hist-male-2020-15070', 'male'),
  ('uci-hist-male-2022-17369', 'uci-hist-male-2020-15070', 'male'),
  ('uci-hist-male-2021-15865', 'uci-hist-male-2020-15072', 'male'),
  ('uci-hist-male-2022-17325', 'uci-hist-male-2020-15072', 'male'),
  ('uci-hist-male-2020-15075', 'team_1780912000095_o4mv1y', 'male'),
  ('uci-hist-male-2022-17310', 'team_1780912000095_o4mv1y', 'male'),
  ('uci-hist-male-2024-19869', 'team_1780912000095_o4mv1y', 'male'),
  ('uci-hist-male-2025-20459', 'team_1780912000095_o4mv1y', 'male'),
  ('uci-hist-male-2021-15868', 'uci-hist-male-2020-15077', 'male'),
  ('uci-hist-male-2022-17205', 'uci-hist-male-2020-15077', 'male'),
  ('uci-hist-male-2020-15144', 'team_1776703993260_yubupk', 'male'),
  ('uci-hist-male-2021-15264', 'team_1776703993260_yubupk', 'male'),
  ('uci-hist-male-2022-17219', 'team_1776703993260_yubupk', 'male'),
  ('uci-hist-male-2023-17711', 'team_1776703993260_yubupk', 'male'),
  ('uci-hist-male-2024-19514', 'team_1776703993260_yubupk', 'male'),
  ('uci-hist-male-2021-15249', 'uci-hist-male-2020-15152', 'male'),
  ('uci-hist-male-2022-17203', 'uci-hist-male-2020-15152', 'male'),
  ('uci-hist-male-2020-15154', 'team_1776703755811_lbaphb', 'male'),
  ('uci-hist-male-2021-15237', 'team_1776703755811_lbaphb', 'male'),
  ('uci-hist-male-2022-17184', 'team_1776703755811_lbaphb', 'male'),
  ('uci-hist-male-2021-15254', 'uci-hist-male-2020-15156', 'male'),
  ('uci-hist-male-2020-15211', 'team_1777379215624_qymkfj', 'male'),
  ('uci-hist-male-2021-15241', 'team_1777379215624_qymkfj', 'male'),
  ('uci-hist-male-2021-15437', 'uci-hist-male-2020-15222', 'male'),
  ('uci-hist-female-2022-17244', 'uci-hist-female-2021-15404', 'female'),
  ('uci-hist-female-2021-15419', 'team_1776715791581_5z1fd7', 'female'),
  ('uci-hist-female-2022-17259', 'team_1776715791581_5z1fd7', 'female'),
  ('uci-hist-female-2023-18546', 'team_1776715791581_5z1fd7', 'female'),
  ('uci-hist-female-2024-19577', 'team_1776715791581_5z1fd7', 'female'),
  ('uci-hist-female-2022-17597', 'uci-hist-female-2021-15802', 'female'),
  ('uci-hist-female-2021-15872', 'team_1780912000114_kn4q6m', 'female'),
  ('uci-hist-female-2022-17262', 'team_1780912000114_kn4q6m', 'female'),
  ('uci-hist-male-2021-15290', 'team_devo_alpecin', 'male'),
  ('uci-hist-male-2022-17620', 'team_devo_alpecin', 'male'),
  ('uci-hist-male-2023-18381', 'team_devo_alpecin', 'male'),
  ('uci-hist-male-2024-19714', 'team_devo_alpecin', 'male'),
  ('uci-hist-male-2025-20322', 'team_devo_alpecin', 'male'),
  ('uci-hist-male-2021-15307', 'team_1776778841056_se564m', 'male'),
  ('uci-hist-male-2022-17305', 'team_1776778841056_se564m', 'male'),
  ('uci-hist-male-2021-15310', 'team_0f68fdd397434298', 'male'),
  ('uci-hist-male-2022-17316', 'uci-hist-male-2021-15314', 'male'),
  ('uci-hist-male-2021-15346', 'team_1780912000065_kuiska', 'male'),
  ('uci-hist-male-2022-17355', 'team_1780912000065_kuiska', 'male'),
  ('uci-hist-male-2023-18463', 'team_1780912000065_kuiska', 'male'),
  ('uci-hist-male-2024-19864', 'team_1780912000065_kuiska', 'male'),
  ('uci-hist-male-2025-20479', 'team_1780912000065_kuiska', 'male'),
  ('uci-hist-male-2022-17370', 'uci-hist-male-2021-15361', 'male'),
  ('uci-hist-male-2022-17375', 'uci-hist-male-2021-15363', 'male'),
  ('uci-hist-male-2022-17402', 'uci-hist-male-2021-15374', 'male'),
  ('uci-hist-male-2022-17433', 'uci-hist-male-2021-15377', 'male'),
  ('uci-hist-male-2022-17405', 'uci-hist-male-2021-15380', 'male'),
  ('uci-hist-male-2023-18505', 'uci-hist-male-2021-15380', 'male'),
  ('uci-hist-male-2024-19814', 'uci-hist-male-2021-15380', 'male'),
  ('uci-hist-male-2022-17403', 'uci-hist-male-2021-15381', 'male'),
  ('uci-hist-male-2023-18508', 'uci-hist-male-2021-15381', 'male'),
  ('uci-hist-male-2022-17421', 'uci-hist-male-2021-15383', 'male'),
  ('uci-hist-male-2022-17408', 'uci-hist-male-2021-15803', 'male'),
  ('uci-hist-male-2022-17341', 'uci-hist-male-2021-15806', 'male'),
  ('uci-hist-male-2022-17434', 'uci-hist-male-2021-15825', 'male'),
  ('uci-hist-male-2021-15828', 'team_1780912000086_wfy0k6', 'male'),
  ('uci-hist-male-2022-17287', 'team_1780912000086_wfy0k6', 'male'),
  ('uci-hist-male-2022-17409', 'uci-hist-male-2021-15838', 'male'),
  ('uci-hist-male-2024-19798', 'uci-hist-male-2021-15838', 'male'),
  ('uci-hist-male-2022-17340', 'uci-hist-male-2021-15843', 'male'),
  ('uci-hist-male-2023-18437', 'uci-hist-male-2021-15843', 'male'),
  ('uci-hist-male-2024-19759', 'uci-hist-male-2021-15843', 'male'),
  ('uci-hist-female-2022-17202', 'team_female_unox', 'female'),
  ('uci-hist-female-2023-17692', 'team_female_unox', 'female'),
  ('uci-hist-female-2024-19529', 'team_female_unox', 'female'),
  ('uci-hist-female-2023-18558', 'uci-hist-female-2022-17223', 'female'),
  ('uci-hist-female-2022-17228', 'team_47f82f2c644743bd', 'female'),
  ('uci-hist-female-2023-18562', 'team_47f82f2c644743bd', 'female'),
  ('uci-hist-female-2024-19555', 'team_47f82f2c644743bd', 'female'),
  ('uci-hist-female-2025-20493', 'team_47f82f2c644743bd', 'female'),
  ('uci-hist-female-2022-17231', 'team_1780912000108_wlqfll', 'female'),
  ('uci-hist-female-2023-18518', 'team_1780912000108_wlqfll', 'female'),
  ('uci-hist-female-2024-19884', 'team_1780912000108_wlqfll', 'female'),
  ('uci-hist-female-2025-20613', 'team_1780912000108_wlqfll', 'female'),
  ('uci-hist-female-2022-17264', 'team_1780912000117_dmf8tp', 'female'),
  ('uci-hist-female-2023-18557', 'team_1780912000117_dmf8tp', 'female'),
  ('uci-hist-female-2024-19586', 'team_1780912000117_dmf8tp', 'female'),
  ('uci-hist-female-2025-20633', 'team_1780912000117_dmf8tp', 'female'),
  ('uci-hist-female-2023-19355', 'uci-hist-female-2022-17423', 'female'),
  ('uci-hist-female-2024-20187', 'uci-hist-female-2022-17423', 'female'),
  ('uci-hist-female-2022-17594', 'team_1780079146432_mu00hr', 'female'),
  ('uci-hist-female-2022-17600', 'team_1780912000112_w31pcz', 'female'),
  ('uci-hist-female-2023-18549', 'team_1780912000112_w31pcz', 'female'),
  ('uci-hist-female-2025-20415', 'team_1780912000112_w31pcz', 'female'),
  ('uci-hist-male-2023-18366', 'uci-hist-male-2022-17266', 'male'),
  ('uci-hist-male-2022-17288', 'team_1780912000090_wyrpo1', 'male'),
  ('uci-hist-male-2023-18386', 'uci-hist-male-2022-17292', 'male'),
  ('uci-hist-male-2023-18390', 'uci-hist-male-2022-17298', 'male'),
  ('uci-hist-male-2024-19882', 'uci-hist-male-2022-17298', 'male'),
  ('uci-hist-male-2023-18401', 'uci-hist-male-2022-17300', 'male'),
  ('uci-hist-male-2023-18429', 'uci-hist-male-2022-17327', 'male'),
  ('uci-hist-male-2024-19749', 'uci-hist-male-2022-17327', 'male'),
  ('uci-hist-male-2023-18442', 'uci-hist-male-2022-17331', 'male'),
  ('uci-hist-male-2024-19754', 'uci-hist-male-2022-17331', 'male'),
  ('uci-hist-male-2022-17335', 'team_1780912000014_9fhzxh', 'male'),
  ('uci-hist-male-2023-18445', 'team_1780912000014_9fhzxh', 'male'),
  ('uci-hist-male-2022-17337', 'team_1776705681103_iohs0z', 'male'),
  ('uci-hist-male-2023-19360', 'team_1776705681103_iohs0z', 'male'),
  ('uci-hist-male-2024-20056', 'team_1776705681103_iohs0z', 'male'),
  ('uci-hist-male-2025-20455', 'team_1776705681103_iohs0z', 'male'),
  ('uci-hist-male-2023-19333', 'uci-hist-male-2022-17339', 'male'),
  ('uci-hist-male-2023-18459', 'uci-hist-male-2022-17350', 'male'),
  ('uci-hist-male-2022-17364', 'team_5338bde2c0024175', 'male'),
  ('uci-hist-male-2023-18481', 'team_5338bde2c0024175', 'male'),
  ('uci-hist-male-2024-19782', 'team_5338bde2c0024175', 'male'),
  ('uci-hist-male-2025-20615', 'team_5338bde2c0024175', 'male'),
  ('uci-hist-male-2023-18483', 'uci-hist-male-2022-17371', 'male'),
  ('uci-hist-male-2023-18486', 'uci-hist-male-2022-17374', 'male'),
  ('uci-hist-male-2022-17382', 'team_1780912000031_mrfuri', 'male'),
  ('uci-hist-male-2023-19331', 'team_1780912000031_mrfuri', 'male'),
  ('uci-hist-male-2024-19845', 'team_1780912000031_mrfuri', 'male'),
  ('uci-hist-male-2025-20435', 'team_1780912000031_mrfuri', 'male'),
  ('uci-hist-male-2022-17384', 'team_1780912000028_phgv9z', 'male'),
  ('uci-hist-male-2023-18591', 'team_1780912000028_phgv9z', 'male'),
  ('uci-hist-male-2024-19795', 'team_1780912000028_phgv9z', 'male'),
  ('uci-hist-male-2025-20436', 'team_1780912000028_phgv9z', 'male'),
  ('uci-hist-male-2022-17387', 'team_1776792426179_zz8law', 'male'),
  ('uci-hist-male-2022-17393', 'team_1780912000060_ixxtgt', 'male'),
  ('uci-hist-male-2023-18498', 'team_1780912000060_ixxtgt', 'male'),
  ('uci-hist-male-2024-19804', 'team_1780912000060_ixxtgt', 'male'),
  ('uci-hist-male-2025-20373', 'team_1780912000060_ixxtgt', 'male'),
  ('uci-hist-male-2022-17397', 'team_1780912000068_f9xhlq', 'male'),
  ('uci-hist-male-2023-19335', 'team_1780912000068_f9xhlq', 'male'),
  ('uci-hist-male-2023-19357', 'uci-hist-male-2022-17411', 'male'),
  ('uci-hist-male-2022-17429', 'team_1780912000103_ziho13', 'male'),
  ('uci-hist-male-2023-18472', 'team_1780912000103_ziho13', 'male'),
  ('uci-hist-male-2024-19778', 'team_1780912000103_ziho13', 'male'),
  ('uci-hist-male-2023-18580', 'uci-hist-male-2022-17430', 'male'),
  ('uci-hist-male-2024-20182', 'uci-hist-male-2022-17430', 'male'),
  ('uci-hist-male-2023-18467', 'uci-hist-male-2022-17604', 'male'),
  ('uci-hist-male-2023-19339', 'uci-hist-male-2022-17605', 'male'),
  ('uci-hist-male-2023-18416', 'uci-hist-male-2022-17608', 'male'),
  ('uci-hist-male-2024-19842', 'uci-hist-male-2022-17608', 'male'),
  ('uci-hist-male-2022-17611', 'team_2e801316d3c1457f', 'male'),
  ('uci-hist-male-2023-19362', 'team_2e801316d3c1457f', 'male'),
  ('uci-hist-male-2023-18496', 'uci-hist-male-2022-17614', 'male'),
  ('uci-hist-male-2024-19802', 'uci-hist-male-2022-17614', 'male'),
  ('uci-hist-male-2022-17618', 'team_1776704584941_aeypqm', 'male'),
  ('uci-hist-female-2024-19526', 'uci-hist-female-2023-17684', 'female'),
  ('uci-hist-female-2024-20064', 'uci-hist-female-2023-18515', 'female'),
  ('uci-hist-female-2024-19825', 'uci-hist-female-2023-18525', 'female'),
  ('uci-hist-female-2024-19835', 'uci-hist-female-2023-18527', 'female'),
  ('uci-hist-female-2024-19561', 'uci-hist-female-2023-18534', 'female'),
  ('uci-hist-female-2024-19563', 'uci-hist-female-2023-18535', 'female'),
  ('uci-hist-female-2024-19569', 'uci-hist-female-2023-18537', 'female'),
  ('uci-hist-female-2024-20189', 'uci-hist-female-2023-18553', 'female'),
  ('uci-hist-female-2024-19585', 'uci-hist-female-2023-18555', 'female'),
  ('uci-hist-female-2024-19582', 'uci-hist-female-2023-18556', 'female'),
  ('uci-hist-female-2025-20465', 'uci-hist-female-2023-18588', 'female'),
  ('uci-hist-female-2023-19334', 'team_1779568751561_pl1lo6', 'female'),
  ('uci-hist-female-2024-19558', 'team_1779568751561_pl1lo6', 'female'),
  ('uci-hist-female-2025-20393', 'team_1779568751561_pl1lo6', 'female'),
  ('uci-hist-female-2024-19562', 'uci-hist-female-2023-19346', 'female'),
  ('uci-hist-male-2024-19500', 'uci-hist-male-2023-17694', 'male'),
  ('uci-hist-male-2025-20707', 'uci-hist-male-2023-17694', 'male'),
  ('uci-hist-male-2023-17705', 'team_1776704474025_wuq3wr', 'male'),
  ('uci-hist-male-2024-19508', 'team_1776704474025_wuq3wr', 'male'),
  ('uci-hist-male-2025-20289', 'team_1776704474025_wuq3wr', 'male'),
  ('uci-hist-male-2024-19704', 'uci-hist-male-2023-18369', 'male'),
  ('uci-hist-male-2024-19858', 'uci-hist-male-2023-18370', 'male'),
  ('uci-hist-male-2024-19707', 'uci-hist-male-2023-18375', 'male'),
  ('uci-hist-male-2024-19715', 'uci-hist-male-2023-18380', 'male'),
  ('uci-hist-male-2024-19712', 'uci-hist-male-2023-18383', 'male'),
  ('uci-hist-male-2025-20319', 'uci-hist-male-2023-18383', 'male'),
  ('uci-hist-male-2024-19720', 'uci-hist-male-2023-18389', 'male'),
  ('uci-hist-male-2024-19850', 'uci-hist-male-2023-18391', 'male'),
  ('uci-hist-male-2025-20632', 'uci-hist-male-2023-18391', 'male'),
  ('uci-hist-male-2023-18392', 'team_1779566405212_4tb411', 'male'),
  ('uci-hist-male-2024-20062', 'team_1779566405212_4tb411', 'male'),
  ('uci-hist-male-2025-20326', 'team_1779566405212_4tb411', 'male'),
  ('uci-hist-male-2024-19852', 'uci-hist-male-2023-18397', 'male'),
  ('uci-hist-male-2025-20746', 'uci-hist-male-2023-18397', 'male'),
  ('uci-hist-male-2024-19721', 'uci-hist-male-2023-18403', 'male'),
  ('uci-hist-male-2024-19847', 'uci-hist-male-2023-18413', 'male'),
  ('uci-hist-male-2024-19834', 'uci-hist-male-2023-18417', 'male'),
  ('uci-hist-male-2024-19820', 'uci-hist-male-2023-18428', 'male'),
  ('uci-hist-male-2025-20336', 'uci-hist-male-2023-18428', 'male'),
  ('uci-hist-male-2024-19761', 'uci-hist-male-2023-18438', 'male'),
  ('uci-hist-male-2024-19758', 'uci-hist-male-2023-18441', 'male'),
  ('uci-hist-male-2025-20614', 'uci-hist-male-2023-18460', 'male'),
  ('uci-hist-male-2023-18479', 'team_1776705190489_lx26od', 'male'),
  ('uci-hist-male-2024-19509', 'team_1776705190489_lx26od', 'male'),
  ('uci-hist-male-2025-20296', 'team_1776705190489_lx26od', 'male'),
  ('uci-hist-male-2024-19787', 'uci-hist-male-2023-18484', 'male'),
  ('uci-hist-male-2023-18499', 'team_devo_tudor', 'male'),
  ('uci-hist-male-2023-18503', 'team_1780912000069_qms7ml', 'male'),
  ('uci-hist-male-2023-18504', 'team_1776778751089_plvxbb', 'male'),
  ('uci-hist-male-2024-19829', 'team_1776778751089_plvxbb', 'male'),
  ('uci-hist-male-2025-20444', 'team_1776778751089_plvxbb', 'male'),
  ('uci-hist-male-2024-20184', 'uci-hist-male-2023-18566', 'male'),
  ('uci-hist-male-2023-18569', 'team_1780912000055_yk7x1n', 'male'),
  ('uci-hist-male-2024-19874', 'team_1780912000055_yk7x1n', 'male'),
  ('uci-hist-male-2025-20494', 'team_1780912000055_yk7x1n', 'male'),
  ('uci-hist-male-2023-18572', 'team_1780912000056_53nl2h', 'male'),
  ('uci-hist-male-2024-20050', 'uci-hist-male-2023-19328', 'male'),
  ('uci-hist-male-2024-19800', 'uci-hist-male-2023-19359', 'male'),
  ('uci-hist-male-2025-20368', 'uci-hist-male-2023-19359', 'male'),
  ('uci-hist-female-2024-19522', 'team_1776715116251_asy20x', 'female'),
  ('uci-hist-female-2025-20390', 'uci-hist-female-2024-19553', 'female'),
  ('uci-hist-female-2025-20635', 'uci-hist-female-2024-19556', 'female'),
  ('uci-hist-female-2025-20403', 'uci-hist-female-2024-19564', 'female'),
  ('uci-hist-female-2024-19568', 'team_1779568814366_si9au5', 'female'),
  ('uci-hist-female-2025-20396', 'team_1779568814366_si9au5', 'female'),
  ('uci-hist-female-2024-19856', 'team_1780912000107_hb9z46', 'female'),
  ('uci-hist-female-2025-20623', 'team_1780912000107_hb9z46', 'female'),
  ('uci-hist-female-2024-20185', 'team_1776714955304_ng13hf', 'female'),
  ('uci-hist-female-2025-20301', 'team_1776714955304_ng13hf', 'female'),
  ('uci-hist-male-2024-19703', 'team_1779566883187_6pfaiw', 'male'),
  ('uci-hist-male-2025-20316', 'team_1779566883187_6pfaiw', 'male'),
  ('uci-hist-male-2025-20320', 'uci-hist-male-2024-19716', 'male'),
  ('uci-hist-male-2024-19719', 'team_1780912000082_5llirp', 'male'),
  ('uci-hist-male-2025-20783', 'team_1780912000082_5llirp', 'male'),
  ('uci-hist-male-2024-19726', 'team_1780912000000_i87o0a', 'male'),
  ('uci-hist-male-2025-20325', 'team_1780912000000_i87o0a', 'male'),
  ('uci-hist-male-2024-19729', 'team_1780912000012_o83lkc', 'male'),
  ('uci-hist-male-2025-20327', 'team_1780912000012_o83lkc', 'male'),
  ('uci-hist-male-2025-20604', 'uci-hist-male-2024-19730', 'male'),
  ('uci-hist-male-2025-20335', 'uci-hist-male-2024-19738', 'male'),
  ('uci-hist-male-2025-20345', 'uci-hist-male-2024-19751', 'male'),
  ('uci-hist-male-2024-19786', 'team_devo_picnic', 'male'),
  ('uci-hist-male-2024-19789', 'team_1780912000066_5sf7js', 'male'),
  ('uci-hist-male-2024-19790', 'team_1780912000084_dqj2o2', 'male'),
  ('uci-hist-male-2024-19792', 'team_1780912000073_gh7uxg', 'male'),
  ('uci-hist-male-2024-19799', 'team_1779520937837_4ow0c6', 'male'),
  ('uci-hist-male-2025-20745', 'team_1779520937837_4ow0c6', 'male'),
  ('uci-hist-male-2024-19803', 'team_1780912000062_g8q948', 'male'),
  ('uci-hist-male-2024-19815', 'team_84a3307f695e4741', 'male'),
  ('uci-hist-male-2025-20606', 'team_84a3307f695e4741', 'male'),
  ('uci-hist-male-2025-20445', 'uci-hist-male-2024-19819', 'male'),
  ('uci-hist-male-2024-19827', 'team_devo_soudal', 'male'),
  ('uci-hist-male-2024-19836', 'team_66fdf306c4b249f5', 'male'),
  ('uci-hist-male-2025-20602', 'team_66fdf306c4b249f5', 'male'),
  ('uci-hist-male-2025-20627', 'uci-hist-male-2024-19866', 'male'),
  ('uci-hist-male-2024-19871', 'team_1780912000080_tpv2v9', 'male'),
  ('uci-hist-male-2024-19875', 'team_1780912000093_fbdmrd', 'male'),
  ('uci-hist-male-2024-19878', 'team_1780912000074_vp9qv3', 'male'),
  ('uci-hist-male-2025-20625', 'team_1780912000074_vp9qv3', 'male'),
  ('uci-hist-male-2024-20067', 'team_1776792550457_sd769j', 'male'),
  ('uci-hist-female-2025-20391', 'team_1776715943597_af6cmv', 'female'),
  ('uci-hist-female-2025-20400', 'team_1779568909853_sml6e1', 'female'),
  ('uci-hist-female-2025-20402', 'team_1780912000115_bngyrz', 'female'),
  ('uci-hist-female-2025-20418', 'team_1779568979831_a6701t', 'female'),
  ('uci-hist-female-2025-20464', 'team_devo_ag_fem', 'female'),
  ('uci-hist-female-2025-20468', 'team_1776716014580_enrpjl', 'female'),
  ('uci-hist-male-2025-20315', 'team_1780912000047_5qcve4', 'male'),
  ('uci-hist-male-2025-20331', 'team_1780912000050_bisutr', 'male'),
  ('uci-hist-male-2025-20338', 'team_red_bull_rookies', 'male'),
  ('uci-hist-male-2025-20344', 'team_1777987560768_xpd8lr', 'male'),
  ('uci-hist-male-2025-20355', 'team_devo_astana', 'male'),
  ('uci-hist-male-2025-20357', 'team_1780912000077_hnwr06', 'male'),
  ('uci-hist-male-2025-20376', 'team_328a0d9287554316', 'male'),
  ('uci-hist-male-2025-20388', 'team_1780912000023_w464il', 'male'),
  ('uci-hist-male-2025-20389', 'team_1780912000024_166i02', 'male'),
  ('uci-hist-male-2025-20432', 'team_1776778634909_49sj04', 'male'),
  ('uci-hist-male-2025-20438', 'team_1780912000101_m46bk3', 'male'),
  ('uci-hist-male-2025-20448', 'team_1780912000096_rcetxi', 'male'),
  ('uci-hist-male-2025-20456', 'team_devo_ef', 'male'),
  ('uci-hist-male-2025-20457', 'team_1780912000087_3xlslf', 'male'),
  ('uci-hist-male-2025-20466', 'team_1780912000075_quvvvp', 'male'),
  ('uci-hist-male-2025-20484', 'team_1780912000011_j9vmgk', 'male'),
  ('uci-hist-male-2025-20611', 'team_1780912000054_8cukuz', 'male'),
  ('uci-hist-male-2025-20626', 'team_1776792606045_9p2ktk', 'male'),
  ('uci-hist-male-2025-20629', 'team_1779567381568_7ic9g3', 'male'),
  ('uci-hist-male-2025-20743', 'team_1780912000099_vdya9z', 'male');

CREATE TEMP TABLE _team_continuity_before AS
SELECT
  (SELECT count(*) FROM public.teams) teams,
  (SELECT count(*) FROM public.team_seasons) team_seasons,
  (SELECT count(*) FROM private.uci_catalog_team_links) uci_links,
  (SELECT count(*) FROM private.historical_team_roster_observations) roster_observations,
  (SELECT count(*) FROM public.rider_team_affiliations) affiliations,
  (SELECT count(*) FROM public.race_uci_results) results,
  (SELECT count(*) FROM public.startlist_teams) startlist_teams;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM _team_continuity_merge) <> 625 THEN
    RAISE EXCEPTION 'El manifiesto de continuidad no contiene 625 relaciones';
  END IF;
  IF EXISTS(SELECT 1 FROM _team_continuity_merge m JOIN _team_continuity_merge other ON other.target_id=m.source_id) THEN
    RAISE EXCEPTION 'El manifiesto contiene cadenas no normalizadas';
  END IF;
  PERFORM 1 FROM public.teams t WHERE t.id IN (SELECT source_id FROM _team_continuity_merge UNION SELECT target_id FROM _team_continuity_merge) FOR UPDATE;
  IF (SELECT count(*) FROM _team_continuity_merge m
      JOIN public.teams source ON source.id=m.source_id AND source."historicalCatalogOnly"=true
        AND source.gender=m.gender AND source."specialEdition"=false
      JOIN public.teams target ON target.id=m.target_id AND target.gender=m.gender
        AND target."specialEdition"=false AND target."teamKind"<>'selection') <> 625 THEN
    RAISE EXCEPTION 'Las identidades origen o destino cambiaron desde la auditoría';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.team_seasons source
    JOIN _team_continuity_merge m ON m.source_id=source."teamId"
    JOIN public.team_seasons target ON target."teamId"=m.target_id AND target.year=source.year
  ) THEN RAISE EXCEPTION 'Una temporada colisiona con la matriz longitudinal de destino'; END IF;
END
$preflight$;

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'teams',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.teams x WHERE x.id IN (SELECT source_id FROM _team_continuity_merge UNION SELECT target_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'team_seasons',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.team_seasons x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'uci_catalog_team_links',md5(to_jsonb(x)::text),to_jsonb(x) FROM private.uci_catalog_team_links x WHERE x.team_id IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'historical_team_roster_observations',md5(to_jsonb(x)::text),to_jsonb(x) FROM private.historical_team_roster_observations x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'historical_participation_decisions',md5(to_jsonb(x)::text),to_jsonb(x) FROM private.historical_participation_decisions x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'rider_team_affiliations',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.rider_team_affiliations x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'race_uci_results',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.race_uci_results x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'startlist_teams',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.startlist_teams x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'team_link_decisions',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.team_link_decisions x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'team_name_aliases',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.team_name_aliases x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'team_season_variants',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.team_season_variants x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'uci_team_rankings',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.uci_team_rankings x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'uci_catalog_baselines',md5(to_jsonb(x)::text),to_jsonb(x) FROM private.uci_catalog_baselines x WHERE x.team_id IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'team_development_links',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.team_development_links x WHERE x."mainTeamId" IN (SELECT source_id FROM _team_continuity_merge) OR x."developmentTeamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'teams_parent',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.teams x WHERE x."parentTeamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'riders_men',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.riders_men x WHERE x."currentTeamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'riders_women',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.riders_women x WHERE x."currentTeamId" IN (SELECT source_id FROM _team_continuity_merge);

INSERT INTO private.repair_team_continuity_20260907_backup(entity,row_key,row_data)
SELECT 'rider_transfers',md5(to_jsonb(x)::text),to_jsonb(x) FROM public.rider_transfers x WHERE x."fromTeamId" IN (SELECT source_id FROM _team_continuity_merge) OR x."toTeamId" IN (SELECT source_id FROM _team_continuity_merge);

CREATE TEMP TABLE _team_continuity_backup_count AS
SELECT count(*) rows FROM private.repair_team_continuity_20260907_backup;

UPDATE public.team_seasons x SET "teamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE private.uci_catalog_team_links x SET team_id=m.target_id,reviewed_at=transaction_timestamp()
FROM _team_continuity_merge m WHERE x.team_id=m.source_id;
UPDATE private.historical_team_roster_observations x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE private.historical_participation_decisions x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.rider_team_affiliations x
SET "teamId"=m.target_id,
    id='hist_'||md5(concat_ws('|',x."riderGender",x."riderId",m.target_id,x.year,x."dateFrom",x."dateTo",x."sourceUrl")),
    "updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.race_uci_results x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.startlist_teams x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.team_link_decisions x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.team_name_aliases x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.team_season_variants x SET "teamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE public.uci_team_rankings x SET "teamId"=m.target_id
FROM _team_continuity_merge m WHERE x."teamId"=m.source_id;
UPDATE private.uci_catalog_baselines x SET team_id=m.target_id
FROM _team_continuity_merge m WHERE x.team_id=m.source_id;
UPDATE public.team_development_links x SET "mainTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."mainTeamId"=m.source_id;
UPDATE public.team_development_links x SET "developmentTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."developmentTeamId"=m.source_id;
UPDATE public.teams x SET "parentTeamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."parentTeamId"=m.source_id;
UPDATE public.riders_men x SET "currentTeamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."currentTeamId"=m.source_id;
UPDATE public.riders_women x SET "currentTeamId"=m.target_id,"updatedAt"=transaction_timestamp()
FROM _team_continuity_merge m WHERE x."currentTeamId"=m.source_id;
UPDATE public.rider_transfers x SET "fromTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."fromTeamId"=m.source_id;
UPDATE public.rider_transfers x SET "toTeamId"=m.target_id
FROM _team_continuity_merge m WHERE x."toTeamId"=m.source_id;

SELECT set_config('app.historical_catalog','on',true);
WITH targets AS (SELECT DISTINCT target_id FROM _team_continuity_merge),
latest AS (
  SELECT DISTINCT ON (s."teamId") s."teamId",s.name,s.category,s.gender,s."headerBg",s."headerText",
    s."badgeTorsoCenter",s."badgeTorsoSides",s."badgeInnerCircle",s."badgeShorts",s."badgeVisible"
  FROM public.team_seasons s JOIN targets t ON t.target_id=s."teamId"
  ORDER BY s."teamId",s.year DESC
), stats AS (
  SELECT s."teamId",min(s.year) first_season,
    string_agg(DISTINCT btrim(s.name),E'
' ORDER BY btrim(s.name)) FILTER(WHERE btrim(s.name)<>'') aliases
  FROM public.team_seasons s JOIN targets t ON t.target_id=s."teamId" GROUP BY s."teamId"
)
UPDATE public.teams t SET
  "firstSeason"=least(coalesce(t."firstSeason",stats.first_season),stats.first_season),
  name=CASE WHEN t."historicalCatalogOnly" THEN latest.name ELSE t.name END,
  category=CASE WHEN t."historicalCatalogOnly" THEN latest.category ELSE t.category END,
  "headerBg"=CASE WHEN t."historicalCatalogOnly" THEN latest."headerBg" ELSE t."headerBg" END,
  "headerText"=CASE WHEN t."historicalCatalogOnly" THEN latest."headerText" ELSE t."headerText" END,
  "badgeTorsoCenter"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeTorsoCenter" ELSE t."badgeTorsoCenter" END,
  "badgeTorsoSides"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeTorsoSides" ELSE t."badgeTorsoSides" END,
  "badgeInnerCircle"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeInnerCircle" ELSE t."badgeInnerCircle" END,
  "badgeShorts"=CASE WHEN t."historicalCatalogOnly" THEN latest."badgeShorts" ELSE t."badgeShorts" END,
  "nameAliases"=stats.aliases,
  "updatedAt"=transaction_timestamp()
FROM latest,stats WHERE t.id=latest."teamId" AND stats."teamId"=t.id;

DO $verify$
DECLARE v_before _team_continuity_before%ROWTYPE;
BEGIN
  SELECT * INTO v_before FROM _team_continuity_before;
  IF (SELECT count(*) FROM public.teams)<>v_before.teams
    OR (SELECT count(*) FROM public.team_seasons)<>v_before.team_seasons
    OR (SELECT count(*) FROM private.uci_catalog_team_links)<>v_before.uci_links
    OR (SELECT count(*) FROM private.historical_team_roster_observations)<>v_before.roster_observations
    OR (SELECT count(*) FROM public.rider_team_affiliations)<>v_before.affiliations
    OR (SELECT count(*) FROM public.race_uci_results)<>v_before.results
    OR (SELECT count(*) FROM public.startlist_teams)<>v_before.startlist_teams THEN
    RAISE EXCEPTION 'La consolidación alteró el número de filas';
  END IF;
  IF EXISTS(SELECT 1 FROM public.team_seasons GROUP BY "teamId",year HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM public.team_seasons s JOIN public.teams t ON t.id=s."teamId" WHERE s.gender IS DISTINCT FROM t.gender)
    OR EXISTS(SELECT 1 FROM private.uci_catalog_team_links l LEFT JOIN public.team_seasons s
      ON s."teamId"=l.team_id AND s.year=l.season WHERE s.id IS NULL OR l.gender IS DISTINCT FROM s.gender OR l.category IS DISTINCT FROM s.category)
    OR EXISTS(SELECT 1 FROM private.historical_team_roster_observations o LEFT JOIN public.teams t ON t.id=o."teamId" WHERE t.id IS NULL) THEN
    RAISE EXCEPTION 'La consolidación produjo solapamientos o referencias incompatibles';
  END IF;
  IF EXISTS(SELECT 1 FROM public.team_seasons x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge))
    OR EXISTS(SELECT 1 FROM private.uci_catalog_team_links x WHERE x.team_id IN (SELECT source_id FROM _team_continuity_merge))
    OR EXISTS(SELECT 1 FROM private.historical_team_roster_observations x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge))
    OR EXISTS(SELECT 1 FROM public.rider_team_affiliations x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge))
    OR EXISTS(SELECT 1 FROM public.race_uci_results x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge))
    OR EXISTS(SELECT 1 FROM public.startlist_teams x WHERE x."teamId" IN (SELECT source_id FROM _team_continuity_merge)) THEN
    RAISE EXCEPTION 'Quedan referencias operativas en identidades retiradas';
  END IF;
  IF (SELECT count(*) FROM public.teams t WHERE t.id IN (SELECT source_id FROM _team_continuity_merge) AND t."historicalCatalogOnly"=true)<>625 THEN
    RAISE EXCEPTION 'No se conservaron las 625 identidades ocultas de compatibilidad';
  END IF;
  IF (SELECT count(*) FROM private.repair_team_continuity_20260907_backup)
     <> (SELECT rows FROM _team_continuity_backup_count) THEN
    RAISE EXCEPTION 'El backup cambió durante la reparación';
  END IF;
END
$verify$;

COMMIT;

-- Rollback dirigido: restaurar desde row_data por entidad dentro de una transacción,
-- empezando por teams y team_seasons. El backup conserva cada fila completa previa.
