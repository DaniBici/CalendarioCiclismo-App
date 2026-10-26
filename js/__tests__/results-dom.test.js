import { describe, expect, it } from 'vitest';
import { htmlFingerprint } from '../html-fingerprint.js';
import { updateResultsHtml } from '../results/dom.js';

function container() {
  return {
    writes: 0,
    get innerHTML() { return this.html; },
    set innerHTML(value) {
      this.writes++;
      this.html = value;
      this.child = { expanded: false };
    },
  };
}

describe('actualizaciones de clasificaciones sin reconstrucciones innecesarias', () => {
  it('conserva los nodos y el estado interactivo al recibir el mismo contenido', () => {
    const element = container();
    updateResultsHtml(element, '<table>Oficial</table>');
    const child = element.child;
    child.expanded = true;
    // La interacción y la serialización del navegador pueden alterar el DOM.
    element.html = '<table data-expanded="true">Oficial</table>';
    expect(updateResultsHtml(element, '<table>Oficial</table>')).toBe(false);
    expect(element.child).toBe(child);
    expect(element.child.expanded).toBe(true);
    expect(element.writes).toBe(1);
  });

  it('aplica una corrección recibida y distingue los contenedores', () => {
    const table = container();
    const publication = container();
    updateResultsHtml(table, '1:00');
    expect(updateResultsHtml(table, '1:01')).toBe(true);
    expect(table.innerHTML).toBe('1:01');
    expect(updateResultsHtml(publication, '1:01')).toBe(true);
    expect(publication.writes).toBe(1);
  });

  it('restaura la tabla tras pasar por el estado de carga o vacío', () => {
    const element = container();
    for (const intermediate of ['Cargando', '']) {
      updateResultsHtml(element, '<table>Resultados</table>');
      updateResultsHtml(element, intermediate);
      expect(updateResultsHtml(element, '<table>Resultados</table>')).toBe(true);
      expect(element.innerHTML).toBe('<table>Resultados</table>');
    }
  });
});

// Hueco escrito en el build: data-prerendered con la huella y, en la tabla
// recortada, data-rows; las filas añadidas van al final del <tbody>.
function prerendered(html, dataset) {
  const element = container();
  element.html = html;
  element.dataset = { ...dataset };
  element.appended = [];
  element.querySelector = selector => (selector === 'tbody'
    ? { insertAdjacentHTML: (position, rows) => element.appended.push([position, rows]) } : null);
  return element;
}

describe('contenido generado en el build', () => {
  const rows = { head: '<table><tbody>', list: ['<tr>1</tr>', '<tr>2</tr>', '<tr>3</tr>'], tail: '</tbody></table>' };
  const full = rows.head + rows.list.join('') + rows.tail;
  const firstTwo = rows.head + rows.list.slice(0, 2).join('') + rows.tail;

  it('conserva el DOM si la huella coincide y retira las marcas', () => {
    const element = prerendered('<p>Oficial</p>', { prerendered: htmlFingerprint('<p>Oficial</p>') });
    expect(updateResultsHtml(element, '<p>Oficial</p>')).toBe(true);
    expect(element.writes).toBe(0);
    expect(element.dataset).toEqual({});
    // Lo conservado cuenta como pintado: el mismo HTML no vuelve a tocar el DOM.
    expect(updateResultsHtml(element, '<p>Oficial</p>')).toBe(false);
  });

  it('sustituye el contenido si la huella no coincide', () => {
    const element = prerendered('<p>Oficial</p>', { prerendered: htmlFingerprint('<p>Oficial</p>') });
    expect(updateResultsHtml(element, '<p>Provisional</p>')).toBe(true);
    expect(element.innerHTML).toBe('<p>Provisional</p>');
    expect(element.dataset).toEqual({});
  });

  it('con las primeras filas conservadas añade las demás sin sustituirlas', () => {
    const element = prerendered(firstTwo, { prerendered: htmlFingerprint(firstTwo), rows: '2' });
    expect(updateResultsHtml(element, full, rows)).toBe(true);
    expect(element.writes).toBe(0);
    expect(element.appended).toEqual([['beforeend', '<tr>3</tr>']]);
    expect(element.dataset).toEqual({});
    expect(updateResultsHtml(element, full, rows)).toBe(false);
  });

  it('repinta la tabla entera si cambian las primeras filas o no hay filas que comparar', () => {
    for (const [html, list] of [[full, rows], [firstTwo, null]]) {
      const element = prerendered(firstTwo, { prerendered: htmlFingerprint(firstTwo), rows: '2' });
      expect(updateResultsHtml(element, html, list && { ...list, list: ['<tr>0</tr>', ...list.list] })).toBe(true);
      expect(element.writes).toBe(1);
      expect(element.appended).toEqual([]);
    }
  });
});
