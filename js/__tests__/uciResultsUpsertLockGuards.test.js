import { describe, it, expect } from 'vitest';
import { buildPlan } from '../../scripts/results-fetchers/uci-results-upsert.mjs';

// Guarda de lock ASIMÉTRICA en la purga de gemelas sintéticas.
//
// Contexto: una misma clasificación lógica (raceId + stageNumber + classKind +
// scope) puede existir bajo varios eventId. Los POSITIVOS son de DataRide (fuente
// oficial); los NEGATIVOS son sintéticos (cronometrador, volcado PDF, fuente externa…).
//
// La regla de producto (Dani, 2026-06-10) es "lo oficial pisa al placeholder": un
// volcado provisional nunca debe bloquear a la UCI. Pero la implementación original
// purgaba por "eventId distinto y negativo" a secas, así que también se llevaba por
// delante a una gemela SINTÉTICA curada a mano y bloqueada desde el panel — entre dos
// fuentes provisionales ninguna es "la verdad", así que ahí el candado debe mandar
// (matizado 2026-07-19, caso Giro della Valle d'Aosta 2026: E1-E3 volcadas de fuente externa y
// del libro STS y curadas a mano, con el .clax de STS llegando después bajo otro
// eventId sintético).
//
// Estos tests fijan el SQL que emite buildPlan. Son la red de seguridad de una
// lógica de BORRADO: sin ellos, una regresión aquí destruye datos curados en silencio.

const clasificacion = (overrides = {}) => ({
  eventId: -1359920101,
  classKind: 'stage',
  scope: 'stage',
  eventName: 'Stage 1',
  stageNumber: 1,
  rowCount: 2,
  rows: [
    { rank: 1, rankText: '1', bib: '11', riderDisplay: 'BRAVO Henrique', timeText: "26'25" },
    { rank: 2, rankText: '2', bib: '12', riderDisplay: 'BOCK Emanuel', gapText: '+1' },
  ],
  ...overrides,
});

const planDe = (eventId) => {
  const { plan } = buildPlan({
    competitionId: eventId > 0 ? 78302 : -135992,
    disciplineId: 10,
    stages: [{ stageNumber: 1, classifications: [clasificacion({ eventId })] }],
  });
  return plan;
};

const purgaDe = (plan) => plan.find(
  (p) => p.text.includes('DELETE FROM public.race_uci_stages') && p.text.includes('"eventId" <> '),
);
const insertCabeceraDe = (plan) => plan.find((p) => p.text.includes('INSERT INTO public.race_uci_stages'));
const insertFilasDe = (plan) => plan.find((p) => p.text.includes('INSERT INTO public.race_uci_results'));

describe('purga de gemelas — entrante SINTÉTICA (otro cronometrador/PDF)', () => {
  it('respeta el candado: no borra una gemela bloqueada', () => {
    // Sin este AND, el .clax de STS se llevaría por delante los volcados manuales
    // de las etapas 1-3 de Aosta pese a estar bloqueados desde el panel.
    expect(purgaDe(planDe(-1359920101)).text).toContain('"lockedAt" IS NULL');
  });

  it('no se inserta al lado de una gemela bloqueada', () => {
    // El ON CONFLICT es por "eventId", que aquí NO colisiona (los eventId difieren)
    // → sin este guard saldrían DOS pestañas de la misma clasificación en la web.
    const sql = insertCabeceraDe(planDe(-1359920101)).text;
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain('"lockedAt" IS NOT NULL');
  });

  it('sus filas exigen que la cabecera exista', () => {
    // Si el guard anterior impidió insertar la cabecera, las filas quedan sin
    // stageRef al que colgar y el FK aborta el --apply ENTERO (cazado en real
    // contra Aosta: "violates foreign key constraint race_uci_results_stageRef_fkey").
    expect(insertFilasDe(planDe(-1359920101)).text)
      .toContain('EXISTS (SELECT 1 FROM public.race_uci_stages h WHERE h.id=$1)');
  });
});

describe('purga de gemelas — entrante OFICIAL (DataRide)', () => {
  it('purga el placeholder AUNQUE esté bloqueado', () => {
    // La regla original, intacta: el candado protege correcciones del panel frente a
    // re-volcados de la misma fuente, pero no convierte un placeholder en verdad
    // frente a la UCI. Si esto se rompe, un PDF viejo bloquea al oficial para siempre.
    expect(purgaDe(planDe(78302001)).text).not.toContain('"lockedAt" IS NULL');
  });

  it('se inserta sin condicionarse a gemelas bloqueadas', () => {
    // Su purga ya se llevó la gemela por delante → no hay nada que esquivar.
    expect(insertCabeceraDe(planDe(78302001)).text).not.toContain('WHERE NOT EXISTS');
  });
});

describe('coherencia placeholders ↔ params en el INSERT de cabecera', () => {
  // El nº de $N del SQL debe cuadrar SIEMPRE con params.length, o Postgres rechaza
  // el bind y aborta el --apply entero. Se rompió con la pseudo-etapa Final
  // Classification (stageNumber null): raceDayExpr='NULL' y stageDateExpr='$12' no
  // referencian $16, pero params seguía llevando sectorIndex → "bind message supplies
  // 16 parameters, but prepared statement requires 15". Cazado en real volcando la
  // etapa 4 del Giro della Valle d'Aosta 2026. --emit-sql no lo detecta (serializa
  // a literales), así que solo fallaba la ruta --apply.
  const maxPlaceholder = (sql) =>
    Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));

  const planConStage = (stageNumber) => {
    const { plan } = buildPlan({
      competitionId: 78302,
      disciplineId: 10,
      stages: [{
        stageNumber,
        isFinalClassification: stageNumber == null,
        dateKey: '2026-07-19',
        classifications: [clasificacion({ stageNumber })],
      }],
    });
    return plan;
  };

  it('etapa normal: params cuadran con los placeholders', () => {
    const ins = insertCabeceraDe(planConStage(4));
    expect(maxPlaceholder(ins.text)).toBe(ins.params.length);
  });

  it('Final Classification (stageNumber null): params cuadran con los placeholders', () => {
    const ins = insertCabeceraDe(planConStage(null));
    expect(maxPlaceholder(ins.text)).toBe(ins.params.length);
  });

  it('doble sector: sectorIndex se sigue pasando cuando el SQL lo usa', () => {
    // El fix no debe llevarse por delante el soporte de doble sector (3A/3B): con
    // stageNumber presente, $16 se referencia en el OFFSET y debe ir en params.
    const ins = insertCabeceraDe(planConStage(3));
    expect(ins.text).toContain('OFFSET $16');
    expect(ins.params).toHaveLength(16);
  });
});

describe('el candado propio sigue protegiendo el re-volcado de la MISMA clasificación', () => {
  it('la cabecera no se actualiza si está bloqueada', () => {
    // Guarda preexistente (migración 087), independiente de la asimetría de arriba.
    expect(insertCabeceraDe(planDe(-1359920101)).text)
      .toContain('WHERE race_uci_stages."lockedAt" IS NULL');
  });

  it('las filas no se borran si su clasificación está bloqueada', () => {
    const borrado = planDe(-1359920101).plan ?? planDe(-1359920101);
    const del = borrado.find(
      (p) => p.text.includes('DELETE FROM public.race_uci_results') && p.text.includes('"stageRef"=$1'),
    );
    expect(del.text).toContain('lockedAt" IS NOT NULL');
  });
});
