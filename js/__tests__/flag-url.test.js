import {describe,it,expect} from 'vitest';
import {flagIconUrl} from '../flag-url.js';

describe('banderas de las comunidades autónomas',()=>{
  it('sirve las comunidades desde /flags y el resto desde el CDN',()=>{
    expect(flagIconUrl('es-an')).toBe('/flags/es-an.svg');
    expect(flagIconUrl('ES-VC')).toBe('/flags/es-vc.svg');
    expect(flagIconUrl('es-ct')).toBe('https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/es-ct.svg');
    expect(flagIconUrl('fr')).toBe('https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/fr.svg');
    expect(flagIconUrl('')).toBe('');
  });
});
