import { describe, expect, it } from 'vitest';
import { assertSelectedPdfsParsed, cronoIndividualRow, normalizeColombiaTeamName, parseCode, parseOneDayPdfText, pdfLinksFromRaceHtml, parsePdfText, stageFromLabel, suggestCompetitionId, validateExpectedYear } from '../../scripts/results-fetchers/colombia-pdf-results-fetch.mjs';

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

const oneDayLayout = `
CLASIFICACION GRAN PRIX CHITRE
Fecha                 : 27/08/26
Cls     Dor UCI-ID        Apellido,Nombre     Categ Nac Equipo                       Tiempos Diferen.
------------------------------------------------------------------------------------------------------
  1       15 10009690987 PAREDES,Wilmar Andre ELITE COL TEAM MEDELLIN EPM            02:31:01
  2       54 10035361534 GOMEZ,Nicolas        ELITE COL GW ERCO SPORTFITNESS              mt.
  3        1 10009436262 RAJOVIC,Dusan        ELITE SRB SOLUTION TECH NIPPO RALI 02:31:03 2
  4 Fc    64 10158845160 FLORES,Emiliano      ELITE MEX ESPARZA T - UN ISIMA DE M 02:54:22 23:21
Corredores clasificados : 4

CORREDORES QUE NO TOMARON LA PARTIDA/DNS
--------------------------------------------------------------------------------
 --     111 10170518001 BECERRA,Kristian      ELITE VEN ILC CYCLING TEAM

CORREDORES FUERA DEL LIMITE DE TIEMPO/OTL
--------------------------------------------------------------------------------
    64 FLORES,Emiliano

CORREDORES RETIRADOS/DNF
--------------------------------------------------------------------------------
 --      35 10010110818 HERNANDEZ,Nolberto    ELITE PAN SENAFRONT PANAMÁ

FDO
`;

describe('Clasificaciones del Ciclismo Colombiano — PDF', () => {
  it('descubre 3A/3B sin colapsarlas y corresponde las seis jornadas de Santa Catarina', () => {
    const labels = ['1', '2', '3a', '3b', '4', '5'];
    const html = labels.map((stage) => `<a href="/files/clasificacion-etapa-${stage}_0.pdf">clasificacion-etapa-${stage}.pdf</a>`).join('\n');
    const links = pdfLinksFromRaceHtml(html, { code: 'volta-santa-catarina-2026' });
    expect(links.map(({ stageNumber }) => stageNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(links.filter((link) => link.stageNumber === 3).map((link) => link.href)).toEqual([
      'https://www.clasificacionesdelciclismocolombiano.com/files/clasificacion-etapa-3a_0.pdf',
    ]);
    expect(links.filter((link) => link.stageNumber === 4).map((link) => link.href)).toEqual([
      'https://www.clasificacionesdelciclismocolombiano.com/files/clasificacion-etapa-3b_0.pdf',
    ]);
    expect(stageFromLabel('CLASIFICACIÓN ETAPA 3A')).toBe('3A');
    expect(stageFromLabel('CLASIFICACION 1A ETAPA')).toBe(1);
    expect(() => pdfLinksFromRaceHtml(html, { code: 'otra-carrera' })).toThrow('correspondencia de jornadas');
  });

  it('selecciona las generales acumuladas y conserva la llegada frente a un DNF contradictorio', () => {
    const text = `CLASIFICACION ETAPA 3A\n04.SEPT.2026
CLASIFICACION ETAPA 3A
Fecha: 04/09/26
1 102 10093536272 RABELO,Euller ELITE BRA ANDBANK CYCLING TEAM 02:44:31
2 5 10115991974 CAMARGO,Yeferson SUB23 COL TEAM MEDELLIN EPM 02:45:10 39
Corredores clasificados: 2
DNS:
3 10083945396 GONZALEZ David COL MED
31 10119250568 BAEZA Cristobal CHI PPZ
DNF:
5 10115991974 CAMARGO Yeferson COL MED
154 10051156770 MONGES Jonathan PAR
CLASIFICACION SUB23 DE LA ETAPA
1 136 SILVA,Vin SUB23 SÃO JOSÉ CICLISMO 02:44:45
CLASIFICACION POR EQUIPOS DE LA ETAPA
1 ANDBANK CYCLING TEAM 08:13:33
CLASIFICACION POR PUNTOS DE LA ETAPA
1 102 RABELO,Euller ELITE ANDBANK CYCLING TEAM 10 Pts
CLASIFICACION GENERAL
1.-22 JAMAICA,Javier ELITE NU COLOMBIA 08:27:06
2.-5 CAMARGO,Yeferson SUB23 TEAM MEDELLIN EPM 08:38:07 a 11:01
CLASIFICACION GENERAL POR EQUIPOS
1.- NU COLOMBIA 25:22:38
2.- TEAM MEDELLIN EPM 25:23:39 a 1:01
CLASIFICACION GENERAL POR PUNTOS
1 34 KOTSAKIS,Francisco ELITE 23 Pts
2 22 JAMAICA,Javier ELITE 15 Pts
CLASIFICACION GENERAL DE MONTAÑA
1 23 GUTIERREZ,Carlos ELITE 15 Pts
2 103 FERREIRA,Alex ELITE 12 Pts
CLASIFICACION GENERAL DE SUB23
1.-64 FREITAS,Guilherme SUB23 AVAI 08:29:14
2.-136 SILVA,Vinicius SUB23 SÃO JOSÉ CICLISMO 08:29:56 a 42
`;
    const { stage, final } = parsePdfText('volta-santa-catarina-2026', 3, text, 6, 2026, '2026-09-04');
    const classes = Object.fromEntries(stage.classifications.map((item) => [item.classKind, item]));
    expect(Object.keys(classes)).toEqual(['stage', 'gc', 'points', 'kom', 'youth', 'teams']);
    expect(classes.stage.rows.map(({ bib, irm }) => [bib, irm])).toEqual([
      ['102', null], ['5', null], ['3', 'DNS'], ['31', 'DNS'], ['154', 'DNF'],
    ]);
    expect(classes.points.rows[0]).toMatchObject({ bib: '34', points: 23 });
    expect(classes.kom.rows[0]).toMatchObject({ bib: '23', points: 15 });
    expect(classes.youth.rows[0]).toMatchObject({ bib: '64', timeText: '8:29:14' });
    expect(classes.teams.rows[0]).toMatchObject({ teamName: 'Nu Colombia', timeText: '25:22:38' });
    expect(final).toBeNull();
    expect(() => parsePdfText('volta-santa-catarina-2026', 5, text, 6, 2026, '2026-09-05')).toThrow('no de 2026-09-05');
  });

  it('descubre las dos etapas de Clásica Azuero en la estructura Drupal de la página', () => {
    const html = `
      <div class="field--name-field-etapas field--type-entity-reference field-items">
        <a href="/sites/default/files/documents/guia-tecnica-clasica-azuero-2026.pdf">Guia Técnica</a>
        <a href="/sites/default/files/documents/listado-de-inscritos-clasica-de-azuero-panama-2026.pdf">LISTADO DE INSCRITOS</a>
        <a href="/sites/default/files/documents/clasificacion-primera-etapa-clasica-azuero-2026.pdf">CLASIFICACION PRIMERA ETAPA</a>
        <a href="/sites/default/files/documents/clasificacion-segunda-etapa-clasica-azuero-2026.pdf">CLASIFICACION SEGUNDA ETAPA</a>
      </div>`;
    expect(pdfLinksFromRaceHtml(html).map(({ stageNumber, href }) => [stageNumber, href])).toEqual([
      [1, 'https://www.clasificacionesdelciclismocolombiano.com/sites/default/files/documents/clasificacion-primera-etapa-clasica-azuero-2026.pdf'],
      [2, 'https://www.clasificacionesdelciclismocolombiano.com/sites/default/files/documents/clasificacion-segunda-etapa-clasica-azuero-2026.pdf'],
    ]);
    expect(stageFromLabel('CLASIFICACIÓN ETAPA 2')).toBe(2);
    expect(stageFromLabel('CLASIFICACION 1A ETAPA')).toBe(1);
  });

  it('descubre solo PDFs de etapas y normaliza el slug', () => {
    const links = pdfLinksFromRaceHtml('<a href="/files/guia.pdf">Guía técnica</a><a href="/files/e1.pdf">CLASIFICACION PRIMERA ETAPA</a><a href="/files/e2.pdf">CLASIFICACION SEGUNDA ETAPA</a>');
    expect(links.map((link) => link.stageNumber)).toEqual([1, 2]);
    expect(pdfLinksFromRaceHtml('<a href="/files/chitre.pdf">CLASIFICACION GRAN PRIX CHITRE</a>', { oneDay: true })).toMatchObject([{ stageNumber: null }]);
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

  it('procesa una carrera de un día y traslada DNS, OTL y DNF al final', () => {
    const { stage } = parseOneDayPdfText('gran-prix-chitre-2026', oneDayLayout, 'https://example.test/chitre.pdf');
    const classification = stage.classifications[0];
    expect(stage).toMatchObject({ stageNumber: null, isFinalClassification: true, dateKey: '2026-08-27', sourcePdfUrl: 'https://example.test/chitre.pdf' });
    expect(classification).toMatchObject({ classKind: 'gc', scope: 'stage', rowCount: 6, expectedRowCount: 6 });
    expect(classification.rows.slice(0, 3).map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(classification.rows.slice(3).map((row) => [row.bib, row.irm])).toEqual([['111', 'DNS'], ['64', 'OTL'], ['35', 'DNF']]);
    expect(classification.rows[1]).toMatchObject({ resultValue: '+0', gapText: '+0' });
  });

  it('conserva IRM de una etapa y genera la clasificación final de Azuero en la etapa 2', () => {
    const azuero = `
CLASIFICACION SEGUNDA ETAPA
Fecha                 : 30/08/26
Cls     Dor UCI-ID        Apellido,Nombre     Categ Nac Equipo                       Tiempos Diferen.
------------------------------------------------------------------------------------------------------
  1       75 10009690987 PAREDES,Wilmar Andre ELITE COL TEAM MEDELLIN EPM            03:00:00
  2       54 10035361534 GOMEZ,Nicolas        ELITE COL GW ERCO SPORTFITNESS          03:00:05 5
  3       17 10009436262 RAJOVIC,Dusan        ELITE SRB SOLUTION TECH NIPPO RALI      03:00:10 10
Corredores clasificados : 3

CORREDORES RETIRADOS/DNF
--------------------------------------------------------------------------------
 --      42 10012345678 LOPEZ,Carlos         ELITE COL TEAM MEDELLIN EPM              NDF

CLASIFICACION GENERAL
  1.-75 10009690987 PAREDES,Wilmar Andre ELITE COL TEAM MEDELLIN EPM 05:00:00-000
  2.-54 10035361534 GOMEZ,Nicolas        ELITE COL GW ERCO SPORTFITNESS   05:00:05-000 a 5
  3.-17 10009436262 RAJOVIC,Dusan        ELITE SRB SOLUTION TECH NIPPO RALI 05:00:10-000 a 10
`;
    const { stage, final } = parsePdfText('clasica-azuero-2026', 2, azuero, 2, 2026);
    const stageClassification = stage.classifications.find((item) => item.classKind === 'stage');
    expect(stage.dateKey).toBe('2026-08-30');
    expect(stageClassification.rows.at(-1)).toMatchObject({ bib: '42', irm: 'DNF', rank: null });
    expect(final.classifications.find((item) => item.classKind === 'gc')).toMatchObject({ scope: 'stage', eventId: expect.any(Number) });
  });

  it('acepta la portada y el formato de filas de la Volta de Santa Catarina', () => {
    const santaCatarina = `
1RA ETAPA POMERODE – ASCURRA 117.2 KM
            02.SEPT.2026
\f
CLASIFICACIÓN 1 ETAPA / STAGE 1 CLASSIFICATION
Fecha                 : 01/09/26
Cls Dor UCI-ID Apellido,Nombre Categ Nac Equipo Tiempos Diferen.
  1 34 10117664519 KOTSAKIS,Francisco ELITE CHI PLUS PERFORMANCE-ZEO SPRT 02:32:51 -10
  2 Fc 95 10177461480 SPENGLER,Giovani ELITE BRA APROCICLI PMC CHAPECO 02:59:17 26:26
Corredores clasificados : 2
DNF: 185 – 10173418301 - BAU Orlando Isidoro BRA - SELEÇÃO GAUCHA
`;
    const { stage } = parsePdfText('volta-santa-catarina-2026', 1, santaCatarina, 6, 2026);
    const classification = stage.classifications.find((item) => item.classKind === 'stage');
    expect(stage.dateKey).toBe('2026-09-02');
    expect(classification.rows.map((row) => [row.bib, row.rank, row.irm])).toEqual([
      ['34', 1, null],
      ['95', null, 'OTL'],
      ['185', null, 'DNF'],
    ]);
    expect(classification.rows[0]).toMatchObject({ isoCode2: 'cl' });
    expect(classification.rows[1]).toMatchObject({ isoCode2: 'br' });
  });

  it('rechaza un PDF cuyo año no coincide con la carrera configurada', () => {
    expect(() => validateExpectedYear('Fecha : 30/08/25', 2026, 'Azuero')).toThrow('incompatible');
    expect(() => validateExpectedYear('Fecha : 30/08/26', 2026, 'Azuero')).not.toThrow();
    expect(() => validateExpectedYear('02.SEPT.2026\fFecha : 01/09/26', 2026, 'Santa Catarina')).not.toThrow();
    expect(() => validateExpectedYear('\fFecha : 30/08/26', 2026, 'Azuero')).toThrow('no se pudo verificar');
  });

  it('propaga como error un PDF descubierto que no produce ninguna etapa', () => {
    expect(() => assertSelectedPdfsParsed(1, 0, 1)).toThrow('No se pudo interpretar ninguno');
    expect(() => assertSelectedPdfsParsed(0, 0, 0)).not.toThrow();
    expect(() => assertSelectedPdfsParsed(2, 1, 1)).not.toThrow();
  });

  it('normaliza las abreviaturas del PDF a los nombres de la startlist', () => {
    expect(normalizeColombiaTeamName('4WD RENTACAR FACATATIVA')).toBe('4WD Rent a Car - Facatativa');
    expect(normalizeColombiaTeamName('CANELS JAVA')).toBe("Canel's - Java");
    expect(normalizeColombiaTeamName('GOB PUTUMAYO-B.STRONGMAN')).toBe('Gobernación Putumayo-Bicicletas Strongman');
    expect(normalizeColombiaTeamName('AG NECTAR-C.MARCA-S.NATUR')).toBe('AG Néctar-Cundinamarca-Somos Natural');
  });
});
