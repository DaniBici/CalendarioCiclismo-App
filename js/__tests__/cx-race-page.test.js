import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as presentation from '../cx/presentation.js';
import {cxDateInSeason} from '../cx/season.js';
import {cxUrl,cxYouTubeVideoId} from '../cx/editor-logic.js';
import {cxRaceSeo} from '../cx/race-seo.js';
import {cxIsHidden,CX_SPANISH_AUDIENCE} from '../services/cx-data.js';

const script=readFileSync(new URL('../cx-race.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('}catch(error){root.innerHTML=', '}catch(error){throw error;root.innerHTML=');
const race={id:'race',name:'Carrera CX',nameEn:'CX Race',slug:'carrera',slugEn:'race',seasonKey:'2026-27',dateKey:'2026-11-01',class:'C1',venue:'Ostende',countryCode:'BE',websiteUrl:'https://organizer.example/',
  cx_tournaments:{id:'series',name:'Circuito CX',slug:'circuito'},
  cx_race_categories:['ME','WE'].map(category=>({category,startTimeUtc:'2026-11-01T12:00:00Z',resultsStatus:'official',startlistImportedAt:'2026-10-31T12:00:00Z'}))};

async function open(path='/ciclocross/carrera/',{lang='es',resultCodes=['ME','WE'],assets=[],broadcasts,startlist=true,videos=true,programme=true,categoryStatus='official',resultsSourceUrl=null,resultEvidence={},raceClass=race.class,standings=[],states=[]}={}) {
  const location={};
  const navigate=path=>{const url=new URL(path,'https://calendariociclismo.app');Object.assign(location,{href:url.href,origin:url.origin,pathname:url.pathname,search:url.search,hash:url.hash});};
  navigate(path);
  const testRace={...race,class:raceClass,cx_race_categories:race.cx_race_categories.map(category=>({...category,...(programme?{}:{startTimeUtc:null}),resultsStatus:categoryStatus,...(resultsSourceUrl?{resultsSourceUrl}:{}) ,resultsEvidence:resultEvidence}))};
  const events={},clicks={},meta={},alternates={};
  class Element {
    constructor(attrs={}) {
      this.attrs=attrs;this.hidden=false;
      this.dataset=Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
      this.classList={toggle:vi.fn()};
    }
    get href(){return new URL(this.attrs.href||'',location.href).href;}
    set href(value){this.attrs.href=value;}
    get target(){return this.attrs.target;}
    hasAttribute(name){return name in this.attrs;}
    setAttribute(name,value){this.attrs[name]=value;}
    removeAttribute(name){delete this.attrs[name];}
    closest(selector){return selector==='a[href]'&&this.hasAttribute('href')?this:null;}
  }
  const canonical=new Element(),root=new Element();
  let markup='',writes=0,nodes=[];
  Object.defineProperty(root,'innerHTML',{get:()=>markup,set:value=>{
    markup=value;writes++;
    nodes=[...value.matchAll(/<[a-z]+\b([^>]+)>/g)].map(match=>new Element(Object.fromEntries([...match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(attr=>[attr[1],attr[2]||'']))));
  }});
  root.querySelectorAll=selector=>nodes.filter(node=>selector.split(',').some(part=>node.hasAttribute(part.trim().slice(1,-1))));
  root.querySelector=selector=>selector==='[data-cx-race-id]'?new Element({'data-cx-race-id':'race'}):root.querySelectorAll(selector)[0]||null;
  root.addEventListener=(name,fn)=>{clicks[name]=fn;};
  const back=vi.fn(),buildRaceHeader=vi.fn(()=>'<header class="race-header"><h1>Carrera CX</h1></header>');
  const limitScrollToStickyStart=vi.fn();
  const data={cx_results:resultCodes.map(category=>({category,rank:1,riderDisplay:'Ganador',timeSeconds:3600})),
    cx_startlist_riders:startlist?['ME','WE'].map(category=>({category,firstName:'Nombre',lastName:category,bib:1,sortOrder:0})):[],
    cx_broadcasts:broadcasts??[{channel:'TV CX',url:'https://tv.example/live',country:'ALL'}],
    cx_videos:Array.isArray(videos)?videos:videos?[{title:'Resumen CX',url:'https://www.youtube.com/watch?v=abcdefghijk'}]:[],
    cx_standings_state:states,cx_tournament_standings:standings,cx_races:[],cx_teams:[],assets};
  const cxAllRows=vi.fn(async(_client,table)=>data[table]);
  const supabase={from:table=>{
    const query={table,select:()=>query,eq:()=>query,maybeSingle:()=>query};return query;
  }};
  await runInNewContext(`(async()=>{${script}})()`,{
    ...presentation,esc:presentation.cxEsc,cxRaceSeo,cxDateInSeason,cxUrl,cxYouTubeVideoId,URL,URLSearchParams,Intl,Date,location,
    history:{pushState:(_state,_title,path)=>navigate(path),replaceState:(_state,_title,path)=>navigate(path)},cxStandingsTableHtml:()=>'<table></table>',cxWireStandingsScroll:()=>{},
    window:{innerWidth:600,ccHeaderBack:back,addEventListener:(name,fn)=>{events[name]=fn;}},
    document:{hidden:false,getElementById:()=>root,addEventListener:()=>{},
      querySelector:selector=>selector==='link[rel=canonical]'?canonical:alternates[selector],
      createElement:()=>new Element(),head:{append:node=>{alternates[`link[rel=alternate][hreflang="${node.hreflang}"]`]=node;}}},
    initI18n:async()=>{},t:key=>key,getLang:()=>lang,getLocale:()=>lang==='en'?'en-GB':'es-ES',
    supabase,cxQuery:async query=>query.table==='cx_races'?testRace:[],cxAllRows,cxSeasonRounds:async()=>new Map(),cxIsHidden,CX_SPANISH_AUDIENCE,
    countryFlag:()=>'',buildRaceHeader,teamStripes:()=>'',findMatchingTeam:()=>null,cxLogoImage:()=>null,limitScrollToStickyStart,
    setMeta:(key,value)=>{meta[key]=value;},setMetaProperty:(key,value)=>{meta[key]=value;},
    filterBroadcastsByRegion:rows=>rows,broadcastRegionBadgeLabel:country=>country,seoLongDateWeekday:date=>date,
    cxCategoryTiming:()=>({displayState:'official'}),startlistCyclistHtml:'',resultsTrophyHtml:'',setInterval:()=>1,clearInterval:()=>{}
  });
  const node=(attribute,value)=>nodes.find(node=>node.dataset[attribute]===value);
  const click=(node,options={})=>{
    const event={target:node,button:0,preventDefault:vi.fn(),...options};clicks.click(event);return event;
  };
  return {root,node,click,location,back,buildRaceHeader,cxAllRows,canonical,meta,limitScrollToStickyStart,writes:()=>writes,
    restore:path=>{navigate(path);events.popstate();}};
}

describe('jornada CX integrada',()=>{
  it('en inglés sustituye una carrera nacional por el aviso con enlace a la versión en castellano',async()=>{
    const page=await open('/en/cyclocross/race/',{lang:'en',raceClass:'NAC'});
    expect(page.root.innerHTML).toContain(CX_SPANISH_AUDIENCE.title);
    expect(page.root.innerHTML).toContain('href="/ciclocross/carrera/"');
    expect(page.meta.robots).toBe('noindex');
    expect(page.cxAllRows).not.toHaveBeenCalled();
    const spanish=await open('/ciclocross/carrera/',{raceClass:'NAC'});
    expect(spanish.root.innerHTML).not.toContain(CX_SPANISH_AUDIENCE.title);
  });

  it('mantiene el programa completo cuando falta un mapa o su URL es inválida',async()=>{
    for(const assets of [[],[{type:'map',url:'javascript:alert(1)'}],[{type:'map',url:'https://assets.example/map.pdf?v=2'}],[{type:'map',url:'https://assets.example/map.webp'}]]) {
      const page=await open('/ciclocross/carrera/programa/',{assets});
      expect(page.root.innerHTML).not.toContain('class="cx-programme-layout"');
      expect(page.root.innerHTML).toContain('cx-programme-schedule');
    }
  });
  it('muestra la general como sección propia y redirige los enlaces antiguos de resultados',async()=>{
    const standings=[{category:'ME',rank:1,riderDisplay:'Líder',points:'40'},{category:'WU',rank:1,riderDisplay:'Sub-23',points:'40'}];
    const states=['ME','WU'].map(category=>({category,status:'ready',roundIds:['race']}));
    const none=await open('/ciclocross/carrera/?view=general');
    expect(none.node('cxSectionLink','general')).toBeUndefined();
    expect(none.node('cxSection','results').hidden).toBe(false);
    const page=await open('/ciclocross/carrera/?view=general#WU',{standings,states});
    expect(page.node('cxSection','general').hidden).toBe(false);
    expect(page.node('cxSection','results').hidden).toBe(true);
    expect(page.node('cxGeneral','WU').hidden).toBe(false);
    expect(page.node('cxGeneral','ME').hidden).toBe(true);
    expect(page.node('cxSectionLink','results').attrs.href).toBe('/ciclocross/carrera/resultados/');
    const legacy=await open('/ciclocross/carrera/resultados/#general-WU',{standings,states});
    expect(legacy.location.search).toBe('?view=general');
    expect(legacy.location.hash).toBe('#WU');
    expect(legacy.node('cxSection','general').hidden).toBe(false);
  });
  it('oculta el selector de secciones cuando el programa es la única sección, como en las apps',async()=>{
    const page=await open('/ciclocross/carrera/',{startlist:false,resultCodes:[],videos:false});
    expect(page.root.innerHTML).not.toContain('cx-section-nav');
    expect(page.node('cxSection','programme').hidden).toBe(false);
    const full=await open('/ciclocross/carrera/');
    expect(full.root.innerHTML).toContain('cx-section-nav');
  });
  it('abre Vídeos cuando es la única sección y ofrece el selector desde un programa vacío',async()=>{
    const only=await open('/ciclocross/carrera/',{startlist:false,resultCodes:[],programme:false,broadcasts:[]});
    expect(only.root.innerHTML).not.toContain('cx-section-nav');
    expect(only.node('cxSection','videos').hidden).toBe(false);
    const programme=await open('/ciclocross/carrera/?view=programme',{startlist:false,resultCodes:[],programme:false,broadcasts:[]});
    expect(programme.node('cxSectionLink','videos')).toBeTruthy();
    // Con TV y sin horarios, Programa aparece y abre por delante de Vídeos.
    const tv=await open('/ciclocross/carrera/',{startlist:false,resultCodes:[],programme:false});
    expect(tv.node('cxSectionLink','programme')).toBeTruthy();
    expect(tv.node('cxSection','programme').hidden).toBe(false);
  });
  it('genera la descripción editorial con fecha, clase, ubicación y torneo, sin inventar campos ausentes',()=>{
    const label=()=> 'domingo, 1 de noviembre de 2026';
    expect(cxRaceSeo(race,'race',label)).toEqual({
      title:'Carrera CX - Calendario Ciclismo App',
      description:'Carrera CX (domingo 1 de noviembre de 2026) es una prueba de ciclocross de categoría UCI C1 en Ostende (Bélgica). Pertenece a Circuito CX 2026-27. Consulta el programa, los dorsales y resultados, cómo ver la carrera por TV y online streaming y vídeos de las carreras.'
    });
    const national=cxRaceSeo({...race,class:'NAC',venue:null,countryCode:null,cx_tournaments:null},'startlist',label);
    expect(national.title).toBe('Dorsales · Carrera CX - Calendario Ciclismo App');
    expect(national.description).toContain('de categoría nacional. Consulta');
    expect(national.description).not.toMatch(/null|undefined|Pertenece|UCI NAC/);
  });

  it('genera en inglés el SEO de la página EN, en paridad con el generador',()=>{
    const label=(date,lang)=>lang==='en'?'Sunday, 1 November 2026':'domingo, 1 de noviembre de 2026';
    expect(cxRaceSeo({...race,nameEn:'CX Race'},'results',label,'en')).toEqual({
      title:'Results · CX Race - Calendario Ciclismo App',
      description:'CX Race (Sunday 1 November 2026) is a UCI C1 cyclocross race in Ostende (Belgium). It is part of the Circuito CX 2026-27. See the programme, startlist and results, how to watch the race on TV and online streaming, and race videos.'
    });
    const national=cxRaceSeo({...race,class:'NAC',venue:null,countryCode:null,cx_tournaments:null},'startlist',label,'en');
    expect(national.title).toBe('Startlist · CX Race - Calendario Ciclismo App');
    expect(national.description).toContain('is a national cyclocross race. See');
  });

  it('incluye el país también cuando falta la localidad',()=>{
    const seo=cxRaceSeo({...race,venue:null,countryCode:'ca'},'race',()=> 'domingo, 1 de noviembre de 2026');
    expect(seo.description).toContain('en Canadá.');
    expect(seo.description).not.toMatch(/domingo,|inscritos/i);
  });

  it('no añade un segundo año al nombre ni una segunda temporada al torneo',()=>{
    const seo=cxRaceSeo({...race,name:'Carrera CX 2026',cx_tournaments:{name:'Circuito CX 2026-27'}},'race',date=>date);
    expect(seo.title).toBe('Carrera CX 2026 - Calendario Ciclismo App');
    expect(seo.description.match(/2026-27/g)).toHaveLength(1);
  });

  it('abre resultados y permite acceder a todas las demás secciones sin reconstruir la cabecera ni consultar datos',async()=>{
    const page=await open();
    expect(page.node('cxSection','results').hidden).toBe(false);
    const calls=page.cxAllRows.mock.calls.length;
    for(const section of ['programme','startlist','videos','results']) {
      expect(page.click(page.node('cxSectionLink',section)).preventDefault).toHaveBeenCalledOnce();
      expect(page.node('cxSection',section).hidden).toBe(false);
      for(const other of ['programme','startlist','videos','results'].filter(key=>key!==section))expect(page.node('cxSection',other).hidden).toBe(true);
    }
    expect(page.writes()).toBe(1);
    // Cada cambio de sección limita el scroll al inicio de la barra fija.
    expect(page.limitScrollToStickyStart).toHaveBeenCalledTimes(4);
    expect(page.buildRaceHeader).toHaveBeenCalledOnce();
    expect(page.cxAllRows.mock.calls.length).toBe(calls);
    expect(page.root.innerHTML.match(/href="https:\/\/organizer.example\/"/g)).toHaveLength(1);
    expect(page.buildRaceHeader.mock.calls[0][0].action).toBe('');
    expect(page.root.innerHTML).not.toContain('cx-race-summary');
    expect(page.root.innerHTML).not.toContain(page.meta.description);
    expect(page.root.innerHTML.match(/<h1>/g)).toHaveLength(1);
    expect(page.buildRaceHeader.mock.calls[0][0].race.name).toBe('Carrera CX');
  });

  it('respeta el acceso directo a una sección y vuelve siempre a la home CX',async()=>{
    const page=await open('/ciclocross/carrera/inscritos/#WE'),route=presentation.cxRacePageLocation(page.location.pathname,page.location.search);
    expect(page.node('cxSection',route.page).hidden).toBe(false);
    expect(page.back).toHaveBeenCalledWith({href:'/ciclocross/',label:'cx.back'});
  });

  it('conserva la categoría entre inscritos y resultados y restaura la sección con el historial',async()=>{
    const page=await open('/ciclocross/carrera/resultados/#WE');
    page.click(page.node('cxSectionLink','startlist'));
    expect(page.location.pathname).toBe('/ciclocross/carrera/inscritos/');
    expect(page.location.hash).toBe('#WE');
    expect(page.node('cxStartlistCategory','WE').hidden).toBe(false);
    expect(page.node('cxStartlistCategory','ME').hidden).toBe(true);
    page.click(page.node('cxSectionLink','results'));
    expect(page.node('cxClassificationContent','WE').hidden).toBe(false);
    page.restore('/ciclocross/carrera/?view=programme');
    expect(page.node('cxSection','programme').hidden).toBe(false);
    page.restore('/ciclocross/carrera/resultados/#ME');
    expect(page.node('cxClassificationContent','ME').hidden).toBe(false);
    expect(page.writes()).toBe(1);
  });

  it('no cambia la URL canónica de la raíz por abrir resultados y redacta el SEO en inglés en EN',async()=>{
    const page=await open('/en/cyclocross/race/',{lang:'en'});
    expect(page.canonical.attrs.href).toBe('https://calendariociclismo.app/en/cyclocross/race/');
    expect(page.meta.description).toContain('is a UCI C1 cyclocross race in Ostende (Belgium). It is part of the Circuito CX 2026-27.');
    expect(page.back).toHaveBeenCalledWith({href:'/en/cyclocross/',label:'cx.back'});
    page.click(page.node('cxSectionLink','videos'));
    expect(page.canonical.attrs.href).toBe('https://calendariociclismo.app/en/cyclocross/race/');
  });

  it('prioriza una categoría publicada cuando ME está pendiente y respeta un fragmento explícito',async()=>{
    const page=await open('/ciclocross/carrera/',{resultCodes:['WE']});
    expect(page.node('cxClassificationContent','WE').hidden).toBe(false);
    page.click(page.node('cxClassification','ME'));
    expect(page.node('cxClassificationContent','ME').hidden).toBe(false);
  });

  it('muestra como oficial un resultado DataRide aunque la ingesta siga provisional',async()=>{
    const page=await open('/ciclocross/carrera/resultados/',{categoryStatus:'provisional',resultsSourceUrl:'https://dataride.uci.ch/iframe/Results/',resultsEvidence:{inputSource:'dataride'}});
    expect(page.root.innerHTML).toContain('<span>Oficial</span>');
  });

  it('conserva el comportamiento de enlaces con teclas modificadoras',async()=>{
    const page=await open();
    expect(page.click(page.node('cxSectionLink','programme'),{ctrlKey:true}).preventDefault).not.toHaveBeenCalled();
    expect(page.location.search).toBe('');
  });
});
