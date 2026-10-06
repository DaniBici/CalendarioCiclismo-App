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
  it('abre la carrera CX en la sección indicada sin buscar jornadas de carretera',async()=>{
    const panel=await route('?cxEdit=cx-race&tab=results');
    expect(panel.openCxRaceEditor).toHaveBeenCalledWith('cx-race','results');
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

  it.each(['results','unknown'])('valida la sección %s antes de llamar al editor CX',async section=>{
    const source=cxPanel.match(/export function openCxRaceEditor\([\s\S]*?\n\}/)[0].replace('export ','');
    const editRace=vi.fn();
    await runInNewContext(`${source}\nopenCxRaceEditor('cx-race',section);`,{editRace,section,EDITOR_TAB_KEYS:['identity','results','tv','videos','docs']});
    expect(editRace).toHaveBeenCalledWith({id:'cx-race'},section==='unknown'?'identity':section,null,{fromPublic:true});
  });
});
