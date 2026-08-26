import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../jornada.js', import.meta.url)),
  'utf8',
);

describe('enlaces externos que acompañan resultados nativos en Jornada', () => {
  it('pasa FC y fuente externa a la tarjeta de la etapa actual sin restaurar el fallback automático', () => {
    expect(source).toContain('const extUrlA  = rd.isCancelledDay ? null : buildExtUrlA');
    expect(source).toContain('const extUrlB = rd.isCancelledDay ? null : buildExtUrlB');
    expect(source).toContain('resultsButtonsHtml(inhouseUrl, extUrlA, extUrlB, race, rd.stageNumber)');
    expect(source).not.toContain('if (shouldShowResults(rd, race) || hasInhouseResults)');
  });

  it('mantiene FC y fuente externa junto a la general nativa de la etapa anterior', () => {
    expect(source).toContain('buildExtUrlA(race, _prevRd.stageNumber, _prevRd._fcStageNumber)');
    expect(source).toContain('buildExtUrlB(race, _prevRd.stageNumber, _prevRd._stageSuffix)');
    expect(source).not.toContain('shouldShowPreviousResults(_prevRd, rd, race) || _prevHasInhouse');
  });
});
