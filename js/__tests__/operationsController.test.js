import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,expect,it,vi} from 'vitest';
import * as monitor from '../services/operations-monitor.js';

const source=readFileSync(new URL('../panel.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let _operationsReady ='),source.indexOf("// ── Subvista de la pestaña Carreras:"));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const snapshot=(revision,queues={})=>({generatedAt:'2026-09-12T20:00:00Z',queues,runs:[{job:'cx_results',status:'noop',revision,startedAt:'2026-09-12T20:00:00Z',finishedAt:'2026-09-12T20:00:01Z'}]});

function harness({reads=[],writes=[],confirmations=[]}={}) {
  let buttons=[];
  const nodes=new Map(),calls=[];
  const node=()=>({innerHTML:'',textContent:'',disabled:false,style:{display:'flex'},addEventListener:vi.fn()});
  for(const id of ['operationsRefreshBtn','operationsUpdated','operationsJobs','operationsSources','operationsHistory'])nodes.set(id,node());
  Object.defineProperty(nodes.get('operationsJobs'),'innerHTML',{get(){return this.html||'';},set(html){this.html=html;buttons=[...html.matchAll(/<button[^>]*data-job="([^"]+)"([^>]*)>([\s\S]*?)<\/button>/g)].map(([,job,attributes,label])=>({...node(),dataset:{job},disabled:attributes.includes('disabled'),textContent:label.trim()}));}});
  const context={...monitor,URL,window:{setInterval:vi.fn()},document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>buttons},
    esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),showToast:vi.fn(),
    confirmDialog:vi.fn(async()=>{const next=confirmations.shift();return next?await next.promise:true;}),
    supabase:{rpc:vi.fn(async name=>{calls.push(name);const next=(name==='admin_get_automation_monitor'?reads:writes).shift();return next?await next.promise:{data:name==='admin_get_automation_monitor'?snapshot('current'):{}};})}};
  const api=runInNewContext(`${code}\n({refresh:refreshOperationsMonitor,force:_operationsForce,render:_operationsRenderJobs})`,context);
  return {...api,context,calls,node:id=>nodes.get(id),button:job=>buttons.find(b=>b.dataset.job===job)};
}

describe('operaciones compartidas de carretera y CX',()=>{
  it('una lectura antigua no sustituye la cola y revisión de una lectura más reciente',async()=>{
    const old=deferred(),fresh=deferred(),h=harness({reads:[old,fresh]});const first=h.refresh(),second=h.refresh();
    fresh.resolve({data:snapshot('fresh-revision',{cx_results:{pending:1}})});await second;
    old.resolve({data:snapshot('old-revision')});await first;
    expect(h.node('operationsJobs').innerHTML).toContain('fresh-revis');expect(h.node('operationsJobs').innerHTML).not.toContain('old-revision');
    expect(h.button('cx_results').disabled).toBe(true);
  });
  it('un error anterior no borra el monitor recuperado ni reactiva una lectura vigente',async()=>{
    const old=deferred(),fresh=deferred(),h=harness({reads:[old,fresh]});const first=h.refresh(),second=h.refresh();
    old.reject(Error('Fallo retirado'));await first;expect(h.node('operationsRefreshBtn').disabled).toBe(true);
    fresh.resolve({data:snapshot('recovered')});await second;
    expect(h.node('operationsJobs').innerHTML).toContain('recovered');expect(h.node('operationsUpdated').textContent).not.toContain('No se pudo');
  });
  it('doble pulsación y redibujado durante una consulta CX encolan una sola petición',async()=>{
    const confirmation=deferred(),write=deferred(),h=harness({confirmations:[confirmation],writes:[write]});h.render(snapshot('initial'));
    const first=h.force('cx_results',h.button('cx_results'));h.render(snapshot('during-confirmation'));
    const second=h.force('cx_results',h.button('cx_results'));confirmation.resolve(true);
    await vi.waitFor(()=>expect(h.calls.filter(n=>n==='cx_enqueue_results_fetch')).toHaveLength(1));
    h.render(snapshot('during-write'));expect(h.button('cx_results').disabled).toBe(true);
    write.resolve({data:{}});await Promise.all([first,second]);
    expect(h.calls.filter(n=>n==='cx_enqueue_results_fetch')).toHaveLength(1);
    expect(h.context.showToast).toHaveBeenCalledWith('Pasada de resultados CX encolada','success',4000);
  });
  it('cancelar no consulta el VPS y conserva el botón disponible',async()=>{
    const confirmation=deferred(),h=harness({confirmations:[confirmation]});h.render(snapshot('initial'));
    const forcing=h.force('cx_results',h.button('cx_results'));confirmation.resolve(false);await forcing;
    expect(h.calls).toEqual([]);expect(h.button('cx_results').disabled).toBe(false);
  });
  it('un fallo de encolado permite reintento CX sin usar la RPC de carretera',async()=>{
    const write=deferred(),h=harness({writes:[write]});h.render(snapshot('initial'));
    const forcing=h.force('cx_results',h.button('cx_results'));write.resolve({error:{message:'Cola no disponible'}});await forcing;
    expect(h.button('cx_results').disabled).toBe(false);await h.force('cx_results',h.button('cx_results'));
    expect(h.calls.filter(n=>n!=='admin_get_automation_monitor')).toEqual(['cx_enqueue_results_fetch','cx_enqueue_results_fetch']);
    expect(h.context.showToast).toHaveBeenCalledWith('No se pudo encolar la pasada: Cola no disponible','error');
  });
  it('conserva las RPC de carretera y TV y la cola ya aceptada',async()=>{
    const queued=deferred(),h=harness({reads:[queued]});h.render(snapshot('initial'));
    const forcing=h.force('results',h.button('results'));queued.resolve({data:snapshot('accepted',{results:{pending:1}})});await forcing;
    expect(h.calls).toEqual(['admin_trigger_results_sync','admin_get_automation_monitor']);expect(h.button('results').disabled).toBe(true);
    await h.force('broadcasts',h.button('broadcasts'));expect(h.calls).toContain('admin_trigger_broadcasts_sync');
  });
});
