import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';

const source=readFileSync(new URL('../panel/highlights.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function _onHighlightRaceSearch()'),source.indexOf('function _resolveHighlightDisplay(h)'));
const state=source.slice(source.indexOf('let _highlightEditor ='),source.indexOf('// ── Helpers de fecha+hora'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

// Runs the actual shared editor functions with replaceable DOM controls and an in-memory client.
function harness({fills=[],writes=[],confirmations=[],days=[]}={}) {
  let nodes=new Map(),radios=[],current=null,uuid=0;
  const logs=[],rows=new Map(),handles=[];
  const makeNode=()=>({value:'',textContent:'',innerHTML:'',hidden:false,checked:false,disabled:false,style:{},
    listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);},querySelectorAll:()=>[]});
  const body={set innerHTML(html){nodes=new Map();for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes.set(id,makeNode());
    radios=[...html.matchAll(/name="hl-targetType" value="([^"]+)"( checked)?/g)].map(([,value,checked])=>({...makeNode(),value,checked:!!checked}));},
    querySelector:selector=>nodes.get(selector.slice(1)),querySelectorAll:()=>[...nodes.values(),...radios],setAttribute:vi.fn()};
  const close=()=>{const old=current;current=null;old?.onClose?.();body.innerHTML='';};
  const document={getElementById:id=>nodes.get(id)??null,querySelectorAll:()=>radios,
    querySelector:selector=>selector.includes(':checked')?radios.find(r=>r.checked):new Proxy(radios.find(r=>r.value===selector.match(/value="([^"]+)"/)?.[1]),{set(node,key,value){if(key==='checked'&&value)radios.forEach(r=>{r.checked=false;});node[key]=value;return true;}})};
  const context={document,crypto:{randomUUID:()=>`local-highlight-${++uuid}`},_highlightsCache:[],_highlightRaceDaysCache:{},panelState:{allRaces:[{id:'road-a',name:'Ruta A'},{id:'road-b',name:'Ruta B'}]},
    setTimeout,clearTimeout,esc:value=>value,countryFlag:()=>'',_toDatetimeLocal:value=>value??'',_fromDatetimeLocal:value=>value||null,
    openDrawer:options=>{current?.onClose?.();const handle={body,onClose:options.onClose,isCurrent:()=>current===handle,close:()=>{if(current===handle)close();}};current=handle;handles.push(handle);options.render(body);return handle;},
    closeDrawer:close,attachInlineUpload:vi.fn(),showToast:vi.fn(),fetchHighlights:vi.fn(async()=>[...rows.values()]),_prefetchHighlightsRaceDays:vi.fn(async()=>{}),renderHighlightsList:vi.fn(),panelArea:()=> 'road',
    fillCxRaceSelect:vi.fn(async(_client,node,selected)=>{const next=fills.shift();if(next)await next.promise;node.innerHTML='<option>Prueba CX</option>';node.value=selected||'';}),
    fillCxTournamentSelect:vi.fn(async(_client,node,selected)=>{node.innerHTML='<option>Torneo CX</option>';node.value=selected||'';}),
    _fetchRaceDaysForHighlight:vi.fn(async id=>{const next=days.shift();return next?await next.promise:[{id:`day-${id}`}];}),
    confirmDialog:vi.fn(async()=>{const next=confirmations.shift();return next?await next.promise:true;}),
    supabase:{from:table=>({
      update:payload=>({eq:async(_key,id)=>{logs.push({kind:'update',table,id,payload});const next=writes.shift();if(next)await next.promise;rows.set(id,{...rows.get(id),...payload,id});return {};}}),
      upsert:async payload=>{logs.push({kind:'upsert',table,id:payload.id,payload});rows.set(payload.id,payload);const next=writes.shift();if(next)await next.promise;return {};},
      delete:()=>({eq:async(_key,id)=>{logs.push({kind:'delete',table,id});const next=writes.shift();if(next)await next.promise;rows.delete(id);return {};}}),
      select:()=>({eq:()=>({single:async()=>({data:{raceId:'road-a'}})})}),
    })},
  };
  const api=runInNewContext(`${state}\n${code}\n({open:openHighlightEditor,close:closeHighlightEditor,save:saveHighlight,remove:deleteHighlight,select:_selectHighlightRace});`,context);
  const setType=type=>radios.forEach(r=>{r.checked=r.value===type;});
  return {...api,context,logs,rows,handles,node:id=>nodes.get(id),setType,isOpen:()=>!!current};
}
const cx={id:'old-highlight',targetType:'cxRace',cxRaceId:'cx-a',customTitle:'Título CX',customTitleEn:'CX title',customDetail:'Detalle',position:3};

describe('consultas y escrituras del editor común de Cintillo',()=>{
  it('descarta el error de una consulta CX al cerrar y abrir otro destacado',async()=>{
    const old=deferred(),h=harness({fills:[old]});const opening=h.open(cx);h.close();await h.open({...cx,id:'new-highlight'});
    h.node('highlightSaveStatus').textContent='Borrador vigente';h.node('hl-customTitle').value='Título nuevo';
    old.reject(Error('Consulta retirada'));await opening;
    expect(h.node('highlightSaveStatus').textContent).toBe('Borrador vigente');expect(h.node('hl-customTitle').value).toBe('Título nuevo');expect(h.isOpen()).toBe(true);
  });
  it('no borra la carrera y jornada del segundo editor al completar la consulta CX anterior',async()=>{
    const old=deferred(),h=harness({fills:[old]});const opening=h.open(cx);await h.open({id:'new-highlight',targetType:'race',raceId:'road-b'});
    expect(h.node('hl-race-selected-name').textContent).toBe('Ruta B');h.node('hl-raceDayId').value='day-road-b';
    old.resolve();await opening;
    expect(h.node('hl-raceDayId').value).toBe('day-road-b');expect(h.node('hl-race-selected').style.display).toBe('flex');
  });
  it('una respuesta de jornadas anterior no sustituye la selección de carretera vigente',async()=>{
    const old=deferred(),h=harness({days:[old]});await h.open(cx);h.setType('raceDay');
    const selecting=h.select(h.context.panelState.allRaces[0]);await h.select(h.context.panelState.allRaces[1]);
    old.resolve([{id:'stale-day'}]);await selecting;
    expect(h.node('hl-raceDayId').innerHTML).toContain('day-road-b');expect(h.node('hl-raceDayId').innerHTML).not.toContain('stale-day');
  });
  it('permite reintentar la carga CX manteniendo títulos y destino, y guarda sus referencias',async()=>{
    const failing=deferred(),h=harness({fills:[failing]});const opening=h.open(cx);failing.reject(Error('Catálogo no disponible'));await opening;
    expect(h.node('hl-cx-retry').hidden).toBe(false);expect(h.node('hl-customTitle').value).toBe('Título CX');
    h.node('hl-cx-retry').listeners.get('click')();await vi.waitFor(()=>expect(h.node('hl-cx-race-id').disabled).toBe(false));
    expect(h.node('hl-cx-race-id').value).toBe('cx-a');
    await h.save();expect(h.logs[0]).toMatchObject({kind:'update',id:'old-highlight',payload:{targetType:'cxRace',cxRaceId:'cx-a',raceId:null,raceDayId:null,customTitle:'Título CX',customTitleEn:'CX title',customDetail:'Detalle'}});
    expect(h.isOpen()).toBe(false);
  });
  it('bloquea doble guardado y conserva un ID en el reintento tras perder la respuesta de un alta',async()=>{
    const lost=deferred(),h=harness({writes:[lost]});await h.open(null);h.setType('cxRace');h.node('hl-cx-race-id').value='cx-a';h.node('hl-customTitle').value='Alta CX';
    const saving=h.save();expect(h.node('saveHighlightBtn').disabled).toBe(true);await h.save();expect(h.logs).toHaveLength(1);
    lost.reject(Error('Respuesta perdida'));await saving;
    expect(h.node('saveHighlightBtn').disabled).toBe(false);expect(h.node('hl-customTitle').value).toBe('Alta CX');
    await h.save();expect(h.logs).toHaveLength(2);expect(h.logs[0].id).toBe(h.logs[1].id);expect(h.rows.size).toBe(1);
  });
  it('un guardado anterior termina sin cerrar ni modificar el nuevo borrador',async()=>{
    const old=deferred(),h=harness({writes:[old]});await h.open(cx);const saving=h.save();h.close();await h.open({...cx,id:'new-highlight'});
    h.node('hl-customTitle').value='Borrador nuevo';old.resolve();await saving;
    expect(h.node('hl-customTitle').value).toBe('Borrador nuevo');expect(h.isOpen()).toBe(true);expect(h.context.showToast).not.toHaveBeenCalled();
    expect(h.logs[0].id).toBe('old-highlight');
  });
  it('una confirmación antigua no elimina el destacado que se abre después',async()=>{
    const old=deferred(),h=harness({confirmations:[old]});await h.open(cx);const removing=h.remove();h.close();await h.open({...cx,id:'new-highlight'});
    old.resolve(true);await removing;expect(h.logs).toHaveLength(0);expect(h.isOpen()).toBe(true);
  });
  it('cancelar eliminación conserva el formulario y confirmar elimina su propio ID',async()=>{
    const cancel=deferred(),h=harness({confirmations:[cancel]});await h.open(cx);const removing=h.remove();cancel.resolve(false);await removing;
    expect(h.logs).toHaveLength(0);expect(h.isOpen()).toBe(true);await h.remove();expect(h.logs[0]).toMatchObject({kind:'delete',id:'old-highlight'});expect(h.isOpen()).toBe(false);
  });
  it('cerrar sin sustituto descarta una consulta fallida sin acceder a controles retirados',async()=>{
    const pending=deferred(),h=harness({fills:[pending]});const opening=h.open(cx);h.close();
    pending.reject(Error('Consulta tardía'));await expect(opening).resolves.toBeUndefined();expect(h.isOpen()).toBe(false);
  });
  it('un error de edición conserva el payload y permite guardar de nuevo en el mismo destacado',async()=>{
    const failing=deferred(),h=harness({writes:[failing]});await h.open(cx);h.node('hl-customDetail').value='Nuevo detalle';
    const saving=h.save();failing.reject(Error('Escritura fallida'));await saving;
    expect(h.node('highlightSaveStatus').textContent).toBe('Error: Escritura fallida');expect(h.node('hl-customDetail').value).toBe('Nuevo detalle');
    await h.save();expect(h.logs.map(row=>row.id)).toEqual(['old-highlight','old-highlight']);expect(h.rows.get('old-highlight').customDetail).toBe('Nuevo detalle');
  });
  it('una selección CX vacía no envía escritura ni pierde los campos',async()=>{
    const h=harness();await h.open(cx);h.node('hl-cx-race-id').value='';await h.save();
    expect(h.logs).toHaveLength(0);expect(h.node('highlightSaveStatus').textContent).toBe('Selecciona una carrera de ciclocross.');expect(h.node('hl-customTitle').value).toBe('Título CX');
  });
});
