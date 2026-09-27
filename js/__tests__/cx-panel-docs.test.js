import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';

const panel=readFileSync(new URL('../panel-cx.js',import.meta.url),'utf8');
const docsForm=panel.slice(panel.indexOf('async function docsForm('),panel.indexOf('\nasync function rowsForm('));
const onSubmit=panel.slice(panel.indexOf('function onSubmit('),panel.indexOf('\nasync function loadRaces('));
const actions=panel.match(/const actions=[^\n]+/)[0];
const headerSave=panel.match(/handle\.body\.querySelector\('\[data-save-section\]'\)\.onclick=[^\n]+/)[0];

async function openDocs({failure=null}={}) {
  const types=['technicalGuide','map'];
  const assets=types.map(type=>({id:type,type,url:`https://example.org/${type}.${type === "map" ? "png" : "pdf"}`}));
  const forms=[];
  const header={disabled:false,innerHTML:'Guardar',textContent:'Guardar'};
  const editor={querySelector:()=>header,querySelectorAll:()=>[header]};
  const makeForm=html=>{
    const attributes=new Map(),events=new Map();
    const submit=html.includes('type="submit"')?{hidden:false,disabled:false,textContent:'Guardar',innerHTML:'Guardar'}:null;
    const error={textContent:''},controls=submit?[submit]:[];
    const inputs=Object.fromEntries(types.map(type=>{
      const upload={disabled:false,addEventListener:vi.fn()},remove={disabled:false};
      controls.push(upload,remove);
      const row={querySelector:selector=>selector==='[data-upload]'?upload:remove};
      return [type,{value:assets.find(asset=>asset.type===type).url,closest:()=>row}];
    }));
    const form={isConnected:true,submit,inputs,error,
      querySelector:selector=>selector==='[type=submit]'?submit:selector==='.cx-error'?error:
        selector.startsWith('.asset-url-input')?inputs[selector.match(/data-type=([^\]]+)/)[1]]:null,
      querySelectorAll:()=>controls,closest:()=>editor,contains:node=>controls.includes(node),
      reportValidity:()=>true,getAttribute:key=>attributes.get(key),
      setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),
      addEventListener:(name,callback)=>events.set(name,callback),
      requestSubmit:()=>events.get('submit')({preventDefault:vi.fn()}),
    };
    return form;
  };
  const root={isConnected:true,querySelector:()=>forms.at(-1),
    set innerHTML(value){forms.push(makeForm(value));},
  };
  const handle={body:{querySelector:selector=>selector==='[data-save-section]'?header:forms.at(-1)}};
  const from=vi.fn(table=>({table,update(value){this.value=value;return this;},eq(){return this;}}));
  const cxQuery=vi.fn(async()=>{if(failure)throw failure;}),refresh=vi.fn(async()=>{}),showToast=vi.fn();
  await runInNewContext(`(async()=>{${actions}\n${onSubmit}\n${docsForm}\n${headerSave}\nawait docsForm(root,race);})()`,{
    root,handle,race:{id:'cx-race'},ctx:{supabase:{from},showToast},
    CX_DOC_TYPES:types.map(type=>({type,icon:''})),cxAllRows:async()=>assets,
    URL,cxQuery,cxUrl:value=>value,esc:value=>value,boxSection:vi.fn(),refresh,
    errorAt:(form,error)=>{form.error.textContent=error.message;},
  });
  return {forms,header,cxQuery,refresh,showToast};
}

describe('guardado de Docs en el editor CX',()=>{
  it('no crea el botón inferior al abrir ni después de guardar desde la cabecera',async()=>{
    const docs=await openDocs();
    expect(docs.forms[0].submit).toBeNull();
    docs.forms[0].inputs.map.value='https://example.org/new-map.png';
    await docs.header.onclick();
    await vi.waitFor(()=>expect(docs.forms).toHaveLength(2));
    expect(docs.cxQuery).toHaveBeenCalledTimes(2);
    expect(docs.cxQuery.mock.calls[1][0].value).toEqual({url:'https://example.org/new-map.png'});
    expect(docs.showToast).toHaveBeenCalledWith('Documentos guardados','success');
    expect(docs.refresh).toHaveBeenCalledOnce();
    expect(docs.forms).toHaveLength(2);
    expect(docs.forms[1].submit).toBeNull();
    expect(docs.header.disabled).toBe(false);
    expect(docs.header.innerHTML).toBe('Guardar');
  });

  it('rechaza mapas PDF o WebP antes de modificar los documentos',async()=>{
    for(const ext of ['pdf','webp']) {
      const docs=await openDocs();
      docs.forms[0].inputs.map.value=`https://example.org/map.${ext}?v=2`;
      await docs.header.onclick();
      await vi.waitFor(()=>expect(docs.forms[0].error.textContent).toBe('El mapa debe ser JPG o PNG.'));
      expect(docs.cxQuery).not.toHaveBeenCalled();
      expect(docs.refresh).not.toHaveBeenCalled();
    }
  });

  it('conserva el aviso de error y restablece la cabecera si falla el guardado',async()=>{
    const docs=await openDocs({failure:new Error('No se pudo guardar')});
    await docs.header.onclick();
    await vi.waitFor(()=>expect(docs.forms[0].error.textContent).toBe('No se pudo guardar'));
    expect(docs.header.disabled).toBe(false);
    expect(docs.header.innerHTML).toBe('Guardar');
    expect(docs.forms[0].submit).toBeNull();
    expect(docs.refresh).not.toHaveBeenCalled();
  });
});
