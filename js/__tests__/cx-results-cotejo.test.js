import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {cxResultsCotejo} from '../../scripts/cx/cx-results-cotejo.mjs';
import {cxNaturalRiderDisplay, normalizeCxDataRideRows, splitCxDisplayName} from '../../scripts/results-fetchers/cx-dataride-results.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../docs/cx-cotejos/waaslandcross-2025-26-me.json', import.meta.url)));
const sourceRows = copy => copy.normalizedDataRide.categories[0].rows;
const alcobendas = JSON.parse(readFileSync(new URL('../../docs/cx-cotejos/alcobendas-2025-26-me.json', import.meta.url)));

describe('cotejo oficial offline C2, Waaslandcross ME 2025–26', () => {
  it('conserva la discrepancia de cronometraje y todos los puestos/estados sin modificar las fuentes', () => {
    const before = JSON.stringify(fixture), report = cxResultsCotejo(fixture);
    expect(report).toMatchObject({scope: 'offline_only_not_publication', status: 'needs_review',
      officialRows: 33, datarideRows: 33, matchingIdentities: 33, absoluteTimes: 28, matchingAbsoluteTimes: 27,
      lapStates: 4, matchingLapStates: 4, otherStates: 1, matchingOtherStates: 1});
    expect(report.differences).toEqual([{bib: '14', name: 'VAN DE PUTTE Victor', field: 'absoluteTime',
      official: '57:53', officialSeconds: '3473', dataride: '0:57:51', datarideSeconds: '3471', datarideIrm: null}]);
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it('detecta una diferencia de un segundo incluso fuera del rango Number seguro', () => {
    const copy = structuredClone(fixture);
    copy.official.rows[0][3] = '3000000000000:00:01';
    sourceRows(copy)[0].timeSeconds = '10800000000000000';
    const difference = cxResultsCotejo(copy).differences.find(entry => entry.bib === '1');
    expect(difference).toMatchObject({field: 'absoluteTime', officialSeconds: '10800000000000001', datarideSeconds: '10800000000000000'});
  });
  it('identifica el subconjunto de fuentes coincidente sin convertirlo en una publicación', () => {
    const copy = structuredClone(fixture);
    copy.official.rows = copy.official.rows.slice(0, 3);
    copy.normalizedDataRide.categories[0].rows = sourceRows(copy).slice(0, 3);
    expect(cxResultsCotejo(copy)).toMatchObject({scope: 'offline_only_not_publication', status: 'matching',
      officialRows: 3, datarideRows: 3, matchingIdentities: 3, matchingAbsoluteTimes: 3, differences: []});
  });
  it('no equipara LAP o DNF con tiempo cero ni pierde los puestos de doblados', () => {
    for (const [bib, field, value, expectedField] of [['39', 'timeSeconds', '0', 'lapState'],
      ['39', 'rank', null, 'identityOrRank'], ['39', 'gapText', '-2 LAP', 'lapState'],
      ['35', 'timeSeconds', '0', 'nonFinishState'], ['35', 'rank', 33, 'identityOrRank']]) {
      const copy = structuredClone(fixture);
      sourceRows(copy).find(row => row.bib === bib)[field] = value;
      expect(cxResultsCotejo(copy).differences).toContainEqual(expect.objectContaining({bib, field: expectedField}));
    }
  });
  it('solo normaliza el plural de vueltas y acepta DNF textual o NULL', () => {
    const copy = structuredClone(fixture);
    sourceRows(copy).find(row => row.bib === '39').gapText = '-1 LAPS';
    sourceRows(copy).find(row => row.bib === '35').timeText = 'DNF';
    expect(cxResultsCotejo(copy).differences).toHaveLength(1);
  });
  it('detecta dorsales duplicados, ausentes y ajenos aunque el recuento sea el mismo', () => {
    const copy = structuredClone(fixture), rows = sourceRows(copy);
    rows[0].bib = rows[1].bib;
    rows[2].bib = '999';
    const report = cxResultsCotejo(copy);
    expect(report).toMatchObject({status: 'needs_review', officialRows: 33, datarideRows: 33, absoluteTimes: 28});
    expect(report.differences).toEqual(expect.arrayContaining([
      {bib: '2', field: 'duplicateBib', source: 'dataride', count: 2},
      {bib: '1', field: 'missingBib'}, {bib: '11', field: 'missingBib'}, {bib: '999', field: 'unexpectedBib'}]));
    const duplicateOfficial = structuredClone(fixture);
    duplicateOfficial.official.rows[0][1] = '2';
    expect(cxResultsCotejo(duplicateOfficial).differences).toContainEqual({bib: '2', field: 'duplicateBib', source: 'official', count: 2});
  });
  it('rechaza manifiestos incompatibles, datos desconocidos y conflictos del normalizador', () => {
    for (const edit of [copy => {copy.scope = 'production';}, copy => {copy.normalizedDataRide.disciplineId = 10;},
      copy => {copy.category = 'WE';}, copy => {copy.dateKey = '2026-02-15';},
      copy => {copy.originalOfficialFactsSha256 = '';}, copy => {copy.official.rows[0][3] = 'unknown';},
      copy => {delete sourceRows(copy)[0].irm;}, copy => {copy.normalizedDataRide.categories.push(copy.normalizedDataRide.categories[0]);}]) {
      const copy = structuredClone(fixture); edit(copy);
      expect(() => cxResultsCotejo(copy)).toThrow();
    }
    const conflicting = structuredClone(fixture);
    sourceRows(conflicting)[0].sourceConflict = 'RankNumber y Rank discrepan';
    expect(cxResultsCotejo(conflicting).differences).toContainEqual({bib: '1', field: 'sourceConflict', value: 'RankNumber y Rank discrepan'});
  });
});

describe('cotejo C2 Alcobendas, clasificación nombrada y DNS no enumerados', () => {
  it('coteja todos los tiempos y estados sin descartar DNS de DataRide ni fabricar los del PDF', () => {
    const before = JSON.stringify(alcobendas), report = cxResultsCotejo(alcobendas);
    expect(alcobendas.classEvidence).toMatchObject({classCode: 'C2', competitionId: 75840, date: '16 Nov 2025', countryCode: 'ES'});
    expect(report).toMatchObject({status: 'needs_review', officialRows: 38, datarideRows: 40,
      matchingIdentities: 38, absoluteTimes: 26, matchingAbsoluteTimes: 26,
      lapStates: 9, matchingLapStates: 9, otherStates: 3, matchingOtherStates: 3,
      sourceCoverage: {scope: 'named_rows_with_unlisted_dns', officialUnlistedDns: 6, dnsCountDifference: 4,
        namedClassificationMatches: true, allEntrantsMatches: false, officialDnsIdentitiesMatched: false}});
    expect(report.sourceCoverage.dataRideOnlyDns).toEqual([
      {bib: '20', name: 'GONZALEZ BELLIDO Cesar'}, {bib: '39', name: 'EGUIGUREN SANTAMARIA Oskitx'},
    ]);
    expect(report.differences).toEqual([
      {bib: '20', field: 'unexpectedBib'}, {bib: '39', field: 'unexpectedBib'}, {field: 'rowCount', official: 38, dataride: 40},
    ]);
    expect(JSON.stringify(alcobendas)).toBe(before);
  });
  it('normaliza las cuarenta filas crudas y contrasta los nueve déficits con vueltas explícitas del PDF', () => {
    const raw = alcobendas.rawResultRows.map(values => Object.fromEntries(alcobendas.rawResultColumns.map((column, i) => [column, values[i]])));
    const fields = ['rank', 'bib', 'riderDisplay', 'timeText', 'timeSeconds', 'gapText', 'irm', 'sourceConflict'];
    const received = normalizeCxDataRideRows(raw).map(row => Object.fromEntries(fields.map(field => [field, row[field]])));
    const expected = sourceRows(alcobendas).map((row, index) => {
      const split = splitCxDisplayName(raw[index].DisplayName);
      return {...row, riderDisplay: cxNaturalRiderDisplay(split.firstName, split.lastName, row.riderDisplay)};
    });
    expect(received).toEqual(expected);
    const laps = alcobendas.official.publishedTimeRows.filter(row => /vueltas?/.test(row[3]));
    expect(laps).toHaveLength(9);
    for (const [rank, bib, partialTime, deficit, completedLaps] of laps) {
      const lostLaps = Number(/\d+/.exec(deficit)[0]);
      expect(lostLaps).toBe(6 - completedLaps);
      expect(received.find(row => row.bib === bib)).toMatchObject({rank, irm: 'LAP', timeSeconds: null,
        timeText: null, gapText: `-${lostLaps} LAP`});
      expect(partialTime).toMatch(/^\d+:\d{2}$/); // Tiempo parcial publicado, sin atribuirlo a meta.
    }
  });
  it('no oculta errores de tiempo, puesto, estado, duplicados o corredores adicionales', () => {
    const edits = [copy => {sourceRows(copy)[0].timeSeconds = '3489';},
      copy => {sourceRows(copy).find(row => row.bib === '33').gapText = '-3 LAP';},
      copy => {sourceRows(copy).find(row => row.bib === '40').timeSeconds = '0';},
      copy => {sourceRows(copy).find(row => row.bib === '20').rank = 36;},
      copy => {sourceRows(copy).find(row => row.bib === '20').timeSeconds = '0';},
      copy => {sourceRows(copy).find(row => row.bib === '20').sourceConflict = 'Puesto contradictorio';},
      copy => {sourceRows(copy).push(structuredClone(sourceRows(copy).at(-1)));},
      copy => {copy.official.summary.unlistedDns = 1;},
      copy => {sourceRows(copy).at(-1).irm = 'DNF';}];
    for (const edit of edits) {
      const copy = structuredClone(alcobendas); edit(copy);
      expect(cxResultsCotejo(copy)).toMatchObject({status: 'needs_review', sourceCoverage: {namedClassificationMatches: false, allEntrantsMatches: false}});
    }
  });
  it('mantiene revisión de DNS aun sin filas adicionales y rechaza coberturas o cabeceras incompatibles', () => {
    const copy = structuredClone(alcobendas);
    copy.normalizedDataRide.categories[0].rows = sourceRows(copy).slice(0, 38);
    expect(cxResultsCotejo(copy)).toMatchObject({status: 'needs_review', differences: [],
      sourceCoverage: {namedClassificationMatches: true, allEntrantsMatches: false, officialUnlistedDns: 6, dnsCountDifference: 6}});
    for (const edit of [copy => {copy.official.coverage = 'ignore_extra_rows';},
      copy => {copy.official.summary.classified = 34;}, copy => {copy.official.summary.dnf = 2;},
      copy => {copy.official.summary.unlistedDns = 0;}, copy => {delete copy.official.summary;}]) {
      const invalid = structuredClone(alcobendas); edit(invalid);
      expect(() => cxResultsCotejo(invalid)).toThrow(/Cobertura/);
    }
  });
});
