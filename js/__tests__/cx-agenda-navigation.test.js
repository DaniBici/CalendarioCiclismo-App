import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {cxHiddenClasses,cxIsHidden,CX_SPANISH_AUDIENCE} from '../services/cx-data.js';
import {cxSeasonMonths,cxMonthDays,cxEsc,cxRaceName,cxRaceUrl,cxTournamentUrl,cxCategories,cxColor,cxClassLabel,cxRoundBadge,cxUsesCategoryBadges,cxRaceOpen,cxRacePlaceholder,cxPlaceholderMessage,cxRacePageUrl,cxCategoryCardState,cxTime} from '../cx-presentation.js';
import {cxTournamentDescription} from '../cx-tournament-seo.js';

const script=readFileSync(new URL('../ciclocross.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');

// Los fixtures usan fechas de septiembre de 2026. El reloj real del runner
// avanza y acabaría situando esas fechas en el pasado, invirtiendo el mensaje
// de cxPlaceholderMessage. Congelamos SOLO Date (sin tocar temporizadores) en el
// mismo instante que el FixedDate del contexto de la agenda, de modo que el
// mensaje «de futuro» siga siendo determinista.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-12T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

// Exercise the real agenda navigation with empty months and an in-memory DOM/client.
async function open({failure,nextDate=null,tournamentId=null,rows=[],rounds=new Map(),initialHash=null,pinnedFilter=null}={}) {
  const events=new Map(),frames=[],calls=[],metadata=new Map();
  const location={search:'',origin:'http://localhost',hash:initialHash?`#${initialHash}`:''};
  const history={replaceState:(_state,_title,url)=>{if(typeof url==='string'&&url.startsWith('#'))location.hash=url.slice(1);}};
  const window={scrollY:0,addEventListener:(name,fn)=>{
    if(!events.has(name))events.set(name,[]);events.get(name).push(fn);
  },scrollTo:vi.fn(({top})=>{window.scrollY=top;})};
  class Element {
    children=[];dataset={};classList={toggle:()=>{}};offsetHeight=50;
    addEventListener(){}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(){} removeAttribute(){}
    getBoundingClientRect(){return {left:0,right:50,width:50};}
    scrollIntoView(){window.scrollY=0;}
    querySelector(selector){
      if(selector==='[data-month]')return this.children.find(node=>node.dataset.month)??null;
      return null;
    }
    querySelectorAll(){return [];}
  }
  const list=new Element(),bar=new Element(),error=new Element(),navigation=new Element();
  const root=new Element();root.dataset={cxTournamentId:tournamentId};root.style={setProperty:vi.fn()};
  root.querySelector=selector=>({'#cxMonths':list,'#cxMonthBar':bar,'#cxAgendaError':error,'.cx-month-nav':navigation,'.cx-agenda-sticky':navigation}[selector]);
  const cxNextDate=vi.fn(async()=>nextDate);
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:['2026-09-12T12:00:00Z']));} }
  const result=await runInNewContext(`(async()=>{${script}\nreturn {goMonth};})()`,{
    window,URLSearchParams,location,history,Date:FixedDate,Intl,document:{querySelector:()=>null,head:{append:()=>{}},hidden:false,getElementById:()=>root,createElement:()=>new Element(),addEventListener:()=>{}},
    ResizeObserver:class {observe(){}},requestAnimationFrame:fn=>frames.push(fn),setInterval:()=>1,clearInterval:()=>{},
    initCintillo:async()=>{},initI18n:async()=>{},t:key=>key,getLang:()=> 'es',getLocale:()=> 'es-ES',cxSeason:()=> '2026-27',cxSeasonMonths,
    cxMonth:async(_client,_season,year,month)=>{const key=`${year}-${String(month).padStart(2,'0')}`;calls.push(key);if(key===failure)throw Error('Fallo');return rows;},
    cxSeasonRows:async()=>{calls.push('temporada');return rows;},
    cxTournamentMetadata:async()=>({id:tournamentId,name:'Circuito local',slug:'circuito',seasonKey:'2026-27',logoUrl:'https://example.org/logo.svg',countryCode:'ES'}),
    buildRaceHeader:({race})=>`<div class="race-header">${race.name}</div>`,cxRaceName,cxRaceUrl,cxTournamentUrl,cxCategories,cxColor,cxClassLabel,cxUsesCategoryBadges,countryFlag:()=>'',categoryBadge:()=>'',
    setMeta:(key,value)=>metadata.set(key,value),setMetaProperty:(key,value)=>metadata.set(key,value),cxNextDate,cxHiddenClasses,cxIsHidden,CX_SPANISH_AUDIENCE,supabase:{},dateNavigationButton:()=>new Element(),cxMonthDays,esc:cxEsc,cxTournamentDescription,
    formatDateLabel:key=>key,
    cxSeasonRounds:vi.fn(async()=>rounds),cxRoundBadge,
    cxRaceOpen,cxRacePlaceholder,cxPlaceholderMessage,cxRacePageUrl,openPhBanner:vi.fn(),wirePhDescriptions:vi.fn(),
    getPinnedFilter:()=>pinnedFilter,renderFilterPins:()=>{},handleFilterEvent:()=>null,setPressed:()=>{},
    cxCategoryCardState,cxTime,cxCategoryTiming:()=>({displayState:'time',temporalState:'scheduled'}),waitingResultsHtml:(lang,tag)=>`<${tag}></${tag}>`,resultsTrophyHtml:'<span></span>',
  });
  const flush=()=>{while(frames.length)frames.shift()();};flush();
  return {...result,root,list,error,calls,metadata,cxNextDate,window,location,flush,scroll:y=>{window.scrollY=y;for(const fn of events.get('scroll')??[])fn();}};
}

describe('apertura de la agenda CX: siempre al próximo día con carreras',()=>{
  it('abre el mes del próximo día con carreras y descarta la posición guardada',async()=>{
    const agenda=await open({nextDate:'2027-01-30'});
    expect(agenda.calls).toEqual(['2026-09','2027-01']);
    expect(agenda.cxNextDate).toHaveBeenCalledOnce();
    expect(agenda.list.children.map(node=>node.dataset.month)).toEqual(['2027-01']);
  });

  it('mantiene el mes en curso cuando el próximo día con carreras cae en él',async()=>{
    const agenda=await open({nextDate:'2026-09-19'});
    expect(agenda.calls).toEqual(['2026-09']);
    expect(agenda.cxNextDate).toHaveBeenCalledWith({},'2026-27','2026-09-12',null,[]);
    expect(agenda.list.children.map(node=>node.dataset.month)).toEqual(['2026-09']);
  });

  it('si no quedan días con carreras en el mes, salta al mes siguiente',async()=>{
    const agenda=await open({nextDate:'2026-10-04'});
    expect(agenda.calls).toEqual(['2026-09','2026-10']);
    expect(agenda.list.children.map(node=>node.dataset.month)).toEqual(['2026-10']);
  });

  it('mantiene el mes anterior si falla el cambio manual de mes',async()=>{
    const agenda=await open({failure:'2026-11',nextDate:'2026-09-19'});
    await agenda.goMonth('2026-11');agenda.flush();
    expect(agenda.error.textContent).toContain('Fallo');
    expect(agenda.list.children.map(node=>node.dataset.month)).toEqual(['2026-09']);
  });

  it('abre el mes indicado en el marcador de la URL',async()=>{
    const agenda=await open({nextDate:'2026-09-19',initialHash:'2026-10'});
    expect(agenda.calls).toEqual(['2026-10']);
    expect(agenda.list.children.map(node=>node.dataset.month)).toEqual(['2026-10']);
    expect(agenda.cxNextDate).not.toHaveBeenCalled();
    expect(agenda.location.hash).toBe('2026-10');
  });

  it('escribe el mes abierto en el marcador de la URL',async()=>{
    const agenda=await open({nextDate:'2027-01-30'});
    expect(agenda.list.children.map(node=>node.dataset.month)).toEqual(['2027-01']);
    expect(agenda.location.hash).toBe('2027-01');
  });

  it('muestra el torneo en texto sin enlazar su nombre',async()=>{
    const tournament={id:'t',name:'Circuito local',slug:'circuito'};
    const race={id:'a',name:'Prueba del circuito',slug:'prueba-a',dateKey:'2026-09-19',seasonKey:'2026-27',tournamentId:'t',cx_tournaments:tournament,cx_race_categories:[]};
    const agenda=await open({nextDate:'2026-09-19',rows:[race]});
    const html=agenda.list.children[0].innerHTML;
    expect(html).toContain('class="race-card__sub">Circuito local');
    expect(html).not.toContain('>Circuito local</a>');
    expect(html).toContain('class="race-card__overview-btn"');
  });
});


describe('página de torneo con todas las pruebas en una sola página',()=>{
  const tournament={id:'t',name:'Circuito local',slug:'circuito'};
  const rows=[{id:'a',name:'Prueba del circuito',slug:'prueba-a',dateKey:'2026-09-19',seasonKey:'2026-27',tournamentId:'t',cx_tournaments:tournament,cx_race_categories:[]},
    {id:'b',name:'Prueba de enero',slug:'prueba-b',dateKey:'2027-01-30',seasonKey:'2026-27',tournamentId:'t',cx_tournaments:tournament,cx_race_categories:[]},
    {id:'c',name:'Otra prueba',slug:'prueba-c',dateKey:'2026-09-19',seasonKey:'2026-27',tournamentId:'otro',cx_tournaments:tournament,cx_race_categories:[]}];
  it('carga la temporada una vez y reúne las fechas sin agrupaciones por mes ni torneo en las cards',async()=>{
    const agenda=await open({tournamentId:'t',rows,nextDate:'2027-01-30',pinnedFilter:'big'});
    expect(agenda.calls).toEqual(['temporada']);
    expect(agenda.root.innerHTML).toContain('class="race-header"');
    expect(agenda.root.innerHTML).not.toContain('cx-month-nav');
    expect(agenda.root.innerHTML).not.toContain('cxAgendaFilters');
    expect(agenda.root.style.setProperty).toHaveBeenCalledWith('--cx-agenda-nav-h','50px');
    expect(agenda.list.children).toHaveLength(1);
    expect(agenda.list.children[0].className).toBe('cx-tournament-list');
    expect(agenda.list.children[0].dataset.month).toBeUndefined();
    expect(agenda.list.children[0].innerHTML).toContain('Prueba del circuito');
    const html=agenda.list.children[0].innerHTML;
    expect(html).toContain('Prueba de enero');
    expect(html).not.toContain('Otra prueba');
    expect(html).not.toContain('cx-month');
    expect(html).not.toContain('Circuito local');
    expect(html).not.toContain('race-card__overview-btn');
    expect(html.indexOf('data-date="2026-09-19"')).toBeLessThan(html.indexOf('Prueba del circuito'));
    expect(html.indexOf('data-date="2027-01-30"')).toBeLessThan(html.indexOf('Prueba de enero'));
    const description='El Circuito local abarca 2 pruebas del 19 de septiembre al 30 de enero. Consulta fechas, horarios, resultados y cómo ver por TV y online streaming.';
    for(const key of ['description','og:description','twitter:description'])expect(agenda.metadata.get(key)).toBe(description);
    expect(agenda.cxNextDate).toHaveBeenCalledWith({},'2026-27','2026-09-12','t',[]);
  });
  it('muestra el aviso vacío si el torneo no tiene pruebas',async()=>{
    const agenda=await open({tournamentId:'t',rows:[rows[2]]});
    expect(agenda.list.innerHTML).toContain('empty-state');
    expect(agenda.list.innerHTML).toContain('cx.noRaces');
  });

  it('condensa la prueba cancelada: badge Cancelada y sin categorías',async()=>{
    const cancelled={id:'can',name:'Prueba cancelada',slug:'cancelada',dateKey:'2026-09-19',seasonKey:'2026-27',tournamentId:'t',isCancelled:true,
      cx_race_categories:[{category:'ME',dateKey:'2026-09-19',startTimeUtc:'2026-09-19T13:00:00Z'}]};
    const agenda=await open({tournamentId:'t',rows:[cancelled],nextDate:'2026-09-19'});
    const html=agenda.list.children.map(node=>node.innerHTML).join('');
    expect(html).toContain('badge--cancelled-day');
    expect(html).not.toContain('cx-category-times');
    expect(html).not.toContain('line-through');
  });

  it('pinta placeholder la prueba sin carga mínima y card clicable la que la tiene',async()=>{
    const ready={id:'ok',name:'Prueba lista',slug:'prueba-lista',dateKey:'2026-09-19',seasonKey:'2026-27',tournamentId:'t',
      assets:[{type:'technicalGuide',url:'https://assets.example.org/guia.pdf'}],
      cx_race_categories:[{category:'ME',dateKey:'2026-09-19',startTimeUtc:'2026-09-19T13:00:00Z'}]};
    // Sin documento ni horarios, la clasificación publicada de una manga basta.
    const published={id:'res',name:'Prueba con clasificación',slug:'prueba-res',dateKey:'2026-09-19',seasonKey:'2026-27',tournamentId:'t',
      cx_race_categories:[{category:'ME',dateKey:'2026-09-19',resultsStatus:'official'}]};
    const agenda=await open({tournamentId:'t',rows:[ready,published,rows[0]],nextDate:'2026-09-19'});
    const html=agenda.list.children.map(node=>node.innerHTML).join('');
    const cards=html.split('<article').slice(1);
    const readyCard=cards.find(card=>card.includes('data-cx-logo-race="ok"'))??'';
    const publishedCard=cards.find(card=>card.includes('data-cx-logo-race="res"'))??'';
    const placeholderCard=cards.find(card=>card.includes('data-cx-logo-race="a"'))??'';
    // La prueba con Libro de Ruta y horarios enlaza a la ficha, con chevron.
    expect(readyCard).toContain('data-href="/ciclocross/prueba-lista/"');
    expect(readyCard).toContain('<a href="/ciclocross/prueba-lista/">Prueba lista</a>');
    expect(readyCard).toContain('cx-card-chevron');
    expect(readyCard).not.toContain('race-card--placeholder');
    expect(readyCard).not.toContain('data-ph-tooltip');
    // La prueba con clasificación publicada también enlaza, sin documento ni horarios.
    expect(publishedCard).toContain('data-href="/ciclocross/prueba-res/"');
    expect(publishedCard).toContain('<a href="/ciclocross/prueba-res/">Prueba con clasificación</a>');
    expect(publishedCard).toContain('cx-card-chevron');
    expect(publishedCard).not.toContain('race-card--placeholder');
    expect(publishedCard).not.toContain('data-ph-tooltip');
    // La prueba sin documento ni horarios es placeholder: sin enlaces, con aviso.
    expect(placeholderCard).toContain('race-card--placeholder');
    expect(placeholderCard).not.toContain('data-href');
    expect(placeholderCard).toContain('data-ph-tooltip="Por ahora sin información extra"');
    expect(placeholderCard).toContain('<span>Prueba del circuito</span>');
    expect(placeholderCard).toContain('race-card__seo-link');
    expect(placeholderCard).not.toContain('cx-card-chevron');
  });
});
