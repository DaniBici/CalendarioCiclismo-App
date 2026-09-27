import {describe,it,expect,vi} from 'vitest';
import {CxCalendarImportState,validateCxCalendarPreview} from '../cx-calendar-import-state.js';

const manifest=(name='Prueba oficial')=>({
  source:'uci_web_calendar',seasonKey:'2026-27',
  summary:{races:1,categories:2,excludedCompetitions:0},
  races:[{race:{name,dateKey:'2026-11-01',class:'C2'},categories:[{category:'ME'},{category:'WE'}]}]
});
function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

describe('importador de calendario CX, selección y respuestas tardías',()=>{
  it('invalida la previsualización anterior antes de leer el archivo nuevo y no permite aplicarla tras un rechazo',async()=>{
    const session=new CxCalendarImportState('2026-27'),apply=vi.fn();
    await session.load(async()=>manifest());
    expect(session.state.status).toBe('ready');
    const file=deferred(),loading=session.load(()=>file.promise);
    expect(session.state).toMatchObject({status:'loading',manifest:null,error:null});
    expect(await session.apply(apply)).toBe(false);
    file.resolve({...manifest(),source:'dataride'});
    expect(await loading).toBe(false);
    expect(session.state.status).toBe('error');
    expect(session.state.manifest).toBeNull();
    expect(session.state.error.message).toContain('incompatible');
    expect(await session.apply(apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('una consulta UCI tardía no sustituye el archivo elegido después',async()=>{
    const session=new CxCalendarImportState('2026-27'),fetch=deferred();
    const old=session.load(()=>fetch.promise);
    await session.load(async()=>manifest('Archivo nuevo'));
    fetch.resolve(manifest('Consulta anterior'));
    expect(await old).toBe(false);
    expect(session.state.manifest.races[0].race.name).toBe('Archivo nuevo');
  });

  it('un rechazo nuevo no recupera el manifiesto de la consulta anterior cuando esta termina',async()=>{
    const session=new CxCalendarImportState('2026-27'),fetch=deferred();
    const old=session.load(()=>fetch.promise);
    await session.load(async()=>JSON.parse('archivo dañado'));
    const error=session.state.error;
    fetch.resolve(manifest());
    await old;
    expect(session.state).toMatchObject({status:'error',manifest:null,error});
  });

  it('una consulta anterior fallida no elimina una previsualización más reciente',async()=>{
    const session=new CxCalendarImportState('2026-27'),fetch=deferred();
    const old=session.load(()=>fetch.promise);
    await session.load(async()=>manifest('Archivo vigente'));
    fetch.reject(new Error('Consulta anterior fallida'));
    await old;
    expect(session.state.status).toBe('ready');
    expect(session.state.manifest.races[0].race.name).toBe('Archivo vigente');
    expect(session.state.error).toBeNull();
  });

  it('conserva la selección válida después de un error de escritura y permite reintentar una sola aplicación',async()=>{
    const session=new CxCalendarImportState('2026-27'),save=deferred();
    await session.load(async()=>manifest());
    const applying=session.apply(()=>save.promise);
    expect(session.state.status).toBe('applying');
    const duplicate=vi.fn(),newFile=vi.fn();
    expect(await session.apply(duplicate)).toBe(false);
    expect(await session.load(newFile)).toBe(false);
    expect(duplicate).not.toHaveBeenCalled();expect(newFile).not.toHaveBeenCalled();
    save.reject(new Error('Error de escritura'));
    expect(await applying).toBe(false);
    expect(session.state).toMatchObject({status:'ready',error:{message:'Error de escritura'}});
    const result={inserted:1,updated:0,categories:2};
    const retry=vi.fn(async()=>result);
    expect(await session.apply(retry)).toBe(true);
    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith(manifest());
    expect(session.state).toMatchObject({status:'applied',manifest:null,result,error:null});
    expect(await session.apply(duplicate)).toBe(false);
  });

  it('cerrar el drawer descarta la respuesta pendiente y no permite aplicar después',async()=>{
    const render=vi.fn(),session=new CxCalendarImportState('2026-27',render),fetch=deferred();
    const loading=session.load(()=>fetch.promise);
    session.close();
    fetch.resolve(manifest());
    expect(await loading).toBe(false);
    expect(render).toHaveBeenCalledOnce();
    expect(await session.load(vi.fn())).toBe(false);
    expect(await session.apply(vi.fn())).toBe(false);
  });

  it('cerrar durante un RPC no anuncia resultados en un formulario sustituido',async()=>{
    const render=vi.fn(),session=new CxCalendarImportState('2026-27',render),save=deferred();
    await session.load(async()=>manifest());
    const applying=session.apply(()=>save.promise);
    session.close();
    const renders=render.mock.calls.length;
    save.resolve({inserted:1,updated:0,categories:2});
    expect(await applying).toBe(false);
    expect(render.mock.calls.length).toBe(renders);
  });

  it('la edición externa y un RPC fallido no alteran el manifiesto preparado',async()=>{
    const session=new CxCalendarImportState('2026-27'),selected=manifest();
    await session.load(async()=>selected);
    selected.races[0].race.name='Modificado después';
    await session.apply(async document=>{document.races[0].race.name='Modificado por RPC';throw new Error('Fallo');});
    expect(session.state.manifest).toEqual(manifest());
  });
});

describe('previsualización de calendario CX',()=>{
  it('rechaza archivos incompatibles o incompletos con un error recuperable',()=>{
    for(const data of [null,{},[],{...manifest(),seasonKey:'2025-26'},{...manifest(),races:[]},
      {...manifest(),summary:null},{...manifest(),summary:{races:'1',categories:2,excludedCompetitions:0}},
      {...manifest(),races:[{}]},{...manifest(),races:[{race:{dateKey:'2026-11-01'},categories:[]}]}])
      expect(()=>validateCxCalendarPreview(data,'2026-27')).toThrow();
    expect(validateCxCalendarPreview(manifest(),'2026-27')).toEqual(manifest());
  });

  it('comprueba la ventana agosto–febrero también en finales multidía y fechas de categoría',()=>{
    const data=manifest();
    data.races[0].race.endDateKey='2027-03-01';
    expect(()=>validateCxCalendarPreview(data,'2026-27')).toThrow('agosto a febrero');
    delete data.races[0].race.endDateKey;
    data.races[0].categories[1].dateKey='2027-03-01';
    expect(()=>validateCxCalendarPreview(data,'2026-27')).toThrow('agosto a febrero');
    data.races[0].categories[1].dateKey='2027-02-28';
    expect(()=>validateCxCalendarPreview(data,'2026-27')).not.toThrow();
    data.races[0].race.dateKey='2027-02-30';
    expect(()=>validateCxCalendarPreview(data,'2026-27')).toThrow('agosto a febrero');
  });
});
