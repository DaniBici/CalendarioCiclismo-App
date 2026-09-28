import { describe, expect, it } from 'vitest';
import { applyCxResults, emitCxResultsSql, loadCxResultsContext, prepareCxResults, resolveCxResultIdentity } from '../results-fetchers/cx-results-upsert.mjs';

function fixture() {
  const riders = [{ id: 'a-cx', firstName: 'A', lastName: 'Prueba', nationality: 'ES', birthDate: '2000-01-01', verified: true }];
  const context = { race: { id: 'own-cx', seasonKey: '2026-27', dateKey: '2026-09-12', editorialStatus: 'published', isCancelled: false },
    categories: [{ raceId: 'own-cx', category: 'ME', dateKey: null, isCancelled: false, resultsLockedAt: null }],
    link: { raceId: 'own-cx', competitionId: 100, seasonId: 472, disciplineId: 3, uciRaceId: 0 }, riders: { men: riders, women: [] } };
  const document = { schemaVersion: 1, disciplineId: 3, source: 'dataride', competitionId: 100, seasonId: 472,
    categories: [{ category: 'ME', dateKey: '2026-09-12', uciRaceId: 10, eventId: 20, publicationHint: 'unverified_results',
      evidence: { sourceUrl: 'https://dataride.uci.ch/iframe/Results/' },
      rows: [{ rank: 1, bib: 'A01', riderDisplay: 'PRUEBA A', isoCode2: 'ES', timeText: '1:00:00', timeSeconds: '3600',
        bonusSeconds: null, bonusPoints: 0, sourceResultId: '100001' }] }] };
  return { document, context };
}
const prepare = ({ document, context }, options) => prepareCxResults(document, context, options);

describe('identidades CX propias', () => {
  it('resuelve nombre completo verificado en ambos órdenes, partículas y acentos', () => {
    const riders = [{ id: 'own', firstName: 'José A', lastName: 'van de Prueba', nationality: 'ES', verified: true }];
    expect(resolveCxResultIdentity({ riderDisplay: 'VAN DE PRUEBA Jose A', isoCode2: 'ES' }, riders).id).toBe('own');
    expect(resolveCxResultIdentity({ firstName: 'Jose A', lastName: 'van de Prueba', isoCode2: 'ES' }, riders).id).toBe('own');
  });
  it('resuelve la ficha de nombre y primer apellido por el nombre completo de otherNames', () => {
    const riders = [{ id: 'martinez-garcia-ivan', firstName: 'Iván', lastName: 'Martínez', otherNames: 'Ivan Martinez Garcia', nationality: 'ES', verified: true },
      { id: 'martinez-ivan', firstName: 'Iván', lastName: 'Martínez', otherNames: 'Ivan Martinez Lopez', nationality: 'ES', verified: true }];
    expect(resolveCxResultIdentity({ riderDisplay: 'MARTINEZ GARCIA Ivan', isoCode2: 'ES' }, riders).id).toBe('martinez-garcia-ivan');
    expect(resolveCxResultIdentity({ firstName: 'IVAN', lastName: 'MARTINEZ GARCIA', isoCode2: 'ES' }, riders).id).toBe('martinez-garcia-ivan');
    expect(resolveCxResultIdentity({ firstName: 'Iván', lastName: 'Martínez', isoCode2: 'ES' }, riders)).toMatchObject({ id: null, reason: 'ambiguous' });
    expect(resolveCxResultIdentity({ riderDisplay: 'MARTINEZ Ivan', isoCode2: 'ES' }, riders)).toMatchObject({ id: null, reason: 'ambiguous' });
    expect(resolveCxResultIdentity({ riderDisplay: 'MARTINEZ GARCIA Jorge', isoCode2: 'ES' }, riders).id).toBeNull();
  });
  it('admite cualquier fecha del año en fichas con precisión de año', () => {
    const riders = [{ id: 'beloqui-blanco-aitor', firstName: 'Aitor', lastName: 'Beloqui', otherNames: 'Aitor Beloqui Blanco', nationality: 'ES', birthDate: '2010-01-01', birthDatePrecision: 'year', verified: true },
      { id: 'exacta', firstName: 'Ana', lastName: 'Prueba', nationality: 'ES', birthDate: '2010-01-01', birthDatePrecision: 'day', verified: true }];
    expect(resolveCxResultIdentity({ riderDisplay: 'BELOQUI BLANCO Aitor', isoCode2: 'ES', birthDate: '2010-06-15' }, riders).id).toBe('beloqui-blanco-aitor');
    expect(resolveCxResultIdentity({ riderDisplay: 'BELOQUI BLANCO Aitor', isoCode2: 'ES', birthDate: '2009-06-15' }, riders).id).toBeNull();
    expect(resolveCxResultIdentity({ riderDisplay: 'PRUEBA Ana', isoCode2: 'ES', birthDate: '2010-06-15' }, riders).id).toBeNull();
  });
  it('desambigua por país y nacimiento disponibles, sin escoger el primer homónimo', () => {
    const riders = [{ id: 'one', firstName: 'A', lastName: 'Prueba', nationality: 'ES', birthDate: '2000-01-01', verified: true },
      { id: 'two', firstName: 'A', lastName: 'Prueba', nationality: 'ES', birthDate: '2001-01-01', verified: true }];
    expect(resolveCxResultIdentity({ riderDisplay: 'PRUEBA A', isoCode2: 'ES' }, riders)).toMatchObject({ id: null, reason: 'ambiguous' });
    expect(resolveCxResultIdentity({ riderDisplay: 'PRUEBA A', birthDate: '2001-01-01' }, riders).id).toBe('two');
    expect(resolveCxResultIdentity({ riderDisplay: 'PRUEBA A', isoCode2: 'NL' }, riders).id).toBeNull();
  });
  it('conserva nacimiento ISO verificable y anula formatos no acreditados', () => {
    const input = fixture(); const row = input.document.categories[0].rows[0];
    row.birthDate = '2000-01-01';
    expect(prepare(input).imports[0].rows[0].birthDate).toBe('2000-01-01');
    row.birthDate = '01/01/2000';
    expect(prepare(input).imports[0].rows[0].birthDate).toBeNull();
    row.birthDate = '2000-02-30';
    expect(prepare(input).imports[0].rows[0].birthDate).toBeNull();
  });
  it('no crea una ficha ni enlaza automáticamente un perfil sin verificar', () => {
    const input = fixture(); input.context.riders.men[0].verified = false;
    const value = prepare(input); expect(value.imports[0].rows[0].globalRiderId).toBeNull();
    expect(value.warnings[0].reason).toBe('unresolved'); expect(input.context.riders.men).toHaveLength(1);
  });
  it('excluye catálogo de carretera y fichas del otro género, incluso por ID explícito', () => {
    const input = fixture(); input.document.categories[0].rows[0].globalRiderId = 'road-only';
    input.context.roadRiders = [{ id: 'road-only', firstName: 'A', lastName: 'Prueba' }]; expect(() => prepare(input)).toThrow(/ajena/);
    input.context.riders.women = [{ ...input.context.riders.men[0], id: 'road-only' }]; expect(() => prepare(input)).toThrow(/ajena/);
  });
});

describe('preparación del contrato CX', () => {
  it('conserva tiempos/BIGINT, bonos NULL, dorsal textual y evidencia de identidad/fuente', () => {
    const input = fixture(); input.document.categories[0].rows[0].timeSeconds = '9007199254740993';
    const value = prepare(input); expect(value.status).toBe('provisional');
    expect(value.imports[0].rows[0]).toMatchObject({ globalRiderId: 'a-cx', bib: 'A01', timeSeconds: '9007199254740993', bonusSeconds: null, points: null });
    expect(value.imports[0].evidence).toMatchObject({ seasonKey: '2026-27', dateKey: '2026-09-12', inputSource: 'dataride',
      dataRide: { disciplineId: 3, competitionId: 100, seasonId: 472, uciRaceId: 10, eventId: 20 }, identityEvidence: input.context.riders.men });
  });
  it('normaliza el orden de nombre en la preparación, también para filas manuales', () => {
    const input = fixture();
    input.document.source = 'manual';
    delete input.document.competitionId; delete input.document.seasonId;
    input.document.raceId = 'own-cx'; input.document.seasonKey = '2026-27'; input.context.link = null;
    input.document.categories[0].evidence = { sourceUrl: 'https://official.test/result' };
    input.document.categories[0].rows[0] = { rank: 1, bib: 'A01', riderDisplay: 'PRUEBA Alex', firstName: null, lastName: null,
      isoCode2: 'ES', timeText: '1:00:00', timeSeconds: '3600', bonusSeconds: null, sourceResultId: '100001' };
    expect(prepare(input).imports[0].rows[0]).toMatchObject({ riderDisplay: 'Alex Prueba', firstName: 'Alex', lastName: 'Prueba' });
  });
  it('no oficializa un documento DataRide por su mera existencia', () => {
    const input = fixture(); expect(() => prepare(input, { status: 'official' })).toThrow(/revisión/);
    input.document.categories[0].evidence = { sourceUrl: 'https://official.test/result', officialReviewed: true, officialReviewSourceUrl: 'https://official.test/result' };
    expect(prepare(input, { status: 'official' }).status).toBe('official');
  });
  it('permite al colector oficializar solo documentos UCI/DataRide y registra su fuente como revisión', () => {
    const input = fixture();
    const value = prepare(input, { status: 'official', officialUciResults: true });
    expect(value.imports[0].evidence).toMatchObject({ officialReviewed: true,
      officialReviewSourceUrl: 'https://dataride.uci.ch/iframe/Results/' });
    input.document.source = 'pdf'; input.document.raceId = 'own-cx'; input.document.seasonKey = '2026-27'; input.context.link = null;
    expect(() => prepare(input, { status: 'official', officialUciResults: true })).toThrow(/inválidos/);
  });
  it('rechaza disciplina, competición, temporada y Race ID sin correspondencia verificada', () => {
    for (const edit of [input => input.document.disciplineId = 10, input => input.context.link = null,
      input => input.context.link.disciplineId = 10, input => input.document.competitionId = 101,
      input => input.document.seasonId = 455, input => input.context.link.seasonId = null,
      input => input.document.seasonKey = '2025-26',
      input => input.context.link.uciRaceId = 11]) {
      const input = fixture(); edit(input); expect(() => prepare(input)).toThrow();
    }
  });
  it('rechaza marzo–julio, finales fuera de ventana y fecha multidía errónea', () => {
    for (const edit of [input => input.context.race.dateKey = '2027-03-01', input => input.context.race.endDateKey = '2027-03-01',
      input => input.document.categories[0].dateKey = '2026-09-13', input => input.context.categories[0].dateKey = '2026-09-11']) {
      const input = fixture(); edit(input); expect(() => prepare(input)).toThrow();
    }
  });
  it('omite canceladas, mangas inexistentes, bloqueadas y filas aún no publicadas', () => {
    for (const edit of [input => input.context.categories = [], input => input.context.categories[0].isCancelled = true,
      input => input.context.categories[0].resultsLockedAt = '2026-09-12T10:00:00Z', input => input.document.categories[0].publicationHint = 'not_published']) {
      const input = fixture(); edit(input); expect(prepare(input).imports).toEqual([]); expect(prepare(input).skipped).toHaveLength(1);
    }
  });
  it('conserva IRM y tiempo textual parcial, con tiempo real desconocido', () => {
    const input = fixture(); Object.assign(input.document.categories[0].rows[0], { rank: 20, irm: 'LAP', timeText: null, gapText: '-1 LAP', timeSeconds: null });
    expect(prepare(input).imports[0].rows[0]).toMatchObject({ rank: 20, irm: 'LAP', gapText: '-1 LAP', timeSeconds: null });
    input.document.categories[0].rows[0].timeSeconds = '3000'; expect(() => prepare(input)).toThrow(/IRM/);
  });
  it('omite placeholders solo en provisionales; no añade DNF ni tiempo ficticio', () => {
    const input = fixture(); input.document.categories[0].rows.push({ riderDisplay: 'Sin puesto', rank: null, irm: null });
    const value = prepare(input); expect(value.imports[0].rows).toHaveLength(1); expect(value.warnings[0].reason).toMatch(/sin puesto/);
    input.document.categories[0].evidence.officialReviewed = true; input.document.categories[0].evidence.officialReviewSourceUrl = 'https://official.test/result';
    expect(() => prepare(input, { status: 'official' })).toThrow(/inválidos/);
  });
  it('rechaza puesto/conflicto/ID/dorsal duplicados y tiempo inseguro', () => {
    for (const edit of [input => input.document.categories[0].rows[0].sourceConflict = 'Conflicto',
      input => input.document.categories[0].rows[0].timeSeconds = 9007199254740992,
      input => input.document.categories[0].rows.push({ ...input.document.categories[0].rows[0], rank: 2 }),
      input => input.document.categories.push(input.document.categories[0])]) {
      const input = fixture(); edit(input); expect(() => prepare(input)).toThrow();
    }
  });
  it('exige fuente de bonos/ajustes y mantiene puntos separados de segundos', () => {
    const input = fixture(); input.document.categories[0].rows[0].bonusSeconds = 0; expect(() => prepare(input)).toThrow(/evidencia/);
    input.document.categories[0].evidence.bonusSourceUrl = 'https://official.test/bonuses'; expect(prepare(input).imports[0].rows[0].bonusSeconds).toBe('0');
    input.document.categories[0].rows[0].bonusPoints = '-25'; expect(() => prepare(input)).toThrow(/evidencia/);
    Object.assign(input.document.categories[0].evidence, { adjustmentSourceUrl: 'https://official.test/penalty', adjustmentReason: 'Maillot' });
    expect(prepare(input).imports[0].rows[0].bonusPoints).toBe('-25');
    input.document.categories[0].rows[0].bonusSeconds='2147483648'; expect(() => prepare(input)).toThrow(/INTEGER/);
  });
  it('prepara manual/PDF sin enlace DataRide, con carrera, fecha, edición y revisión explícitas', () => {
    const input = fixture(); input.document.source = 'pdf'; input.document.raceId = 'own-cx'; input.document.seasonKey = '2026-27'; input.context.link = null;
    Object.assign(input.document.categories[0].evidence, { sourceUrl: 'https://official.test/result.pdf', officialReviewed: true, officialReviewSourceUrl: 'https://official.test/result.pdf' });
    const value = prepare(input, { status: 'official' }); expect(value.imports[0].evidence.dataRide).toBeUndefined();
    expect(value.imports[0].evidence.inputSource).toBe('pdf');
    input.document.raceId = 'other'; expect(() => prepare(input)).toThrow(/otra/);
  });
});

describe('aplicación/SQL revisable', () => {
  it('informa de carrera ausente sin desestructurar una fila inexistente', async () => {
    await expect(loadCxResultsContext({ query: async () => ({ rows: [] }) },'no-existe')).rejects.toThrow('Carrera CX no encontrada');
  });
  it('escapa apóstrofos en JSON/SQL y no produce INSERT de carretera ni de perfiles', () => {
    const input = fixture(); input.document.categories[0].rows[0].riderDisplay = "O'Prueba A";
    const sql = emitCxResultsSql(prepare(input)); expect(sql).toContain("O''Prueba A"); expect(sql).toContain('public.cx_ingest_results');
    expect(sql).not.toMatch(/INSERT|race_uci_results|riders_men/); expect(sql.startsWith('BEGIN;')).toBe(true);
  });
  it('revierte el lote si falla una categoría, sin confirmar categorías parciales', async () => {
    const calls = []; let imports = 0;
    const client = { query: async sql => { calls.push(sql); if (sql.startsWith('SELECT')) { if (++imports === 2) throw Object.assign(new Error('Entrada cambió'), { code: '40001' }); return { rows: [{ imported: { rows: 1 } }] }; } return { rows: [] }; } };
    const value = prepare(fixture()); value.imports.push({ ...value.imports[0], category: 'WE' });
    await expect(applyCxResults(client, value)).rejects.toThrow(/cambió/);
    expect(calls[0]).toBe('BEGIN'); expect(calls.at(-1)).toBe('ROLLBACK'); expect(calls).not.toContain('COMMIT');
  });
});
