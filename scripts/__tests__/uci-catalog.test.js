import { describe, it, expect, vi } from 'vitest';
import { Collector, madridDate, parseRider, retryDelay, validateIndex } from '../uci-catalog/source.mjs';
import { normalizeSnapshot, buildPlan } from '../uci-catalog/planner.mjs';
import { clientConfig, errorCode } from '../uci-catalog/run.mjs';
import { snapshotFixture, contextFixture } from './fixtures/uci-catalog.mjs';

const NOW = new Date('2026-09-04T08:00:00Z');
function setup() {
  const snapshot = normalizeSnapshot(snapshotFixture());
  return { snapshot, context: contextFixture(snapshot) };
}
function moving() {
  const { snapshot, context } = setup();
  context.riders[0].currentTeamId = 'old-team';
  context.states['male:rider-100'].affiliations[0].teamId = 'old-team';
  context.baselines['male:100'] = 'old-team';
  return { snapshot, context };
}

describe('captura UCI acotada', () => {
  it('valida las divisiones reales de cada temporada, el orden y la paginación', () => {
    const raw = snapshotFixture();
    const items = raw.teams.map(t => ({ teamName: t.teamName, teamCode: t.teamCode, countryCode: t.countryCode,
      url: `/team-details/${t.uciTeamProfileId}`, categoryName: t.categoryName, disciplineCode: 'ROA' }));
    const pages = [{ page: 1, pageSize: 3, totalItems: 6, items: items.slice(0, 3) },
      { page: 2, pageSize: 3, totalItems: 6, items: items.slice(3) }];
    expect(validateIndex(pages, 2026)).toHaveLength(6);
    expect(() => validateIndex(pages.slice(0, 1), 2026)).toThrow('incomplete');
    const duplicate = structuredClone(pages); duplicate[1].items[2] = duplicate[0].items[0];
    expect(() => validateIndex(duplicate, 2026)).toThrow();
    const changed = structuredClone(pages); changed[1].totalItems = 7;
    expect(() => validateIndex(changed, 2026)).toThrow();

    const historicalItems = items.filter(item => item.categoryName !== 'PRW');
    const historical = [{ page: 1, pageSize: 5, totalItems: 5, items: historicalItems }];
    expect(validateIndex(historical, 2020)).toHaveLength(5);
    expect(() => validateIndex(historical, 2025)).toThrow('historical_division_mismatch');
    expect(() => validateIndex(pages, 2024)).toThrow('historical_division_mismatch');
  });
  it.each(['<html>Error 200</html>', '<div data-component="RiderDetailsModule" data-props="{}">'])('rechaza un HTML incompleto', html => {
    expect(() => parseRider(html)).toThrow();
  });
  it('admite biografía sin historial y sigue bloqueando un traslado sin evidencia histórica', () => {
    const data = { details: { givenName: 'Anna', familyName: 'VAN DER BREGGEN', dob: '18.04.1990', nationality: 'NED' } };
    const html = `<div data-component="RiderDetailsModule" data-props="${JSON.stringify(data).replaceAll('"', '&quot;')}">`;
    expect(parseRider(html)).toMatchObject({ birthDate: '1990-04-18', history: [] });
    const { snapshot, context } = moving(); snapshot.records['100'].history = [];
    expect(buildPlan(snapshot, context, NOW).cases.some(c => c.reason === 'source_history_conflict')).toBe(true);
  });
  it('completa una nacionalidad ausente en la ficha desde la misma plantilla UCI', () => {
    const raw = snapshotFixture(); raw.riders[0].nationality = null;
    const record = normalizeSnapshot(raw).records['100'];
    expect(record.bio.nationality).toBe('es'); expect(record.conflict).toBe(false);
  });
  it('separa plantilla habitual y trainee y detecta género contradictorio', () => {
    const raw = snapshotFixture();
    raw.teams[1].riders.push({ ...raw.teams[0].riders[0], sourcePanel: 'Trainees', affiliationType: 'trainee' });
    let r = normalizeSnapshot(raw).records['100'];
    expect(r.regular).toEqual(['1']); expect(r.trainees).toEqual(['2']); expect(r.conflict).toBe(false);
    raw.teams[3].riders.push(raw.teams[0].riders[0]);
    expect(normalizeSnapshot(raw).records['100'].conflict).toBe(true);
  });
  it('marca para revisión la doble clasificación regular/trainee del mismo equipo', () => {
    const raw = snapshotFixture();
    raw.teams[0].riders.push({ ...raw.teams[0].riders[0], sourcePanel: 'Trainees', sourcePanels: ['Trainees'], affiliationType: 'trainee' });
    const record = normalizeSnapshot(raw).records['100'];
    expect(record.regular).toEqual(['1']);
    expect(record.trainees).toEqual(['1']);
    expect(record.conflict).toBe(true);
  });
  it('ignora espacios y mayúsculas entre ficha y plantilla sin aceptar otro nombre', () => {
    const raw = snapshotFixture();
    raw.teams[0].riders[0].givenName = ` ${raw.riders[0].givenName.toLowerCase()}  `;
    expect(normalizeSnapshot(raw).records['100'].conflict).toBe(false);
    raw.teams[0].riders[0].givenName = 'Otra persona';
    expect(normalizeSnapshot(raw).records['100'].conflict).toBe(true);
  });
  it('admite un nombre compuesto abreviado por la ficha sin confundir otro nombre', () => {
    const raw = snapshotFixture(); raw.teams[0].riders[0].givenName = `Segundo ${raw.riders[0].givenName}`;
    expect(normalizeSnapshot(raw).records['100'].conflict).toBe(false);
    raw.teams[0].riders[0].givenName = 'Segundo Distinto';
    expect(normalizeSnapshot(raw).records['100'].conflict).toBe(true);
  });
  it('rechaza licencias de once cifras y no confunde fichas con licencia', () => {
    const raw = snapshotFixture(); raw.teams[0].riders[0].uciProfileId = '12345678901';
    expect(() => normalizeSnapshot(raw)).toThrow('invalid_profile');
  });
  it('respeta Retry-After numérico y fecha HTTP', () => {
    expect(retryDelay('120', 0)).toBe(120000);
    expect(retryDelay('Thu, 01 Jan 1970 00:02:00 GMT', 0)).toBe(120000);
  });
  it('difiere ante 429 que supera el presupuesto y no reintenta una denegación', async () => {
    let calls = 0;
    const c = new Collector({ fetcher: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '9999' } }); }, sleep: async () => {} });
    await expect(c.get('/rider-details/1')).rejects.toThrow('rate_limited'); expect(calls).toBe(1);
    const denied = new Collector({ fetcher: async () => new Response('', { status: 403 }), sleep: async () => {} });
    await expect(denied.get('/rider-details/1')).rejects.toThrow('denied');
    await expect(denied.get('/rider-details/2')).rejects.toThrow('budget');
  });
  it('impone límites de peticiones y cuerpo aun con HTTP 200', async () => {
    const c = new Collector({ maxRequests: 1, intervalMs: 0, fetcher: async () => new Response('abc'), sleep: async () => {} });
    await c.get('/rider-details/1'); await expect(c.get('/rider-details/2')).rejects.toThrow('budget');
    const bytes = new Collector({ maxBytes: 2, fetcher: async () => new Response('abc'), sleep: async () => {} });
    await expect(bytes.get('/rider-details/1')).rejects.toThrow('body_budget');
  });
  it('amplía una espera ya iniciada cuando la otra petición recibe un 429', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    try {
      const starts = [];
      const c = new Collector({ fetcher: async () => {
        starts.push(Date.now());
        return starts.length === 1 ? new Response('', { status: 429, headers: { 'retry-after': '3' } }) : new Response('ok');
      } });
      const pending = Promise.all([c.get('/rider-details/1'), c.get('/rider-details/2')]);
      await vi.advanceTimersByTimeAsync(5000); await pending;
      expect(starts).toEqual([0, 3000, 4000]);
    } finally { vi.useRealTimers(); }
  });
  it('serializa el inicio de peticiones concurrentes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    try {
      const starts = [];
      const c = new Collector({ fetcher: async () => { starts.push(Date.now()); return new Response('ok'); } });
      const pending = Promise.all([c.get('/rider-details/1'), c.get('/rider-details/2'), c.get('/rider-details/3')]);
      await vi.advanceTimersByTimeAsync(3000); await pending;
      expect(starts).toEqual([0, 1000, 2000]);
    } finally { vi.useRealTimers(); }
  });
});

describe('plan diario sin cambios públicos durante la simulación', () => {
  it('no inventa fechas ni actualizaciones si el equipo ya coincide', () => {
    const { snapshot, context } = setup();
    const plan = buildPlan(snapshot, context, NOW);
    expect(plan.actions).toEqual([]); expect(plan.counts.unchanged).toBe(6);
  });
  it('propone un único componente de traslado tras dos capturas estables', () => {
    const { snapshot, context } = moving();
    const plan = buildPlan(snapshot, context, NOW);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].operations).toEqual([{ kind: 'move', teamProfile: '1' }]);
    expect(plan.day).toBe('2026-09-04');
  });
  it.each([
    ['primera captura', 'awaiting_stability', c => { c.previous = null; }],
    ['capturas demasiado próximas', 'awaiting_stability', c => { c.previous.observedAt = c.observedAt; }],
    ['captura obsoleta', 'awaiting_stability', c => { c.previous.observedAt = '2026-09-01T02:30:00Z'; }],
    ['sin referencia adoptada', 'baseline_conflict', c => { c.baselines = {}; }],
    ['bloqueo manual', 'manual_lock', c => { c.blocked = ['rider:2026:100']; }],
    ['edición especial', 'team_catalog_review', c => { c.links[0].specialEdition = true; }],
    ['contrato futuro', 'affiliation_or_contract_review', c => { c.riders[0].contractUntil = 2028; }],
    ['afiliación futura', 'affiliation_or_contract_review', c => { c.states['male:rider-100'].affiliations.push({ year: 2027, affiliationType: 'regular' }); }],
    ['tramo ya cerrado', 'affiliation_or_contract_review', c => { c.states['male:rider-100'].affiliations[0].dateTo = '2026-12-31'; }],
    ['alta hoy', 'affiliation_or_contract_review', c => { c.states['male:rider-100'].affiliations[0].dateFrom = '2026-09-04'; }],
    ['biografía contradictoria', 'biography_review', c => { c.riders[0].birthDate = '2000-01-02'; }],
    ['perfil en ambos géneros', 'identity_conflict', c => { c.riders.push({ ...c.riders[0], gender: 'female' }); }],
  ])('deja en revisión: %s', (_, reason, mutate) => {
    const { snapshot, context } = moving(); mutate(context);
    const plan = buildPlan(snapshot, context, NOW);
    expect(plan.actions).toEqual([]); expect(plan.cases.map(c => c.reason)).toContain(reason);
  });
  it('no decide entre dos plantillas ni a partir de una ausencia', () => {
    const { snapshot, context } = moving(); snapshot.records['100'].regular.push('2');
    expect(buildPlan(snapshot, context, NOW).actions).toEqual([]);
    delete snapshot.records['100'];
    const plan = buildPlan(snapshot, context, NOW);
    expect(plan.actions).toEqual([]); expect(plan.cases.some(c => c.reason === 'source_absence')).toBe(true);
  });
  it('omite un perfil UCI clasificado como personal técnico', () => {
    const { snapshot, context } = setup(); context.exclusions = ['100'];
    const plan = buildPlan(snapshot, context, NOW);
    expect(plan.actions.some(action => action.profile === '100')).toBe(false);
    expect(plan.cases.some(row => row.key.includes(':100'))).toBe(false);
  });
  it('agrupa el relleno de campo vacío y el traslado para una sola transacción', () => {
    const { snapshot, context } = moving(); context.riders[0].birthDate = null;
    const plan = buildPlan(snapshot, context, NOW);
    expect(plan.actions).toHaveLength(1); expect(plan.actions[0].operations.map(o => o.kind)).toEqual(['fill', 'move']);
  });
  it('suspende el ciclo ante una caída de plantilla o demasiados cambios', () => {
    const { snapshot, context } = moving(); context.previous.snapshot.teams['1'].members = 20;
    expect(buildPlan(snapshot, context, NOW).suspended).toBe(true);
  });
  it('conserva los trainees ya registrados sin refrescar sus fechas', () => {
    const { snapshot, context } = setup(); snapshot.records['100'].trainees = ['2'];
    context.states['male:rider-100'].affiliations.push({ teamId: 'team-2', year: 2026, affiliationType: 'trainee' });
    expect(buildPlan(snapshot, context, NOW).actions).toEqual([]);
  });
  it.each([
    ['2026-09-03T22:30:00Z', '2026-09-04'], ['2026-01-01T23:30:00Z', '2026-01-02'],
    ['2026-03-29T00:30:00Z', '2026-03-29'], ['2026-10-25T01:30:00Z', '2026-10-25'],
  ])('usa Europe/Madrid en %s', (time, expected) => expect(madridDate(new Date(time))).toBe(expected));
});

describe('conexión y errores', () => {
  it('exige el rol dedicado y valida el certificado aunque la URL pida desactivarlo', () => {
    const config = clientConfig('postgres://cc_uci_catalog_worker.project:secret@db.example/db?sslmode=no-verify&ssl=false&user=postgres');
    expect(config.ssl.rejectUnauthorized).toBe(true); expect(config.connectionString).not.toContain('sslmode');
    expect(config.connectionString).not.toContain('?');
    expect(() => clientConfig('postgres://postgres:secret@db.example/db')).toThrow('wrong_database_role');
    expect(() => clientConfig('password secret malformed URL')).toThrow('invalid_catalog_database_url');
  });
  it('no vuelca credenciales ni mensajes arbitrarios de PostgreSQL', () => {
    expect(errorCode(new Error('postgres://worker:secret@db.example/db'))).toBe('catalog_error');
    expect(errorCode(new Error('apply_rejected:concurrent_edit'))).toBe('apply_rejected:concurrent_edit');
  });
});
