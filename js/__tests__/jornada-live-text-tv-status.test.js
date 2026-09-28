import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const jornada = readFileSync(
  fileURLToPath(new URL('../jornada.js', import.meta.url)),
  'utf8',
);

describe('Live texto sin estado de televisión en Jornada', () => {
  it('no intenta traducir ni renderizar un estado nulo', () => {
    expect(jornada).toContain('const tvLabel = _tvStatus ? TV_STATUS_LABELS[_tvStatus] : null;');
    expect(jornada).toContain('} else if (tvLabel) {');
    expect(jornada).not.toContain("${tvLabel || t('tv.noInfo')}");
  });
});
