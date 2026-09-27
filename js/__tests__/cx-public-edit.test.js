import {describe,it,expect,vi} from 'vitest';
import {cxPublicEditUrl,mountCxPublicEditButton} from '../cx-public-edit.js';

const session={user:{id:'admin'}};
function mount({activeSession=null,verification={data:true,error:null},sessionError=null,sessionPromise}={}) {
  const header={children:[],appendChild:node=>header.children.push(node)};
  const root={querySelector:()=>header,ownerDocument:{createElement:()=>({remove(){header.children=header.children.filter(node=>node!==this);}})}};
  let onAuth,section='programme';
  const unsubscribe=vi.fn();
  const client={rpc:vi.fn(async()=>verification),auth:{
    getSession:vi.fn(()=>sessionPromise||Promise.resolve({data:{session:activeSession},error:sessionError})),
    onAuthStateChange:vi.fn(callback=>{onAuth=callback;return {data:{subscription:{unsubscribe}}};}),
  }};
  const control=mountCxPublicEditButton(client,root,'race/id',{getSection:()=>section});
  return {client,header,control,unsubscribe,auth:(event,next)=>onAuth(event,next),section:value=>{section=value;control.update();}};
}

describe('acceso de edición en la carrera pública CX',()=>{
  it('no muestra el botón ni comprueba permisos sin sesión',async()=>{
    const page=mount();await page.control.ready;
    expect(page.header.children).toHaveLength(0);
    expect(page.client.rpc).not.toHaveBeenCalled();
  });

  it('muestra el mismo botón de carretera solo con permiso administrativo verificado',async()=>{
    const page=mount({activeSession:session});await page.control.ready;
    expect(page.client.rpc).toHaveBeenCalledWith('cx_require_admin');
    expect(page.header.children).toHaveLength(1);
    const button=page.header.children[0];
    expect(button.id).toBe('editCxRaceBtn');
    expect(button.className).toBe('edit-jornada-btn');
    expect(button.innerHTML).toContain('Editar carrera');
    expect(button.href).toBe('/panel/app.html?cxEdit=race%2Fid&tab=identity');
    page.section('results');expect(button.href).toContain('&tab=results');
    page.section('startlist');expect(button.href).toContain('&tab=startlist');
    page.section('tv');expect(button.href).toContain('&tab=tv');
    page.section('videos');expect(button.href).toContain('&tab=videos');
  });

  it.each([{data:false,error:null},{data:null,error:{code:'42501'}},{data:null,error:{message:'Sesión expirada'}}])(
    'oculta el botón a usuarios sin permisos o con verificación fallida (%j)',async verification=>{
      const page=mount({activeSession:session,verification});await page.control.ready;
      expect(page.header.children).toHaveLength(0);
    });

  it('no rompe la página si falla la red al verificar permisos',async()=>{
    const page=mount({activeSession:session});page.client.rpc.mockRejectedValue(new Error('Red'));
    await page.control.ready;expect(page.header.children).toHaveLength(0);
  });

  it('retira el botón inmediatamente al cerrar sesión y no duplica el botón tras autenticarse',async()=>{
    const page=mount({activeSession:session});await page.control.ready;
    page.auth('SIGNED_OUT',null);expect(page.header.children).toHaveLength(0);
    page.auth('SIGNED_IN',session);await vi.waitFor(()=>expect(page.header.children).toHaveLength(1));
    page.auth('TOKEN_REFRESHED',session);await vi.waitFor(()=>expect(page.header.children).toHaveLength(1));
    page.control.dispose();expect(page.header.children).toHaveLength(0);expect(page.unsubscribe).toHaveBeenCalledOnce();
  });

  it('no restaura el botón si una verificación pendiente termina después del logout',async()=>{
    const page=mount({activeSession:session});let resolve;
    page.client.rpc.mockReturnValue(new Promise(done=>{resolve=done;}));
    await vi.waitFor(()=>expect(page.client.rpc).toHaveBeenCalledOnce());
    page.auth('SIGNED_OUT',null);resolve({data:true,error:null});
    await page.control.ready;expect(page.header.children).toHaveLength(0);
  });

  it('ignora la sesión inicial si llega después de cerrar sesión',async()=>{
    let resolve;
    const page=mount({sessionPromise:new Promise(done=>{resolve=done;})});
    page.auth('SIGNED_OUT',null);resolve({data:{session},error:null});
    await page.control.ready;expect(page.client.rpc).not.toHaveBeenCalled();
    expect(page.header.children).toHaveLength(0);
  });

  it('no acepta sesiones cuya lectura devuelve un error',async()=>{
    const page=mount({activeSession:session,sessionError:new Error('Sesión')});
    await page.control.ready;expect(page.client.rpc).not.toHaveBeenCalled();
  });

  it('codifica el identificador y conserva la ruta base sin aceptar pestañas arbitrarias',()=>{
    expect(cxPublicEditUrl('race&tab=docs','unknown','/cc')).toBe('/cc/panel/app.html?cxEdit=race%26tab%3Ddocs&tab=identity');
  });
});
