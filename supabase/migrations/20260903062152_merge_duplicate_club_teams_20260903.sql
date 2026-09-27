-- Fusión auditada de equipos de club duplicados masculinos y femeninos.
-- Manifiesto: 129 equipos redundantes (90 CLUBM y 39 CLUBW) sobre 102 equipos canónicos.
-- La reparación conserva las variantes nominales como alias, actualiza todas las
-- referencias de catálogo y normaliza los nombres de las filas de startlist afectadas.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.repair_club_team_duplicates_20260903_backup (
  operation text NOT NULL,
  entity text NOT NULL,
  row_key text NOT NULL,
  change_kind text NOT NULL,
  row_data jsonb NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (operation, entity, row_key)
);

COMMENT ON TABLE private.repair_club_team_duplicates_20260903_backup IS
  'Backup recuperable de la fusión auditada de equipos de club duplicados del 2026-09-03.';

ALTER TABLE private.repair_club_team_duplicates_20260903_backup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.repair_club_team_duplicates_20260903_backup
  FROM PUBLIC, anon, authenticated, service_role;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT ON TABLE private.repair_club_team_duplicates_20260903_backup
  TO service_role;

CREATE TEMP TABLE _club_team_merge (
  old_id text PRIMARY KEY,
  old_name text NOT NULL,
  survivor_id text NOT NULL,
  canonical_name text NOT NULL
) ON COMMIT DROP;

INSERT INTO _club_team_merge (old_id, old_name, survivor_id, canonical_name)
VALUES
('team_auto_347385928ae29c0856eab17d7dc5d7f7','Atom 6-Cycleur de Luxe-Auto Stroo','team_1777987180489_2xmold','Atom 6 Bikes - Cycleur de Luxe'),
('team_auto_901045390d308a2361e35c0b01c65779','Atom 6 Bikes-Cycleur de Luxe-Auto Stroo','team_1777987180489_2xmold','Atom 6 Bikes - Cycleur de Luxe'),
('team_auto_de122d004fcc418b0090fa82f4706691','Atom 6 Bikes - Cycleur De Luxe - Auto St','team_1777987180489_2xmold','Atom 6 Bikes - Cycleur de Luxe'),
('team_auto_744863fd8b3c6b0fa72c1e43ec33b023','Atom6 Cycleur de Luxe Autostroo','team_1777987180489_2xmold','Atom 6 Bikes - Cycleur de Luxe'),
('team_auto_f82df2ab6f8963b95cfcbc2b0bfe947e','Carbonbike - Giordana','team_auto_80c6a8672976a1774ed01c3cf9f3fdd0','Carbonbike Giordana Giofré by Gen Z'),
('team_auto_d7cf5303b3cae8628aab1a131ddedd02','Carbonbike Giordana Sofré by Gen Z','team_auto_80c6a8672976a1774ed01c3cf9f3fdd0','Carbonbike Giordana Giofré by Gen Z'),
('team_auto_4728eafe47a30e369d3365c137dbc1c3','Carbonbike Giordana Sofré','team_auto_80c6a8672976a1774ed01c3cf9f3fdd0','Carbonbike Giordana Giofré by Gen Z'),
('team_auto_8394a8393bfc1e169728673a887a82a3','Cyclingteam Belco / Van Eyck','team_auto_981ccbefa11c8bdeedbf3a3be5b09cad','Belco-Van Eyck'),
('team_auto_4f9a4ed42fcdd804257eecfa2a9051d1','Van Eyck/Belco','team_auto_981ccbefa11c8bdeedbf3a3be5b09cad','Belco-Van Eyck'),
('team_auto_d4e045cfd85adb4cb8a2ce10d760dc9e','Bialini Gomola Hygge','team_auto_2325efb2d6847a73439b51739764d8d7','Bialini Team Global Cycling Project'),
('team_auto_8e5b01f0ccb83c565f80b7c2b038e1cf','Bialini Wheellab','team_auto_2325efb2d6847a73439b51739764d8d7','Bialini Team Global Cycling Project'),
('team_auto_c760e43724363d74f4fa474c5233a80c','CeramicSpeed Aros Forsikring Herning','team_auto_abe481e2918c00fcb3c2417fdad8baa5','CeramicSpeed Racing p/b Aros Forsikring'),
('team_auto_f6e6db834f30a283836eeb9c71200ab2','CeramicSpeed Racing','team_auto_abe481e2918c00fcb3c2417fdad8baa5','CeramicSpeed Racing p/b Aros Forsikring'),
('team_auto_87fb4bc76e2c9dee9315c0d014e8ee80','Ciclismo Capital','team_auto_a2238b225d809b6be4f59fddf7b8eb18','Ciclismo Capital - Fundación Gero'),
('team_auto_d350bc44a6bf72cfeb597eb11b61dd83','Ciclismo Capital-Fun Gero','team_auto_a2238b225d809b6be4f59fddf7b8eb18','Ciclismo Capital - Fundación Gero'),
('team_auto_b154353b2733268d811bec4f7525a007','Giant Store Assen Cycling Team NWVG','team_auto_5c42bba2ed9edc78ef8a8c35470f790a','Giant Store Assen CT NWVG'),
('team_auto_abe689999cf9ca453edd590cddf46f17','Giant Store Assen CT NWVG','team_auto_5c42bba2ed9edc78ef8a8c35470f790a','Giant Store Assen CT NWVG'),
('team_auto_1d8032eaababa8e187b6cd87cc2365d2','Devoluy','team_efe7ed159c0142ac','Le Dévoluy - Région Sud'),
('team_auto_6de04ad6d9dcc24c7b5a17c0af228d79','Dévoluy-Région Sud Ladies Cycling Team','team_efe7ed159c0142ac','Le Dévoluy - Région Sud'),
('team_auto_0ea69916ce753e774e19e4c21b60cf75','Frijs ABC ACR','team_auto_29b7ff208e3a54bd89421a4be1823ba8','Team FRIIS'),
('team_auto_5aacdd1a5cb653875ed48fb507eec263','Team Friis ABC ACR','team_auto_29b7ff208e3a54bd89421a4be1823ba8','Team FRIIS'),
('team_auto_a0af253fd6b21aa055d0f802e2a3e3b9','GRC Jan van Arckel','team_auto_15794e78599c1a5c246948aa4b2051ae','Jan van Arckel Women'),
('team_auto_5e82d5ed5c6725e6d9f3be0dd90bfd82','Jan van Arckel Dames','team_auto_15794e78599c1a5c246948aa4b2051ae','Jan van Arckel Women'),
('team_auto_97f6e8e81a41dacb4f2be31e3c6955bc','Jan Van Arkel Dames team','team_auto_15794e78599c1a5c246948aa4b2051ae','Jan van Arckel Women'),
('team_auto_c92bb2e33414717c3fe8f95594e33eab','K.S. Pogoń Mostostal Puławy','team_auto_9ac817d53e431ce243d7ec332d6cb8b2','Mostostal Puławy Cycling Team'),
('team_auto_a448b395957a9fd3de781a70458d9501','Ks Pogoń Mostostal Puławy','team_auto_9ac817d53e431ce243d7ec332d6cb8b2','Mostostal Puławy Cycling Team'),
('team_auto_d3767a28ca19e14e5c754cff1109b8e6','TC Chrobry Głogów','team_auto_c6ccbd9270b981c5be3d3af7903fc0b9','TC Chrobry Głogów / SCOTT'),
('team_auto_79b812d0f3a116eb36bb53015d635833','TC Chrobry Scott Głogów','team_auto_c6ccbd9270b981c5be3d3af7903fc0b9','TC Chrobry Głogów / SCOTT'),
('team_auto_2fa90c43e4732f551aa50f1fa1b931d1','Team Aalborg Sparekassen','team_auto_dce050be5da7eaeb8451e23db66e1253','Team Aalborg - Sparekassen Danmark'),
('team_auto_e9de9f89d63e459b1e895cb2d78d847b','Team Aalborg Sparkassen','team_auto_dce050be5da7eaeb8451e23db66e1253','Team Aalborg - Sparekassen Danmark'),
('team_auto_da358ed7bd013e755dedae34a4d8736b','TKK Pacific Toruń Nestlé','team_auto_46c02ff306174dd18ff6967023d04bc0','TKK Pacific Toruń Nestlé Fitness Cycling Team'),
('team_auto_22981e3c0b4a18154c3dea7a4e17b2d9','TKK Pacific Nestlé Fitness Cycling Team','team_auto_46c02ff306174dd18ff6967023d04bc0','TKK Pacific Toruń Nestlé Fitness Cycling Team'),
('team_auto_c1ab490513f104c28b9346ae6c372f1d','7-Eleven Cliqq Rodbike Philippi','team_1780912000051_7dqjfj','7Eleven Cliqq Roadbike Philippines'),
('team_auto_6253d7f6e3ccbeb6bb1c36cb5f3a45ab','7-Eleven Cliqq Rodbike Philippines','team_1780912000051_7dqjfj','7Eleven Cliqq Roadbike Philippines'),
('team_auto_0aae940dee9ff34badeac23c1f753886','ARBÖ ON Fahrrad','team_auto_70a727bee24700d6fc4c10881ef10d65','ARBÖ MIKO PV ON-Fahrrad'),
('team_auto_e62e0a8c198f27ac19ac681572be5f52','Brussels Big Brackets','team_auto_6dca5eca46eeb078dc584ca80bb3e791','BBB - Brussels Big Brackets Cycling Club'),
('team_auto_dcc77eb75675b1d2e3b0c554a91b7988','Best PC','team_auto_2a56382942b4a5e9a6a28ca82104b847','Best PC Ecuador'),
('team_auto_af6fc3c94f9872ea7d3b5f4325d59304','Biesse - Carrera','team_auto_94885293aaa1f622345924b097b86e28','Biesse Carrera Zambelli'),
('team_auto_d523f3730289f29c1283b3e372e71e8b','Born To Win Women''s Cycling Team','team_auto_7641509c8f2fbdd10544899b0014b834','Born to Win - BTC City Ljubljana'),
('team_auto_8d621b8e429e9c62a75c42f3279d6ee7','CC Lleida','team_auto_5a76ed398a6e697bf33e8f3736c6d0f0','CC Lleida - D.Pedros'),
('team_auto_963921e7646bbd87050aa09f5fa8828c','CCB p/b Levine Law Group','team_auto_10e775067bb5c672ee46293f4256769e','CCB KENETIK p/b Levine Law Group Cycling Team'),
('team_auto_a040ca31bdaf6d6735819a66ab175764','Cycling Crew Szostak','team_auto_c9868c443e215bf99bc9c3b9ce97935b','CCS / Cycling Crew Szostak'),
('team_auto_1f6fde3b15151e84a16ea79ddddbff7a','Feminin Chambery','team_auto_afbc6028c885c1a16f8edff35691534c','Chambéry Cyclisme Compétition Féminin'),
('team_auto_83b22c344f3667a7cb5338c2d0b51ebf','Saint Louisien','team_auto_23b47d09a67f784f4231f88c84b860ed','Club Cycliste Saint-Louisien'),
('team_auto_ca7cb70dd5e210c1070f2b53639dc5b8','Coppi Tbo.Buro','team_auto_e618078d8c199aa3a3a73f4226b58705','Coppi BO.BURO Cycling Team'),
('team_auto_fc42d89236d46db503529e80f87937f3','Cyklotym Havirov Tirana','team_auto_16ced21f2bf2be4c2b655aabf59f63a3','Cyclo Tým Havířov - Tirana'),
('team_auto_47fd73a07bb1bbfe3079410b0ece0313','De Ceuster-Acrog Serso Team Mixte','team_auto_58f29b79e35838fcb9081a4620bb7e67','De Ceuster - Acrog'),
('team_auto_3984811bbc0f0d88360d3fa4e2e495df','Eneicat-Becall','team_1779710837377_3ne3wi','Eneicat-Be Call'),
('team_auto_c95146d30cdfc8fb5adec506f86f3e52','Equipe Stuttgart-Vaihingen','team_auto_9f1103469162ad5184fc59b69a9d5078','EQUIPE Stuttgart-Vaihingen | WRSV'),
('team_auto_ebcf702524a8559645a439e5559b58b8','Esparza Training - Un Isima de Mexico','team_auto_16e2f6be1ffb3b7383a7e60ca9b5cac8','Esparza Training'),
('team_auto_5a84f7b575e1df35441a649a8ad4f5af','Gallina Lucchini Ecotek','team_auto_8480bd310eda054fa88785c4e78c5cd8','Gallina Lucchini Ecotek'),
('team_auto_ed99fd30c6583d7f12d422e550f5cc28','GKS Cartusia Kartuzy','team_auto_10e7ca587961e983a13a828dea5daefb','GKS Cartusia w Kartuzach'),
('team_auto_c01c3a10a57568f418317caec33c6e05','Hemus-1896','team_auto_767d1a86ede65cbc73ca4db5b4cce376','Hemus 1896 Trojan'),
('team_auto_45950baba438ff762bfaf586268c8baf','Holstebro Cycleclub af 1960','team_auto_b1e894e8ba1813f363afd4a0a1f2b14f','Holstebro Cykle Club af 1960'),
('team_auto_30d2a4aa023ed1f0ab3332dc9caf9ff3','Hubo Scott CT','team_auto_61cbf11ad6b32921f4bef90d7276fd9e','Hubo - Scott Cycling Team'),
('team_auto_16a7ed88c4e1e84bf7084aec6281b1c0','Jakroo Handsling','team_auto_6257d11f83f1bc4d70d1bdf48558dd27','Jakroo Handsling Racing'),
('team_auto_e70e4ea81312c8c46372b3a0e77cfc1e','Kasseien Fiets Huis','team_auto_ade7118e7de25e9c09a462754134dbc8','Kasseien Fiets Huis CT'),
('team_auto_53f409f5b6b0bce3eb7a337af68d121b','Kk Tarnovia','team_auto_81914121fde6de2a5ae0ee8dadcac11f','Klub Kolarski Tarnovia'),
('team_auto_581b28436a0d7fafdff921f6f203c840','Kobanya Cycling','team_auto_b062fccebdcb11fa21426caaaeb35354','Kőbánya Cycling Academy'),
('team_auto_a5e2b7389d65320eaf61217c85119cd9','Motala AIF Continental','team_auto_c0e502a26c2de5a3126bb6387ae9ab57','MAIFRACING Motala AIF CK'),
('team_auto_ef087383d1e4fa6e12c086a5e1a0167b','Martigues SC - Payden & Ryrel','team_auto_53d15c81a9a457ea30e173b62c500b05','Martigues SC - Payden & Rygel'),
('team_auto_a501dc0a426c6dba44951e4b4400a111','Mayenne-Monbanarapido','team_auto_1e2587adc449eb177263deff22498dfe','Mayenne-Monbana-Rapido'),
('team_auto_7cbb2928039c2d415462b40a18817a6d','Mugla Büyüksehir Belediy','team_1776778784223_esx00e','Mugla BB'),
('team_auto_2d6c6b6d934c97442ea5648ecc90e690','MUĞLA BÜYÜKŞEHİR BELEDİYESİ SPOR KULÜBÜ','team_1776778784223_esx00e','Mugla BB'),
('team_auto_0013289d733c2ba928f61847820a9451','Pato Bike BMC Team','team_auto_97e04b0ed8866c8f60d520c9283f6ca6','PatoBike - BMC'),
('team_auto_42970443740a8386aeb51d6df35ecd85','Porminho','team_auto_02ae01db0353cac1905b8b651cf95f56','Porminho Team Sub23'),
('team_auto_17d9430e333698f6e0ef9049d5bd6a1e','Prologue','team_auto_f58603542591b89bfa0665fbc8a97fd5','Prologue Racing Team'),
('team_auto_40b87a67aff6d101a24b9ee614af5f65','Reffen Co:Play-Giant Store 2031','team_auto_beb28e3804997e8388967b0c7f57b02b','Reffen Co:Play - Giant Store'),
('team_auto_4f1dc9a6490325b30513a463fe289769','RSV Rheinadler 2015','team_auto_a11164da6ef34cd6427ec08ddf5df21f','RSV Rheinadler 2015 e. V.'),
('team_auto_082d9a7d5362b38e02c166b2c260350e','Santa Maria Feira/Moreira/Bolflex/E.Leclerc','team_auto_b40a58e2c1417a41dfec0ad50147ccf6','Stª. Maria Feira / Moreira / Bolflex / E.Leclerc'),
('team_auto_578183ccb9a595fa233b318d475e000f','Schils - Doltcini','team_auto_09ffd1a35481baa8d7525bda410273ef','Schils - Doltcini Racing Team'),
('team_auto_8818afccf4b55522c10d72908fe21951','Schils - Doltcini Racing Team','team_auto_09ffd1a35481baa8d7525bda410273ef','Schils - Doltcini Racing Team'),
('team_auto_51ce5975881561d811d565b0d3c036e7','SCO Dijon','team_1780912000025_5uuzvx','SCO Dijon Team Matériel-Velo.com'),
('team_auto_84709bcbd7e02ceca0a8799c79062d5a','SCO Dijon-Team Matériel-Vélo','team_1780912000025_5uuzvx','SCO Dijon Team Matériel-Velo.com'),
('team_auto_936f6de98df9585f30f32708b40ae0ec','Sensa Cyclingteam','team_auto_51c06e5f6cf7f7d7aa5ec086e44f44cd','Sensa - Kanjers voor Kanjers Cyclingteam'),
('team_auto_c883ee2420620f15889f69584575b7ff','Spica Solutions','team_auto_99b4e7c905408719250ec75c6d48715d','Spica.team'),
('team_auto_2d9adfded17697e002417dc0dc8962f2','Team Aalborg-Sparekassen Danmark Dame','team_auto_b728b579f18c429a59c5f285b5af1b4e','Team Aalborg - Sparekassen Danmark Women'),
('team_auto_831a98f66eeb59f9e6f749bb4165cdbf','Team Technipes #inEmilia Romagna Caffè Borbone','team_1780912000021_rwxlc7','Team Technipes #inEmiliaRomagna Caffè Borbone'),
('team_auto_3a44411b09b0d30a42e435962da3c38d','Technipes Inemilaromagna Caffè Borbone','team_1780912000021_rwxlc7','Team Technipes #inEmiliaRomagna Caffè Borbone'),
('team_auto_797c11f36368fd73b0f4d8b1c76c52ef','VITN kaffee rösterei parsberg','team_auto_3dba5cc41c74ccc3a0645001ecbb02f0','Team VITN Kaffeerösterei Parsberg'),
('team_auto_26145fd9129f414a458b8bdce53b7f4a','Tecnosylva Rower Bembibre','team_auto_eb15fb5688b81de4334897f576a51d04','Technosylva Rower Bembibre'),
('team_auto_47935ec36a0b4cfb11b040fa8483688c','VC Morteau Mont Benoit','team_auto_f0a23d33b6f6aca0fe4787488d3d581e','VC Morteau-Montbenoit'),
('team_auto_8fa26b7d3d07fc85442a12428f30b85a','Volharding Cycling (we)','team_auto_2e99fdb8cff52516c4144683a9d8034a','Volharding Women'),
('team_auto_0afea00dba30dcf2661d43364fbdcef4','Wielerploeg Groot Amsterdam WPGA','team_auto_6e6c5bba11b831cf144519e748f7310b','Wielerploeg Groot Amsterdam'),
('team_auto_05291b4d1dc45d7e81dbcd5f8ba8b69d','WV Breda Vrouwen','team_auto_2934323aac9bb41b0fd121947b15cad8','WV Breda Women'),
('team_auto_40e1d099694a4d934255472b46d5c57b','WV Schijndel Women U23','team_auto_5f5c9d9af511273e6fff08347020e14d','WV Schijndel Women U23'),
('team_auto_ee8028b9be5c4502f2fd8da60dd652e7','Zappi','team_auto_514e6b7c3725b6bb657874385bac0041','Zappi Racing Team'),
('team_auto_0d032abad3531cfeca71e1cbf55e8111','4WD RENTACAR - FACATATIVA','team_1780912000089_ru3hv9','4WD Rent a Car - Facatativa'),
('team_auto_719960944b95036ab3f32b6dfbaf21d3','EuroCycling Trips - CCN','team_1776792069601_gdgq3j','EuroCyclingTrips - CCN'),
('team_auto_0e9a8fe65fedee4c3691e0df8034bbe0','Campana Imballaggi-Morbiato-Trentino','team_1780912000015_59fxnj','Campana Imballaggi - Morbiato - Trentino'),
('team_auto_872d9d47013987143297d4b837063fc1','Meridian Racing P/B De LA LUZ','team_1780912000041_68hs8m','Meridian Racing p/b De La Luz'),
('team_auto_74fd36eb5bc45b256434deecb64e22fb','Bini Fantini - BePink','team_1777723184117_2a5qpg','Vini Fantini-BePink'),
('team_auto_4188c18830a3d059ce9bc9d4b2ea904d','Anicolor/Cambicarn','team_1779525867219_zsf5fw','Anicolor / Campicarn'),
('team_auto_e48ccb5c0fafbb9c876d8bda85b64078','Elite Foundations Cycling Team','team_1780912000063_hkyuof','Elite Fondations Cycling Team'),
('team_auto_9f88bcb4041f95efae710fa2f6e1c76c','China Anta - Mentech CT','team_1780912000002_bqyn9l','China Anta - Mentech Cycling Team'),
('team_auto_4d99c7d05da3b7f94711ee5293be116b','GI Group Holding - Simoldes','team_1780912000030_afbqrk','GI Group Holding - Simoldes - UDO'),
('team_auto_aacad0387717bfa06f69b299e8e89463','Groupama-FDJ United CONTI','team_1780912000096_rcetxi','Groupama-FDJ United CT'),
('team_auto_6224fbce2a4aa9c67ddd0df924f75c31','VC Villefranche Beaujolais','team_1780912000026_f7k33j','Vélo Club Villefranche Beaujolais'),
('team_auto_3e0ea5bc1ad3ecc9a0da85fb3ac61560','Konya Büyüksehir Beled','team_1776778634909_49sj04','Konya Büyükşehir'),
('team_auto_865c3814faa17d1c511f2d7618d3d733','Spor Toto Cycling Tea','team_1776778751089_plvxbb','Spor Toto'),
('team_auto_641892e208132f5ab5a9cb635d2c144b','Tavfer-Ovos MatinadoS','team_1780912000031_mrfuri','Tavfer-Ovos Matinados-Mortágua'),
('team_auto_f622a44ab72ecf043b162be1cf7986b9','Voster ATS Team','team_1780912000072_rgw2x1','Voster'),
('team_auto_77c5ae84acaa81bc817de00b3bdfdd5b','Parkhotel Valkenburg','team_1777987414743_fxcezb','Azerion / Villa Valkenburg'),
('team_auto_8ced202222b2e919f8a7b9f8e1ab8b7d','LAA Credibom / La AlumíNIOS','team_ct_credibom','Credibom / La Alumínios / Marcos Car'),
('team_auto_421d65288d740e98d7a7baf924864d07','VC Rouen 76','team_1780912000027_l2s7ey','Veloce Club Rouen 76'),
('team_auto_63b41f8ef630e6af5f9f419d0658d0d5','Dukla Praha','team_1779568751561_pl1lo6','Dukla'),
('team_auto_19584356bc483d8f03d1a1e0fdd4df0d','P.A.S. Ioanninnon - P&I','team_1780912000083_1lxnsv','P.A.S. Ioanninon - P&I'),
('team_auto_2177a9d5ca07aa899261828d4d734490','Alpecin-Deceuninck','team_1776703130449_us300h','Alpecin-Premier Tech'),
('team_auto_184d85a61df6414ddfba138b14456fe9','Sparkle Oita','team_1780912000034_lkkswh','Sparkle Oita Racing Team'),
('team_auto_bfdbe99a0c6de0bbca40fa06fa1ff563','Mouloudia Club Alger','team_1780912000081_bd2sca','Mouloudia Club d''Alger'),
('team_auto_8f0f859ef0e52cb1ca923f29809e25e7','KDM - Pack Cycling Team VZW','team_1777713596323_yq8lej','KDM-Pack'),
('team_auto_6e4bf09d582168977d2748db62240cea','Bclose Balenzo CT','team_auto_1259ee59664f5f54998638a56bbebb10','B-Close - Bal-Enzo'),
('team_auto_cb419f4c8515e60b9cf3b693bbe59961','Metalac','team_auto_594cec5fbd9f7a52b2d9ec3131a481de','CCN Metalac'),
('team_auto_273e712714473c58e6b61bdc3e7d0c43','Coppi-Boburo Cyclingteam','team_auto_e618078d8c199aa3a3a73f4226b58705','Coppi BO.BURO Cycling Team'),
('team_auto_e4be2b3e859134ceb34f16b3fb94e604','Goodshop Team','team_auto_b01412745b055051e6dbd11bbb2fdfe8','GoodShop Team Yoyogurt'),
('team_auto_bd05f8d100bd7870da6e81da9a46847d','GoodShopTeam','team_auto_b01412745b055051e6dbd11bbb2fdfe8','GoodShop Team Yoyogurt'),
('team_auto_a1bd180e45e3393f110bd11ff7ae9c24','GRC Jan van Arckel Vrouwen','team_auto_15794e78599c1a5c246948aa4b2051ae','Jan van Arckel Women'),
('team_auto_3a5ff78843bfef71fe3b1b04067dc979','Latin All Star Racing','team_auto_3e7c540df2748bd64b4e342d749bf054','Latin All Star Racing'),
('team_auto_48bd8506d20d1e05f9fd284da6cde870','Les Rouleurs Polo Velo','team_auto_261d44b55184e9dfa1ac57234e219b86','Les Rouleurs de Gatineau'),
('team_auto_82928d16f6139730a61b2154507c3dca','Team Lockimmo.com','team_auto_d887ebaa2d4290ef6825a69a0b5c57cb','Team LOCKimmo.com - CC Nogent-sur-Oise'),
('team_auto_d3987ae310dc1da94673a3eeb4ae47a8','Minimax WB Ladies','team_auto_f7b0e7c58e63fc5be55e7e22ee2560b0','Minimax WB Cycling Team'),
('team_auto_bb2397c84e03f5cc94369a3a75f8e973','OW Discovery','team_auto_488d5f7df71842e1591bf0fa17763417','OW Discovery KH Club'),
('team_auto_581bac2cc0f2ce9716fa6db705cce32f','PZ Giessen','team_auto_6500c974dc9f0f2cee1efbeeec39d871','PZ Gießen Racing Team'),
('team_auto_36f2d256ebbc0b6a97c57d1e328b98ff','Vasil Levski','team_auto_c95467dddeee11e017652c5863bb4909','PSKK Vassil-Levski'),
('team_auto_d850ff6080a823f4c897103c9cf60120','Siena Garden Racing BL','team_auto_c102ca320e850d48632e5c940d92735e','Siena Garden Racing Team'),
('team_auto_96019705e422a29bec96ba6b13904173','Telco M On Clima','team_auto_a3a51af231afbea10867c01f285953f2','Telco - On Clima - Osés'),
('team_auto_40d3152f390157dd72a4e5f971f4dce4','U.C. Monaco','team_auto_c17788455bdc2d3a59417c07e4169d70','Union Cycliste Monaco'),
('team_auto_ab969528c8a0f1f05afdd928154f352b','VC Unité Schwenheim','team_auto_77ad070194195a395fba1d8fa7120242','Vélo Club Unité Schwenheim TPM'),
('team_auto_e2f8322c6d800776bd13b0da19d5da52','UWTC de Volharding','team_auto_2e99fdb8cff52516c4144683a9d8034a','Volharding Women');

CREATE TEMP TABLE _club_team_canonical ON COMMIT DROP AS
SELECT survivor_id, min(canonical_name) AS canonical_name
FROM _club_team_merge
GROUP BY survivor_id;

ALTER TABLE _club_team_canonical
  ADD PRIMARY KEY (survivor_id);

CREATE TEMP TABLE _club_team_affected ON COMMIT DROP AS
SELECT old_id AS team_id, survivor_id, canonical_name, true AS is_redundant
FROM _club_team_merge
UNION ALL
SELECT survivor_id, survivor_id, canonical_name, false
FROM _club_team_canonical;

ALTER TABLE _club_team_affected
  ADD PRIMARY KEY (team_id);

DO $preflight$
DECLARE
  v_count integer;
BEGIN
  IF (SELECT count(*) FROM _club_team_merge) <> 129 THEN
    RAISE EXCEPTION 'El manifiesto no contiene los 129 equipos redundantes previstos';
  END IF;

  IF (SELECT count(*) FROM _club_team_canonical) <> 102 THEN
    RAISE EXCEPTION 'El manifiesto no contiene los 102 equipos canónicos previstos';
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_merge m
    JOIN public.teams t
      ON t.id = m.old_id
     AND t.name = m.old_name
     AND t.category IN ('CLUBM', 'CLUBW')
     AND t."specialEdition" = false
  ) <> 129 THEN
    RAISE EXCEPTION 'El preflight no encuentra las 129 fichas de club redundantes con su nombre auditado';
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_canonical c
    JOIN public.teams t
      ON t.id = c.survivor_id
     AND t."specialEdition" = false
  ) <> 102 THEN
    RAISE EXCEPTION 'El preflight no encuentra los 102 equipos canónicos previstos';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _club_team_merge m
    JOIN public.teams old_team ON old_team.id = m.old_id
    JOIN public.teams survivor ON survivor.id = m.survivor_id
    WHERE old_team.gender IS DISTINCT FROM survivor.gender
  ) THEN
    RAISE EXCEPTION 'El manifiesto contiene una fusión con género incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _club_team_merge m
    JOIN _club_team_canonical c ON c.survivor_id = m.old_id
  ) THEN
    RAISE EXCEPTION 'Un equipo redundante figura también como canónico';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.startlist_teams st
    JOIN _club_team_affected a ON a.team_id = st."teamId"
    GROUP BY st."raceId", a.survivor_id
    HAVING count(*) > 1 AND bool_or(a.is_redundant)
  ) THEN
    RAISE EXCEPTION 'Dos equipos del mismo grupo de fusión aparecen simultáneamente en una carrera';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_teams st
  JOIN _club_team_merge m ON m.old_id = st."teamId";
  IF v_count <> 206 THEN
    RAISE EXCEPTION 'El preflight encuentra % referencias startlist redundantes; se esperaban 206', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.startlist_teams st
  JOIN _club_team_affected a ON a.team_id = st."teamId";
  IF v_count <> 906 THEN
    RAISE EXCEPTION 'El preflight encuentra % filas startlist afectadas; se esperaban 906', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_link_decisions d
  JOIN _club_team_merge m ON m.old_id = d."teamId";
  IF v_count <> 212 THEN
    RAISE EXCEPTION 'El preflight encuentra % decisiones redundantes; se esperaban 212', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.race_uci_results r
  JOIN _club_team_merge m ON m.old_id = r."teamId";
  IF v_count <> 45 THEN
    RAISE EXCEPTION 'El preflight encuentra % resultados redundantes; se esperaban 45', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.uci_team_rankings r
  JOIN _club_team_merge m ON m.old_id = r."teamId";
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'El preflight encuentra % rankings redundantes; se esperaban 4', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_name_aliases a
  JOIN _club_team_merge m ON m.old_id = a."teamId";
  IF v_count <> 129 THEN
    RAISE EXCEPTION 'El preflight encuentra % alias redundantes; se esperaban 129', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_seasons s
  JOIN _club_team_merge m ON m.old_id = s."teamId";
  IF v_count <> 129 THEN
    RAISE EXCEPTION 'El preflight encuentra % temporadas redundantes; se esperaban 129', v_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rider_team_affiliations a
    JOIN _club_team_merge m ON m.old_id = a."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.riders_men r
    JOIN _club_team_merge m ON m.old_id = r."currentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.riders_women r
    JOIN _club_team_merge m ON m.old_id = r."currentTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.rider_transfers r
    JOIN _club_team_merge m
      ON m.old_id = r."fromTeamId" OR m.old_id = r."toTeamId"
  ) OR EXISTS (
    SELECT 1 FROM public.teams child
    JOIN _club_team_merge m ON m.old_id = child."parentTeamId"
  ) THEN
    RAISE EXCEPTION 'El preflight detecta referencias no previstas en afiliaciones, corredores, traspasos o equipos hijos';
  END IF;
END
$preflight$;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'manifest',
  m.old_id,
  'mapping',
  to_jsonb(m)
FROM _club_team_merge m
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'teams',
  t.id,
  CASE WHEN a.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(t)
FROM public.teams t
JOIN _club_team_affected a ON a.team_id = t.id
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'team_seasons',
  s.id,
  CASE WHEN a.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(s)
FROM public.team_seasons s
JOIN _club_team_affected a ON a.team_id = s."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'team_name_aliases',
  a.id,
  CASE WHEN af.is_redundant THEN 'delete' ELSE 'update' END,
  to_jsonb(a)
FROM public.team_name_aliases a
JOIN _club_team_affected af ON af.team_id = a."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'startlist_teams',
  st.id,
  'update',
  to_jsonb(st)
FROM public.startlist_teams st
JOIN _club_team_affected a ON a.team_id = st."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'team_link_decisions',
  d.id,
  'update',
  to_jsonb(d)
FROM public.team_link_decisions d
JOIN _club_team_affected a ON a.team_id = d."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'race_uci_results',
  r.id::text,
  'update',
  to_jsonb(r)
FROM public.race_uci_results r
JOIN _club_team_merge m ON m.old_id = r."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'uci_team_rankings',
  r.gender || '|' || r.rank::text,
  'update',
  to_jsonb(r)
FROM public.uci_team_rankings r
JOIN _club_team_merge m ON m.old_id = r."teamId"
ON CONFLICT (operation, entity, row_key) DO NOTHING;

CREATE TEMP TABLE _club_team_alias_source ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    a.survivor_id,
    t.name AS alias,
    2026::smallint AS year,
    'club_team_merge_20260903'::text AS source,
    NULL::text AS source_url,
    false AS verified
  FROM _club_team_affected a
  JOIN public.teams t ON t.id = a.team_id

  UNION ALL

  SELECT
    a.survivor_id,
    line.alias,
    2026::smallint,
    'club_team_merge_20260903',
    NULL::text,
    false
  FROM _club_team_affected a
  JOIN public.teams t ON t.id = a.team_id
  CROSS JOIN LATERAL unnest(string_to_array(COALESCE(t."nameAliases", ''), E'\n')) AS line(alias)
  WHERE btrim(line.alias) <> ''

  UNION ALL

  SELECT
    af.survivor_id,
    a.alias,
    a.year,
    a.source,
    a."sourceUrl",
    a.verified
  FROM _club_team_affected af
  JOIN public.team_name_aliases a ON a."teamId" = af.team_id

  UNION ALL

  SELECT
    c.survivor_id,
    c.canonical_name,
    2026::smallint,
    'club_team_merge_20260903',
    NULL::text,
    true
  FROM _club_team_canonical c
),
ranked AS (
  SELECT
    survivor_id,
    btrim(alias) AS alias,
    public.fold_team_name(alias) AS folded_name,
    year,
    source,
    source_url,
    verified,
    row_number() OVER (
      PARTITION BY survivor_id, public.fold_team_name(alias), year
      ORDER BY verified DESC, (source_url IS NOT NULL) DESC, length(alias) DESC, alias
    ) AS priority
  FROM candidates
  WHERE btrim(alias) <> ''
    AND public.fold_team_name(alias) IS NOT NULL
)
SELECT survivor_id, alias, folded_name, year, source, source_url, verified
FROM ranked
WHERE priority = 1;

INSERT INTO public.team_name_aliases (
  id, "teamId", alias, "foldedName", year, source, "sourceUrl", verified
)
SELECT
  'tna_merge_' || md5(
    s.survivor_id || '|' || s.year::text || '|' || s.folded_name
  ),
  s.survivor_id,
  s.alias,
  s.folded_name,
  s.year,
  s.source,
  s.source_url,
  s.verified
FROM _club_team_alias_source s
ON CONFLICT ("teamId", "foldedName", year) DO UPDATE SET
  alias = CASE
    WHEN public.team_name_aliases.verified AND NOT EXCLUDED.verified
      THEN public.team_name_aliases.alias
    ELSE EXCLUDED.alias
  END,
  source = CASE
    WHEN public.team_name_aliases.verified AND NOT EXCLUDED.verified
      THEN public.team_name_aliases.source
    ELSE EXCLUDED.source
  END,
  "sourceUrl" = CASE
    WHEN public.team_name_aliases.verified AND NOT EXCLUDED.verified
      THEN public.team_name_aliases."sourceUrl"
    ELSE COALESCE(EXCLUDED."sourceUrl", public.team_name_aliases."sourceUrl")
  END,
  verified = public.team_name_aliases.verified OR EXCLUDED.verified,
  "updatedAt" = now();

INSERT INTO private.repair_club_team_duplicates_20260903_backup
  (operation, entity, row_key, change_kind, row_data)
SELECT
  'merge-club-team-duplicates-20260903',
  'team_name_aliases_after',
  a.id,
  CASE
    WHEN before_alias.row_key IS NULL THEN 'created'
    ELSE 'updated'
  END,
  to_jsonb(a)
FROM public.team_name_aliases a
JOIN _club_team_canonical c ON c.survivor_id = a."teamId"
LEFT JOIN private.repair_club_team_duplicates_20260903_backup before_alias
  ON before_alias.operation = 'merge-club-team-duplicates-20260903'
 AND before_alias.entity = 'team_name_aliases'
 AND before_alias.row_key = a.id
ON CONFLICT (operation, entity, row_key) DO NOTHING;

WITH aliases_by_team AS (
  SELECT
    s.survivor_id,
    string_agg(s.alias, E'\n' ORDER BY lower(s.alias), s.alias)
      FILTER (WHERE s.alias IS DISTINCT FROM c.canonical_name) AS name_aliases
  FROM _club_team_alias_source s
  JOIN _club_team_canonical c ON c.survivor_id = s.survivor_id
  GROUP BY s.survivor_id
)
UPDATE public.teams t
SET
  name = c.canonical_name,
  "nameAliases" = NULLIF(a.name_aliases, ''),
  "updatedAt" = now()
FROM _club_team_canonical c
JOIN aliases_by_team a ON a.survivor_id = c.survivor_id
WHERE t.id = c.survivor_id;

-- Evita que una normalización administrativa reescriba el método y la acción
-- histórica de las decisiones automáticas. El guard de integridad referencial
-- permanece activo durante toda la actualización.
ALTER TABLE public.startlist_teams
  DISABLE TRIGGER auto_link_startlist_team_trg;

UPDATE public.startlist_teams st
SET
  "teamId" = a.survivor_id,
  "teamName" = a.canonical_name
FROM _club_team_affected a
WHERE st."teamId" = a.team_id
  AND (
    st."teamId" IS DISTINCT FROM a.survivor_id
    OR st."teamName" IS DISTINCT FROM a.canonical_name
  );

ALTER TABLE public.startlist_teams
  ENABLE TRIGGER auto_link_startlist_team_trg;

UPDATE public.team_link_decisions d
SET
  "teamId" = m.survivor_id,
  "updatedAt" = now()
FROM _club_team_merge m
WHERE d."teamId" = m.old_id;

UPDATE public.race_uci_results r
SET "teamId" = m.survivor_id
FROM _club_team_merge m
WHERE r."teamId" = m.old_id;

UPDATE public.uci_team_rankings r
SET
  "teamId" = m.survivor_id,
  "displayName" = m.canonical_name,
  "teamCategory" = survivor.category
FROM _club_team_merge m
JOIN public.teams survivor ON survivor.id = m.survivor_id
WHERE r."teamId" = m.old_id;

DELETE FROM public.teams t
USING _club_team_merge m
WHERE t.id = m.old_id;

DO $verify$
DECLARE
  v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.teams t
    JOIN _club_team_merge m ON m.old_id = t.id
  ) THEN
    RAISE EXCEPTION 'Persisten equipos redundantes después de la fusión';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.startlist_teams st
    JOIN _club_team_merge m ON m.old_id = st."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.team_link_decisions d
    JOIN _club_team_merge m ON m.old_id = d."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.race_uci_results r
    JOIN _club_team_merge m ON m.old_id = r."teamId"
  ) OR EXISTS (
    SELECT 1 FROM public.uci_team_rankings r
    JOIN _club_team_merge m ON m.old_id = r."teamId"
  ) THEN
    RAISE EXCEPTION 'Persisten referencias hacia equipos redundantes';
  END IF;

  SELECT count(*) INTO v_count
  FROM private.repair_club_team_duplicates_20260903_backup b
  JOIN public.startlist_teams st ON st.id = b.row_key
  JOIN _club_team_affected a ON a.team_id = b.row_data ->> 'teamId'
  WHERE b.operation = 'merge-club-team-duplicates-20260903'
    AND b.entity = 'startlist_teams'
    AND st."teamId" = a.survivor_id
    AND st."teamName" = a.canonical_name;
  IF v_count <> 906 THEN
    RAISE EXCEPTION 'Solo % de las 906 filas startlist quedaron normalizadas', v_count;
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_canonical c
    JOIN public.teams t
      ON t.id = c.survivor_id
     AND t.name = c.canonical_name
  ) <> 102 THEN
    RAISE EXCEPTION 'No quedaron normalizados los 102 nombres canónicos';
  END IF;

  IF (
    SELECT count(*)
    FROM _club_team_canonical c
    JOIN public.team_seasons s
      ON s."teamId" = c.survivor_id
     AND s.year = 2026
     AND s.name = c.canonical_name
  ) <> 102 THEN
    RAISE EXCEPTION 'No quedaron normalizadas las 102 temporadas canónicas de 2026';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _club_team_merge m
    JOIN public.teams t ON t.id = m.survivor_id
    WHERE NOT (public.fold_team_name(m.old_name) = ANY(t."foldedNames"))
  ) THEN
    RAISE EXCEPTION 'Algún nombre redundante no quedó preservado en foldedNames';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _club_team_alias_source s
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.team_name_aliases a
      WHERE a."teamId" = s.survivor_id
        AND a.year = s.year
        AND a."foldedName" = s.folded_name
    )
  ) THEN
    RAISE EXCEPTION 'Algún alias auditado no quedó asignado a su equipo canónico';
  END IF;

  IF (
    SELECT count(*)
    FROM private.repair_club_team_duplicates_20260903_backup
    WHERE operation = 'merge-club-team-duplicates-20260903'
      AND entity = 'manifest'
  ) <> 129 THEN
    RAISE EXCEPTION 'El backup no contiene las 129 filas del manifiesto';
  END IF;

  IF (
    SELECT count(*)
    FROM private.repair_club_team_duplicates_20260903_backup
    WHERE operation = 'merge-club-team-duplicates-20260903'
      AND entity = 'teams'
  ) <> 231 THEN
    RAISE EXCEPTION 'El backup no contiene las 231 fichas de equipo afectadas';
  END IF;
END
$verify$;

COMMIT;
