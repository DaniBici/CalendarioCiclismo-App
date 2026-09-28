import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,expect,it,vi} from 'vitest';
import {resolveCxPushTarget,cxPushAudienceLabel,cxPushSubscriberQuery} from '../cx/push.js';

const source=readFileSync(new URL('../panel/notifications.js',import.meta.url),'utf8').replace(/^export /gm,'');
const setup=source.slice(source.indexOf('let _notificationsInitialized ='),source.indexOf('/** Carga los dispositivos registrados'));
const sending=source.slice(source.indexOf('function _clearPushForm()'),source.indexOf('async function loadScheduledNotifications()'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

function harness({fills=[],counts=[],confirmations=[],responses=[],area='road'}={}) {
  let areaKey=area;
  const nodes=new Map(),queries=[];
  const card={querySelectorAll:()=>[...nodes.values()].filter(n=>['INPUT','SELECT','BUTTON'].includes(n.tagName))};
  for(const [,tag,id] of readFileSync(new URL('../../panel/app.html',import.meta.url),'utf8').matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) {
    const node={tagName:tag.toUpperCase(),value:'',textContent:'',innerHTML:'',disabled:false,checked:false,hidden:false,style:{},dataset:{},listeners:new Map(),
      addEventListener(name,fn){this.listeners.set(name,[...(this.listeners.get(name)||[]),fn]);},
      dispatch(name){return Promise.all((this.listeners.get(name)||[]).map(fn=>fn({target:this})));},closest:()=>card,querySelector:()=>({}),setAttribute:vi.fn(),removeAttribute:vi.fn()};
    nodes.set(id,node);
  }
  const context={URL,Date,setTimeout,clearTimeout,console,resolveCxPushTarget,cxPushAudienceLabel,cxPushSubscriberQuery,
    panelArea:()=>areaKey,
    document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[],createElement:()=>({})},
    panelState:{allRaces:[]},MARKET_SEASON:2027,esc:value=>String(value??''),countryFlag:()=>'',uciRankSimple:()=>0,stageLabel:()=>'',
    showToast:vi.fn(),loadPushHistory:vi.fn(),loadScheduledNotifications:vi.fn(),loadSubscriberCount:vi.fn(),_loadPushDebugDevices:vi.fn(),
    fillCxRaceSelect:vi.fn(async(_client,node,selected='',options={})=>{const next=fills.shift();const rows=next?await next.promise:['cx-a','cx-b'];
      if(options.isCurrent&&!options.isCurrent())return;node.innerHTML=rows.join(',');node.value=selected&&rows.includes(selected)?selected:'';}),
    confirmDialog:vi.fn(async()=>{const next=confirmations.shift();return next?await next.promise:false;}),
    SEND_PUSH_FN:'https://local.invalid/send-push',getAuthHeaders:vi.fn(async()=>({})),
    fetch:vi.fn(async()=>{const next=responses.shift();return next?await next.promise:{ok:true,json:async()=>({sent:1,totalDevices:1})};}),
    supabase:{from:table=>{const query={table,filters:[],select(columns,options){this.columns=columns;this.options=options;return this;},
      eq(key,value){this.filters.push([key,value]);return this;},in(key,value){this.filters.push([key,value]);return this;},
      then(resolve,reject){queries.push(this);const next=counts.shift();return (next?next.promise:Promise.resolve({count:1})).then(resolve,reject);}};return query;}},
  };
  const api=runInNewContext(`${setup}\n${sending}\n({setup:setupNotificationsView,clear:_clearPushForm,target:getPushAudienceTarget,send:sendPushNotification})`,context);
  const select=async(value)=>{nodes.get('push-deepLinkType').value=value;await nodes.get('push-deepLinkType').dispatch('change');};
  return {...api,context,queries,node:id=>nodes.get(id),select,setArea:value=>{areaKey=value;}};
}

describe('destinos CX del formulario común de Notificaciones',()=>{
  it('borra la carrera anterior al limpiar y bloquea un destino CX mientras carga',async()=>{
    const read=deferred(),h=harness({fills:[read]});await h.setup();h.node('push-deepLinkCxRace').value='cx-a';h.clear();await h.select('cxRace');
    expect(h.node('push-deepLinkCxRace').value).toBe('');expect(h.node('push-deepLinkCxRace').disabled).toBe(true);
    expect(()=>h.target()).toThrow();h.node('push-title').value='Borrador';await h.send();expect(h.context.fetch).not.toHaveBeenCalled();
    read.resolve(['cx-a']);await settle();
  });
  it('una carga antigua no sustituye la selección CX vigente',async()=>{
    const old=deferred(),fresh=deferred(),h=harness({fills:[old,fresh]});await h.setup();await h.select('cxRace');await h.select('tab');await h.select('cxRace');
    fresh.resolve(['cx-b']);await settle();h.node('push-deepLinkCxRace').value='cx-b';await h.node('push-deepLinkCxRace').dispatch('change');
    old.resolve(['cx-a']);await settle();expect(h.node('push-deepLinkCxRace').value).toBe('cx-b');expect(h.target()).toMatchObject({category:'cyclocross',cxRaceId:'cx-b',deepLink:'cxRace/cx-b'});
  });
  it('descarta un error de catálogo anterior y permite recuperar el catálogo vigente',async()=>{
    const old=deferred(),h=harness({fills:[old]});await h.setup();await h.select('cxRace');await h.select('tab');
    h.node('push-deepLinkTab').value='cyclocross';old.reject(Error('Consulta retirada'));await settle();
    expect(h.context.showToast).not.toHaveBeenCalled();expect(h.target()).toMatchObject({category:'cyclocross',deepLink:'cyclocross'});
    await h.select('cxRace');await settle();expect(h.node('push-deepLinkCxRace').disabled).toBe(false);
  });
  it('doble pulsación durante el recuento y confirmación no duplica la petición',async()=>{
    const count=deferred(),confirmation=deferred(),h=harness({counts:[count],confirmations:[confirmation]});await h.setup();
    h.node('push-title').value='Aviso CX';await h.select('cxRace');await settle();h.node('push-deepLinkCxRace').value='cx-a';
    const first=h.send();await settle();const second=h.send();expect(h.node('sendPushBtn').disabled).toBe(true);expect(h.node('push-title').disabled).toBe(true);
    count.resolve({count:2});await settle();expect(h.context.confirmDialog).toHaveBeenCalledTimes(1);confirmation.resolve(true);await Promise.all([first,second]);
    expect(h.context.fetch).toHaveBeenCalledTimes(1);expect(h.queries).toHaveLength(1);expect(h.queries[0].filters).toContainEqual(['push_cx_race_subscriptions.raceId','cx-a']);
    const payload=JSON.parse(h.context.fetch.mock.calls[0][1].body);expect(payload).toMatchObject({title:'Aviso CX',category:'cyclocross',cxRaceId:'cx-a',deepLink:'cxRace/cx-a'});
    expect(h.node('sendPushBtn').disabled).toBe(false);expect(h.node('push-title').value).toBe('');expect(h.node('push-deepLinkCxRace').value).toBe('');
  });
  it('cancelar la confirmación conserva borrador y destino sin enviar',async()=>{
    const h=harness();await h.setup();h.node('push-title').value='Conservar';await h.select('cxRace');await settle();h.node('push-deepLinkCxRace').value='cx-a';await h.send();
    expect(h.context.fetch).not.toHaveBeenCalled();expect(h.node('push-title').value).toBe('Conservar');expect(h.node('push-deepLinkCxRace').value).toBe('cx-a');expect(h.node('sendPushBtn').disabled).toBe(false);
  });
  it('un catálogo fallido impide usar el destino anterior y permite reintento',async()=>{
    const failing=deferred(),h=harness({fills:[failing]});await h.setup();h.node('push-deepLinkCxRace').value='cx-a';await h.select('cxRace');
    failing.reject(Error('Catálogo no disponible'));await settle();expect(()=>h.target()).toThrow();expect(h.node('push-title').disabled).toBe(false);
    await h.select('tab');await h.select('cxRace');await settle();expect(h.node('push-deepLinkCxRace').disabled).toBe(false);
  });
  it('un fallo de envío conserva los campos y permite reintentar el mismo destino',async()=>{
    const confirmation=deferred(),failed=deferred(),h=harness({confirmations:[confirmation],responses:[failed]});await h.setup();
    h.node('push-title').value='Reintentar';await h.select('cxRace');await settle();h.node('push-deepLinkCxRace').value='cx-a';
    const sending=h.send();await settle();confirmation.resolve(true);failed.resolve({ok:false,json:async()=>({error:'Fallo local'})});await sending;
    expect(h.node('push-title').value).toBe('Reintentar');expect(h.node('push-deepLinkCxRace').value).toBe('cx-a');expect(h.node('sendPushBtn').disabled).toBe(false);
    expect(h.node('pushSendError').textContent).toBe('Fallo local');
  });
  it('Reintentar recupera el catálogo sin perder el título ni reutilizar el destino anterior',async()=>{
    const failing=deferred(),h=harness({fills:[failing]});await h.setup();h.node('push-title').value='Título conservado';await h.select('cxRace');
    failing.reject(Error('Catálogo no disponible'));await settle();expect(h.node('push-cx-retry').style.display).toBe('');
    await h.node('push-cx-retry').dispatch('click');await settle();expect(h.node('push-title').value).toBe('Título conservado');
    expect(h.node('push-deepLinkCxRace').value).toBe('');expect(h.node('push-cx-retry').style.display).toBe('none');
  });
  it('limpiar el formulario retira una consulta pendiente sin modificar el borrador siguiente',async()=>{
    const read=deferred(),h=harness({fills:[read]});await h.setup();await h.select('cxRace');h.clear();h.node('push-title').value='Borrador posterior';
    read.reject(Error('Lectura anterior'));await settle();expect(h.node('push-deepLinkCxRace').value).toBe('');expect(h.context.showToast).not.toHaveBeenCalled();
    expect(h.node('push-title').value).toBe('Borrador posterior');expect(h.target()).toMatchObject({category:'general'});
  });
  it('un recuento rechazado presenta el error y libera los controles sin enviar',async()=>{
    const count=deferred(),h=harness({counts:[count]});await h.setup();h.node('push-title').value='Conservar tras error';
    const sending=h.send();count.reject(Error('Recuento no disponible'));await sending;expect(h.context.fetch).not.toHaveBeenCalled();
    expect(h.node('pushSendError').textContent).toBe('Recuento no disponible');expect(h.node('push-title').value).toBe('Conservar tras error');expect(h.node('sendPushBtn').disabled).toBe(false);
  });
  it('programar conserva el mismo destino CX y evita duplicar la petición durante la confirmación',async()=>{
    const confirmation=deferred(),h=harness({confirmations:[confirmation]});await h.setup();await h.select('cxRace');await settle();
    h.node('push-deepLinkCxRace').value='cx-a';h.node('push-title').value='Programada CX';h.node('push-schedule-toggle').checked=true;
    h.node('push-scheduledAt').value='2099-11-01T12:00';const first=h.send();await settle();await h.send();confirmation.resolve(true);await first;
    expect(h.context.fetch).toHaveBeenCalledTimes(1);expect(JSON.parse(h.context.fetch.mock.calls[0][1].body)).toMatchObject({category:'cyclocross',cxRaceId:'cx-a',deepLink:'cxRace/cx-a',scheduledAt:expect.any(String)});
    expect(h.node('push-schedule-toggle').checked).toBe(false);expect(h.node('sendPushBtn').disabled).toBe(false);
  });
  it('conserva público general e identificadores de carretera para sus propios destinos',async()=>{
    const h=harness();await h.setup();await h.select('race');h.node('push-deepLinkRace').value='road-a';
    expect(h.target()).toMatchObject({category:'general',deepLink:'race/road-a'});h.node('push-title').value='Ruta';await h.send();
    expect(h.queries[0].filters).toContainEqual(['push_subscription_categories.category','general']);expect(h.queries[0].columns).not.toContain('push_cx_race_subscriptions');
    expect(h.context.fetch).not.toHaveBeenCalled();
  });
});

describe('separación de las notificaciones por área del panel',()=>{
  it('en carretera el formulario solo ofrece destinos de carretera',async()=>{
    const h=harness({area:'road'});await h.setup();
    expect(h.node('pushAreaLabel').textContent).toBe('Carretera');
    expect(h.node('push-deepLinkType').innerHTML).toContain('value="race"');
    expect(h.node('push-deepLinkType').innerHTML).not.toContain('value="cxRace"');
    expect(h.target()).toMatchObject({category:'general'});
  });
  it('en ciclocross el formulario solo ofrece el destino CX y su público',async()=>{
    const h=harness({area:'cx'});await h.setup();
    expect(h.node('pushAreaLabel').textContent).toBe('Ciclocross');
    expect(h.node('push-deepLinkType').innerHTML).toContain('value="cxRace"');
    expect(h.node('push-deepLinkType').innerHTML).not.toContain('value="race"');
    expect(h.node('push-deepLinkTab').innerHTML).toContain('value="cyclocross"');
    expect(h.node('push-deepLinkTab').innerHTML).not.toContain('value="today"');
    expect(h.target()).toMatchObject({category:'cyclocross',deepLink:'cyclocross'});
  });
  it('el cambio de área reajusta el formulario al reabrir la vista',async()=>{
    const h=harness({area:'road'});await h.setup();h.setArea('cx');await h.setup();
    expect(h.node('pushAreaLabel').textContent).toBe('Ciclocross');
    expect(h.node('push-deepLinkType').innerHTML).toContain('value="cxRace"');
    expect(h.target()).toMatchObject({category:'cyclocross'});
  });
});
