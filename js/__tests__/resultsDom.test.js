import { describe, expect, it } from 'vitest';
import { updateResultsHtml } from '../results-dom.js';

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
