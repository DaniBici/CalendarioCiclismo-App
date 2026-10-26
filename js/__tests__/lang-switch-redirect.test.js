import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../lang-switch.js',import.meta.url),'utf8');
const GOOGLEBOT='Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function visitRoot({userAgent,language='en-US',stored=null}){
  const location={origin:'https://calendariociclismo.app',hostname:'calendariociclismo.app',pathname:'/',search:'',hash:'',href:'https://calendariociclismo.app/',
    replace(url){this.href=url;}};
  const document={readyState:'complete',getElementById:()=>null,createElement:()=>({dataset:{},addEventListener:()=>{}}),querySelector:()=>null};
  runInNewContext(script,{window:{location},document,navigator:{language,userAgent},CONFIG:{enDomain:null},URL,URLSearchParams,
    localStorage:{getItem:()=>stored,setItem:()=>{}}});
  return location.href;
}

describe('redirección automática de / a /en/',()=>{
  it('lleva a /en/ al visitante con navegador en inglés y sin elección previa',()=>{
    expect(visitRoot({userAgent:CHROME})).toBe('/en/');
  });
  it('no redirige a Googlebot aunque renderice en inglés',()=>{
    expect(visitRoot({userAgent:GOOGLEBOT})).toBe('https://calendariociclismo.app/');
  });
  it('no redirige con navegador en castellano ni con idioma ya elegido',()=>{
    expect(visitRoot({userAgent:CHROME,language:'es-ES'})).toBe('https://calendariociclismo.app/');
    expect(visitRoot({userAgent:CHROME,stored:'es'})).toBe('https://calendariociclismo.app/');
  });
});
