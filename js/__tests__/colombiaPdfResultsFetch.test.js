import { describe, expect, it } from 'vitest';
import { cronoIndividualRow, normalizeColombiaTeamName, parseCode, pdfLinksFromRaceHtml, parsePdfText, stageFromLabel, suggestCompetitionId } from '../../scripts/results-fetchers/colombia-pdf-results-fetch.mjs';

const layout = `
CLASIFICACION PRIMERA ETAPA YOPAL-PORE-TRINIDAD
Fecha                 : 20/07/26
Cls     Dor Apellido,Nombre       Categ Publicidad                 Tiempos   Diferencia Bomif
---------------------------------------------------------------------------------------------
  1        6 VÉLEZ,Cristian Damian SUB23 TEAM SISTECREDITO          02:46:00               -13
  2       17 MANRIQUE,Julian Leon SUB23 NU COLOMBIA                02:46:00           mt.-06
  3       27 JIMENEZ,Nelson Fabian SUB23 GW ERCO SPORTFITNESS       02:46:08           8 seg.
Corredores clasificados : 3
CLASIFICACION POR EQUIPOS DE LA ETAPA Y GENERAL
  1 NU COLOMBIA 08:18:00
  2 TEAM SISTECREDITO 08:18:05 a 5 seg.
CLASIFICACION POR PUNTOS DE LA ETAPA Y GENERAL
  1 6 VÉLEZ,Cristian Damian SUB23 TEAM SISTECREDITO 18 Pts
  2 17 MANRIQUE,Julian Leon SUB23 NU COLOMBIA 12 Pts
CLASIFICACION GENERAL
1.-6 VÉLEZ,Cristian Damian SUB23 TEAM SISTECREDITO 02:45:47-000
2.-17 MANRIQUE,Julian Leon SUB23 NU COLOMBIA 02:45:54-000 a 7
3.-27 JIMENEZ,Nelson Fabian SUB23 GW ERCO SPORTFITNESS 02:45:55-000 a 8
`;

describe('Clasificaciones del Ciclismo Colombiano — PDF', () => {
  it('descubre solo PDFs de etapas y normaliza el slug', () => {
    const links = pdfLinksFromRaceHtml('<a href="/files/guia.pdf">Guía técnica</a><a href="/files/e1.pdf">CLASIFICACION PRIMERA ETAPA</a><a href="/files/e2.pdf">CLASIFICACION SEGUNDA ETAPA</a>');
    expect(links.map((link) => link.stageNumber)).toEqual([1, 2]);
    expect(stageFromLabel('CLASIFICACION SÉPTIMA ETAPA')).toBe(7);
    expect(parseCode('/vuelta-colombia-sistecredito-2026/')).toBe('vuelta-colombia-sistecredito-2026');
    expect(suggestCompetitionId('vuelta-colombia-sistecredito-2026')).toBeLessThan(0);
  });

  it('conserva filas, dorsales, tiempos y generales desde pdftotext -layout', () => {
    const { stage, final } = parsePdfText('vuelta-colombia-sistecredito-2026', 1, layout, 1);
    const stageRows = stage.classifications.find((item) => item.classKind === 'stage').rows;
    expect(stage.dateKey).toBe('2026-07-20');
    expect(stageRows).toHaveLength(3);
    expect(stageRows[0]).toMatchObject({ rank: 1, bib: '6', timeText: '2:46:00', riderDisplay: 'VÉLEZ,Cristian Damian' });
    expect(stageRows[2].gapText).toBe('+8');
    expect(stage.classifications.find((item) => item.classKind === 'gc').rows[1].gapText).toBe('+7');
    expect(stage.classifications.find((item) => item.classKind === 'points').rows[0].points).toBe(18);
    expect(stage.classifications.find((item) => item.classKind === 'teams').isTeamEvent).toBe(true);
    expect(final.stageNumber).toBeNull();
    expect(final.classifications.some((item) => item.classKind === 'gc')).toBe(true);
  });

  it('rechaza una etapa parcial antes del upsert', () => {
    expect(() => parsePdfText('carrera-2026', 1, layout.replace('Corredores clasificados : 3', 'Corredores clasificados : 4'))).toThrow('filas extraídas');
  });

  it('lee una CRI sin categoría y toma T.Final, no el intermedio', () => {
    const cri = `CLASIFICACION TERCERA ETAPA C.R.I\nFecha : 22/07/26\nCls Dor Apellido,Nombre Publicidad T.Inter T.Final Diferencia\n1 5 PLAZAS,Robert Andres    TEAM SISTECREDITO           00:21:15:330    00:40:08-62\n2 3 ZAPATA,Mauricio         TEAM SISTECREDITO           00:21:30:430    00:40:19-98    11 seg.\nCorredores clasificados: 2`;
    expect(cronoIndividualRow('1    5 PLAZAS,Robert Andres    TEAM SISTECREDITO           00:21:15:330    00:40:08-62')).toMatchObject({ bib: '5', timeText: '0:40:08' });
    const rows = parsePdfText('carrera-2026', 3, cri).stage.classifications[0].rows;
    expect(rows[0]).toMatchObject({ bib: '5', timeText: '0:40:08', teamName: 'TEAM SISTECREDITO' });
    expect(rows[1].gapText).toBe('+11');
  });

  it('acepta las columnas UCI-ID, nacionalidad y mt. de la Vuelta a Colombia', () => {
    const uciLayout = `CLASIFICACION PRIMERA ETAPA NEIVA-PITALITO
Fecha : 08/08/26
Cls Dor UCI-ID Apellido,Nombre Categ Nac Equipo Tiempos Diferen.
 1 75 10009690987 PAREDES,Wilmar Andre ELITE COL TEAM MEDELLIN EPM 04:52:52
 2 172 10035339811 CASTILLO,Kevin David ELITE COL ORGULLO PAISA mt.
 3 25 10119469527 MONTEROS,Luis Javier ELITE ECU BEST PC ECUADOR mt.
 4 37 10015021240 MATUTE,Fredd ELITE HON 4WD RENTACAR FACATATIVA 05:08:31 15:39-06
 5 41 10012345678 GARCIA,Juan David ELITE COL TEAM FICTICIO mt.
 6 48 10012345679 PEREZ,Carlos Andres ELITE COL TEAM FICTICIO mt.
Corredores clasificados : 6`;
    const rows = parsePdfText('vuelta-colombia-sistecredito-2026', 1, uciLayout).stage.classifications[0].rows;
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ bib: '75', isoCode2: 'co', timeText: '4:52:52' });
    expect(rows[1]).toMatchObject({ bib: '172', resultValue: '+0', timeText: null, gapText: '+0' });
    expect(rows[2]).toMatchObject({ bib: '25', isoCode2: 'ec' });
    expect(rows[3]).toMatchObject({ bib: '37', resultValue: '+15:39', timeText: null, gapText: '+15:39' });
    expect(rows[4]).toMatchObject({ bib: '41', resultValue: '+15:39', timeText: null, gapText: '+15:39' });
    expect(rows[5]).toMatchObject({ bib: '48', resultValue: '+15:39', timeText: null, gapText: '+15:39' });
  });

  it('normaliza las abreviaturas del PDF a los nombres de la startlist', () => {
    expect(normalizeColombiaTeamName('4WD RENTACAR FACATATIVA')).toBe('4WD Rent a Car - Facatativa');
    expect(normalizeColombiaTeamName('CANELS JAVA')).toBe("Canel's - Java");
    expect(normalizeColombiaTeamName('GOB PUTUMAYO-B.STRONGMAN')).toBe('Gobernación Putumayo-Bicicletas Strongman');
    expect(normalizeColombiaTeamName('AG NECTAR-C.MARCA-S.NATUR')).toBe('AG Néctar-Cundinamarca-Somos Natural');
  });
});
