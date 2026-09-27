import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
import {cxSaveErrorMessage} from '../cx-editor-logic.js';

const cxPanel=readFileSync(new URL('../panel-cx.js',import.meta.url),'utf8');
const panel=readFileSync(new URL('../panel.js',import.meta.url),'utf8');
const showToastSource=panel.match(/function showToast\([\s\S]*?\n\}/)[0];

function toastContext() {
  const toasts=[];
  const showToast=runInNewContext(`(${showToastSource})`,{
    document:{getElementById:()=>({appendChild:toast=>toasts.push(toast)}),createElement:()=>({style:{}})},
    setTimeout:vi.fn(),
  });
  return {ctx:{showToast},toasts};
}

describe('avisos del panel de ciclocross',()=>{
  it.each([
    'Carrera guardada',
    'Enlaces guardados',
    'Documentos guardados',
    'Texto extraído',
    'Resultados guardados',
    'Torneo guardado',
    'Equipo guardado',
    'Ficha guardada',
  ])('muestra «%s» como éxito, sin heredar el error por defecto',message=>{
    const call=cxPanel.match(new RegExp(`ctx\\.showToast\\('${message}'[^;]*\\);`));
    expect(call).not.toBeNull();
    const {ctx,toasts}=toastContext();
    runInNewContext(call[0],{ctx});
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toBe(message);
    expect(toasts[0].className).toBe('toast toast--success');
  });

  it('conserva el tipo error cuando no hay un mensaje de error dentro del formulario',()=>{
    const errorAt=cxPanel.match(/function errorAt\([^\n]+/)[0];
    const {ctx,toasts}=toastContext();
    runInNewContext(`${errorAt}\nerrorAt(root,error);`,{
      ctx,cxSaveErrorMessage,root:{querySelector:()=>null},error:new Error('No se pudo guardar'),
    });
    expect(toasts[0].textContent).toBe('No se pudo guardar');
    expect(toasts[0].className).toBe('toast toast--error');
  });
  it.each([
    ['cx_races_slugEn_key','El slug en inglés ya está en uso por otra carrera. Modificar «Slug (EN)».'],
    ['cx_races_slug_key','El slug ya está en uso por otra carrera. Modificar «Slug».'],
  ])('muestra el error %s aunque su texto esté al final del formulario', (constraint,message)=>{
    const errorAt=cxPanel.match(/function errorAt\([^\n]+/)[0];
    const {ctx,toasts}=toastContext(),target={textContent:''};
    runInNewContext(`${errorAt}\nerrorAt(root,error);`,{
      ctx,cxSaveErrorMessage,root:{querySelector:()=>target},
      error:new Error(`duplicate key value violates unique constraint "${constraint}"`),
    });
    expect(target.textContent).toBe(message);
    expect(toasts[0].textContent).toBe(message);
    expect(toasts[0].className).toBe('toast toast--error');
  });
});
