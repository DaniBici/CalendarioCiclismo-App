import {describe,it,expect,vi} from 'vitest';
import {PdfTextImportState} from '../pdf-text-import-state.js';

function deferred() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function editor() {
  let text='Borrador vigente',connected=true;
  const onText=vi.fn(value=>text=value),onError=vi.fn(),onState=vi.fn();
  const state=new PdfTextImportState({isCurrent:()=>connected,onState});
  return {state,onText,onError,onState,get text(){return text;},detach(){connected=false;}};
}

describe('selección PDF y respuestas tardías',()=>{
  it('una lectura antigua no sustituye el último PDF elegido',async()=>{
    const e=editor(),old=deferred(),reading=e.state.read({},()=>old.promise,e.onText,e.onError);
    expect(await e.state.read({},async()=>'Último PDF',e.onText,e.onError)).toBe(true);
    old.resolve('PDF anterior');expect(await reading).toBe(false);
    expect(e.text).toBe('Último PDF');expect(e.onText).toHaveBeenCalledOnce();expect(e.onError).not.toHaveBeenCalled();
  });

  it('un error antiguo no desbloquea la extracción nueva ni pinta un error en ella',async()=>{
    const e=editor(),old=deferred(),latest=deferred();
    const previous=e.state.read({},()=>old.promise,e.onText,e.onError);
    const current=e.state.read({},()=>latest.promise,e.onText,e.onError);
    old.reject(new Error('Fallo antiguo'));await previous;
    expect(e.state.pending).toBe(true);expect(e.onState).not.toHaveBeenCalledWith(false);expect(e.onError).not.toHaveBeenCalled();
    latest.resolve('PDF vigente');await current;
    expect(e.state.pending).toBe(false);expect(e.onState).toHaveBeenLastCalledWith(false);expect(e.text).toBe('PDF vigente');
  });

  it('una edición posterior invalida la lectura pendiente y permite elegir el mismo archivo otra vez',async()=>{
    const e=editor(),old=deferred(),selected={name:'resultados.pdf'};
    const reading=e.state.read(selected,()=>old.promise,e.onText,e.onError);
    e.state.invalidate();expect(e.state.pending).toBe(false);
    old.resolve('Texto que llega tarde');expect(await reading).toBe(false);
    expect(e.text).toBe('Borrador vigente');expect(e.onText).not.toHaveBeenCalled();
    expect(await e.state.read(selected,async()=>'Nuevo intento',e.onText,e.onError)).toBe(true);
    expect(e.text).toBe('Nuevo intento');
  });

  it('un archivo nuevo inválido conserva el borrador y no recupera una lectura antigua',async()=>{
    const e=editor(),old=deferred(),reading=e.state.read({},()=>old.promise,e.onText,e.onError),error=new Error('PDF inválido');
    expect(await e.state.read({},async()=>{throw error;},e.onText,e.onError)).toBe(false);
    old.resolve('Archivo anterior');await reading;
    expect(e.text).toBe('Borrador vigente');expect(e.onText).not.toHaveBeenCalled();expect(e.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(e.state.pending).toBe(false);
  });

  it('cancelar sin archivo no inicia una extracción ni modifica el estado',async()=>{
    const e=editor(),loader=vi.fn();
    expect(await e.state.read(undefined,loader,e.onText,e.onError)).toBe(false);
    expect(loader).not.toHaveBeenCalled();expect(e.onState).not.toHaveBeenCalled();expect(e.text).toBe('Borrador vigente');
  });

  it('cerrar o sustituir el editor descarta tanto el texto como los errores pendientes',async()=>{
    for(const fails of [false,true]) {
      const e=editor(),file=deferred(),reading=e.state.read({},()=>file.promise,e.onText,e.onError);
      e.detach();if(fails)file.reject(new Error('Fallo tardío'));else file.resolve('Texto tardío');
      expect(await reading).toBe(false);
      expect(e.onText).not.toHaveBeenCalled();expect(e.onError).not.toHaveBeenCalled();expect(e.onState).toHaveBeenCalledExactlyOnceWith(true);
    }
  });
});
