import {describe,it,expect,vi} from 'vitest';
import {cxCategories,cxMonthDays,cxColor,cxStandingTotal,cxRankSort,cxRaceUrl,cxRacePageUrl,cxRacePageLocation,cxSeason,cxSeasonMonths,cxTime,cxRaceMedia,cxCategoryConcludedAt,cxProgrammeOrder,cxCategoryCardState,cxUsesCategoryBadges,cxClassificationSelection,cxLegacyGeneralFragment,cxTournamentPageUrl,cxTournamentPage,cxTournamentGeneralCategories,cxStandingValueCells,cxStandingsBreakdown,cxResultCategories,cxGeneralCategories,cxRoundLabel,cxRoundBadge,cxRaceOpen,cxRacePlaceholder,cxPlaceholderMessage,cxHasClassifications,cxLapsLost,cxResultCell,cxResultCells,cxResultRank,cxAgendaFilterMatches} from '../cx/presentation.js';
import {cxMonth,cxNextDate,cxAllRows,cxTournamentRounds,cxSeasonRounds} from '../services/cx-data.js';
import {cxDateInSeason,cxSeasonBounds} from '../cx/season.js';

describe('agenda y clasificación pública CX',()=>{
  const world={name:'Mundial',slug:'mundial',slugEn:'worlds',class:'CM',dateKey:'2027-01-29',endDateKey:'2027-01-31',cx_race_categories:[
    {category:'ME',dateKey:'2027-01-31'},{category:'WE',dateKey:'2027-01-30'},{category:'MU',dateKey:'2027-01-30'}]};
  it('distribuye las mangas reales de una prueba multidía sin inventar relevo ni WU',()=>{
    expect(cxMonthDays([world],'2027-01').map(d=>d.date)).toEqual(['2027-01-30','2027-01-31']);
    expect(cxCategories(world,'2027-01-30').map(c=>c.category)).toEqual(['WE','MU']);
    expect(cxCategories(world).map(c=>c.category)).toEqual(['ME','WE','MU']);
    expect(cxRaceUrl(world,'en','ME')).toBe('/en/cyclocross/worlds/#ME');
    expect(cxRacePageUrl(world,'es','startlist','WE')).toBe('/ciclocross/mundial/inscritos/#WE');
    expect(cxRacePageUrl(world,'en','results','general')).toBe('/en/cyclocross/worlds/results/#general');
    expect(cxRacePageLocation('/en/cyclocross/worlds/startlist/')).toEqual({page:'startlist',slug:'worlds'});
    expect(cxRacePageLocation('/ciclocross/mundial/resultados/')).toEqual({page:'results',slug:'mundial'});
    for(const view of ['programme','tv','videos','general']) {
      expect(cxRacePageUrl(world,'es',view,'WE')).toBe(`/ciclocross/mundial/?view=${view}#WE`);
      expect(cxRacePageLocation('/ciclocross/mundial/',`?view=${view}`)).toEqual({page:view,slug:'mundial'});
      expect(cxRacePageLocation('/en/cyclocross/worlds/',`?view=${view}`)).toEqual({page:view,slug:'worlds'});
    }
    expect(cxRacePageLocation('/ciclocross/mundial/resultados/','?view=programme').page).toBe('results');
    expect(cxRacePageLocation('/ciclocross/mundial/','?view=unknown').page).toBe('race');
  });
  it('selecciona una clasificación por fragmento y reconoce los enlaces antiguos de la general',()=>{
    expect(cxClassificationSelection('WE',['ME','WE'])).toEqual({category:'WE',fragment:'WE'});
    expect(cxClassificationSelection('WU',['ME','WE']).category).toBe('ME');
    expect(cxClassificationSelection('WU',['WE','WU']).category).toBe('WU');
    expect(cxClassificationSelection('',[]).category).toBeNull();
    expect(cxLegacyGeneralFragment('general-WU')).toBe('WU');
    expect(cxLegacyGeneralFragment('general')).toBe('');
    expect(cxLegacyGeneralFragment('WU')).toBeNull();
    const series={slug:'x2o-trofee-2026-27'};
    expect(cxTournamentPageUrl(series,'es','general','MU')).toBe('/ciclocross/torneos/x2o-trofee-2026-27/?view=general#MU');
    expect(cxTournamentPageUrl(series,'en')).toBe('/en/cyclocross/series/x2o-trofee-2026-27/');
    expect(cxTournamentPage('?view=general')).toBe('general');
    expect(cxTournamentPage('')).toBe('calendar');
  });
  it('presenta la general por tiempo con diferencias y la de puntos con desglose y descartes',()=>{
    const time=[{rank:2,timeSeconds:'29295'},{rank:1,timeSeconds:'29190'},{rank:3,timeSeconds:'29190'}];
    const cells=cxStandingValueCells(time,'time');
    expect(time.map(row=>cells.get(row).text)).toEqual(["+1'45\"",'8:06:30','m.t.']);
    const state={status:'ready',roundIds:['r1','r2','r3'],breakdown:[{globalRiderId:'a',rounds:[
      {raceId:'r1',points:'40',retained:true},{raceId:'r2',points:'17',retained:false},{raceId:'r3',points:'0',missing:true}]}]};
    const breakdown=cxStandingsBreakdown(state,'points');
    expect(breakdown.cells({globalRiderId:'a'})).toEqual([{text:'40',dropped:false},{text:'17',dropped:true},{text:'-',dropped:false}]);
    expect(breakdown.cells({globalRiderId:'b'}).map(cell=>cell.text)).toEqual(['-','-','-']);
    expect(cxStandingsBreakdown({...state,status:'manual'},'points')).toBeNull();
    expect(cxStandingsBreakdown(state,'time')).toBeNull();
    expect(cxStandingsBreakdown({...state,breakdown:[]},'points')).toBeNull();
    expect(cxTournamentGeneralCategories([{category:'WE'},{category:'ME'}],[{category:'WE',status:'needs_review'}])).toEqual(['ME']);
  });
  it('ordena por clase y primera manga del día y muestra cabeceras sin programa',()=>{
    const early={name:'Antes',slug:'antes',class:'C2',dateKey:'2027-01-30',cx_race_categories:[{category:'ME',startTimeUtc:'2027-01-30T10:00:00Z'}]};
    const late={...early,name:'Después',cx_race_categories:[{category:'ME',startTimeUtc:'2027-01-30T12:00:00Z'}]};
    expect(cxMonthDays([late,early,world],'2027-01')[0].races.map(r=>r.name)).toEqual(['Mundial','Antes','Después']);
    expect(cxMonthDays([{...early,cx_race_categories:[]}],'2027-01')[0].races).toHaveLength(1);
    expect(cxMonthDays([world],'2027-02')).toEqual([]);
  });
  it('usa el horario de la categoría programada de mayor rango para ordenar cada clase',()=>{
    const dateKey='2027-01-30';
    const category=(code,startTimeUtc,isCancelled=false)=>({category:code,dateKey,startTimeUtc,isCancelled});
    const race=(name,cls,categories)=>({name,class:cls,dateKey,seasonKey:'2026-27',cx_race_categories:categories});
    const rows=[
      race('Élite tardía','C2',[category('WE','2027-01-30T10:00:00Z'),category('ME','2027-01-30T15:00:00Z')]),
      race('Élite temprana','C2',[category('WE','2027-01-30T13:00:00Z'),category('ME','2027-01-30T14:00:00Z')]),
      race('U23','C2',[category('MU','2027-01-30T13:00:00Z')]),
      race('U23 femenina','C2',[category('WJ','2027-01-30T08:00:00Z'),category('MJ','2027-01-30T09:00:00Z'),category('WU','2027-01-30T13:30:00Z')]),
      race('Sin élite','C2',[category('ME',null),category('MU','2027-01-30T12:00:00Z'),category('WE','2027-01-30T16:00:00Z')]),
      race('Élite cancelada','C2',[category('ME','2027-01-30T11:00:00Z',true),category('WE','2027-01-30T17:00:00Z')]),
      race('Junior masculino','C2',[category('WJ','2027-01-30T08:00:00Z'),category('MJ','2027-01-30T18:00:00Z')]),
      race('Junior femenino','C2',[category('WJ','2027-01-30T19:00:00Z')]),
      race('Sin horario','C2',[category('ME',null)]),
      race('C1 temprana','C1',[category('ME','2027-01-30T08:00:00Z')]),
      race('Mundial tarde','CM',[category('ME','2027-01-30T18:00:00Z')]),
      race('Clase desconocida','X',[category('ME','2027-01-30T07:00:00Z')]),
    ];
    expect(cxMonthDays(rows,'2027-01')[0].races.map(r=>r.name)).toEqual([
      'Mundial tarde','C1 temprana','U23','U23 femenina','Élite temprana','Élite tardía','Sin élite','Élite cancelada','Junior masculino','Junior femenino','Sin horario','Clase desconocida',
    ]);
  });
  it('prioriza el torneo, conserva el color individual y las horas desconocidas',()=>{
    expect(cxColor({colorHex:'#123456',cx_tournaments:{colorHex:'#654321'}})).toBe('#654321');
    expect(cxColor({cx_tournaments:{colorHex:'#654321'}})).toBe('#654321');
    expect(cxColor({colorHex:'red;'})).toBeNull();
    expect(cxTime(null)).toBeNull();
    expect(cxTime('2027-01-30T14:00:00Z','es-ES','Europe/Madrid')).toBe('15:00');
    expect(cxTime('2026-09-30T13:00:00Z','en-GB','Europe/Brussels')).toBe('15:00');
  });
  it('asigna la paleta por torneo sin deducirlo del nombre de la carrera',()=>{
    for(const [name,color] of [['Copa del Mundo UCI','#8B173D'],['Telenet Superprestige','#FFC600'],['X2O Badkamers Trofee','#00A8C7'],['Copa de España','#D71920'],['Exact Cross','#E6342A'],['HG Cross','#E6342A'],['Coupe de France','#0055A4'],['Swiss Cyclocross Cup','#D52B1E'],['Toi Toi Cup','#E87524'],['HSF System Cup','#E87524'],['National Trophy','#6B3FA0'],['Trek USCX Series','#233C78'],['Giro delle Regioni Ciclocross','#E94B8A'],['Taça de Portugal','#008657']]) {
      expect(cxColor({cx_tournaments:{name},colorHex:'#123456'})).toBe(color);
      expect(cxColor({cx_tournaments:{name,colorHex:'#112233'}})).toBe('#112233');
    }
    expect(cxColor({name:'Copa del Mundo',colorHex:'#123456'})).toBe('#123456');
    expect(cxColor({cx_tournaments:{name:'Torneo local',colorHex:'invalid'},colorHex:'#123456'})).toBe('#123456');
    expect(cxColor({cx_tournaments:{name:'Torneo local'}})).toBeNull();
  });
  it('exige filas publicadas y general posterior con la ronda actual, incluida WU derivada',()=>{
    const race={id:'current',dateKey:'2026-09-12',seasonKey:'2026-27',cx_race_categories:[{category:'ME',resultsStatus:'official'},{category:'WE',resultsStatus:'pending'}],
      cx_tournaments:{pointsScheme:{categories:{ME:{mode:'time'},WU:{mode:'points',extras:{derived:{fromCategory:'ME'}}}}}}};
    const rows=[{category:'ME'}],standings=[{category:'ME'},{category:'WU'}],prior=['ME','WU'].map(category=>({category,status:'ready',roundIds:['prior']}));
    expect(cxResultCategories(race,[])).toEqual([]);
    expect(cxResultCategories(race,[...rows,{category:'WE'}])).toEqual(['ME']);
    expect(cxGeneralCategories(race,standings,[],prior)).toEqual(['ME','WU']);
    expect(cxGeneralCategories(race,standings,rows,prior)).toEqual([]);
    expect(cxGeneralCategories(race,standings,rows,prior.map(s=>({...s,roundIds:['current']})))).toEqual(['ME','WU']);
    expect(cxGeneralCategories(race,standings,rows,prior.map(s=>({...s,status:'needs_review',roundIds:['current']})))).toEqual([]);
    expect(cxGeneralCategories(race,standings,rows)).toEqual([]);
    expect(cxGeneralCategories(race,standings,[])).toEqual(['ME','WU']);
  });
  it('mantiene el horario hasta meta y separa espera de resultados publicados en cada categoría',()=>{
    const race={class:'CM'};
    const c={category:'ME',startTimeUtc:'2027-01-31T14:00:00Z',durationFormat:'individual',durationRuleVersion:'2026-07-01',resultsStatus:'pending'};
    expect(cxCategoryCardState(race,c,'2027-01-31T13:00:00Z')).toBe('time');
    expect(cxCategoryCardState(race,c,'2027-01-31T14:59:59Z')).toBe('time');
    expect(cxCategoryCardState(race,c,'2027-01-31T15:00:00Z')).toBe('awaiting');
    expect(cxCategoryCardState(race,{...c,startTimeUtc:'2027-01-31T16:00:00Z'},'2027-01-31T15:00:00Z')).toBe('time');
    for(const resultsStatus of ['official','provisional'])expect(cxCategoryCardState(race,{...c,resultsStatus},'2027-01-31T15:00:00Z')).toBe('results');
    expect(cxCategoryCardState(race,{...c,durationFormat:null},'2027-01-31T15:00:00Z')).toBe('time');
    expect(cxCategoryCardState({isCancelled:true},{...c,resultsStatus:'official'},'2027-01-31T15:00:00Z')).toBe('cancelled');
  });
  it('solo espera resultados en Mundiales, Continentales y Copa del Mundo, Superprestige y X2O',()=>{
    const c={category:'ME',startTimeUtc:'2027-01-31T14:00:00Z',durationFormat:'individual',durationRuleVersion:'2026-07-01',resultsStatus:'pending'};
    const at='2027-01-31T15:00:00Z';
    for(const cls of ['CM','CC','CDM'])expect(cxCategoryCardState({class:cls},c,at)).toBe('awaiting');
    for(const name of ['Copa del Mundo UCI','Telenet Superprestige','X2O Badkamers Trofee']) {
      expect(cxCategoryCardState({class:'C1',cx_tournaments:{name}},c,at)).toBe('awaiting');
      expect(cxCategoryCardState({class:'C1',cx_tournaments:{slug:name}},c,at)).toBe('awaiting');
    }
    for(const race of [{class:'C1'},{class:'C2'},{class:'CN'},{class:'NAC'},{},
      {class:'C1',cx_tournaments:{name:'Copa de España'}},
      {class:'C1',cx_tournaments:{name:'Exact Cross'}},
      {class:'C1',cx_tournaments:{name:'Trek USCX Series'}}]) {
      expect(cxCategoryCardState(race,c,at)).toBe('time');
    }
  });
  it('filtra la agenda CX por Big, Pro y España',()=>{
    const big=race=>cxAgendaFilterMatches(race,'big');
    for(const cls of ['CM','CDM','CC'])expect(big({class:cls})).toBe(true);
    for(const name of ['Telenet Superprestige','X2O Badkamers Trofee','Copa del Mundo UCI','Exact Cross','HG Cross']) {
      expect(big({class:'C1',cx_tournaments:{name}})).toBe(true);
      expect(big({class:'C1',cx_tournaments:{slug:name}})).toBe(true);
    }
    expect(big({class:'C1',cx_tournaments:{name:'Copa de España'}})).toBe(false);
    expect(big({class:'C2'})).toBe(false);
    const pro=race=>cxAgendaFilterMatches(race,'pro');
    for(const cls of ['CM','CDM','CC','C1','C2'])expect(pro({class:cls})).toBe(true);
    for(const cls of ['CN','NAC'])expect(pro({class:cls})).toBe(false);
    const spain=race=>cxAgendaFilterMatches(race,'spain');
    expect(spain({countryCode:'es'})).toBe(true);
    expect(spain({countryCode:'ES-AN'})).toBe(true);
    expect(spain({countryCode:'fr'})).toBe(false);
    expect(spain({countryCode:null})).toBe(false);
    expect(cxAgendaFilterMatches({class:'NAC',countryCode:'fr'},'all')).toBe(true);
  });
  it('pasa a badges solo cuando ninguna categoría del día tiene horario ni estado especial',()=>{
    const noSchedule={cx_race_categories:[{category:'ME',dateKey:'2026-09-19'},{category:'WE',dateKey:'2026-09-19'}]};
    expect(cxUsesCategoryBadges(noSchedule,'2026-09-19','2026-09-12T10:00:00Z')).toBe(true);
    const withTime={cx_race_categories:[{category:'ME',dateKey:'2026-09-19'},{category:'WE',dateKey:'2026-09-19',startTimeUtc:'2026-09-19T10:00:00Z'}]};
    expect(cxUsesCategoryBadges(withTime,'2026-09-19','2026-09-12T10:00:00Z')).toBe(false);
    const withResults={cx_race_categories:[{category:'ME',dateKey:'2026-09-19',resultsStatus:'official'}]};
    expect(cxUsesCategoryBadges(withResults,'2026-09-19','2026-09-20T10:00:00Z')).toBe(false);
    const changedDay={cx_race_categories:[{category:'ME',dateKey:'2026-09-20',startTimeUtc:'2026-09-20T10:00:00Z'},{category:'WE',dateKey:'2026-09-19'}]};
    expect(cxUsesCategoryBadges(changedDay,'2026-09-19','2026-09-12T10:00:00Z')).toBe(true);
    expect(cxUsesCategoryBadges({cx_race_categories:[]},'2026-09-19')).toBe(false);
  });
  it('trata como placeholder la prueba cancelada o sin Libro de Ruta/Mapa y horarios',()=>{
    const loaded={dateKey:'2026-12-05',assets:[{type:'map',url:'https://assets.example.org/map.png'}],cx_race_categories:[{category:'ME',startTimeUtc:'2026-12-05T13:00:00Z'}]};
    expect(cxRaceOpen(loaded)).toBe(true);
    expect(cxRacePlaceholder(loaded)).toBe(false);
    expect(cxRacePlaceholder({...loaded,assets:[]})).toBe(true);
    expect(cxRacePlaceholder({...loaded,cx_race_categories:[{category:'ME'}]})).toBe(true);
    // Cancelada siempre, aunque tenga la carga mínima completa.
    expect(cxRacePlaceholder({...loaded,isCancelled:true})).toBe(true);
    expect(cxPlaceholderMessage({...loaded,isCancelled:true})).toBe('Carrera cancelada');
    expect(cxPlaceholderMessage({...loaded,dateKey:'2999-01-01'})).toBe('Por ahora sin información extra');
    expect(cxPlaceholderMessage({...loaded,dateKey:'2020-01-01'})).toBe('Sin información extra');
  });
  it('abre la prueba sin documento ni horarios cuando alguna manga tiene clasificación publicada',()=>{
    const bare={dateKey:'2026-12-05',cx_race_categories:[{category:'ME',dateKey:'2026-12-05'}]};
    expect(cxHasClassifications(bare)).toBe(false);
    expect(cxRaceOpen(bare)).toBe(false);
    expect(cxRacePlaceholder(bare)).toBe(true);
    for(const status of ['official','provisional']){
      const withResults={...bare,cx_race_categories:[{category:'ME',dateKey:'2026-12-05',resultsStatus:status}]};
      expect(cxHasClassifications(withResults)).toBe(true);
      expect(cxRaceOpen(withResults)).toBe(true);
      expect(cxRacePlaceholder(withResults)).toBe(false);
    }
    expect(cxHasClassifications({...bare,cx_race_categories:[{category:'ME',resultsStatus:'pending'}]})).toBe(false);
    // Cancelada con clasificación publicada sigue siendo placeholder.
    expect(cxRacePlaceholder({...bare,isCancelled:true,cx_race_categories:[{category:'ME',resultsStatus:'official'}]})).toBe(true);
  });
  it('presenta unidades independientes y ordena por puesto, incluso con tiempos menores',()=>{
    const rows=[{rank:2,timeSeconds:90001,points:null},{rank:1,timeSeconds:89900,points:null}];
    expect(rows.sort(cxRankSort).map(r=>r.rank)).toEqual([1,2]);
    expect(cxStandingTotal(rows[1],'time')).toBe('25:00:01');
    expect(cxStandingTotal({timeSeconds:null,points:0},'time')).toBe('-');
    expect(cxStandingTotal({timeSeconds:0,points:null},'time')).toBe('0:00:00');
    expect(cxStandingTotal({timeSeconds:0,points:null},'points')).toBe('-');
    expect(cxStandingTotal({points:0},'points')).toBe('0');
    expect(cxStandingTotal({points:12.5},'points','en-GB')).toBe('12.5');
    expect(cxStandingTotal({points:'12.123456789012'},'points','en-GB')).toBe('12.123456789012');
    expect(cxStandingTotal({timeSeconds:'9007199254740993'},'time')).toBe('2501999792983:36:33');
  });
  it('delimita agosto–febrero y abre la siguiente temporada fuera de esa ventana',()=>{
    expect(cxSeason(new Date(2026,6,31))).toBe('2026-27');
    expect(cxSeason(new Date(2026,7,1))).toBe('2026-27');
    expect(cxSeason(new Date(2027,1,28))).toBe('2026-27');
    expect(cxSeason(new Date(2027,2,1))).toBe('2027-28');
    expect(cxSeasonMonths('2026-27')).toEqual(['2026-08','2026-09','2026-10','2026-11','2026-12','2027-01','2027-02']);
    expect(cxSeasonBounds('2027-28')).toEqual({first:'2027-08-01',last:'2028-02-29'});
    expect(cxDateInSeason('2026-27','2027-02-28')).toBe(true);
    expect(cxDateInSeason('2026-27','2027-02-29')).toBe(false);
    expect(cxDateInSeason('2026-27','2027-03-01')).toBe(false);
    for(let month=3;month<=7;month++) expect(cxMonthDays([{...world,dateKey:`2027-0${month}-01`,cx_race_categories:[]}],`2027-0${month}`)).toEqual([]);
  });
  const race={dateKey:'2026-10-11',cx_race_categories:[]};
  const me={category:'ME',startTimeUtc:'2026-10-11T13:00:00Z',resultsStatus:'official'};
  const we={category:'WE',startTimeUtc:'2026-10-11T11:45:00Z'};
  const before=new Date('2026-10-11T10:00:00Z');
  it('separa vídeos editoriales de Revive y conserva regiones',()=>{
    const global={id:'g',url:'https://example.org',channel:'Canal',country:'ALL',showInRevive:true};
    const rows=[global,{...global,id:'me',category:'ME'},{...global,id:'be',country:'BE'},
      {...global,id:'we',url:'https://other.example.org',category:'WE'},{...global,id:'bad',url:'javascript:alert(1)'}];
    const media=cxRaceMedia(race,[me],rows,[{url:'https://www.youtube.com/watch?v=abcdefghijk',category:'ME'}],
      {results:[{category:'ME'}],at:before});
    expect(media.tv).toEqual([]);
    expect(media.revive.map(row=>row.url)).toEqual(['https://example.org/']);
    expect(media.videos.map(row=>row.url)).toEqual(['https://www.youtube.com/watch?v=abcdefghijk']);
  });
  it('retira el directo al concluir la categoría y exige resultados o cancelación para Revive',()=>{
    const rows=[{id:'we',url:'https://example.org/we',category:'WE',showInRevive:true}];
    expect(cxRaceMedia(race,[we],rows,[],{at:before}).tv).toHaveLength(1);
    // 50 min reglamentarios desconocidos → 60 + 30 tras la salida.
    expect(cxCategoryConcludedAt(race,we).toISOString()).toBe('2026-10-11T13:15:00.000Z');
    expect(cxCategoryConcludedAt(race,{...we,durationFormat:'individual',durationRuleVersion:'2026-07-01'}).toISOString()).toBe('2026-10-11T13:05:00.000Z');
    expect(cxCategoryConcludedAt(race,{category:'MJ'}).toISOString()).toBe('2026-10-12T06:00:00.000Z');
    const later=cxRaceMedia(race,[we],rows,[],{at:new Date('2026-10-11T13:15:00Z')});
    expect(later.tv).toEqual([]);
    expect(later.revive).toEqual([]);
    expect(cxRaceMedia({...race,isCancelled:true},[we],rows,[],{at:before}).revive).toHaveLength(1);
  });
  it('aplica el criterio de Revive de carretera y Sporza, salvo en categorías canceladas',()=>{
    const rows=[
      {id:'eu',url:'https://play.hbomax.com/sport/1',channel:'Eurosport (HBO Max)',category:'ME',sortOrder:0},
      {id:'yt',url:'https://www.youtube.com/watch?v=abcdefghijk',channel:'Canal',category:'ME',sortOrder:1},
      {id:'sp',url:'https://sporza.be/live',channel:'Sporza',isSporza:true,category:'ME',sortOrder:2},
      {id:'tv',url:'https://tv.example/live',channel:'TV',category:'ME',sortOrder:3},
    ];
    expect(cxRaceMedia(race,[me],rows,[],{results:[{category:'ME'}],at:before}).revive.map(row=>row.id)).toEqual(['eu','yt','sp']);
    expect(cxRaceMedia(race,[{...me,isCancelled:true}],rows,[],{at:before}).revive).toEqual([]);
    expect(cxRaceMedia(race,[me],rows,[],{results:[{category:'ME'}],visibleBroadcasts:[],at:before}).revive).toEqual([]);
  });
  it('no repite en Revive una emisión global que sigue en directo y no colapsa la misma URL entre categorías',()=>{
    const rows=[
      {id:'g',url:'https://example.org/all',channel:'Canal',showInRevive:true},
      {id:'me',url:'https://example.org/cx',channel:'Canal',category:'ME'},
      {id:'we',url:'https://example.org/cx',channel:'Canal',category:'WE'},
    ];
    const media=cxRaceMedia(race,[me,we],rows,[],{results:[{category:'ME'}],at:before});
    expect(media.tv.map(row=>row.id)).toEqual(['g','we']);
    expect(media.revive).toEqual([]);
    expect(cxRaceMedia(race,[{...me,resultsStatus:'pending'},we],rows,[],{at:before}).tv.map(row=>row.id)).toEqual(['g','me','we']);
  });
  it('ordena las categorías en directo como el programa',()=>{
    expect(cxProgrammeOrder(race,[me,we,{category:'MJ'}]).map(c=>c.category)).toEqual(['WE','ME','MJ']);
    const media=cxRaceMedia(race,[{...me,resultsStatus:'pending'},we],[],[],{at:before});
    expect(media.liveCategories.map(c=>c.category)).toEqual(['WE','ME']);
  });
});

describe('número de ronda por torneo',()=>{
  const races=[
    {id:'oct-late',seasonKey:'2026-27',tournamentId:'t1',dateKey:'2026-10-03',cx_race_categories:[{dateKey:'2026-10-04',startTimeUtc:'2026-10-04T15:00:00Z'}]},
    {id:'no-tournament',seasonKey:'2026-27',dateKey:'2026-10-03',cx_race_categories:[]},
    {id:'untimed',seasonKey:'2026-27',tournamentId:'t1',dateKey:'2026-10-03',cx_race_categories:[{dateKey:'2026-10-04'}]},
    {id:'oct-early',seasonKey:'2026-27',tournamentId:'t1',dateKey:'2026-10-03',cx_race_categories:[{dateKey:'2026-10-04',startTimeUtc:'2026-10-04T13:00:00Z',isCancelled:true},{dateKey:'2026-10-04',startTimeUtc:'2026-10-04T11:00:00Z'}]},
    {id:'cancelada',seasonKey:'2026-27',tournamentId:'t1',isCancelled:true,dateKey:'2026-10-02',cx_race_categories:[]},
    {id:'fuera',seasonKey:'2026-27',tournamentId:'t1',dateKey:'2027-03-01',cx_race_categories:[]},
    {id:'nov',seasonKey:'2026-27',tournamentId:'t1',dateKey:'2026-11-01',cx_race_categories:[]},
    {id:'otra-temporada',seasonKey:'2025-26',tournamentId:'t1',dateKey:'2025-10-01',cx_race_categories:[]},
    {id:'b',seasonKey:'2026-27',tournamentId:'t2',dateKey:'2026-10-04',cx_race_categories:[]},
    {id:'a',seasonKey:'2026-27',tournamentId:'t2',dateKey:'2026-10-04',cx_race_categories:[]},
    {id:'solitaria',seasonKey:'2026-27',tournamentId:'t3',dateKey:'2026-12-05',cx_race_categories:[{dateKey:'2027-03-01',startTimeUtc:'2027-03-01T11:00:00Z'}]},
  ];
  it('numera por torneo con el orden del contrato de generales',()=>{
    const rounds=cxTournamentRounds(races,'2026-27');
    expect(rounds.get('oct-early')).toEqual({n:1,total:4});
    expect(rounds.get('oct-late')).toEqual({n:2,total:4});
    expect(rounds.get('untimed')).toEqual({n:3,total:4});
    expect(rounds.get('nov')).toEqual({n:4,total:4});
    expect(rounds.get('cancelada')).toBeUndefined();
    expect(rounds.get('fuera')).toBeUndefined();
    expect(rounds.get('no-tournament')).toBeUndefined();
    expect(rounds.get('otra-temporada')).toBeUndefined();
    expect(rounds.get('a')).toEqual({n:1,total:2});
    expect(rounds.get('b')).toEqual({n:2,total:2});
    expect(rounds.get('solitaria')).toEqual({n:1,total:1});
  });
  it('formatea la insignia solo cuando hay torneo y más de una ronda',()=>{
    expect(cxRoundLabel()).toBeNull();
    expect(cxRoundLabel({n:5,total:8})).toEqual({text:'5/8',aria:'Prueba 5 de 8'});
    for(const round of [{n:1,total:1},{n:0,total:8},{n:9,total:8},null])expect(cxRoundLabel(round)).toBeNull();
    expect(cxRoundBadge({n:5,total:8})).toBe('<span class="cx-round-badge"><span aria-hidden="true">5/8</span><span class="sr-only">Prueba 5 de 8</span></span>');
    expect(cxRoundBadge({n:1,total:1})).toBe('');
    expect(cxRoundBadge(null)).toBe('');
  });
  it('consulta una sola vez por temporada el mínimo de filas publicado',async()=>{
    const rows=Array.from({length:1001},(_,index)=>({id:`r${index}`,seasonKey:'2025-26',editorialStatus:'published',tournamentId:'t',dateKey:'2025-10-01',cx_race_categories:[]}));
    const db=client({cx_races:rows});
    const rounds=await cxSeasonRounds(db,'2025-26');
    expect(rounds.size).toBe(1001);
    expect(rounds.get('r0')).toEqual({n:1,total:1001});
    expect(db.calls.map(call=>call.range)).toEqual([[0,999],[1000,1999]]);
    expect(db.calls.every(call=>call.select==='id,tournamentId,dateKey,seasonKey,isCancelled,cx_race_categories(dateKey,startTimeUtc,isCancelled)')).toBe(true);
    for(const call of db.calls) {
      expect(call.filters).toContainEqual(['seasonKey','2025-26']);
      expect(call.filters).toContainEqual(['editorialStatus','published']);
    }
    const other=client({});
    expect(await cxSeasonRounds(other,'2025-26')).toBe(rounds);
    expect(other.calls).toEqual([]);
  });
});

describe('vueltas perdidas en la celda de resultados CX',()=>{
  it('reconoce los formatos de vuelta perdida que publica DataRide',()=>{
    expect(cxLapsLost({irm:'LAP',gapText:'-2 LAPS'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',gapText:'- 4 LAP'})).toBe(4);
    expect(cxLapsLost({irm:'LAP',gapText:'@ 3 LAPS'})).toBe(3);
    expect(cxLapsLost({irm:'LAP',gapText:'2 LAP'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',gapText:'-1 LAP'})).toBe(1);
    expect(cxLapsLost({irm:null,gapText:'-2 LAPS'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',timeText:'2'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',timeText:'- 2'})).toBe(2);
    expect(cxLapsLost({irm:'LAP',timeText:"'-1'"})).toBe(1);
    expect(cxLapsLost({irm:'LAP'})).toBeNull();
    expect(cxLapsLost({irm:'LAP',timeText:'0'})).toBeNull();
    expect(cxLapsLost({irm:'LAP',timeText:'1:02:28'})).toBeNull();
    expect(cxLapsLost({irm:null,gapText:'+38'})).toBeNull();
    expect(cxLapsLost({irm:null,timeText:'2'})).toBeNull();
    expect(cxLapsLost(null)).toBeNull();
  });
  it('presenta vueltas perdidas, estado, gap y tiempo sin mezclar la celda',()=>{
    expect(cxResultCell({irm:'LAP',gapText:'-2 LAPS'})).toEqual({text:'-2 vueltas',cls:'res-lap'});
    expect(cxResultCell({irm:'LAP',gapText:'-1 LAP'})).toEqual({text:'-1 vuelta',cls:'res-lap'});
    expect(cxResultCell({irm:'LAP'})).toEqual({text:'vuelta perdida',cls:'res-lap'});
    expect(cxResultCell({irm:'LAP',timeText:'1:02:28'})).toEqual({text:'vuelta perdida',cls:'res-lap'});
    expect(cxResultCell({irm:'DNF'})).toEqual({text:'',cls:''});
    expect(cxResultCell({gapText:'+38'})).toEqual({text:'+38"',cls:'res-gap'});
    expect(cxResultCell({rank:1,timeText:'0:57:15'})).toEqual({text:'57:15',cls:'res-time'});
    expect(cxResultCell({rank:1,timeSeconds:'3600'})).toEqual({text:'1:00:00',cls:'res-time'});
    // Con timeSeconds resuelto, un reloj H:MM:SS exacto no se relee como MM:SS:00.
    expect(cxResultCell({rank:1,timeText:'01:03:00',timeSeconds:'3780'})).toEqual({text:'1:03:00',cls:'res-time'});
    expect(cxResultCell({rank:1,timeText:'45:10:00',timeSeconds:'2710'})).toEqual({text:'45:10',cls:'res-time'});
    expect(cxResultCell({timeSeconds:'invalid'})).toEqual({text:'',cls:''});
    expect(cxResultCell({rank:1,irm:null,gapText:null,timeText:'2'})).toEqual({text:'2',cls:'res-time'});
    expect(cxResultCell({irm:null})).toEqual({text:'',cls:''});
    expect(cxResultCell(null)).toEqual({text:'',cls:''});
  });
  it('presenta los cronos de Canmore y los IRM como carretera, salvo LAP',()=>{
    const rows=[{rank:1,timeText:'1:00:33.8'},{rank:2,timeText:'1:00:40.0'},
      {rank:3,timeText:'1:00:40.9'},{rank:4,irm:'LAP',gapText:'-2 LAPS'},
      {rank:5,irm:'DNF',rankText:'5',timeText:'7:16.9'}];
    const cells=cxResultCells(rows);
    expect([...cells.values()].map(c=>c.text)).toEqual(['1:00:33','+7"','m.t.','-2 vueltas','']);
    expect(cxResultRank(rows[4])).toBe('ABN');
    expect(cxResultRank(rows[4],'en')).toBe('DNF');
    expect(cxResultRank(rows[3])).toBe(4);
    const winner={rank:1,timeText:'42:09.2'},second={rank:2,timeText:'42:09.3'};
    expect(cxResultCells([winner,second]).get(second).text).toBe('m.t.');
    expect(cxResultCell({rank:2,timeText:'42:10.0',gapText:'+0.8'},winner).text).toBe('+1"');
    expect(cxResultCell({rank:2,timeText:'0:00:05'},winner).text).toBe('0:05');
    expect(cxResultCell({rank:1,timeSeconds:'3210'}).text).toBe('53:30');
  });

});

function client(tables) {
  const calls=[];
  return {calls,rpc:vi.fn(async()=>({data:null,error:null})),from(table){
    const filters=[],entry={table,select:null,range:null,filters};calls.push(entry);
    const query={select(value){entry.select=value;return this;},eq(key,value){filters.push([key,value]);return this;},gte(){return this;},lte(){return this;},or(){return this;},order(){return this;},range(a,b){entry.range=[a,b];return this;},then(resolve){
      let data=(tables[table]||[]).filter(row=>filters.every(([key,value])=>row[key]===value));
      if(entry.range)data=data.slice(entry.range[0],entry.range[1]+1);
      return Promise.resolve({data,error:null}).then(resolve);
    }};return query;
  }};
}

describe('consultas mensuales y salto puntual CX',()=>{
  it('rechaza marzo–julio antes de consultar, incluidos meses antiguos en caché',async()=>{
    const client={from:vi.fn()};
    for(let month=3;month<=7;month++) await expect(cxMonth(client,'2026-27',2027,month)).rejects.toThrow('agosto a febrero');
    expect(client.from).not.toHaveBeenCalled();
  });
  it('limita el mes incluyendo carreras que lo cruzan y no pide una temporada completa',async()=>{
    const q={};for(const key of ['select','eq','lte','or','order'])q[key]=vi.fn(()=>q);
    q.then=resolve=>Promise.resolve(resolve({data:[],error:null}));
    const client={from:vi.fn(()=>q)};
    await cxMonth(client,'2026-27',2027,2);
    expect(q.eq).toHaveBeenCalledWith('seasonKey','2026-27');
    expect(q.eq).toHaveBeenCalledWith('editorialStatus','published');
    expect(q.lte).toHaveBeenCalledWith('dateKey','2027-02-28');
    expect(q.or).toHaveBeenCalledWith('dateKey.gte.2027-02-01,endDateKey.gte.2027-02-01');
    expect(client.from).toHaveBeenCalledTimes(1);
  });
  it('obtiene la fecha mínima por RPC sin recorrer meses vacíos y propaga errores',async()=>{
    const rpc=vi.fn().mockResolvedValueOnce({data:'2027-01-30'}).mockResolvedValueOnce({data:null}).mockResolvedValueOnce({error:{message:'Error de consulta'}});
    expect(await cxNextDate({rpc},'2026-27','2026-07-20')).toBe('2027-01-30');
    expect(rpc).toHaveBeenCalledWith('cx_next_race_date',{p_season_key:'2026-27',p_date_key:'2026-07-20'},{get:true});
    expect(await cxNextDate({rpc},'2026-27','2027-07-20')).toBeNull();
    await expect(cxNextDate({rpc},'2026-27','2027-07-20')).rejects.toThrow('Error de consulta');
  });
  it('pagina listas extensas conservando el filtro de carrera',async()=>{
    const query={select:vi.fn(()=>query),order:vi.fn(()=>query),eq:vi.fn(()=>query),range:vi.fn(()=>query)};
    query.then=resolve=>Promise.resolve(resolve({data:query.range.mock.calls.at(-1)[0]===0?Array.from({length:1000},(_,id)=>({id})):[{id:1000}],error:null}));
    const result=await cxAllRows({from:()=>query},'cx_results','*',{raceId:'prueba'});
    expect(result).toHaveLength(1001);expect(query.range.mock.calls).toEqual([[0,999],[1000,1999]]);
    expect(query.eq).toHaveBeenCalledTimes(2);expect(query.eq).toHaveBeenCalledWith('raceId','prueba');
  });
});
