import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readSource = relativePath => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('aviso de TV filtrada por región en Jornada', () => {
  it('usa la región en lugar del país en ambos idiomas', () => {
    const jornada = readSource('../jornada.js');
    const spanish = readSource('../i18n.js');
    const english = JSON.parse(readSource('../../i18n/en.json'));

    expect(jornada).toContain("t('tv.noTvRegion')");
    expect(jornada).toContain('tv-no-region-msg');
    expect(jornada).not.toContain('tv-no-country-msg');
    expect(spanish).toContain("noTvRegion: 'No hay TV en tu región'");
    expect(english.tv.noTvRegion).toBe('No TV available in your region');
  });
});
