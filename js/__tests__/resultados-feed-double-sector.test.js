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

  it('abre la general final en la última etapa, conservando su clasificación gc', () => {
    expect(feedSource).toContain('const finalStageContextByRace = new Map()');
    expect(feedSource).toContain("inhouseHref(race, finalStage?.sn ?? null, 'gc', isEn, finalStage?.suffix || '')");
  });

  it('acepta etapa-1a/1b y stage-1a/1b en el fallback de Pages', () => {
    expect(fallbackSource).toContain('etapa-\\d+[a-z]?');
    expect(fallbackSource).toContain('stage-\\d+[a-z]?');
  });

  it('no genera accesos externos sin una clasificación propia', () => {
    expect(feedSource).not.toContain("kind: 'ext'");
    expect(feedSource).not.toContain('data-results-fallback');
    expect(feedSource).toContain('El feed solo publica clasificaciones propias');
  });

  it('pinta la destacada como en las apps: fila única con clasificaciones complementarias', () => {
    expect(feedSource).toContain("' feed-row--featured' : ''}\" style=\"--card-color:${esc(color)}\" href=\"${esc(e.href)}\">");
    expect(feedSource).toContain('<span class="feed-row__leaders">');
    expect(feedSource).not.toContain('buildElevationSparkline');
    expect(feedSource).not.toContain('feed-result-link');
  });
});
