import {describe,it,expect} from 'vitest';
import {flagIconUrl,LOCAL_FLAG_CODES} from '../flag-url.js';
import {COUNTRY_LIST} from '../country-select.js';

describe('banderas de las comunidades autónomas',()=>{
  it('sirve las comunidades desde /flags y el resto desde el CDN',()=>{
    expect(flagIconUrl('es-an')).toBe('/flags/es-an.svg');
    expect(flagIconUrl('ES-VC')).toBe('/flags/es-vc.svg');
    expect(flagIconUrl('es-ct')).toBe('https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/es-ct.svg');
    expect(flagIconUrl('fr')).toBe('https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/fr.svg');
    expect(flagIconUrl('')).toBe('');
  });
  it('incluye las 19 comunidades y ciudades en el selector',()=>{
    const codes=new Set(COUNTRY_LIST.map(c=>c.code));
    for(const code of ['es-an','es-ar','es-as','es-cb','es-ce','es-cl','es-cm','es-cn','es-ct','es-ex','es-ga','es-ib','es-mc','es-md','es-ml','es-nc','es-pv','es-ri','es-vc']) {
      expect(codes.has(code),`Falta ${code} en COUNTRY_LIST`).toBe(true);
    }
  });
  it('todas las banderas locales resuelven a /flags',()=>{
    for(const code of LOCAL_FLAG_CODES) expect(flagIconUrl(code)).toBe(`/flags/${code}.svg`);
  });
});
