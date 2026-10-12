import {describe,it,expect} from 'vitest';
import {flagIconUrl} from '../flag-url.js';

describe('banderas de las comunidades autónomas',()=>{
  it('normaliza el código a minúsculas y devuelve cadena vacía sin código',()=>{
    expect(flagIconUrl('ES-VC')).toBe('/flags/es-vc.svg');
    expect(flagIconUrl('')).toBe('');
  });
});
