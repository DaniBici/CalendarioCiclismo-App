import { describe, it, expect } from 'vitest';
import { irmOf, normAbsTime, normGap, clockSeconds, secondsGap, normalizeStageGaps, parseRows, parsePointsRows, parseTeamRows, hasFinalRanking, decodeEntities, stripTags, dateFromCat, fnv1a }
  from '../../scripts/results-fetchers/sportstiming-results-fetch.mjs';

// Fuente: sportstiming.dk (cronometrador DANÉS). Sin API JSON: se lee el HTML
// server-side. Contrato verificado contra la Copenhagen Sprint (edición 2025,
// /event/16511; femenina 2026 volcada en vivo desde /event/18776).
// Contrato completo en scripts/results-fetchers/SPORTSTIMING-API.md.

describe('irmOf — placement danés → IRM UCI', () => {
  it('mapea los códigos de abandono', () => {
    expect(irmOf('DNF')).toBe('DNF');
    expect(irmOf('DNS')).toBe('DNS');
    expect(irmOf('DSQ')).toBe('DSQ');
    expect(irmOf('OTL')).toBe('OTL');
  });

  it('mapea las variantes que también aparecen en estos feeds', () => {
    expect(irmOf('DQ')).toBe('DSQ');
    expect(irmOf('HD')).toBe('OTL');
    expect(irmOf('AB')).toBe('DNF');
    expect(irmOf('NP')).toBe('DNS');
  });

  it('un PUESTO numérico no es un IRM (el placement es la misma columna)', () => {
    // En sportstiming la 1ª celda es "Plac.": trae el puesto O el código de
    // abandono. Confundirlos convertiría a un clasificado en abandono.
    expect(irmOf('1')).toBeNull();
    expect(irmOf('97')).toBeNull();
  });

  it('"-" y vacío → null (sin dato, no abandono)', () => {
    expect(irmOf('-')).toBeNull();
    expect(irmOf('')).toBeNull();
    expect(irmOf(null)).toBeNull();
  });

  it('normaliza minúsculas', () => {
    expect(irmOf('dnf')).toBe('DNF');
  });

  it('un código DESCONOCIDO se conserva en crudo, no se inventa un mapeo', () => {
    expect(irmOf('XYZ')).toBe('XYZ');
  });
});

describe('normAbsTime — Tid → timeText', () => {
  it('acepta el formato de BD tal cual (Copenhagen Sprint: 3:32:30)', () => {
    expect(normAbsTime('3:32:30')).toBe('3:32:30');
    expect(normAbsTime('3:41:46')).toBe('3:41:46');
    expect(normAbsTime('55:12')).toBe('55:12');
  });

  it('el "-" de los abandonos no es un tiempo', () => {
    expect(normAbsTime('-')).toBeNull();
    expect(normAbsTime('')).toBeNull();
    expect(normAbsTime(null)).toBeNull();
  });

  it('un gap no es un tiempo absoluto', () => {
    expect(normAbsTime('+0:12')).toBeNull();
  });
});

describe('normGap — Efter#1 → gapText', () => {
  it('conserva minutos y horas (Copenhagen Sprint: +8:10)', () => {
    expect(normGap('+8:10')).toBe('+8:10');
    expect(normGap('+1:02:03')).toBe('+1:02:03');
    expect(normGap('+2:00:00')).toBe('+2:00:00');
  });

  it('colapsa los grupos de cabecera a cero (sportstiming manda siempre "+0:MM")', () => {
    // La referencia es secondsToGap() de js/resultados.js: bajo el minuto emite
    // segundos sueltos (+12"), nunca "0:12". Ese "0:" de sportstiming sobra.
    expect(normGap('+0:12')).toBe('+12');
    expect(normGap('+0:05')).toBe('+5');
    expect(normGap('+0:00')).toBe('+0');
    expect(normGap('+0:00:07')).toBe('+7');   // colapsa dos grupos
  });

  it('un gap de un solo grupo se recorta igual', () => {
    expect(normGap('+00')).toBe('+0');
    expect(normGap('+0')).toBe('+0');
    expect(normGap('+27')).toBe('+27');
  });

  it('mismo gap, mismo texto que livetiming (la otra fuente que ya colapsaba)', () => {
    // Dos fuentes escribiendo el mismo gap distinto es una discrepancia que aflora
    // en la tabla de resultados según quién cronometre la carrera.
    expect(normGap('+0:12')).toBe('+12');
    expect(normGap('+1:02')).toBe('+1:02');
  });

  it('lo que no es un gap → null', () => {
    expect(normGap('3:32:30')).toBeNull();   // tiempo absoluto
    expect(normGap('-')).toBeNull();
    expect(normGap('')).toBeNull();
    expect(normGap(null)).toBeNull();
    expect(normGap('+abc')).toBeNull();
  });
});

describe('decodeEntities / stripTags — el HTML viene crudo de la fuente', () => {
  it('decodifica las entidades numéricas y con nombre', () => {
    // Los nombres nórdicos llegan escapados (&#248; = ø) → sin decodificar, el
    // display quedaría con basura HTML.
    expect(decodeEntities('S&#248;rensen')).toBe('Sørensen');
    expect(decodeEntities('B&#xF8;rge')).toBe('Børge');
    expect(decodeEntities('Uno-X &amp; Co')).toBe('Uno-X & Co');
    expect(decodeEntities('&quot;X&quot;')).toBe('"X"');
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
  });

  it('stripTags quita el marcado y decodifica de paso', () => {
    expect(stripTags('<span>Lorena Wiebes</span>').trim()).toBe('Lorena Wiebes');
    expect(stripTags('<div>SD Worx &amp; Protime</div>').trim()).toBe('SD Worx & Protime');
  });
});

// ── parseRows ──────────────────────────────────────────────────────────────
// Forma HTML real de la tabla de resultados (verificada contra /event/16511):
//   Plac. | Tid | Efter#1 | <a .../results/{id}><span>Nombre (DORSAL)</span></a><div>EQUIPO</div>
//         | Land (IOC-3) | Klub/Firma | [crossings, ignorados]
const HTML = `
<table>
  <tr><th>Plac.</th><th>Tid</th><th>Efter#1</th><th>Navn</th><th>Land</th><th>Klub</th></tr>
  <tr>
    <td>1</td><td>3:32:30</td><td></td>
    <td><a href="/event/16511/results/12345"><span>Lorena Wiebes (1)</span></a><div>SD Worx - Protime</div></td>
    <td><img src="/f/ned.png"><span> NED</span></td><td><span>SD Worx - Protime</span></td>
  </tr>
  <tr>
    <td>2</td><td>3:32:30</td><td>+0:00</td>
    <td><a href="/event/16511/results/12346"><span>Charlotte Kool (11)</span></a><div>Picnic PostNL</div></td>
    <td><img src="/f/ned.png"><span> NED</span></td><td><span>Picnic PostNL</span></td>
  </tr>
  <tr>
    <td>DNF</td><td>-</td><td>-</td>
    <td><a href="/event/16511/results/12347"><span>Silvia Zanardi (57)</span></a><div>Human Powered Health</div></td>
    <td><img src="/f/ita.png"><span> ITA</span></td><td><span>Human Powered Health</span></td>
  </tr>
  <tr><td>fila de cabecera/resumen sin enlace de corredor</td><td>x</td><td>y</td><td>z</td></tr>
</table>`;

describe('parseRows — el número entre paréntesis ES EL DORSAL', () => {
  it('extrae el dorsal del paréntesis y lo separa del nombre', () => {
    // EL invariante de esta fuente: "Wiebes (1)" → bib=1. De ese dorsal depende el
    // resolve (RPC 082) contra la startlist curada; si se leyera como parte del
    // nombre, NINGUNA fila enlazaría con su corredor.
    const rows = parseRows(HTML);
    expect(rows[0]).toMatchObject({ bib: '1', riderDisplay: 'Lorena Wiebes' });
    expect(rows[1]).toMatchObject({ bib: '11', riderDisplay: 'Charlotte Kool' });
    expect(rows[2]).toMatchObject({ bib: '57', riderDisplay: 'Silvia Zanardi' });
  });

  it('el ganador lleva tiempo ABSOLUTO y NO gap', () => {
    const [w] = parseRows(HTML);
    expect(w).toMatchObject({
      rank: 1, rankText: '1', timeText: '3:32:30', gapText: null, resultValue: '3:32:30', irm: null,
    });
  });

  it('el resto lleva gap y NO tiempo', () => {
    // El "+0:00" del feed (llegada en grupo) se colapsa a "+0" → la web lo pinta m.t.
    const [, second] = parseRows(HTML);
    expect(second).toMatchObject({ rank: 2, rankText: '2', timeText: null, gapText: '+0' });
  });

  it('un abandono (placement DNF, tiempo "-") sale como IRM sin puesto ni tiempo', () => {
    const dnf = parseRows(HTML)[2];
    expect(dnf).toMatchObject({
      rank: null, rankText: 'DNF', irm: 'DNF', bib: '57',
      timeText: null, gapText: null, resultValue: null,
    });
  });

  it('resuelve país (IOC-3) y equipo de sus celdas', () => {
    const [w] = parseRows(HTML);
    expect(w).toMatchObject({ country: 'NED', teamName: 'SD Worx - Protime' });
    expect(parseRows(HTML)[2]).toMatchObject({ country: 'ITA', teamName: 'Human Powered Health' });
  });

  it('ignora las filas que no son de corredor (sin enlace /results/N)', () => {
    // El gate contra cabeceras/resúmenes: sin él, se colarían filas basura.
    expect(parseRows(HTML)).toHaveLength(3);
  });

  it('HTML sin filas de corredor → [] (no revienta)', () => {
    expect(parseRows('<table><tr><td>nada</td></tr></table>')).toEqual([]);
    expect(parseRows('')).toEqual([]);
  });

  it('un nombre SIN dorsal entre paréntesis no rompe: bib null', () => {
    // Ocurrió de verdad: la Copenhagen Sprint masculina 2026 aún no tenía dorsales
    // publicados al cerrar la sesión. Mejor sin enlazar que con un bib inventado.
    const html = `<table><tr>
      <td>1</td><td>3:32:30</td><td></td>
      <td><a href="/event/1/results/9"><span>Sin Dorsal</span></a><div>Team X</div></td>
      <td><span>DEN</span></td><td><span>Team X</span></td></tr></table>`;
    expect(parseRows(html)[0]).toMatchObject({ bib: null, riderDisplay: 'Sin Dorsal', rank: 1 });
  });

  it('decodifica entidades del nombre conservando el dorsal', () => {
    const html = `<table><tr>
      <td>1</td><td>3:32:30</td><td></td>
      <td><a href="/event/1/results/9"><span>Mads S&#248;rensen (42)</span></a><div>Uno-X</div></td>
      <td><span>DEN</span></td><td><span>Uno-X</span></td></tr></table>`;
    expect(parseRows(html)[0]).toMatchObject({ bib: '42', riderDisplay: 'Mads Sørensen' });
  });
});

describe('Vuelta a Dinamarca — etapa sin categoría interna', () => {
  const LIVE_DNFS = `<table>
    <tr><th>Plac.</th><th>Tid</th><th>Efter #1</th><th>Rytter</th><th>Land</th><th>Kategori</th><th>Hold</th></tr>
    <tr><td>DNF</td><td>-</td><td></td><td><a href="/event/18578/results/8462421"><span>Kristian Egholm (2)</span></a></td><td>DEN</td><td>Young Rider</td><td>LIDL-TREK</td></tr>
  </table>`;
  const FINAL = LIVE_DNFS.replace('<td>DNF</td><td>-</td><td></td>', '<td>1</td><td>4:12:34</td><td></td>');

  it('toma el equipo después de la columna adicional de categoría', () => {
    expect(parseRows(LIVE_DNFS)[0]).toMatchObject({
      irm: 'DNF', country: 'DEN', teamName: 'LIDL-TREK', riderDisplay: 'Kristian Egholm', bib: '2',
    });
  });

  it('descarta la sigla móvil que Sportstiming duplica en la celda de equipo', () => {
    const html = LIVE_DNFS.replace('<td>LIDL-TREK</td>', '<td><span class="hidden-xs">LIDL-TREK</span><span class="hidden-lg">LTK</span></td>');
    expect(parseRows(html)[0].teamName).toBe('LIDL-TREK');
  });

  it('no considera los abandonos en directo como una clasificación final', () => {
    expect(hasFinalRanking(parseRows(LIVE_DNFS))).toBe(false);
    expect(hasFinalRanking(parseRows(FINAL))).toBe(true);
  });
});

describe('cortes de grupo y clasificaciones acumuladas', () => {
  it('recalcula el corte desde Tid y elimina microcortes dentro del mismo grupo', () => {
    const html = `<table>
      <tr><td>1</td><td>4:10:49</td><td></td><td><a href="/event/1/results/1"><span>A (1)</span></a></td><td>BEL</td><td>Team A</td></tr>
      <tr><td>2</td><td>4:10:49</td><td>+0:01</td><td><a href="/event/1/results/2"><span>B (2)</span></a></td><td>DEN</td><td>Team B</td></tr>
      <tr><td>3</td><td>4:11:06</td><td>+0:17</td><td><a href="/event/1/results/3"><span>C (3)</span></a></td><td>FRA</td><td>Team C</td></tr>
    </table>`;
    const rows = normalizeStageGaps(parseRows(html));
    expect(rows[1].gapText).toBe('+0');
    expect(rows[2].gapText).toBe('+17');
    expect(clockSeconds('4:10:49')).toBe(15049);
    expect(secondsGap(62)).toBe('+1:02');
  });

  it('lee las clasificaciones de puntos acumuladas', () => {
    const html = `<table><tr><th>Plac.</th><th>Point</th><th>Rytter</th><th>Land</th><th>Kategori</th><th>Hold</th></tr>
      <tr><td>1</td><td>15</td><td><a href="/event/1/results/1"><span>Wout Van Aert (51)</span></a></td><td>BEL</td><td>-</td><td>TEAM VISMA</td></tr></table>`;
    expect(parsePointsRows(html)).toMatchObject([{ rank: 1, bib: '51', riderDisplay: 'Wout Van Aert', points: 15, teamName: 'TEAM VISMA' }]);
  });

  it('lee una clasificación acumulada por equipos sin enlaces de corredor', () => {
    const html = `<table><tr><th>Plac.</th><th>Tid</th><th>Efter #1</th><th>Hold</th></tr>
      <tr><td>1</td><td>12:30:00</td><td></td><td>TEAM VISMA</td></tr>
      <tr><td>2</td><td>12:30:10</td><td>+0:10</td><td>LIDL-TREK</td></tr></table>`;
    expect(parseTeamRows(html)).toMatchObject([
      { rank: 1, riderDisplay: 'TEAM VISMA', teamName: 'TEAM VISMA', timeText: '12:30:00' },
      { rank: 2, riderDisplay: 'LIDL-TREK', teamName: 'LIDL-TREK', gapText: '+10' },
    ]);
  });

  it('acepta las cabeceras inglesas de la vista viewType=team', () => {
    const html = `<table><tr><th>Pos.</th><th>Time</th><th>Behind #1</th><th>Team</th></tr>
      <tr><td>1</td><td>11:58:53</td><td></td><td>TEAM VISMA</td></tr>
      <tr><td>2</td><td>11:59:08</td><td>+0:15</td><td>DANISH NATIONAL TEAM</td></tr></table>`;
    expect(parseTeamRows(html)).toMatchObject([
      { rank: 1, teamName: 'TEAM VISMA', timeText: '11:58:53' },
      { rank: 2, teamName: 'DANISH NATIONAL TEAM', gapText: '+15' },
    ]);
  });
});

describe('dateFromCat — dateKey deducida del catLabel', () => {
  // El catLabel lleva la fecha ("Elite Women (13. June)") porque un evento
  // sportstiming agrupa varias carreras en días distintos.
  it('extrae día y mes del catLabel (formato danés "13. June")', () => {
    // El año lo pone el reloj del sistema (no está en el catLabel) → se comprueba
    // la estructura y el día/mes, no el año concreto.
    expect(dateFromCat('Elite Women (13. June)')).toMatch(/^\d{4}-06-13$/);
    expect(dateFromCat('Elite Men (14. June)')).toMatch(/^\d{4}-06-14$/);
  });

  it('rellena con cero el día de un dígito', () => {
    expect(dateFromCat('Elite Women (3. May)')).toMatch(/^\d{4}-05-03$/);
  });

  it('un catLabel sin fecha o con mes inválido → null (no inventa una jornada)', () => {
    expect(dateFromCat('Elite Women')).toBeNull();
    expect(dateFromCat('Elite Women (13. Smarch)')).toBeNull();
    expect(dateFromCat('')).toBeNull();
  });
});

describe('fnv1a — IDs sintéticos deterministas', () => {
  it('reproduce el competitionId real de la Copenhagen Sprint fem 2026 (-101501)', () => {
    // El valor que está en race_uci_links.competitionId en producción. El code es
    // "{eventId}|{catLabel}" → la masculina del mismo evento tiene otro id.
    expect(-(fnv1a('sportstiming:18776|Elite Women (13. June)') % 200000)).toBe(-101501);
  });

  it('cada carrera del MISMO evento tiene su propio id (el cat entra en el salt)', () => {
    // Un evento agrupa masculina y femenina: si el salt no incluyera el catLabel,
    // ambas compartirían competitionId y se pisarían al volcar.
    const w = fnv1a('sportstiming:18776|Elite Women (13. June)');
    const m = fnv1a('sportstiming:18776|Elite Men (14. June)');
    expect(w).not.toBe(m);
    expect(w).toBe(fnv1a('sportstiming:18776|Elite Women (13. June)'));
  });
});
