import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../jornada.js', import.meta.url)),
  'utf8',
);

describe('resultados de Jornada sin fuentes externas', () => {
  it('integra las clasificaciones propias como primer botón de la barra de assets', () => {
    expect(source).toContain('view: \'jornada\', assets, hasStartlist, resultsUrl, resultsHighlighted');
    expect(source).toContain('const resultsHighlighted = hasInhouseResults');
    expect(source).not.toContain('fuente externa');
    expect(source).not.toContain('fuente externa');
    expect(source).not.toContain('buildExtUrlA');
    expect(source).not.toContain('buildExtUrlB');
  });

  it('no conserva el fallback externo ni la numeración de fuente externa', () => {
    expect(source).not.toContain('shouldShowPreviousResults');
    expect(source).not.toContain('_fcStageNumber');
  });
});
