-- ════════════════════════════════════════════════════════════════
-- Catálogo oro Fase 1 — Continental (CT/CTW) 2026: SOLO EQUIPOS.
-- (1) Corregir gender de equipos existentes con gender NULL (15).
-- (2) Crear los equipos ausentes (120), colores default, nameAliases NULL.
-- Sin corredores (fase posterior). Idempotente.
-- ════════════════════════════════════════════════════════════════
BEGIN;

-- ── (1) Correcciones: fijar gender (category sin cambio) ──
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_5338bde2c0024175';  -- EEW-VDK
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_a86ed7e6dea142b8';  -- Metec - Solarwatt p/b Mantel
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_red_bull_rookies';  -- Red Bull - Bora - Hansgrohe Rookies
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_d93eff8f7d77423b';  -- Baloise Verzekeringen - Het Poetsbureau Lions
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_84a3307f695e4741';  -- Hagens Berman Jayco
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_b83a52ed41b84bde';  -- Fany Gastro - Integray L27
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_fe749a9b73e64edd';  -- Favorit Brno
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_f50b0d4510034740';  -- TUFO - Pardus Prostějov
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_66fdf306c4b249f5';  -- Sistecrédito
UPDATE teams SET gender='male', category='CT', "updatedAt"=now() WHERE id='team_a33f94c2d08042c0';  -- Drali - Repsol
UPDATE teams SET gender='female', category='CTW', "updatedAt"=now() WHERE id='team_bc38e80d7d7c4e4b';  -- Isolmant - Premac - Vittoria
UPDATE teams SET gender='female', category='CTW', "updatedAt"=now() WHERE id='team_b6c3e8dab28d43fd';  -- Liv AlUla Jayco Women's Continental
UPDATE teams SET gender='female', category='CTW', "updatedAt"=now() WHERE id='team_92b6e81fc1d146fa';  -- Meridian Bikebug
UPDATE teams SET gender='female', category='CTW', "updatedAt"=now() WHERE id='team_1dcb883de4444367';  -- Vendée Féminine
UPDATE teams SET gender='female', category='CTW', "updatedAt"=now() WHERE id='team_97bda138f4a34455';  -- Amani

-- ── (2) Altas: Continental ausentes (invisibles hasta que un corredor matchee una carrera cubierta) ──
-- masculinos (CT/male):
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000000_i87o0a', 'Bodywrap LTwoo Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000001_pjxuaj', 'Camp Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000002_bqyn9l', 'China Anta - Mentech Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000003_koaan2', 'China Chermin Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000004_stn4r3', 'FNIX - SCOM - Hengxiang Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000005_z8ue04', 'Giant Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000006_df60rd', 'Huansheng - Vonoa - Taishan Sport Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000007_csl1br', 'Pingtan International Tourism Island Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000008_xe4g60', 'Qinghai Tianyoude Hotel Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000009_u8grve', 'Shenzhen Gineyea - Xidesheng Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000010_pl0o8p', 'Shenzhen Kung Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000011_j9vmgk', 'The Joyrun & Hurricane Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000012_o83lkc', 'Wheeltop Rotor Chengdu Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000013_1olil9', 'Beltrami TSA Tre Colli', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000014_9fhzxh', 'Biesse - Carrera - Premac', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000015_59fxnj', 'Campana Imballagi - Morbiato - Trentino', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000016_uelalv', 'General Store - Essegibi - F.Lli Curia', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000017_1csrvn', 'Gragnano Sporting Club', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000018_jztkxe', 'S.C. Padovani Polo Cherry Bank', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000019_siq55k', 'Solme - Olmo - Arvedi', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000020_zwqotc', 'Team Nippo Nuovacomauto Obor', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000021_rwxlc7', 'Team Technipes #inEmiliaRomagna Caffè Borbone', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000022_jnegch', 'UC Trevigiani - Energiapura Marchiol', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000023_w464il', 'Vega - Vitalcare - Dynatek', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000024_166i02', 'Bourg-en-Bresse Ain Cyclisme', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000025_5uuzvx', 'SCO Dijon Team Matériel-Velo.com', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000026_f7k33j', 'Vélo Club Villefranche Beaujolais', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000027_l2s7ey', 'Veloce Club Rouen 76', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000028_phgv9z', 'Efapel Cycling', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000029_vwws8x', 'Feirense - Beeceler', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000030_afbqrk', 'GI Group Holding - Simoldes - UDO', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000031_mrfuri', 'Tavfer-Ovos Matinados-Mortágua', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000032_tlnxdt', 'Team Tavira / Crédito Agrícola', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000033_vywzs4', 'Universe Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000034_lkkswh', 'Sparkle Oita Racing Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000035_i2jqtf', 'Benotti Berthold', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000036_y6ckhb', 'MaxSolar - Raymon', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000037_i8bxc0', 'Run & Race - Solarpur', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000038_entnh1', 'APS Pro Cycling by Team Cadence Cyclery', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000039_acvdtg', 'Competitive Edge Racing', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000040_r9h546', 'L39ION of Los Angeles', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000041_68hs8m', 'Meridian Racing p/b de la Uz', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000042_b7x5ai', 'Project Echelon Racing', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000043_xp0sxh', 'Team Skyline', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000044_5h9lmr', 'Schwingshandl Intralogistics', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000045_hf5rmp', 'Tirol KTM Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000046_5d9mk0', 'WSA KTM Graz', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000047_5qcve4', 'St George Continental Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000048_vm5n5c', 'GW Erco SportFitness', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000049_lk6fb1', 'BHS - PL Beton Bornholm', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000050_bisutr', 'Team Give Steel', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000051_7dqjfj', '7Eleven Cliqq Roadbike Philippines', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000052_r92tv1', 'Go For Gold Philippines', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000053_qmpfii', 'Standard Insurance PHI', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000054_8cukuz', 'ASC Monsters Indonesia', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000055_yk7x1n', 'Jakarta Pro Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000056_53nl2h', 'Nusantara Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000057_lwdi0p', 'May Stars', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000058_gw67zj', 'Almaty Continental Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000059_itm3ue', 'Team Vino - North Qazaqstan Region', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000060_ixxtgt', 'Factor Racing', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000061_9n05dz', 'Kolesarski Klub Novo Mesto', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000062_g8q948', 'Pogi Team Gusto Ljubljana', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000063_hkyuof', 'Elite Fondations Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000064_tvoibe', 'KSPO', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000065_kuiska', 'LX Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000066_5sf7js', 'Lillehammer CK Continental Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000067_8iptsy', 'Team Ringerike', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000068_f9xhlq', 'Grant Thornton Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000069_qms7ml', 'Roojai Insurance Winspace', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000070_7nenqh', 'Thailand Continental Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000071_239jlr', 'Mazowsze Serce Polski', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000072_rgw2x1', 'Voster Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000073_gh7uxg', 'Wibatech Lubelskie Perła Polski', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000074_vp9qv3', 'Malaysia Pro Cycling', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000075_quvvvp', 'Crown Tabriz Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000076_kftmsc', 'NAVIHOOD DFT CCN', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000077_hnwr06', 'Bishkek Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000078_ylpfa3', 'Canel''s - Java', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000079_pzxt0b', 'Petrolike', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000080_tpv2v9', 'Madar Pro Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000081_bd2sca', 'Mouloudia Club d''Alger', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000082_5llirp', 'Plus Performance - ZEO Sport', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000083_1lxnsv', 'P.A.S. Ioanninon - P&I', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000084_dqj2o2', 'Whoosh - NZ Cycling Project', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000085_z1ajnt', 'UN Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000086_wfy0k6', 'Pío Rico Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000087_3xlslf', 'Sidi Ali - Unlock Sports Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000088_euuezb', 'Tshenolo Pro Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000089_ru3hv9', '4WD Rent a Car - Facatativa', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000090_wyrpo1', 'Localiza Meoo / Swift Pro Cycling', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000091_r7ilfg', 'HKSI Pro Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000092_34ovmy', 'Hino One La Red Suzuki', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000093_fbdmrd', 'Energus Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000094_ulblwr', 'Dukla Banska Bystrica', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000095_o4mv1y', 'Best PC Ecuador', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000096_rcetxi', 'Groupama-FDJ United CT', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000097_4dibqb', 'Team Amani', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000098_m4s5l9', '7 Saber Uzbekistan Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000099_vdya9z', 'Ukraine Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000100_97y0n9', 'Pardus Cycling Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000101_m46bk3', 'Vendée U Primeo Energie', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000102_b213nh', 'Team Novo Nordisk Development', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000103_ziho13', 'Quick Pro Team', 'CT', 'male') ON CONFLICT (id) DO NOTHING;
-- femeninos (CTW/female):
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000104_kfpjcy', 'REMBE | rad-net Women', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000105_b60pmi', 'Wheel Divas Cycling Team', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000106_ndwwqq', 'Smurfit Westrock Cycling Team', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000107_hb9z46', 'Bodywrap LTwoo Women''s Cycling Team', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000108_wlqfll', 'Li Ning Star Ladies', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000109_28uitq', 'XDS China Women Team', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000110_b0o6bz', 'VIF Cycling Team', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000111_x0p2tp', 'Team Abadie Magnan', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000112_w31pcz', 'MAT Atom Deweloper Wrocław', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000113_vzuno4', 'Tirol Women Cycling', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000114_kn4q6m', 'Thailand Women''s Cycling Team', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000115_bngyrz', 'Virginia''s Blue Ridge - TWENTY28', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000116_9k557p', 'Standard Insurance PHI', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000117_dmf8tp', '7 Saber Uzbekistan Women Cycling Team', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000118_251wgg', 'HKSI Pro Cycling Team (Women)', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;
INSERT INTO teams (id, name, category, gender) VALUES ('team_1780912000119_jqenza', 'China Liv Pro Cycling', 'CTW', 'female') ON CONFLICT (id) DO NOTHING;

COMMIT;