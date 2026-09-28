import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(new URL('../../css/app.css', import.meta.url), 'utf8');
const resultsSource = readFileSync(new URL('../resultados.js', import.meta.url), 'utf8');

function declarations(selector) {
  const marker = `${selector} {`;
  const start = appCss.indexOf(marker);
  if (start < 0) return '';
  const open = appCss.indexOf('{', start);
  const close = appCss.indexOf('}', open);
  return appCss.slice(open + 1, close);
}

describe('paleta de los modales públicos', () => {
  it('deriva superficies, cabeceras, campos y bordes de la paleta global', () => {
    const root = declarations(':root');
    expect(root).toContain('--modal-surface:    var(--bg-card)');
    expect(root).toContain('--modal-header:     var(--bg-header)');
    expect(root).toContain('--modal-field:      var(--bg)');
    expect(root).toContain('--modal-border:     var(--border)');
  });

  it.each(['.sg-modal', '.asset-modal', '.report-modal', '#ph-banner-box', '.rd-modal', '.cookie-modal__box'])(
    '%s usa la superficie modal común',
    (selector) => {
      expect(declarations(selector)).toContain('background: var(--modal-surface)');
      expect(declarations(selector)).toContain('border: 1px solid var(--modal-border)');
    },
  );

  it.each(['.sg-modal__bar', '.asset-modal__bar', '.ph-banner__bar', '.rd-modal__bar'])(
    '%s usa la cabecera global',
    (selector) => {
      expect(declarations(selector)).toContain('background: var(--modal-header)');
    },
  );

  it('mantiene el blanco solo como fondo funcional del visor de documentos', () => {
    expect(declarations('.asset-modal--document .asset-modal__body')).toContain('background: #fff');
  });
});

describe('presentación de clasificaciones de un día', () => {
  it('solo crea pestañas cuando existe más de una clasificación', () => {
    expect(resultsSource).toContain('const hasTabs = activeStages.length > 1;');
  });

  it('omite el nombre de la clasificación en la línea de publicación', () => {
    expect(resultsSource).toContain("const classHeading = isOneDay ? ''");
  });

  it('acompaña el estado de actualización con el icono giratorio accesible', () => {
    expect(resultsSource).toContain('res-update-note res-refreshing');
    expect(resultsSource).toContain("statusIcon('refresh')");
    expect(appCss).toContain('.res-refreshing .res-status-icon');
    expect(appCss).toContain('@media(prefers-reduced-motion:reduce)');
  });

  it('conserva la banda persistente al terminar de cargar la clasificación', () => {
    expect(resultsSource).toContain('res-refreshing res-refreshing--busy');
    expect(resultsSource).toContain("publication.querySelector('.res-refreshing--busy')?.remove()");
    expect(resultsSource).not.toContain("publication.querySelector('.res-refreshing')?.remove()");
  });
});
