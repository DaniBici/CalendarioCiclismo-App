import { describe, expect, it } from 'vitest';
import { individualRows, pageUrl, parsePdfs, pdfLinksFromHtml, suggestCompetitionId } from '../../scripts/results-fetchers/burgos-results-fetch.mjs';

const stagePdf = `SALIDA - META 07/08/2026
ETAPA                                                        Pag. 1
 1º    21   BRENNAN, Matthew             GBR   TVL   4:01:12
 2º    35   PITHIE, Laurence             NZL   RBH      m.t.
 3º   175   GONZALEZ LOPEZ, David        ESP   PQT     a 34
NO SALIDOS
      81 BILBAO LOPEZ DE ARMENTIA, PelloESP   TBV
\fPUNTOS ETAPA
 1º 21 BRENNAN, Matthew GBR TEAM VISMA 25`;
const generalPdf = `GENERAL
 1º    51   GALL, Felix                  AUT   DCT   16:19:30
 2º    61   CICCONE, Giulio              ITA   LTK       a 6
\fGENERAL POR PUNTOS
 1º    21   BRENNAN, Matthew             GBR   TEAM VISMA | LEASE A BIKE 50
 2º    61   CICCONE, Giulio              ITA   LIDL-TREK 40
\fGENERAL MONTAÑA
 1º   207   URIARTE BELZUNEGI, Diego     ESP   EQUIPO KERN PHARMA 34
 2º    16   ONLEY, Edgar Oscar           GBR   NETCOMPANY INEOS 31
\fGENERAL JOVENES
 1º    52   BISIAUX, Léo                 FRA   DCT   16:20:25
 2º   126   WIDAR, Jarno                 BEL   LOI       a 1
\fGENERAL EQUIPOS
 1º   TEAM PICNIC POSTNL                 TPP   49:02:38
 2º   UAE TEAM EMIRATES XRG              UEX      a 15`;

describe('Vuelta a Burgos — PDF', () => {
  it('deriva la URL estable de cada etapa y localiza ambos PDFs', () => {
    expect(pageUrl(5)).toBe('https://www.vueltaburgos.com/es/clasificaciones-5a-etapa/');
    expect(pdfLinksFromHtml('<a href="/e.pdf">Clasificaciones de la etapa</a><a href="/g.pdf">Clasificación General</a>')).toEqual({ stage: 'https://www.vueltaburgos.com/e.pdf', general: 'https://www.vueltaburgos.com/g.pdf' });
    expect(suggestCompetitionId(2026)).toBeLessThan(0);
  });

  it('emite las seis clasificaciones públicas con dorsales, tiempos y puntos', () => {
    const { stage, final } = parsePdfs(2026, 5, stagePdf, generalPdf, 5);
    expect(stage.dateKey).toBe('2026-08-07');
    expect(stage.classifications.map((c) => c.classKind)).toEqual(['stage', 'gc', 'points', 'kom', 'youth', 'teams']);
    expect(stage.classifications[0].rows[1]).toMatchObject({ bib: '35', gapText: '+0' });
    expect(stage.classifications[0].rows.at(-1)).toMatchObject({ bib: '81', irm: 'DNS' });
    expect(stage.classifications[1].rows[1]).toMatchObject({ bib: '61', gapText: '+6' });
    expect(stage.classifications[2].rows[0]).toMatchObject({ points: 50, resultValue: '50' });
    expect(stage.classifications[5]).toMatchObject({ isTeamEvent: true, rowCount: 2 });
    expect(stage.classifications[5].rows[1]).toMatchObject({ riderDisplay: 'UAE TEAM EMIRATES XRG', gapText: '+15' });
    expect(final.stageNumber).toBeNull();
    expect(final.classifications).toHaveLength(5);
    expect(new Set(final.classifications.map((c) => c.eventId)).size).toBe(5);
  });

  it('conserva el gap cuando el PDF añade segundos de bonificación', () => {
    const withBonus = stagePdf.replace('2º    35   PITHIE, Laurence             NZL   RBH      m.t.', '2º    35   PITHIE, Laurence             NZL   RBH      a 3    6"');
    const { stage } = parsePdfs(2026, 2, withBonus, generalPdf, null, -41848);
    expect(stage.classifications[0].rows[1].gapText).toBe('+3');
  });

  it('no confunde apellidos con códigos ni pierde filas partidas por el OCR del PDF', () => {
    const rows = individualRows([`44º   171 DE LA CRUZ MELGAREJO, David ESP PQT a 4:09
85º   153 ESP
     IBAÑEZ BELTRAN DE SALAZAR, Javier CJR a 13:41
12º 47º 96 PESCADOR CASTRO, Fernando COL
          DiegoMOV a 10:43`]);
    expect(rows).toMatchObject([
      { rank: 12, bib: '96', riderDisplay: 'PESCADOR CASTRO, Fernando Diego', isoCode2: 'co', gapText: '+10:43' },
      { rank: 44, bib: '171', riderDisplay: 'DE LA CRUZ MELGAREJO, David', isoCode2: 'es', gapText: '+4:09' },
      { rank: 85, bib: '153', riderDisplay: 'IBAÑEZ BELTRAN DE SALAZAR, Javier', isoCode2: 'es', gapText: '+13:41' },
    ]);
  });
});
