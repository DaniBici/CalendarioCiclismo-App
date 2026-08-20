import { describe, it, expect } from 'vitest';
import {
  irmOf, absTime, normGap, deriveCode, fnv1a,
  parseResultRows, parseTttResultRows, parseAnnexeRows, attrs, firstBlock, allStages, rushBody,
  stageRaceType,
} from '../../scripts/results-fetchers/sts-results-fetch.mjs';

// Formatos verificados contra La Route d'Occitanie 2025 y 2026 (primera carrera
// conmutada a esta fuente) + el caso del GP Torres Vedras 2026 E1. El motor es
// Wiclax; STS es solo uno de sus hosts. Contrato completo en STS-TIMING-API.md.

describe('irmOf — estado francés de Wiclax → IRM UCI', () => {
  it('mapea los estados en palabras que trae el .clax', () => {
    expect(irmOf('Abandon')).toBe('DNF');          // el habitual, junto a tr="4"
    expect(irmOf('Non partant')).toBe('DNS');
    expect(irmOf('Hors délai')).toBe('OTL');
    expect(irmOf('Disqualifié')).toBe('DSQ');
    expect(irmOf('Exclu')).toBe('DSQ');
  });

  it('acepta también las abreviaturas y los códigos ya en formato UCI', () => {
    // Timerspeed (otro host Wiclax) manda "DNF" literal en vez de "Abandon".
    expect(irmOf('AB')).toBe('DNF');
    expect(irmOf('NP')).toBe('DNS');
    expect(irmOf('HD')).toBe('OTL');
    expect(irmOf('DNF')).toBe('DNF');
    expect(irmOf('DNS')).toBe('DNS');
    expect(irmOf('DSQ')).toBe('DSQ');
  });

  it('es insensible a acentos y mayúsculas (el .clax mezcla ambos)', () => {
    expect(irmOf('ABANDON')).toBe('DNF');
    expect(irmOf('Hors delai')).toBe('OTL');       // sin acento
  });

  it('un TIEMPO en el atributo t NO es un estado', () => {
    // El estado y el tiempo viajan en el MISMO atributo (t): si "04h31'03" se
    // leyera como estado, el ganador saldría como abandono.
    expect(irmOf("04h31'03")).toBeNull();
    expect(irmOf("00h15'28,34")).toBeNull();
  });

  it('un estado DESCONOCIDO devuelve null: no se inventa un IRM', () => {
    // Devolver un código inventado marcaría como abandonado a quien no lo está.
    expect(irmOf('Blah')).toBeNull();
    expect(irmOf('')).toBeNull();
    expect(irmOf(null)).toBeNull();
  });
});

describe('absTime — tiempo absoluto Wiclax → formato BD', () => {
  it('convierte "HHhMM\'SS" (La Route d\'Occitanie 2025: ganador 04h31\'03)', () => {
    expect(absTime("04h31'03")).toBe('4:31:03');
    expect(absTime("12h52'04")).toBe('12:52:04');
  });

  it('TRUNCA las centésimas de la CRI (00h15\'28,34 → 0:15:28)', () => {
    // La BD/web manejan segundos enteros; la CRI ya tiene su truncado propio en la
    // web (isIttStage). Un prólogo sub-hora conserva el "0:" de horas.
    expect(absTime("00h15'28,34")).toBe('0:15:28');
  });

  it('rellena con cero los componentes de una sola cifra', () => {
    expect(absTime("4h31'3")).toBe('4:31:03');
  });

  it('devuelve null si no es un tiempo', () => {
    expect(absTime('Abandon')).toBeNull();
    expect(absTime('-')).toBeNull();
    expect(absTime('')).toBeNull();
    expect(absTime(null)).toBeNull();
  });
});

describe('normGap — gap Wiclax → estilo UCI en BD', () => {
  it('"-" (líder o mismo tiempo que el cabeza de grupo) → null', () => {
    expect(normGap('-')).toBeNull();
  });

  it('normaliza el apóstrofo y los dos puntos al separador ":"', () => {
    expect(normGap("+0'04")).toBe('+0:04');
    expect(normGap('+0:36')).toBe('+0:36');
    expect(normGap('+16:49')).toBe('+16:49');
  });

  it('descarta las centésimas del gap', () => {
    expect(normGap("+1'02,00")).toBe('+1:02');
  });

  it('gap de más de una hora → "+H:MM:SS"', () => {
    expect(normGap("+1h00'15")).toBe('+1:00:15');
  });

  it('"+ N tour" (corredor DOBLADO) → null: no hay gap numérico', () => {
    // Un "tour" no es una diferencia de tiempo; el absoluto va en resultValue.
    expect(normGap('+ 1 tour')).toBeNull();
    expect(normGap('+ 2 tours')).toBeNull();
  });

  it('lo que no empieza por "+" no es un gap', () => {
    expect(normGap('4:31:03')).toBeNull();   // tiempo absoluto
    expect(normGap('')).toBeNull();
    expect(normGap(null)).toBeNull();
  });
});

// ── parseResultRows ────────────────────────────────────────────────────────
// Índice tal como lo construye main() desde los <Engages> de la etapa.
const riderByBib = new Map([
  [16, { display: 'STAUNE-MITTET Johannes', teamName: 'DECATHLON CMA CGM TEAM' }],
  [44, { display: 'BARTHE Cyril', teamName: 'EUSKALTEL - EUSKADI' }],
  [27, { display: 'PRODHOMME Nicolas', teamName: 'DECATHLON CMA CGM TEAM' }],
  [174, { display: 'RIBEIRO Afonso', teamName: 'EFAPEL' }],
]);

describe('parseResultRows — INVARIANTE: timeText absoluto en TODAS, NUNCA gapText', () => {
  // El invariante más importante de esta fuente. Wiclax da el tiempo total de todos
  // los finishers (127/127 verificado en una etapa en ruta) y los del mismo grupo
  // comparten el t del cabeza (g="-"). Emitiendo timeText en todas y CERO gapText,
  // la web entra en su "Caso A" (deriveGaps): deriva gap = tiempo − ganador y pinta
  // m.t. sola. Mezclar gapText lo rompe (la web exige !rows.some(r => r.gapText)).
  const xml = `
    <R d="16" t="04h31'03" m="40,29" g="-" b="16h18'00" />
    <R d="44" t="04h31'03" m="40,29" g="-" />
  `;

  it('NINGUNA fila trae gapText, ni siquiera cuando el .clax da un gap', () => {
    const rows = parseResultRows(`<R d="16" t="04h31'03" g="-" /><R d="44" t="04h33'00" g="+1'57" />`, riderByBib);
    expect(rows.some((r) => r.gapText)).toBe(false);
  });

  it('cada clasificado lleva su tiempo absoluto en timeText', () => {
    const rows = parseResultRows(xml, riderByBib);
    expect(rows[0]).toMatchObject({ timeText: '4:31:03', gapText: null, resultValue: '4:31:03' });
    expect(rows[1]).toMatchObject({ timeText: '4:31:03', gapText: null, resultValue: '4:31:03' });
  });

  it('el mismo grupo comparte el tiempo del cabeza → la web pintará m.t.', () => {
    const rows = parseResultRows(xml, riderByBib);
    expect(rows[0].timeText).toBe(rows[1].timeText);
  });
});

describe('parseResultRows — el rank es POSICIONAL (no hay atributo de puesto)', () => {
  it('la 1ª fila es el ganador y el resto numera por orden de aparición', () => {
    const rows = parseResultRows(
      `<R d="16" t="04h31'03" g="-" /><R d="44" t="04h31'03" g="-" /><R d="27" t="04h33'00" g="+1'57" />`,
      riderByBib,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.rankText)).toEqual(['1', '2', '3']);
    expect(rows[0].riderDisplay).toBe('STAUNE-MITTET Johannes');
  });

  it('los abandonos NO consumen puesto: el contador solo avanza con clasificados', () => {
    // Si un DNF gastara número, el corredor siguiente saldría con el puesto corrido.
    const rows = parseResultRows(
      `<R d="16" t="04h31'03" g="-" /><R d="27" t="Abandon" tr="4" /><R d="44" t="04h33'00" g="+1'57" />`,
      riderByBib,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, null, 2]);
  });
});

describe('parseTttResultRows — CRE Wiclax agrupada por equipo', () => {
  const tttRiders = new Map([
    [11, { display: 'UNO A', teamName: 'EQUIPO A' }],
    [12, { display: 'DOS A', teamName: 'EQUIPO A' }],
    [21, { display: 'UNO B', teamName: 'EQUIPO B' }],
    [22, { display: 'DOS B', teamName: 'EQUIPO B' }],
    [13, { display: 'TRES A', teamName: 'EQUIPO A' }],
  ]);

  it('deja puesto y tiempo solo al primer corredor de cada equipo', () => {
    const rows = parseTttResultRows(
      `<R d="11" t="00h20'00" /><R d="12" t="00h20'00" g="-" />`
      + `<R d="21" t="00h21'00" g="+1:00" /><R d="22" t="00h21'00" g="+1:00" />`,
      tttRiders,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, null, 2, null]);
    expect(rows[0]).toMatchObject({ timeText: '0:20:00', resultValue: '0:20:00' });
    expect(rows[1]).toMatchObject({ timeText: null, resultValue: null });
    expect(rows[2]).toMatchObject({ timeText: '0:21:00', resultValue: '0:21:00' });
  });

  it('un corredor descolgado que reaparece después no crea otro equipo', () => {
    const rows = parseTttResultRows(
      `<R d="11" t="00h20'00" /><R d="21" t="00h21'00" />`
      + `<R d="13" t="00h25'00" g="+5:00" />`,
      tttRiders,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 2, null]);
    expect(rows[2]).toMatchObject({ teamName: 'EQUIPO A', timeText: null, resultValue: null });
  });

  it('los IRM se conservan y no consumen puesto de equipo', () => {
    const rows = parseTttResultRows(
      `<R d="12" t="Abandon" tr="4" /><R d="11" t="00h20'00" /><R d="21" t="00h21'00" />`,
      tttRiders,
    );
    expect(rows.map((r) => r.rank)).toEqual([null, 1, 2]);
    expect(rows[0]).toMatchObject({ irm: 'DNF', rankText: 'DNF' });
  });
});

describe('parseResultRows — abandonos', () => {
  it('t="Abandon" (con tr="4") → DNF sin tiempo ni puesto', () => {
    const [row] = parseResultRows(`<R d="27" t="Abandon" tr="4" />`, riderByBib);
    expect(row).toMatchObject({
      rank: null, rankText: 'DNF', irm: 'DNF', bib: '27',
      riderDisplay: 'PRODHOMME Nicolas', timeText: null, gapText: null, resultValue: null,
    });
  });

  it('tr marcado SIN tiempo ni gap = corredor CORTADO → DNF', () => {
    // Verificado: GP Torres Vedras 2026 E1, dorsal 174 (RIBEIRO Afonso, tr="1").
    // Wiclax lo deja listado solo con parciales y NO figura en la General. Si saliera
    // clasificado sin timeText, UNA sola fila así desactiva deriveGaps en la web
    // (allTimed exige que toda fila con rank y sin IRM tenga tiempo) → la etapa
    // entera se pintaría con absolutos en vez de m.t.
    const [row] = parseResultRows(`<R d="174" tr="1" p1="1h02'11" />`, riderByBib);
    expect(row).toMatchObject({ rank: null, rankText: 'DNF', irm: 'DNF', bib: '174' });
  });

  it('tr="0" NO es un estado: es una fila normal', () => {
    const [row] = parseResultRows(`<R d="16" t="04h31'03" tr="0" g="-" />`, riderByBib);
    expect(row).toMatchObject({ rank: 1, irm: null, timeText: '4:31:03' });
  });

  it('tr marcado pero CON tiempo de meta → clasificado, no DNF', () => {
    const [row] = parseResultRows(`<R d="16" t="04h31'03" tr="1" g="-" />`, riderByBib);
    expect(row).toMatchObject({ rank: 1, irm: null, timeText: '4:31:03' });
  });
});

describe('parseResultRows — casos límite', () => {
  it('un dorsal que no está en <Engages> no rompe: display/teamName a null', () => {
    const [row] = parseResultRows(`<R d="999" t="04h31'03" g="-" />`, riderByBib);
    expect(row).toMatchObject({ bib: '999', riderDisplay: null, teamName: null, timeText: '4:31:03' });
  });

  it('reconstruye display y equipo por dorsal desde <Engages>', () => {
    const [row] = parseResultRows(`<R d="44" t="04h31'03" g="-" />`, riderByBib);
    expect(row).toMatchObject({ riderDisplay: 'BARTHE Cyril', teamName: 'EUSKALTEL - EUSKADI' });
  });

  it('un bloque vacío (etapa no disputada) produce 0 filas', () => {
    expect(parseResultRows('', riderByBib)).toHaveLength(0);
  });
});

// ── El invariante que sostiene toda la fuente ──────────────────────────────
// js/resultados.js:969-971 apaga deriveGaps si UNA sola fila con rank y sin irm
// no tiene timeText parseable. El efecto no es local: la etapa ENTERA pasa a
// pintarse con tiempos absolutos en vez de m.t./+gap. De ahí que ninguna fila sin
// tiempo de meta pueda salir clasificada, por muy tentador que sea rellenarla.
describe('parseResultRows — NINGUNA fila clasificada sin timeText (deriveGaps)', () => {
  it('el doblado sin gap numérico (g="+ 1 tour") no se incluye', () => {
    // El caso que se colaba: normGap('+ 1 tour') → null por diseño, así que la fila
    // entraba con rank y resultValue/timeText nulos → deriveGaps muerto en la etapa.
    // El guard `tr` no lo cubre: esta fila no trae tr. No se convierte en OTL/FC ni
    // se muestra como LAP: no es un resultado final publicable.
    expect(parseResultRows(`<R d="16" g="+ 1 tour" />`, riderByBib)).toEqual([]);
  });

  it('el doblado CON tiempo absoluto tampoco se incluye', () => {
    // Regresión de La Périgord Ladies 2026: Wiclax SÍ da tiempo al doblado, pero de
    // una distancia menor → menor que el del ganador. Si entra clasificado, la web
    // activa `gapsDisguised` (una fila rank>1 con timeText < ganador) y pinta el
    // absoluto de TODAS las filas como gap ("+3:24:19"). Se descarta sin inferir un
    // OTL que el feed todavía no ha publicado.
    const rows = parseResultRows(
      `<R d="44" t="03h15'06" g="-" /><R d="16" t="03h02'30" g="+ 2 tours" />`,
      riderByBib,
    );
    expect(rows).toHaveLength(1);
    const clasificadas = rows.filter((r) => r.rank != null && !r.irm);
    const winner = clasificadas[0];
    // Ninguna clasificada por debajo del ganador → deriveGaps sigue vivo.
    expect(clasificadas.every((r) => r.timeText >= winner.timeText)).toBe(true);
  });

  it('un OTL explícito se conserva aunque Wiclax también indique vueltas', () => {
    const [row] = parseResultRows(`<R d="16" t="Hors délai" g="+ 1 tour" />`, riderByBib);
    expect(row).toMatchObject({ rank: null, rankText: 'OTL', irm: 'OTL' });
  });

  it('tampoco se clasifica cayendo al gap del .clax como resultValue', () => {
    // Tentación razonable ("que la fila no quede vacía") y misma trampa: rank != null
    // + timeText null pasa el filtro de la web y hace fallar su .every() igual.
    const [row] = parseResultRows(`<R d="16" g="+16:49" />`, riderByBib);
    expect(row).toMatchObject({ rank: null, irm: 'DNF', resultValue: null, timeText: null });
  });

  it('una fila sin t ni g sale DNF', () => {
    const [row] = parseResultRows(`<R d="16" />`, riderByBib);
    expect(row).toMatchObject({ rank: null, irm: 'DNF' });
  });

  it('el descarte NO consume puesto: el rank posicional del resto no se descuadra', () => {
    const rows = parseResultRows(
      `<R d="44" t="04h31'03" g="-" /><R d="16" g="+ 1 tour" /><R d="102" t="04h31'03" g="-" />`,
      riderByBib,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('INVARIANTE: ninguna clasificada sin timeText, ninguna con gapText', () => {
    // La aserción que importa, sobre TODAS las filas: basta una para romper la etapa.
    const rows = parseResultRows(
      `<R d="44" t="04h31'03" g="-" /><R d="16" g="+ 1 tour" />` +
      `<R d="102" t="04h31'07" g="+0'04" /><R d="174" tr="1" />` +
      `<R d="7" t="Abandon" tr="4" /><R d="9" g="+16:49" />`,
      riderByBib,
    );
    const clasificadas = rows.filter((r) => r.rank != null && !r.irm);
    expect(clasificadas.length).toBeGreaterThan(0);
    expect(clasificadas.every((r) => r.timeText != null)).toBe(true);
    expect(rows.some((r) => r.gapText)).toBe(false);
  });
});

describe('parseAnnexeRows — anexas montaña/puntos (pts) vs jóvenes (tps = TIEMPO)', () => {
  it('montaña/puntos: el valor de pts va en resultValue, sin tiempo', () => {
    const rows = parseAnnexeRows(`<res dos="102" pts="28" /><res dos="44" pts="26" bonif="4" />`, riderByBib);
    expect(rows[0]).toMatchObject({ rank: 1, bib: '102', resultValue: '28', timeText: null });
    expect(rows[1]).toMatchObject({ rank: 2, bib: '44', resultValue: '26' });
  });

  it('jóvenes (JE) es una clasificación POR TIEMPO: tps → timeText', () => {
    // Fix real: parseAnnexeRows solo leía pts → todas las filas de jóvenes salían sin
    // tiempo. Cazado en la Volta a Portugal Feminina 2026 (host Timerspeed).
    const [row] = parseAnnexeRows(`<res dos="16" tps="12h52'04" />`, riderByBib);
    expect(row).toMatchObject({ rank: 1, bib: '16', timeText: '12:52:04', resultValue: '12:52:04' });
  });

  it('<res dos="0"> es una plantilla de puntuación vacía → se ignora', () => {
    const rows = parseAnnexeRows(`<res dos="102" pts="28" /><res dos="0" pts="0" />`, riderByBib);
    expect(rows).toHaveLength(1);
  });

  it('el rank también es posicional aquí', () => {
    const rows = parseAnnexeRows(`<res dos="102" pts="28" /><res dos="44" pts="26" /><res dos="16" pts="20" />`, riderByBib);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe('firstBlock — <Resultats /> self-closing = etapa NO disputada', () => {
  // Es LA señal de "no terminada": el fetcher omite la etapa y el ∅-guard del cron
  // deja el link pending sin escribir nada. Confundirlo con un bloque con filas
  // volcaría una etapa que no se ha corrido.
  it('un bloque self-closing devuelve cadena vacía', () => {
    expect(firstBlock('<Etape><Resultats /></Etape>', 'Resultats')).toBe('');
  });

  it('un bloque ausente devuelve cadena vacía', () => {
    expect(firstBlock('<Etape></Etape>', 'Resultats')).toBe('');
  });

  it('un bloque con filas devuelve su contenido', () => {
    expect(firstBlock(`<Etape><Resultats><R d="1" /></Resultats></Etape>`, 'Resultats')).toContain('<R d="1"');
  });
});

describe('rushBody — solo el <Rush id="GN"> (la acumulada) de cada anexa', () => {
  it('tolera atributos extra en el open-tag (nom="Général")', () => {
    expect(rushBody(`<Rush id="GN" nom="Général"><res dos="1" pts="5" /></Rush>`, 'GN')).toContain('dos="1"');
  });

  it('la variante self-closing devuelve vacío', () => {
    expect(rushBody(`<Rush id="GN" nom="Général" />`, 'GN')).toBe('');
  });

  it('no confunde otros Rush con el GN', () => {
    const body = `<Rush id="R1"><res dos="9" pts="3" /></Rush><Rush id="GN"><res dos="1" pts="5" /></Rush>`;
    expect(rushBody(body, 'GN')).toContain('dos="1"');
    expect(rushBody(body, 'GN')).not.toContain('dos="9"');
  });
});

describe('allStages / attrs — parseo del XML', () => {
  it('devuelve una entrada por <Etape>, en orden (= nº de etapa 1-based)', () => {
    const st = allStages(`<Etapes><Etape type="1" chrono="2"><Resultats /></Etape><Etape type="0"><Resultats /></Etape></Etapes>`);
    expect(st).toHaveLength(2);
    expect(st[0].a).toMatchObject({ type: '1', chrono: '2' });   // CRI: type=1 o chrono>0
    expect(st[1].a).toMatchObject({ type: '0' });
  });

  it('attrs extrae los atributos de un open-tag', () => {
    expect(attrs(`<E d="1" n="STAUNE-MITTET Johannes" c="DECATHLON" na="NOR" />`))
      .toMatchObject({ d: '1', n: 'STAUNE-MITTET Johannes', c: 'DECATHLON', na: 'NOR' });
  });
});

describe('stageRaceType — type prevalece sobre chrono', () => {
  it('no convierte una etapa en ruta en CRE aunque chrono="2"', () => {
    // Regresión de Tour du Limousin E1 2026: type="0" es la modalidad fiable.
    expect(stageRaceType({ type: '0', chrono: '2' })).toBeNull();
  });

  it('distingue CRI y CRE mediante type', () => {
    expect(stageRaceType({ type: '1', chrono: '2' })).toBe('ITT');
    expect(stageRaceType({ type: '2', chrono: '0' })).toBe('TTT');
  });

  it('usa chrono como compatibilidad solo cuando type no existe', () => {
    expect(stageRaceType({ chrono: '1' })).toBe('ITT');
    expect(stageRaceType({ type: '0', chrono: '1' })).toBeNull();
  });
});

describe('deriveCode — identificador estable de la edición', () => {
  it('extrae el path tras /LIVE/ sin extensión (host STS)', () => {
    expect(deriveCode('https://www.stsport.fr/LIVE/LAROUTEDOCCITANIE/2026-RDO.clax'))
      .toBe('LAROUTEDOCCITANIE/2026-RDO');
  });

  it('en otro host Wiclax (Timerspeed) cae al path completo sin extensión', () => {
    expect(deriveCode('https://timerspeed.com/live/events/2026/6_vpf_2026.clax'))
      .toBe('events/2026/6_vpf_2026');
  });

  it('lo que no es una URL se devuelve tal cual (no revienta)', () => {
    expect(deriveCode('no-es-una-url')).toBe('no-es-una-url');
  });
});

describe('fnv1a — IDs sintéticos deterministas y NEGATIVOS', () => {
  it('reproduce el competitionId real de La Route d\'Occitanie 2026 (-109623)', () => {
    // El valor que está en race_uci_links.competitionId en producción (y en la doc).
    // Si esto cambia, se rompen los IDs de todo lo ya volcado desde esta fuente.
    expect(-(fnv1a('sts:LAROUTEDOCCITANIE/2026-RDO') % 200000)).toBe(-109623);
  });

  it('la base cabe en el rango que mantiene el eventId > -2^31', () => {
    for (const code of ['LAROUTEDOCCITANIE/2026-RDO', 'sts', 'https://timerspeed.com/live/events/2026/6_vpf_2026.clax']) {
      const base = fnv1a(`sts:${code}`) % 200000;
      expect(base).toBeLessThanOrEqual(199999);
      expect(-(base * 10000)).toBeGreaterThan(-(2 ** 31));
    }
  });

  it('el salt "sts:" evita colisionar con las otras fuentes del mismo hash', () => {
    // tissot/matsport/pdf usan el MISMO fnv1a con otro salt: sin él, dos fuentes
    // podrían generar el mismo competitionId sintético.
    expect(fnv1a('sts:2026_PYF')).not.toBe(fnv1a('matsport:2026_PYF'));
  });

  it('es estable y distinto por edición', () => {
    expect(fnv1a('sts:LAROUTEDOCCITANIE/2026-RDO')).toBe(fnv1a('sts:LAROUTEDOCCITANIE/2026-RDO'));
    expect(fnv1a('sts:LAROUTEDOCCITANIE/2026-RDO')).not.toBe(fnv1a('sts:LAROUTEDOCCITANIE/2027-RDO'));
  });
});
