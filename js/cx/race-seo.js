// Nombres fijos, en paridad con PAIS_ES del generador, sin depender de ICU.
const CX_SEO_COUNTRIES = {
  AD:'Andorra',AE:'Emiratos Árabes Unidos',AF:'Afganistán',AL:'Albania',
  AM:'Armenia',AO:'Angola',AR:'Argentina',AT:'Austria',AU:'Australia',
  AZ:'Azerbaiyán',BA:'Bosnia y Herzegovina',BE:'Bélgica',BF:'Burkina Faso',
  BG:'Bulgaria',BH:'Baréin',BJ:'Benín',BM:'Bermudas',BO:'Bolivia',
  BR:'Brasil',BY:'Bielorrusia',CA:'Canadá',CD:'República Democrática del Congo',
  CH:'Suiza',CL:'Chile',CN:'China',CO:'Colombia',CR:'Costa Rica',
  CU:'Cuba',CY:'Chipre',CZ:'Chequia',DE:'Alemania',DK:'Dinamarca',
  DZ:'Argelia',EC:'Ecuador',EE:'Estonia',ER:'Eritrea',ES:'España',
  'ES-CT':'Cataluña','ES-GA':'Galicia','ES-PV':'País Vasco',
  'ES-AN':'Andalucía','ES-AR':'Aragón','ES-AS':'Asturias','ES-CB':'Cantabria',
  'ES-CE':'Ceuta','ES-CL':'Castilla y León','ES-CM':'Castilla-La Mancha',
  'ES-CN':'Canarias','ES-EX':'Extremadura','ES-IB':'Islas Baleares',
  'ES-MC':'Murcia','ES-MD':'Madrid','ES-ML':'Melilla','ES-NC':'Navarra',
  'ES-RI':'La Rioja','ES-VC':'Comunidad Valenciana',
  ET:'Etiopía',FI:'Finlandia',FR:'Francia',GB:'Reino Unido',GE:'Georgia',
  GR:'Grecia',GT:'Guatemala',GU:'Guam',HK:'Hong Kong',HN:'Honduras',
  HR:'Croacia',HU:'Hungría',ID:'Indonesia',IE:'Irlanda',IL:'Israel',
  IN:'India',IR:'Irán',IS:'Islandia',IT:'Italia',JP:'Japón',
  KE:'Kenia',KG:'Kirguistán',KR:'Corea del Sur',KZ:'Kazajistán',LA:'Laos',
  LT:'Lituania',LU:'Luxemburgo',LV:'Letonia',MA:'Marruecos',MC:'Mónaco',
  MN:'Mongolia',MT:'Malta',MU:'Mauricio',MX:'México',MY:'Malasia',
  NL:'Países Bajos',NO:'Noruega',NZ:'Nueva Zelanda',PA:'Panamá',
  PH:'Filipinas',PL:'Polonia',PT:'Portugal',PY:'Paraguay',RO:'Rumanía',
  RS:'Serbia',RU:'Rusia',RW:'Ruanda',SA:'Arabia Saudí',SE:'Suecia',
  SI:'Eslovenia',SK:'Eslovaquia',SV:'El Salvador',TH:'Tailandia',
  TR:'Turquía',TW:'Taiwán',TZ:'Tanzania',UA:'Ucrania',UG:'Uganda',
  US:'Estados Unidos',UY:'Uruguay',UZ:'Uzbekistán',VE:'Venezuela',
  VN:'Vietnam',XK:'Kosovo',ZA:'Sudáfrica',
};

// Espejo de COUNTRY_EN del generador.
const CX_SEO_COUNTRIES_EN = {
  AD:'Andorra',AE:'United Arab Emirates',AF:'Afghanistan',AL:'Albania',
  AM:'Armenia',AO:'Angola',AR:'Argentina',AT:'Austria',AU:'Australia',
  AZ:'Azerbaijan',BA:'Bosnia and Herzegovina',BE:'Belgium',
  BF:'Burkina Faso',BG:'Bulgaria',BH:'Bahrain',BJ:'Benin',BM:'Bermuda',
  BO:'Bolivia',BR:'Brazil',BY:'Belarus',CA:'Canada',CD:'DR Congo',
  CH:'Switzerland',CL:'Chile',CN:'China',CO:'Colombia',CR:'Costa Rica',
  CU:'Cuba',CY:'Cyprus',CZ:'Czechia',DE:'Germany',DK:'Denmark',
  DZ:'Algeria',EC:'Ecuador',EE:'Estonia',ER:'Eritrea',ES:'Spain',
  ET:'Ethiopia',FI:'Finland',FR:'France',GB:'United Kingdom',GE:'Georgia',
  GR:'Greece',GT:'Guatemala',GU:'Guam',HK:'Hong Kong',HN:'Honduras',
  HR:'Croatia',HU:'Hungary',ID:'Indonesia',IE:'Ireland',IL:'Israel',
  IN:'India',IR:'Iran',IS:'Iceland',IT:'Italy',JP:'Japan',KE:'Kenya',
  KG:'Kyrgyzstan',KR:'South Korea',KZ:'Kazakhstan',LA:'Laos',
  LT:'Lithuania',LU:'Luxembourg',LV:'Latvia',MA:'Morocco',MC:'Monaco',
  MN:'Mongolia',MT:'Malta',MU:'Mauritius',MX:'Mexico',MY:'Malaysia',
  NL:'Netherlands',NO:'Norway',NZ:'New Zealand',PA:'Panama',
  PH:'Philippines',PL:'Poland',PT:'Portugal',PY:'Paraguay',RO:'Romania',
  RS:'Serbia',RU:'Russia',RW:'Rwanda',SA:'Saudi Arabia',SE:'Sweden',
  SI:'Slovenia',SK:'Slovakia',SV:'El Salvador',TH:'Thailand',TR:'Türkiye',
  TW:'Taiwan',TZ:'Tanzania',UA:'Ukraine',UG:'Uganda',US:'United States',
  UY:'Uruguay',UZ:'Uzbekistan',VE:'Venezuela',VN:'Vietnam',XK:'Kosovo',
  ZA:'South Africa',
};

// Paridad con cx_race_seo de tools/site/gen_og_pages.py.
export function cxRaceSeo(race,page,dateLabel,lang='es') {
  const dates=[race.dateKey];
  if(race.endDateKey&&race.endDateKey!==race.dateKey)dates.push(race.endDateKey);
  if(lang==='en'){
    const name=race.nameEn||race.name,tournament=race.cx_tournaments;
    const dateText=dates.map(date=>dateLabel(date,'en').replace(', ', ' ')).join(' – ');
    const category=race.class==='NAC'?'national':race.class?`UCI ${race.class}`:'';
    const code=(race.countryCode||'').toUpperCase(),country=CX_SEO_COUNTRIES_EN[code]||code;
    const location=race.venue?` in ${race.venue}${country?` (${country})`:''}`:country?` in ${country}`:'';
    const membership=tournament?` It is part of the ${tournament.nameEn||tournament.name}${race.seasonKey&&!tournament.name.includes(race.seasonKey)?` ${race.seasonKey}`:''}.`:'';
    const description=`${name} (${dateText}) is a ${category?`${category} `:''}cyclocross race${location}.${membership} See the programme, startlist and results, how to watch the race on TV and online streaming, and race videos.`;
    const prefix=page==='startlist'?'Startlist · ':page==='results'?'Results · ':'';
    return {title:`${prefix}${name} — Calendario Ciclismo App`,description};
  }
  const dateText=dates.map(date=>dateLabel(date,'es').replace(', ', ' ')).join(' – ');
  const category=race.class==='NAC'?'de categoría nacional':race.class?`de categoría UCI ${race.class}`:'';
  const tournament=race.cx_tournaments;
  const code=(race.countryCode||'').toUpperCase(),country=CX_SEO_COUNTRIES[code]||code;
  const location=race.venue?` en ${race.venue}${country?` (${country})`:''}`:country?` en ${country}`:'';
  const membership=tournament?` Pertenece a ${tournament.name}${race.seasonKey&&!tournament.name.includes(race.seasonKey)?` ${race.seasonKey}`:''}.`:'';
  const description=`${race.name} (${dateText}) es una prueba de ciclocross${category?` ${category}`:''}${location}.${membership} Consulta el programa, los dorsales y resultados, cómo ver la carrera por TV y online streaming y vídeos de las carreras.`;
  const prefix=page==='startlist'?'Dorsales · ':page==='results'?'Resultados · ':'';
  const title=`${prefix}${race.name} — Calendario Ciclismo App`;
  return {title,description};
}
