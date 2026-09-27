import {describe,it,expect,vi} from 'vitest';
import {extractPdfText} from '../services/pdf-text.js';

const item=(str,x,y)=>({str,transform:[1,0,0,1,x,y]});
const file={arrayBuffer:async()=>new ArrayBuffer(8)};
function fixture(pages) {
  const document={numPages:pages.length,getPage:async p=>({getTextContent:async()=>pages[p-1]})};
  // PDF.js entrega la liberación en la tarea, no en este proxy de documento.
  const task={promise:Promise.resolve(document),destroy:vi.fn(async()=>{})};
  const pdf={getDocument:vi.fn(()=>task)};
  return {task,pdf,load:async()=>pdf,document};
}

describe('extracción de texto PDF del panel',()=>{
  it('conserva páginas y orden de tabla sin crear columnas para los espacios sintéticos',async()=>{
    const f=fixture([
      {items:[item(' Equipo local ',300,730),item(' ',240,730),item('01',90,730),item('1',40,730),
        item('Corredor local',140,730),item('bib',90,750),item('teamName',300,750),item(' ',120,750),
        item('riderDisplay',140,750),item('rank',40,750)]},
      {items:[item('2',40,730),item('02',90,730),item('Otro corredor',140,730),item('Otro equipo',300,730)]}
    ]);
    expect(await extractPdfText(file,f.load)).toBe('rank\tbib\triderDisplay\tteamName\n1\t01\tCorredor local\tEquipo local\n2\t02\tOtro corredor\tOtro equipo');
    expect(f.pdf.getDocument).toHaveBeenCalledWith({data:expect.any(Uint8Array)});
    expect(f.task.destroy).toHaveBeenCalledOnce();
  });

  it('libera también la tarea de un PDF inválido y conserva su error de lectura',async()=>{
    const f=fixture([]),error=new Error('PDF inválido');f.task.promise=Promise.reject(error);
    await expect(extractPdfText(file,f.load)).rejects.toBe(error);
    expect(f.task.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    ['InvalidPDFException','El PDF no es válido o está dañado.'],
    ['PasswordException','El PDF está protegido con contraseña.']
  ])('presenta el error %s en castellano sin omitir la liberación',async(name,message)=>{
    const f=fixture([]),error=new Error('Mensaje interno PDF.js');error.name=name;
    f.task.promise=Promise.reject(error);
    await expect(extractPdfText(file,f.load)).rejects.toThrow(message);
    expect(f.task.destroy).toHaveBeenCalledOnce();
  });

  it('libera la tarea si una página falla al extraer texto',async()=>{
    const f=fixture([{}]),error=new Error('Página ilegible');
    f.document.getPage=async()=>({getTextContent:async()=>{throw error;}});
    await expect(extractPdfText(file,f.load)).rejects.toBe(error);
    expect(f.task.destroy).toHaveBeenCalledOnce();
  });

  it('rechaza documentos sin texto, para no sustituir un borrador por una cadena vacía',async()=>{
    const f=fixture([{items:[item(' ',40,750)]}]);
    await expect(extractPdfText(file,f.load)).rejects.toThrow('no contiene texto extraíble');
    expect(f.task.destroy).toHaveBeenCalledOnce();
  });
});
