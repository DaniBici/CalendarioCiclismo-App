import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the deployed fallback, including an existing road URL as a control.
const html=readFileSync(new URL('../../404.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*\/\/ Fallback de URLs limpias[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g,'');
function destination(pathname) {
  const replace=vi.fn();runInNewContext(script,{location:{pathname,replace}});return replace.mock.calls[0]?.[0]??null;
}
describe('fallback de agendas de torneo',()=>{
  it.each([
    ['/ciclocross/torneos/copa-del-mundo/','/ciclocross.html?torneo=copa-del-mundo'],
    ['/en/cyclocross/series/world-cup','/en/cyclocross/?torneo=world-cup'],
    ['/ciclocross/torneos/copa%20local/','/ciclocross.html?torneo=copa%20local'],
    ['/en/cyclocross/series/copa%20local/','/en/cyclocross/?torneo=copa%20local'],
    ['/resultados/tour/etapa-3/','/resultados.html?slug=tour&stage=3'],
  ])('resuelve %s', (path,expected)=>expect(destination(path)).toBe(expected));
  it.each(['/ciclocross/torneos/%broken/','/en/cyclocross/series/%broken/','/ciclocross/torneos/copa/otra/','/en/cyclocross/series/'])('mantiene el 404 para %s',path=>expect(destination(path)).toBeNull());
});
