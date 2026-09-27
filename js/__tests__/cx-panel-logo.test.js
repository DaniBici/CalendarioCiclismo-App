import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
import {cxUrl} from '../cx-editor-logic.js';

const panel=readFileSync(new URL('../panel-cx.js',import.meta.url),'utf8');
const source=panel.slice(panel.indexOf('const logoField='),panel.indexOf('\nconst input='));
const getSource=panel.slice(panel.indexOf('const dataOf='),panel.indexOf('\nconst categoryOptions='));
const uploadSource=readFileSync(new URL('../panel.js',import.meta.url),'utf8');
const attachInlineUpload=uploadSource.slice(uploadSource.indexOf('function attachInlineUpload('),uploadSource.indexOf('\nasync function handleUpload('));

function logoForm() {
  const nodes=[],events=new Map();
  const wrapper={style:{},querySelector:()=>null};
  const input={value:'',name:'logoUrl',type:'url',style:{},parentElement:wrapper,
    after:node=>nodes.push(node),addEventListener:(name,handler)=>events.set(name,handler),
    dispatchEvent:event=>events.get(event.type)?.(event),
  };
  const preview={querySelectorAll:()=>[],replaceChildren:vi.fn(),append:vi.fn()};
  const state={},clear={};
  const form={querySelector:selector=>({
    '[name=logoUrl]':input,'[data-logo-image]':preview,'[data-logo-state]':state,'[data-logo-clear]':clear,
  })[selector],querySelectorAll:()=>[input]};
  return {form,input,nodes};
}

describe('URL y subida del logo en el editor CX',()=>{
  it('genera una entrada URL identificada para pegar un logo externo',()=>{
    const html=runInNewContext(`${source}\nlogoField('https://other.example/logo.png');`,{
      crypto:{randomUUID:()=> 'test'},esc:value=>value,
    });
    expect(html).toContain('URL del logo</label>');
    expect(html).toContain('name="logoUrl" type="url" value="https://other.example/logo.png"');
    expect(html).not.toMatch(/readonly|disabled|type="file"/);
  });

  it('conserva la URL pegada y su vista previa sin subir un archivo',()=>{
    const {form,input,nodes}=logoForm();
    const cxLogoImage=vi.fn(()=>null),inlineUpload=vi.fn();
    runInNewContext(`${attachInlineUpload}\n${source}\nctx.attachInlineUpload=attachInlineUpload;\nwireLogoField(form);`,{
      form,ctx:{},cxUrl,cxLogoImage,tournaments:[],
      document:{createElement:()=>({style:{},addEventListener:vi.fn()})},inlineUpload,
    });
    input.value='https://other.example/shared-logo.svg';
    input.dispatchEvent({type:'input'});
    expect(input.value).toBe('https://other.example/shared-logo.svg');
    expect(cxLogoImage).toHaveBeenLastCalledWith({logoUrl:input.value},undefined,expect.any(Object));
    expect(nodes.some(node=>node.type==='file'&&node.style.display==='none')).toBe(true);
    expect(nodes.some(node=>node.className==='inline-upload-btn')).toBe(true);
    expect(inlineUpload).not.toHaveBeenCalled();
    const payload=runInNewContext(`${getSource}\nconst payload=get(form);payload.logoUrl=cxUrl(payload.logoUrl);payload;`,{form,cxUrl});
    expect(payload).toEqual({logoUrl:'https://other.example/shared-logo.svg'});
  });
});
