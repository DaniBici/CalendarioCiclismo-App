// ─────────────────────────────────────────────────────────────────
//  COLORES DE EQUIPO DEL DISEÑO (Figma «calendarioCiclismo»)
//  Fondo, texto y franjas de las losetas de Fichajes › Equipos y del
//  banner de la ficha de equipo, tomados de los marcos TeamsWT, TeamsPT,
//  TeamsWWT y TeamsPRW (temporada 2027). Clave: teamId de team_seasons.
//  Un equipo sin entrada usa la pareja editorial del panel
//  (headerBg/headerText) y sus franjas de maillot.
// ─────────────────────────────────────────────────────────────────

export const FIGMA_TEAM_COLORS = {
  // WT
  'team_1776703130449_us300h': { bg: '#0154e5', text: '#f5f8fd', stripes: ['#0154e5', '#2596be', '#b63f29'] }, // Alpecin-Premier Tech
  'team_1776703182999_kk2zsf': { bg: '#172750', text: '#f5f8fd', stripes: ['#172750', '#4bb2b1', '#db2126'] }, // Bahrain Victorious
  'team_1776703256882_74u3ve': { bg: '#040f50', text: '#f5f8fd', stripes: ['#040f50', '#db2126', '#80d5ac'] }, // Decathlon CMA CGM Team
  'team_1776703309015_k4ixyq': { bg: '#e6379a', text: '#f5f8fd', stripes: ['#e6379a', '#ffffff', '#ee8fc7'] }, // EF Education - EasyPost
  'team_1776703473947_q1b5i9': { bg: '#1170ce', text: '#f5f8fd', stripes: ['#1170ce', '#ffffff', '#e90d1b'] }, // Groupama-FDJ United
  'team_1776702799483_dan5zs': { bg: '#003162', text: '#f5f8fd', stripes: ['#003162', '#fff200', '#e10600'] }, // Lidl-Trek
  'team_1776703552614_pyqigh': { bg: '#ad1510', text: '#f5f8fd', stripes: ['#ad1510', '#ffffff', '#490303'] }, // Lotto Intermarché
  'team_1776702163218_ebmy3d': { bg: '#2159db', text: '#f5f8fd', stripes: ['#2159db', '#fafafb', '#e5e910'] }, // Movistar Team
  'team_1777379215624_qymkfj': { bg: '#9fb7b2', text: '#f5f8fd', stripes: ['#9fb7b2', '#ebf0f0', '#f39159'] }, // Netcompany INEOS
  'team_1776703625379_kbsull': { bg: '#86b5c9', text: '#f5f8fd', stripes: ['#86b5c9', '#ff00ff', '#f4873e'] }, // NSN Cycling Team
  'team_1776703052816_uexbsk': { bg: '#507ad4', text: '#f5f8fd', stripes: ['#507ad4', '#e3e5f1', '#e22f42'] }, // Red Bull - BORA - hansgrohe
  'team_1776703755811_lbaphb': { bg: '#152645', text: '#f5f8fd', stripes: ['#152645', '#ffffff', '#09ff00'] }, // Soudal Safety Jogger
  'team_1776703840961_zz7puu': { bg: '#5a239b', text: '#f5f8fd', stripes: ['#5a239b', '#ffffff', '#38e600'] }, // Team Jayco AlUla
  'team_1776703895660_c8mgkk': { bg: '#323a68', text: '#f5f8fd', stripes: ['#323a68', '#ffffff', '#fd782e'] }, // Team Picnic PostNL
  'team_1776702578134_2wdzno': { bg: '#f1d623', text: '#10233f', stripes: ['#f1d623', '#1d1b31', '#ff363c'] }, // Team Visma | Lease a Bike
  'team_1776702951716_ezxsdy': { bg: '#ffffff', text: '#10233f', stripes: ['#ffffff', '#ff0000', '#000000'] }, // UAE Team Emirates XRG
  'team_1776703993260_yubupk': { bg: '#e32c31', text: '#f5f8fd', stripes: ['#e32c31', '#ffd568', '#e32c31'] }, // Uno-X Mobility
  'team_1776704087509_e6azyq': { bg: '#3abee4', text: '#f5f8fd', stripes: ['#3abee4', '#e3e843', '#ffffff'] }, // XDS Astana Team
  // PT
  'team_1776705387471_62ymrg': { bg: '#4d9fbd', text: '#f5f8fd', stripes: ['#4d9fbd', '#ffffff', '#4d9fbd'] }, // Bardiani CSF 7 Saber
  'team_1776714380056_7kzbtn': { bg: '#5b3d79', text: '#f5f8fd', stripes: ['#5b3d79', '#ffffff', '#e42676'] }, // Burgos-Burpellet-BH
  'team_1776704786623_drt3pq': { bg: '#235637', text: '#f5f8fd', stripes: ['#235637', '#ffffff', '#48bc59'] }, // Caja Rural-Seguros RGA
  'team_1776704301126_0xf7vk': { bg: '#873238', text: '#f5f8fd', stripes: ['#873238', '#e0c225', '#a9001a'] }, // Cofidis
  'team_1776714490672_r88dfo': { bg: '#f16c2d', text: '#f5f8fd', stripes: ['#f16c2d', '#ffffff', '#9d1d2d'] }, // Euskaltel-Euskadi
  'team_1776705480088_lg1a43': { bg: '#151a38', text: '#f5f8fd', stripes: ['#151a38', '#5bbbc4', '#ec1c24'] }, // MBH Bank Proteam
  'team_1776750124382_p457m5': { bg: '#5c111e', text: '#f5f8fd', stripes: ['#5c111e', '#a7884b', '#5c111e'] }, // Modern Adventure Factor Cycling
  'team_1776704474025_wuq3wr': { bg: '#272a4a', text: '#f5f8fd', stripes: ['#272a4a', '#ffffff', '#c79443'] }, // Pinarello-Q36.5 Pro Cycling Team
  'team_1776705681103_iohs0z': { bg: '#184876', text: '#f5f8fd', stripes: ['#184876', '#ffff20', '#fd711a'] }, // Solution Tech Nippo Rali
  'team_1776714541189_3v5tpl': { bg: '#0b233f', text: '#f5f8fd', stripes: ['#0b233f', '#3e9c35', '#ffffff'] }, // Team Novo Nordisk
  'team_1776705783470_ii0i0m': { bg: '#ff0c29', text: '#f5f8fd', stripes: ['#ff0c29', '#ffffff', '#006733'] }, // Team Hayf Sports VisitMalta
  'team_1776705081939_olxbwj': { bg: '#ffffff', text: '#10233f', stripes: ['#ffffff', '#1a8ce2', '#fe8a22'] }, // TotalEnergies
  'team_1776704584941_aeypqm': { bg: '#0c0b10', text: '#f5f8fd', stripes: ['#0c0b10', '#d61f2b', '#0c0b10'] }, // Tudor Pro Cycling Team
  'team_1776705190489_lx26od': { bg: '#2dbae5', text: '#f5f8fd', stripes: ['#2dbae5', '#ee008c', '#242e9f'] }, // Unibet Rose Rockets
  // WWT
  'team_1776714655588_6ae9cr': { bg: '#152645', text: '#f5f8fd', stripes: ['#152645', '#ffffff', '#09ff00'] }, // AG Insurance - Soudal Team
  'team_1780079086533_019dq3': { bg: '#3b43a0', text: '#f5f8fd', stripes: ['#3b43a0', '#fa4043', '#91d6eb'] }, // Canyon//SRAM Scalable Capital
  'team_1776714955304_ng13hf': { bg: '#e6379a', text: '#f5f8fd', stripes: ['#e6379a', '#ffffff', '#ee8fc7'] }, // EF Education
  'team_1776715017170_w96ftz': { bg: '#19181f', text: '#f5f8fd', stripes: ['#19181f', '#017df4', '#fb0206'] }, // FDJ United - SUEZ
  'team_1776715068053_p0pqch': { bg: '#f85616', text: '#f5f8fd', stripes: ['#f85616', '#ffffff', '#292331'] }, // Fenix-Premier Tech
  'team_1776715116251_asy20x': { bg: '#080029', text: '#f5f8fd', stripes: ['#080029', '#f15f22', '#430754'] }, // Human Powered Health
  'team_female_lidl_trek': { bg: '#003162', text: '#f5f8fd', stripes: ['#003162', '#fff200', '#e10600'] }, // Lidl - Trek
  'team_1776715134951_nufhxh': { bg: '#5a239b', text: '#f5f8fd', stripes: ['#5a239b', '#ffffff', '#38e600'] }, // Liv-AlUla-Jayco
  'team_female_movistar': { bg: '#2159db', text: '#f5f8fd', stripes: ['#2159db', '#fafafb', '#e5e910'] }, // Movistar Team
  'team_female_picnic_postnl': { bg: '#323a68', text: '#f5f8fd', stripes: ['#323a68', '#ffffff', '#fd782e'] }, // Team Picnic PostNL
  'team_1776715284567_76xqkf': { bg: '#060f1e', text: '#f5f8fd', stripes: ['#060f1e', '#e4d057', '#5f94b6'] }, // Team SD Worx - Protime
  'team_female_visma': { bg: '#f1d623', text: '#10233f', stripes: ['#f1d623', '#1d1b31', '#ff363c'] }, // Team Visma | Lease a Bike
  'team_uae_l_imad_2026': { bg: '#ffffff', text: '#10233f', stripes: ['#ffffff', '#501b6d', '#000000'] }, // UAE Team L'IMAD
  'team_female_unox': { bg: '#e32c31', text: '#f5f8fd', stripes: ['#e32c31', '#ffd568', '#e32c31'] }, // Uno-X Mobility
  // PRW
  'team_52caa8d69d274529': { bg: '#873238', text: '#f5f8fd', stripes: ['#873238', '#e0c225', '#a9001a'] }, // Cofidis Women Team
  '69279497-940e-4168-ae38-ef59ec547950': { bg: '#040f50', text: '#f5f8fd', stripes: ['#040f50', '#db2126', '#80d5ac'] }, // Decathlon CMA CGM
  'team_1776715516916_9d8gwc': { bg: '#d6b2d0', text: '#10233f', stripes: ['#d6b2d0', '#622444', '#f3426a'] }, // Laboral Kutxa - Fundación Euskadi
  'team_47f82f2c644743bd': { bg: '#ad1510', text: '#f5f8fd', stripes: ['#ad1510', '#ffffff', '#490303'] }, // Lotto Intermarche Ladies
  'team_1776715615381_8kbwig': { bg: '#2e59ba', text: '#f5f8fd', stripes: ['#2e59ba', '#ffffff', '#e73664'] }, // Ma Petite Entreprise
  'team_1776715672148_9njdjy': { bg: '#242633', text: '#f5f8fd', stripes: ['#242633', '#d83633', '#ffffff'] }, // Mayenne Monbana My Pie
  'team_female_st_michel_auber93': { bg: '#fe6903', text: '#f5f8fd', stripes: ['#fe6903', '#059651', '#ffffff'] }, // St Michel - Preference Home - Auber93
  'team_1776715791581_5z1fd7': { bg: '#004fa8', text: '#f5f8fd', stripes: ['#004fa8', '#ffffff', '#000000'] }, // VolkerWessels Cycling Team
};
