import { describe, it, expect } from 'vitest';
import { isFinalStageDump } from '../../scripts/results-fetchers/uci-results-cron.mjs';
import { shouldPublishFinalClassification } from '../../scripts/results-fetchers/uci-results-upsert.mjs';

// REGRESIÓN (2026-08-07, Tour of Kahramanmaraş 2026, comp 77813).
//
// DataRide publica las clasificaciones finales de una vuelta en una `race` APARTE
// llamada "Final Classification", con stageNumber NULL — no colgando de la última
// etapa. Volcar la última etapa exige por tanto DOS cosas a la vez:
//   1. que el FETCH lea la competición entera (sin `--stage N`, que la dejaría fuera), y
//   2. que el UPSERT reciba `--include-final` (o el filtro `--only-stage N` la tiraría).
//
// La condición original era `!ONE_RACE && targetStage === totalStages`. Como --stage
// solo existe junto a --race-id (ONE_STAGE se define únicamente si hay ONE_RACE), ese
// `!ONE_RACE` hacía la rama INALCANZABLE en el único camino que llega con targetStage
// != null: el "Volcar esta etapa" del panel sobre la última etapa se dejaba la general
// final sin volcar y SIN avisar. En Kahramanmaraş se perdieron las cuatro (general,
// puntos, montaña, jóvenes) hasta que se volcó a mano.
describe('isFinalStageDump — la general final entra también en el volcado manual', () => {
  it('la última etapa dispara la lectura completa aunque el disparo sea manual', () => {
    // El caso exacto de Kahramanmaraş: 4 etapas, "Volcar esta etapa" sobre la 4.
    expect(isFinalStageDump(4, 4)).toBe(true);
  });

  it('una etapa intermedia NO arrastra la general final', () => {
    expect(isFinalStageDump(3, 4)).toBe(false);
    expect(isFinalStageDump(1, 4)).toBe(false);
  });

  it('needsFinal manda por sí solo (la query --configured ya decidió)', () => {
    // La final pendiente puede publicarse DESPUÉS de la última etapa: needsFinal la
    // recupera aunque targetStage no sea la última, o aunque no haya targetStage.
    expect(isFinalStageDump(2, 4, true)).toBe(true);
    expect(isFinalStageDump(null, null, true)).toBe(true);
  });

  it('sin datos suficientes no asume que sea la final', () => {
    // Sin targetStage no hay --only-stage que compensar; sin totalStages (carrera con
    // race_days incompletos) preferimos NO forzar la lectura completa a ciegas.
    expect(isFinalStageDump(null, 4)).toBe(false);
    expect(isFinalStageDump(4, null)).toBe(false);
  });

  it('compara por valor, no por tipo (la BD devuelve numérico y el CLI string)', () => {
    expect(isFinalStageDump('4', 4)).toBe(true);
    expect(isFinalStageDump(4, '4')).toBe(true);
  });

  it('el prólogo (etapa 0) de una vuelta de una sola jornada también es final', () => {
    expect(isFinalStageDump(0, 0)).toBe(true);
  });
});

describe('shouldPublishFinalClassification — carreras de un día en DataRide', () => {
  it('acepta una Final Classification única cuando no hay etapa no-final en el payload', () => {
    expect(shouldPublishFinalClassification(false, false)).toBe(true);
  });

  it('mantiene el guard para una vuelta cuyo payload sí contiene etapas', () => {
    expect(shouldPublishFinalClassification(false, true)).toBe(false);
    expect(shouldPublishFinalClassification(true, true)).toBe(true);
  });
});
