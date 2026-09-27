import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../lang-switch.js',import.meta.url),'utf8');
function switchLanguage(current,target,{enDomain=null,alternate}={}) {
  const url=new URL(current),location={origin:url.origin,hostname:url.hostname,pathname:url.pathname,search:url.search,hash:url.hash,href:url.href};
  let click;
  const document={
    readyState:'complete',getElementById:()=>null,
    createElement:()=>({dataset:{},addEventListener:(name,handler)=>{if(name==='click')click=handler;}}),
    querySelector:selector=>selector==='.header-actions'?{querySelector:()=>null,appendChild:()=>{}}:
      selector.startsWith('link[rel="alternate"]')?{href:alternate}:null
  };
  runInNewContext(script,{window:{location},document,CONFIG:{enDomain},URL,URLSearchParams,
    localStorage:{getItem:()=>null,setItem:()=>{}}});
  click({target:{closest:()=>({dataset:{lang:target}})}});
  return location.href;
}

describe('cambio de idioma desde clasificaciones CX',()=>{
  it.each(['programme','tv','videos'])('conserva la sección %s y la categoría al cambiar de idioma',view=>{
    expect(switchLanguage(`https://calendariociclismo.app/ciclocross/prueba/?view=${view}#WE`,'en',{
      alternate:'https://calendariociclismo.app/en/cyclocross/race/'
    })).toBe(`https://calendariociclismo.app/en/cyclocross/race/?view=${view}#WE`);
  });
  it.each(['ME','WE','WU','general','general-ME','general-WE','general-WU'])(
    'conserva #%s y los filtros de la URL al pasar de ES a EN',fragment=>{
      expect(switchLanguage(`https://calendariociclismo.app/ciclocross/prueba/resultados/?date=2026-11-01#${fragment}`,'en',{
        alternate:'https://calendariociclismo.app/en/cyclocross/race/results/'
      })).toBe(`https://calendariociclismo.app/en/cyclocross/race/results/?date=2026-11-01#${fragment}`);
    });

  it('conserva la general por categoría al volver de EN a ES',()=>{
    expect(switchLanguage('https://calendariociclismo.app/en/cyclocross/race/results/#general-WU','es',{
      alternate:'https://calendariociclismo.app/ciclocross/prueba/resultados/'
    })).toBe('https://calendariociclismo.app/ciclocross/prueba/resultados/#general-WU');
  });

  it('conserva la categoría al reescribir la ruta para un dominio inglés dedicado',()=>{
    expect(switchLanguage('https://calendariociclismo.app/ciclocross/prueba/resultados/?date=2026-11-01#WE','en',{
      enDomain:'en.example.org',alternate:'https://calendariociclismo.app/en/cyclocross/race/results/'
    })).toBe('https://en.example.org/cyclocross/race/results/?date=2026-11-01#WE');
  });

  it('conserva la general al volver del dominio dedicado',()=>{
    expect(switchLanguage('https://en.example.org/cyclocross/race/results/#general-WE','es',{
      enDomain:'en.example.org',alternate:'https://calendariociclismo.app/ciclocross/prueba/resultados/'
    })).toBe('https://calendariociclismo.app/ciclocross/prueba/resultados/#general-WE');
  });

  it('no propaga fragmentos ajenos a las clasificaciones CX',()=>{
    expect(switchLanguage('https://calendariociclismo.app/ciclocross/prueba/resultados/#general-desconocida','en',{
      alternate:'https://calendariociclismo.app/en/cyclocross/race/results/'
    })).toBe('https://calendariociclismo.app/en/cyclocross/race/results/');
  });
});
