import { describe, expect, it } from 'vitest';
import { buildNginxMap } from '../assets-canonical/map.mjs';

const PAGE = 'https://calendariociclismo.app/mapa/etapa/';

function sample(extra = {}) {
  const json = { ...extra };
  for (let i = 0; i < 120; i += 1) json[`/races/carrera-${i}/2026/stage-1/map.pdf`] = PAGE;
  return json;
}

describe('buildNginxMap', () => {
  it('decodifica la ruta porque nginx compara con $uri decodificado', () => {
    const { text } = buildNginxMap(sample({ '/races/a%20b/2026/guia%C3%B1.pdf': PAGE }));
    expect(text).toContain('"/races/a b/2026/guiañ.pdf" "<https://calendariociclismo.app/mapa/etapa/>; rel=\\"canonical\\"";');
  });

  it('descarta claves y valores que rompen una cadena de nginx', () => {
    const { text, skipped, count } = buildNginxMap(sample({
      '/races/x/co"mi.pdf': PAGE,
      '/races/x/$var.pdf': PAGE,
      '/races/x/mal%ZZ.pdf': PAGE,
      '/races/x/ok.pdf': 'https://otro.dominio/pagina/',
      '/races/x/imagen.png': PAGE,
      '/races/x/espacio.pdf': `${PAGE} x`,
    }));
    expect(skipped).toBe(6);
    expect(count).toBe(120);
    expect(text).not.toMatch(/co"mi|\$var|otro\.dominio|imagen\.png/);
  });

  it('rechaza un mapa con pocas entradas o con otra forma', () => {
    expect(() => buildNginxMap({ '/races/a/map.pdf': PAGE })).toThrow(/mínimo/);
    expect(() => buildNginxMap([])).toThrow(/objeto/);
    expect(() => buildNginxMap(null)).toThrow(/objeto/);
  });

  it('ordena las rutas para que la salida sea estable', () => {
    const a = buildNginxMap(sample()).text;
    const reversed = Object.fromEntries(Object.entries(sample()).reverse());
    expect(buildNginxMap(reversed).text).toBe(a);
  });
});
