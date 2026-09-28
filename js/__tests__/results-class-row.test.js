import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { resultClassificationOfficialState } from '../results/panel-logic.js';
import { panelClassificationRowHtml } from '../panel/editor-ui.js';

const panelSource = readFileSync(fileURLToPath(new URL('../panel/results.js', import.meta.url)), 'utf8');

function extractFunction(name) {
  const start = panelSource.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`No se encuentra ${name} en panel/results.js`);
  const end = panelSource.indexOf('\n}', start);
  return panelSource.slice(start, end + 2);
}

function renderRow(stage) {
  const context = {
    esc: (v) => String(v ?? ''),
    formatDateTime: (v) => String(v ?? ''),
    resultClassificationOfficialState,
    panelClassificationRowHtml,
    _ruClassLabel: (st) => (st.isFinalClassification ? 'General · final' : 'Etapa'),
  };
  return runInNewContext(`${extractFunction('_ruClassRowHtml')}\n_ruClassRowHtml(stage)`, { ...context, stage });
}

describe('fila de clasificación del panel de resultados', () => {
  it('presenta dos interruptores (oficialidad y bloqueo) y ningún chip de estado', () => {
    const html = renderRow({
      id: 'st-1',
      publicationStatus: 'official',
      officialAt: '2026-09-15T10:00:00Z',
      lockedAt: null,
      rowCount: 120,
    });
    expect(html).toContain('ru-official-toggle');
    expect(html).toContain('checked');
    expect(html).toContain('ru-lock-toggle');
    expect(html).not.toContain('uci-chip');
    expect(html).toContain('Oficial');
    expect(html).toContain('Bloqueo');
    expect(html).toContain('Editar');
    expect(html).toContain('Borrar');
  });

  it('refleja el candado en su interruptor con la variante ámbar', () => {
    const html = renderRow({
      id: 'st-2',
      publicationStatus: 'provisional',
      officialAt: null,
      lockedAt: '2026-09-15T11:00:00Z',
      rowCount: 0,
    });
    expect(html).toContain('ru-switch--lock');
    expect(html).toContain('is-on');
    expect(html.match(/ru-official-toggle[^>]*checked/)).toBeNull();
    expect(html).toContain('Bloqueada el');
  });
});
