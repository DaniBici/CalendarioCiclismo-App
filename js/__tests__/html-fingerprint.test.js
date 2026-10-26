import { describe, expect, it } from 'vitest';
import { applyPrerenderedHtml, htmlFingerprint } from '../html-fingerprint.js';

// Elemento mínimo: dataset y innerHTML, lo único que lee applyPrerenderedHtml.
const element = (innerHTML, prerendered) => ({ innerHTML, dataset: prerendered === undefined ? {} : { prerendered } });

describe('htmlFingerprint', () => {
  it('es estable y distingue un solo carácter', () => {
    const html = '<div class="route-grid">Salida <time datetime="2027-05-08T11:00:00+00:00">13:00</time></div>';
    expect(htmlFingerprint(html)).toBe(htmlFingerprint(html));
    expect(htmlFingerprint(html)).not.toBe(htmlFingerprint(html.replace('13:00', '13:01')));
    expect(htmlFingerprint('')).toMatch(/^[0-9a-f]+$/);
  });
});

describe('applyPrerenderedHtml', () => {
  const html = '<h1>Giro</h1>';

  it('conserva el DOM generado si la huella coincide', () => {
    const el = element('<h1>Giro</h1><!-- build -->', htmlFingerprint(html));
    expect(applyPrerenderedHtml(el, html)).toBe(true);
    expect(el.innerHTML).toBe('<h1>Giro</h1><!-- build -->');
    expect(el.dataset.prerendered).toBeUndefined();
  });

  it('repinta si la huella no coincide o no hay contenido generado', () => {
    const stale = element('<h1>Antiguo</h1>', htmlFingerprint('<h1>Antiguo</h1>'));
    expect(applyPrerenderedHtml(stale, html)).toBe(false);
    expect(stale.innerHTML).toBe(html);
    expect(stale.dataset.prerendered).toBeUndefined();

    const plain = element('');
    expect(applyPrerenderedHtml(plain, html)).toBe(false);
    expect(plain.innerHTML).toBe(html);
  });
});
