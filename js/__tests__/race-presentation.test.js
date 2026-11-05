import { describe, it, expect } from 'vitest';
import { hasValidTimeLimit, isTttStageClassification } from '../services/race-presentation.js';
import { resultObservation, COVERED_STAGE_REFRESH_SOURCES } from '../../scripts/results-fetchers/result-publication.mjs';

describe('fuera de control de la jornada', () => {
  it('fuera de control exige duración, fuente y comprobación válidas', () => {
    const valid={timeLimitSeconds:15000,timeLimitBasis:{sourceUrl:'https://race.example/rules.pdf',verifiedAt:'2026-09-04T14:00:00Z'}};
    expect(hasValidTimeLimit(valid)).toBe(true);
    for(const timeLimitSeconds of [null,0,-1,'x']) expect(hasValidTimeLimit({...valid,timeLimitSeconds})).toBe(false);
    expect(hasValidTimeLimit({...valid,timeLimitBasis:{...valid.timeLimitBasis,sourceUrl:'javascript:alert(1)'}})).toBe(false);
    expect(hasValidTimeLimit({...valid,timeLimitBasis:{sourceUrl:'https://race.example'}})).toBe(false);
  });
});

describe('detección de CRE en la clasificación de etapa', () => {
  const finishers = [{ rank: 1, resultValue: '2:39:10' }, { rank: 2, resultValue: '0:01' }];
  const withdrawals = [
    ...Array.from({ length: 7 }, () => ({ rank: null, resultValue: 'DNF', timeText: 'DNF' })),
    ...Array.from({ length: 2 }, () => ({ rank: null, resultValue: 'DNS', timeText: 'DNS' })),
  ];

  it('Flanders 1B conserva los corredores aunque DataRide deje los IRM en ResultValue', () => {
    expect(isTttStageClassification({
      rows: [...finishers, ...withdrawals], classKind: 'stage',
      raceDay: { primaryType: 'flat' }, stageRaceType: 'IRR',
    })).toBe(false);
  });

  it('mantiene el colapso de una CRE curada con estructura de equipos', () => {
    const rows = [{ rank: 1 }, { rank: 1 }, { rank: 2 }, { rank: 2 }];
    expect(isTttStageClassification({
      rows, classKind: 'stage', raceDay: { primaryType: 'ttt' }, stageRaceType: 'ITT',
    })).toBe(true);
  });

  it('conserva el fallback fuerte solo cuando no se ha podido mapear la jornada', () => {
    const rows = Array.from({ length: 6 }, () => ({ rank: null }));
    expect(isTttStageClassification({ rows, classKind: 'stage' })).toBe(true);
    expect(isTttStageClassification({ rows, classKind: 'stage', stageRaceType: 'IRR' })).toBe(false);
  });
});

describe('observaciones del origen efectivo', () => {
  it('una CRE Tissot puede contener filas UCI oficiales', () => {
    expect(resultObservation({source:'tissot',fetchedAt:'2026-09-04T14:00:00Z'},{},{publication:{provider:'uci',format:'uci'}})).toMatchObject({provider:'uci',format:'uci',observedAt:'2026-09-04T14:00:00Z'});
  });
  it('distingue el PDF de STS de sus cuadros Wiclax', () => {
    expect(resultObservation({source:'sts'},{},{publication:{provider:'sts',format:'pdf'}}).format).toBe('pdf');
    expect(resultObservation({source:'sts'},{},{}).format).toBe('progressive');
    expect(resultObservation({source:'raceresult'},{},{}).format).toBe('progressive');
  });
  it('registra adquisiciones progresivas de las fuentes con refresco de etapa', () => {
    const [source] = COVERED_STAGE_REFRESH_SOURCES;
    expect(resultObservation({source,fetchedAt:'2026-09-04T14:00:00Z'},{},{})).toMatchObject({provider:source,format:'progressive',observedAt:'2026-09-04T14:00:00Z'});
    expect(resultObservation({source},{},{publication:{format:'pdf'}}).format).toBe('pdf');
  });
});
