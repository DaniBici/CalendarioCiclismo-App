import { describe, expect, it } from 'vitest';
import {
  isPlaceholder,
  parseCode,
  parsePdfText,
  parseResultRow,
  resultPdfUrl,
  suggestCompetitionId,
} from '../../scripts/results-fetchers/belgiancycling-results-fetch.mjs';

const result = `
                             GP LUCIEN VAN IMPE                                        UITSLAG - RESULTAT - RESULT
Deelnemers: 4                                      140 km
                                                 3:31:19                                39,751 km/u                20/08/2026
Rang Nr UCIcode               Naam / Nom                     Ploeg / Equipe                                  Tijd/Achterstand - Temps

1     31 NED 100 157 612 68 KOOL Charlotte                   FPC   FENIX-PREMIER TECH                              3:31:19
2     51 NED 100 066 056 80 BRAND Lucinda                    LTK   LIDL-TREK                                       0:00:00
3     22 SWE100 226 195 72 KAGEVI Stina                      EFO   EF EDUCATION - OATLY                            0:02:00
DNS / Non partants / Niet vertrokken :
         2 LUX 100 349 984 89 SCHREIBER Marie                  SDW   TEAM SD WORX - PROTIME
DNF / Abandons / Opgaves :
        44 AUT 100 098 622 54 SCHWEINBERGER Kathrin            HPH   HUMAN POWERED HEALTH
`;

describe('Belgian Cycling — PDF oficial', () => {
  it('deriva la URL estable y el identificador sintético', () => {
    expect(parseCode('2026236')).toBe('2026236');
    expect(resultPdfUrl('2026236')).toBe('https://uitslagen.kbwb-rlvb.com/uitslagen/2026/2026236-U.pdf');
    expect(suggestCompetitionId('2026236')).toBeLessThan(0);
    expect(() => parseCode('https://example.com/result.pdf')).toThrow('identificador numérico');
  });

  it('reconoce el marcador anterior a la publicación', () => {
    expect(isPlaceholder('Info nog niet beschikbaar\nLes informations pas encore disponible\nInformation not yet available')).toBe(true);
    expect(parsePdfText('2026236', 'Information not yet available', '2026-08-21')).toBeNull();
  });

  it('extrae clasificados e IRM con dorsal, UCI ID, tiempos y gaps', () => {
    const stage = parsePdfText('2026233', result, '2026-08-20');
    const classification = stage.classifications[0];
    expect(stage).toMatchObject({ stageNumber: null, dateKey: '2026-08-20', raceType: 'IRR' });
    expect(classification).toMatchObject({ classKind: 'gc', scope: 'stage', rowCount: 5, expectedRowCount: 5, winnerName: 'KOOL Charlotte' });
    expect(classification.rows[0]).toMatchObject({ rank: 1, bib: '31', uciId: '10015761268', isoCode2: 'nl', timeText: '3:31:19' });
    expect(classification.rows[1]).toMatchObject({ rank: 2, bib: '51', gapText: '+00' });
    expect(classification.rows[2]).toMatchObject({ rank: 3, bib: '22', isoCode2: 'se', gapText: '+2:00' });
    expect(classification.rows[3]).toMatchObject({ rank: null, rankText: 'DNS', bib: '2', irm: 'DNS' });
    expect(classification.rows[4]).toMatchObject({ rank: null, rankText: 'DNF', bib: '44', irm: 'DNF' });
  });

  it('rechaza fechas lejanas y resultados parciales', () => {
    expect(() => parsePdfText('2026233', result, '2026-08-22')).toThrow('no de 2026-08-22');
    expect(() => parsePdfText('2026233', result.replace('Deelnemers: 4', 'Deelnemers: 5'))).toThrow('PDF declara 6');
  });

  it('normaliza una errata de un día en la fecha impresa a la fecha de la jornada', () => {
    const stage = parsePdfText('2026233', result, '2026-08-21');
    expect(stage.dateKey).toBe('2026-08-21');
    expect(stage.classifications[0].rowCount).toBe(5);
  });

  it('no interpreta una fila sin puesto fuera de un bloque IRM', () => {
    const line = '        44 AUT 100 098 622 54 SCHWEINBERGER Kathrin            HPH   HUMAN POWERED HEALTH';
    expect(parseResultRow(line)).toBeNull();
    expect(parseResultRow(line, 'DNF')).toMatchObject({ bib: '44', irm: 'DNF' });
  });

  it('extrae las filas de club sin código UCI de equipo', () => {
    const clubResult = `
                             KRINGWEDSTRIJD                                           UITSLAG - RESULTAT - RESULT
Deelnemers: 3                                      150 km
                                                  3:00:00                                50,000 km/u                18/09/2026
Rang Nr UCIcode               Naam / Nom                     Ploeg / Equipe                                  Tijd/Achterstand - Temps

1      11 BEL 100 111 111 11 VOS Aimee                            WCB   WIELERCLUB BRABANT                       3:00:00
2      12 BEL 100 222 222 22 PEETERS Ward                               AARCO                            0:01:00
DNF / Abbandons / Opgaves :
      13 BEL 100 333 333 33 JANSSENS Kamiel                             AARCO
`;
    const stage = parsePdfText('2026276', clubResult, '2026-09-18');
    const rows = stage.classifications[0].rows;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ rank: 2, bib: '12', teamCode: null, teamName: 'AARCO', gapText: '+1:00' });
    expect(rows[2]).toMatchObject({ rank: null, rankText: 'DNF', bib: '13', teamCode: null, teamName: 'AARCO' });
  });
});
