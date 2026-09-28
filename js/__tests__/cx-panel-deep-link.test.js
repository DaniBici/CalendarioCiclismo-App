import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';

const panel=readFileSync(new URL('../panel/main.js',import.meta.url),'utf8');
const cxPanel=readFileSync(new URL('../panel/cx.js',import.meta.url),'utf8');
const routing=panel.slice(panel.indexOf('  // Si venimos desde una página pública con query params'),panel.lastIndexOf('\n}\n'));

async function route(search) {
  const openCxRaceEditor=vi.fn(),openEditor=vi.fn(),switchTab=vi.fn();
  const from=vi.fn(()=>({select:()=>({eq:()=>({single:async()=>({data:{dateKey:'2026-10-11'}})})})}));
  await runInNewContext(`(async()=>{${routing}})()`,{
    URLSearchParams,location:{search,pathname:'/panel/app.html',hash:''},history:{replaceState:vi.fn()},
    supabase:{from},panelState:{currentDateKey:'2026-09-14'},datePicker:{},
    setupModals:vi.fn(),setupRacesView:vi.fn(),loadSidebar:vi.fn(),
    ensureRaceYearLoaded:vi.fn(),raceYearFromDateKey:()=>2026,ensureRaceLoadedById:vi.fn(),
    openCxRaceEditor,openEditor,switchTab,_clickEditorTab:vi.fn(),tabFromHash:()=> 'agenda',
  });
  return {openCxRaceEditor,openEditor,switchTab,from};
}

describe('enlace público al editor CX',()=>{
  it.each(['identity','startlist','results','tv','videos'])('abre la carrera CX en %s sin buscar jornadas de carretera',async tab=>{
    const panel=await route(`?cxEdit=cx-race&tab=${tab}`);
    expect(panel.openCxRaceEditor).toHaveBeenCalledWith('cx-race',tab);
    expect(panel.from).not.toHaveBeenCalled();expect(panel.openEditor).not.toHaveBeenCalled();
  });

  it('abre General cuando el enlace no incluye una sección',async()=>{
    const panel=await route('?cxEdit=cx-race');
    expect(panel.openCxRaceEditor).toHaveBeenCalledWith('cx-race','identity');
  });

  it('conserva el enlace de edición de carretera',async()=>{
    const panel=await route('?edit=road-stage&tab=mas');
    expect(panel.openEditor).toHaveBeenCalledWith('road-stage');
    expect(panel.openCxRaceEditor).not.toHaveBeenCalled();
  });

  it.each(['identity','results','tv','startlist','unknown'])('valida la sección %s antes de llamar al editor CX',async section=>{
    const source=cxPanel.match(/export function openCxRaceEditor\([\s\S]*?\n\}/)[0].replace('export ','');
    const editRace=vi.fn();
    await runInNewContext(`${source}\nopenCxRaceEditor('cx-race',section);`,{editRace,section,EDITOR_TAB_KEYS:['identity','results','tv','videos','docs']});
    expect(editRace).toHaveBeenCalledWith({id:'cx-race'},section==='unknown'?'identity':section,null,{fromPublic:true});
  });

  it('carga los catálogos y posiciona la agenda en la carrera sin recuperar la pestaña recordada',async()=>{
    const start=cxPanel.indexOf('async function editRace(');
    const prefix=cxPanel.slice(start,cxPanel.indexOf('    const handle=ctx.openDrawer',start));
    const race={id:'cx-race',seasonKey:'2025-26',dateKey:'2026-01-11',cx_race_categories:[]};
    const catalogs={cx_tournaments:[{id:'tournament'}],cx_teams:[{id:'team'}]};
    const navigate=vi.fn(),getItem=vi.fn(()=> 'results');
    const query={select:()=>query,eq:()=>query,single:()=>query};
    const context={ctx:{supabase:{from:()=>query},navigate,showToast:vi.fn()},
      cxQuery:async()=>race,cxAllRows:async(_client,table)=>catalogs[table],cxDateInSeason:()=>true,
      seasonKey:'2026-27',agendaDateKey:'2026-09-14',tournaments:[],teams:[],activeRaceId:null,
      markAgendaActive:vi.fn(),localStorage:{getItem},EDITOR_TAB_KEYS:['identity','results','tv']};
    const result=await runInNewContext(`(async()=>{${prefix}return {openSection};}catch(error){throw error;}}\nconst result=await editRace({id:'cx-race'},'identity',null,{fromPublic:true});return {...result,seasonKey,agendaDateKey,tournaments,teams};})()`,context);
    expect(result.openSection).toBe('identity');expect(getItem).not.toHaveBeenCalled();
    expect(result.seasonKey).toBe('2025-26');expect(result.agendaDateKey).toBe('2026-01-11');
    expect(result.tournaments).toEqual(catalogs.cx_tournaments);expect(result.teams).toEqual(catalogs.cx_teams);
    expect(navigate).toHaveBeenCalledWith('cxAgenda');
  });
});
