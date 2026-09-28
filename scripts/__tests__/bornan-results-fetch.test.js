import { describe, expect, it } from 'vitest';
import {
  decodeJsonBuffer,
  findEventUnit,
  findResultReport,
  parseCode,
  parsePdfText,
  parseRow,
  parseUnitResults,
  reportsIndexUrl,
  resultsUrl,
  suggestCompetitionId,
  synthEventId,
} from '../results-fetchers/bornan-results-fetch.mjs';
import zlib from 'node:zlib';

const CODE = 'https://back.results.santafe2026.org|JSUD2026|CRD|W.TT----------------';

const unitResults = {
  Info: { Key: 'W.RR----------------.FNL-.000100--', Event: 'W.RR----------------', Status: 'OFFICIAL', DateTimeRaw: '2026-09-18T09:00:00-03:00' },
  Competitors: [
    { Rk: '1', Bib: '101', Org: 'ARG', Result: '2:47:47.12', Diff: '', IRM: 'OK', Name: 'BENEDETTI Julieta' },
    { Rk: '2', Bib: '121', Org: 'COL', Result: '2:47:47.12', Diff: '+0:00.31', IRM: 'OK', Name: 'HERNANDEZ Lina' },
    { Rk: '', Bib: '135', Org: 'PER', Result: '', Diff: '', IRM: 'OTL', Name: 'LEWIS Flor' },
  ],
};

const results = `
                            Circuito Rutas                                                                                       Ciclismo Ruta
                                                                                                       Contrarreloj Individual Femenino
                                                                                                                          Women's Individual Time Trial
                            TUE 15 SEP 2026
                            Start Time: 9:00                                                                                                  Final
                                                                                  Resultados
                                                                                      Results
                                                                         As of TUE 15 SEP 2026 at 10:06
                  Race                                                    NOC            Lap 1          Lap 2       Lap 3                      Time          Average
        Rank            Name                                                                                                       Finish
                 Number                                                    Code       at 12.0km      at 24.0km   at 36.0km                    Behind           Speed
            1        119 VILLALÓN Aranza                                  CHI      16:00.63 (1) 31:40.79 (1) 47:35.04 (1)       47:35.04                       45.394
                                                                                                 15:40.16 (1) 15:54.24 (2)
            2        133 ESPINOLA Agua                                    PAR      16:04.49 (3) 32:02.20 (2) 47:47.59 (2)       47:47.59     +12.55            45.204
            3        125 PEÑUELA Diana                                    COL      16:26.05 (5) 32:40.34 (4) 48:40.47 (4)       48:40.47   +1:05.43            44.384
                      138 GARCIA Mariana                                   URU                                                       DNF
                      144 CHACON Lilibeth                                  VEN                                                       DNS
   Average Speed                                                                Race Configuration
                                                                                                                                                             Distance
                                                                                                                                                             36.0km
                                                     Participants                                                                Weather
        Entries / NOC              Ranked           DNF                    DSQ                 DQB                DNS
            5 / 3                    3              1                       0                   0                  1
CRDWTT----------------FNL-000100--_73T_ENG 1.0                           Report Created TUE 15 SEP 2026 10:06                                                      Page 1/1
`;

describe('Bornan — resultados oficiales de los Juegos', () => {
  it('lee una prueba en línea solo en inglés y conserva la hora completa', () => {
    const roadRace = `
                                                    Ciclismo Ruta
                                                       Ruta Masculino
                                                    Men's Road Race
                             WED 23 SEP 2026
                             Start Time: 9:00                                                                                                  Final
                                                                                   Results
                                                                          As of WED 23 SEP 2026 at 13:05
        Rank            Name                                                  NOC                               Time          Average
             1        25 ALI Ahmed                                         CHN                        3:42:15.67            43.5
             2        31 TANAKA Kenji                                       JPN                        3:42:15.67   +0:32.10   43.4
                       44 KIM Minho                                          KOR                                 DNF
                                                      Participants
         Entries / NOC              Ranked           DNF                    DSQ                 DQB                DNS
             3 / 3                    2               1                       0                   0                  0
 CRDMRR----------------FNL-000100--_73T_ENG 1.0                           Report Created WED 23 SEP 2026 13:05                                                      Page 1/1
`;
    const stage = parsePdfText(roadRace, { expectedDate: '2026-09-23', expectedEventToken: 'CRDMRR----------------FNL-000100--' });
    const rows = stage.classifications[0].rows;
    expect(rows[0]).toMatchObject({ rank: 1, bib: '25', riderDisplay: 'ALI Ahmed', isoCode2: 'cn', timeText: '3:42:15', gapText: null });
    expect(rows[1]).toMatchObject({ rank: 2, bib: '31', isoCode2: 'jp', timeText: '3:42:15', gapText: '+0:32' });
    expect(rows[2]).toMatchObject({ rank: null, rankText: 'DNF', bib: '44', isoCode2: 'kr', irm: 'DNF' });
  });

  it('interpreta el código compuesto y deriva el identificador sintético', () => {
    expect(parseCode(CODE)).toMatchObject({ apiBase: 'https://back.results.santafe2026.org', champ: 'JSUD2026', disc: 'CRD', eventKey: 'W.TT----------------' });
    expect(suggestCompetitionId(CODE)).toBeLessThan(0);
    expect(synthEventId(CODE)).toBeLessThan(0);
    expect(() => parseCode('solo-una-parte')).toThrow('apiBase');
  });

  it('extrae clasificados con tiempo y hueco, y las filas IRM', () => {
    const stage = parsePdfText(results, { expectedDate: '2026-09-15', expectedEventToken: 'CRDWTT----------------FNL-000100--' });
    const classification = stage.classifications[0];
    expect(stage).toMatchObject({ stageNumber: null, dateKey: '2026-09-15', raceType: 'IRR', eventName: 'Results' });
    expect(classification).toMatchObject({ classKind: 'gc', scope: 'stage', rowCount: 5, expectedRowCount: 5, winnerName: 'VILLALÓN Aranza' });
    expect(classification.rows[0]).toMatchObject({ rank: 1, bib: '119', riderDisplay: 'VILLALÓN Aranza', isoCode2: 'cl', timeText: '47:35', gapText: null });
    expect(classification.rows[1]).toMatchObject({ rank: 2, bib: '133', timeText: '47:47', gapText: '+12' });
    expect(classification.rows[2]).toMatchObject({ rank: 3, bib: '125', timeText: '48:40', gapText: '+1:05' });
    expect(classification.rows[3]).toMatchObject({ rank: null, rankText: 'DNF', bib: '138', irm: 'DNF', timeText: null });
  });

  it('rechaza fecha equivocada, unidad ajena y recuentos inconsistentes', () => {
    expect(() => parsePdfText(results, { expectedDate: '2026-09-16' })).toThrow('no de 2026-09-16');
    expect(() => parsePdfText(results, { expectedEventToken: 'CRDMTT----------------FNL-000100--' })).toThrow('unidad esperada');
    expect(() => parsePdfText(results.replace('5 / 3                    3', '5 / 3                    2'))).toThrow('declara 2');
  });

  it('descarta las líneas de parciales intermedias', () => {
    expect(parseRow('                                                                                                 15:40.16 (1) 15:54.24 (2)')).toBeNull();
    expect(parseRow('            5        117 SOTO Catalina                          CHI      16:23.79 (4) 32:49.02 (5) 48:53.46 (5)       48:53.46   +1:18.42            44.187'))
      .toMatchObject({ rank: 5, bib: '117', timeText: '48:53', gapText: '+1:18' });
  });

  it('localiza el cuadro Results de la unidad y elige la revisión mayor', () => {
    const payload = { Events: [{ Key: 'W.TT----------------', Phases: [{ Units: [{ Reports: [
      { Desc: 'Start List', Version: 2, Revision: 0, URL: 'https://results.santafe2026.org/a.pdf' },
      { Desc: 'Results', Version: 1, Revision: 0, URL: 'https://results.santafe2026.org/b.pdf' },
      { Desc: 'Results', Version: 1, Revision: 1, URL: 'https://results.santafe2026.org/c.pdf' },
    ] }] }] }] };
    expect(findResultReport(payload, 'W.TT----------------')?.report.URL).toContain('c.pdf');
    expect(findResultReport(payload, 'M.TT----------------')).toBeNull();
  });

  it('localiza la unidad por evento y fecha, y construye la URL de resultados', () => {
    const payload = { Events: [{ Key: 'W.RR----------------', Phases: [{ Units: [
      { Key: 'W.RR----------------.FNL-.000100--', DateTimeRaw: '2026-09-18T09:00:00-03:00' },
    ] }] }] };
    expect(findEventUnit(payload, 'W.RR----------------', '2026-09-18')?.Key).toBe('W.RR----------------.FNL-.000100--');
    expect(findEventUnit(payload, 'M.RR----------------')).toBeNull();
    expect(resultsUrl(parseCode(CODE), 'W.RR----------------.FNL-.000100--'))
      .toBe('https://back.results.santafe2026.org/s/JSUD2026/en/CRD/results/W.RR----------------.FNL-.000100--');
  });

  it('interpreta la clasificación estructurada oficial con huecos e IRM', () => {
    const stage = parseUnitResults(unitResults, { expectedDate: '2026-09-18', expectedEventKey: 'W.RR----------------' });
    const classification = stage.classifications[0];
    expect(stage).toMatchObject({ stageNumber: null, dateKey: '2026-09-18', raceType: 'IRR', eventName: 'Results' });
    expect(classification).toMatchObject({ classKind: 'gc', scope: 'stage', rowCount: 3, expectedRowCount: 3, winnerName: 'BENEDETTI Julieta' });
    expect(classification.rows[0]).toMatchObject({ rank: 1, bib: '101', isoCode2: 'ar', timeText: '2:47:47', gapText: null, irm: null });
    expect(classification.rows[1]).toMatchObject({ rank: 2, bib: '121', isoCode2: 'co', gapText: '+0:00', resultValue: '+0:00' });
    expect(classification.rows[2]).toMatchObject({ rank: null, rankText: 'OTL', bib: '135', isoCode2: 'pe', timeText: null, irm: 'OTL' });
  });

  it('rechaza unidades no oficiales, de otra fecha o con anomalías', () => {
    expect(() => parseUnitResults({ ...unitResults, Info: { ...unitResults.Info, Status: 'START_LIST' } })).toThrow('OFFICIAL');
    expect(() => parseUnitResults(unitResults, { expectedDate: '2026-09-17' })).toThrow('no de 2026-09-17');
    expect(() => parseUnitResults(unitResults, { expectedEventKey: 'M.RR----------------' })).toThrow('unidad esperada');
    const noWinner = { ...unitResults, Competitors: [{ Rk: '', Bib: '135', Org: 'PER', Result: '', Diff: '', IRM: 'DNF', Name: 'LEWIS Flor' }] };
    expect(() => parseUnitResults(noWinner)).toThrow('ganador');
    const duplicate = { ...unitResults, Competitors: [...unitResults.Competitors, { Rk: '3', Bib: '101', Org: 'ARG', Result: '2:48:00', IRM: 'OK', Name: 'OTRA Corredora' }] };
    expect(() => parseUnitResults(duplicate)).toThrow('dorsales duplicados');
    const orphan = { ...unitResults, Competitors: [{ Rk: '', Bib: '999', Org: 'ARG', Result: '', IRM: 'OK', Name: 'SIN Estado' }] };
    expect(() => parseUnitResults(orphan)).toThrow('puesto ni IRM');
  });

  it('decodifica las respuestas comprimidas de la API Bornan', () => {
    const payload = JSON.stringify({ Events: [] });
    const deflate = zlib.deflateSync(Buffer.from(payload));
    const mangled = Buffer.from(deflate.toString('latin1'), 'utf8');
    expect(decodeJsonBuffer(deflate)).toEqual({ Events: [] });
    expect(decodeJsonBuffer(zlib.gzipSync(Buffer.from(payload)))).toEqual({ Events: [] });
    expect(decodeJsonBuffer(mangled)).toEqual({ Events: [] });
    expect(decodeJsonBuffer(zlib.gzipSync(mangled))).toEqual({ Events: [] });
  });

  it('construye la URL del índice de informes', () => {
    expect(reportsIndexUrl(parseCode(CODE))).toBe('https://back.results.santafe2026.org/s/JSUD2026/en/CRD/reports/all');
  });
});
