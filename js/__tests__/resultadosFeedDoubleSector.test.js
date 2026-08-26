import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const feedSource = readFileSync(new URL('../resultados-feed.js', import.meta.url), 'utf8');
const fallbackSource = readFileSync(new URL('../../404.html', import.meta.url), 'utf8');

// Regresión (Baltic Chain Tour 2026): el feed colapsaba 1A/1B por stageNumber,
// mostraba solo 1B como "Etapa 1" y atribuía su ganador a la entrada única.
describe('feed y fallback de resultados con doble sector', () => {
  it('agrupa y enlaza cada clasificación por raceDayId y sufijo', () => {
    expect(feedSource).toContain('key(s.raceId, s.stageNumber, s.raceDayId)');
    expect(feedSource).toContain('inhouseHref(race, s.stageNumber, null, isEn, suffix)');
    expect(feedSource).toContain('stageLabel(e.sn, isEn, e.suffix || \'\')');
  });

  it('acepta etapa-1a/1b y stage-1a/1b en el fallback de Pages', () => {
    expect(fallbackSource).toContain('etapa-\\d+[a-z]?');
    expect(fallbackSource).toContain('stage-\\d+[a-z]?');
  });
});
