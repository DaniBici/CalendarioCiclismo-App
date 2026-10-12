import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CX_SOURCES, HBO_CX_SOURCE, SPORZA_CX_SOURCE, TNT_URL,
  cxCategoryFromLabel, desiredRows, joinSporzaCx, matchCxRace, parseHboCyclocrossCatalog,
  parseSporzaCxLivestreams, parseSporzaCxSchedule, planCxRace,
} from '../../scripts/broadcasts-sync/cx-broadcasts-core.mjs';
import {
  collectHboCx, collectSporzaCx, runCxBroadcasts, summarizeCxSource,
} from '../../scripts/broadcasts-sync/cx-broadcasts.mjs';

const fixture = (name) => readFileSync(
  fileURLToPath(new URL(`../../scripts/broadcasts-sync/fixtures/${name}`, import.meta.url)),
  'utf8',
);

const WE = { category: 'WE', dateKey: '2026-10-11', isCancelled: false };
const ME = { category: 'ME', dateKey: '2026-10-11', isCancelled: false };
const races = [
  {
    id: 'dendermonde', name: 'Mosselcross', nameEn: null, venue: 'Dendermonde', dateKey: '2026-10-11',
    endDateKey: null, isCancelled: false, tournamentName: 'HG Cross', tournamentNameEn: null,
    categories: [WE, ME],
  },
  {
    id: 'meulebeke', name: 'Berencross', nameEn: null, venue: 'Tielt (Meulebeke)', dateKey: '2026-10-17',
    endDateKey: null, isCancelled: false, tournamentName: 'HG Cross', tournamentNameEn: null,
    categories: [{ ...WE, dateKey: '2026-10-17' }, { ...ME, dateKey: '2026-10-17' }],
  },
  {
    id: 'heerde', name: 'Internationale Cyclocross Heerderstrand', nameEn: null, venue: 'Heerde',
    dateKey: '2026-10-24', endDateKey: null, isCancelled: false, tournamentName: 'HG Cross', tournamentNameEn: null,
    categories: [{ ...WE, dateKey: '2026-10-24' }, { ...ME, dateKey: '2026-10-24' }],
  },
  {
    id: 'overijse', name: 'Vlaamse Druivencross', nameEn: null, venue: 'Overijse', dateKey: '2026-10-25',
    endDateKey: null, isCancelled: false, tournamentName: 'Telenet Superprestige', tournamentNameEn: null,
    categories: [{ category: 'ME', dateKey: '2026-10-25', isCancelled: false }],
  },
];

// Estado previo de Dendermonde: identificadores HBO erróneos y horas de Sporza
// tomadas de la salida de carrera, como se cargó a mano.
const staleDendermonde = () => [
  { id: 'we-euro', raceId: 'dendermonde', category: 'WE', channel: 'Eurosport (HBO Max)', country: 'EUROPA',
    startTimeUtc: '2026-10-11T11:40:00.000Z', url: 'https://play.hbomax.com/sport/9ff6b798-df75-5565-bfc1-3d95aa8d02cd',
    note: null, sortOrder: 0, showInRevive: false, isSporza: false },
  { id: 'we-tnt', raceId: 'dendermonde', category: 'WE', channel: 'TNT Sports (HBO Max)', country: 'UK_IE',
    startTimeUtc: '2026-10-11T11:40:00.000Z', url: TNT_URL, note: null, sortOrder: 1, showInRevive: false, isSporza: false },
  { id: 'we-sporza', raceId: 'dendermonde', category: 'WE', channel: 'Sporza', country: 'BE',
    startTimeUtc: '2026-10-11T11:45:00.000Z', url: 'https://sporza.be/nl/sport/wielrennen/~3305648/',
    note: null, sortOrder: 2, showInRevive: false, isSporza: true },
  { id: 'me-euro', raceId: 'dendermonde', category: 'ME', channel: 'Eurosport (HBO Max)', country: 'EUROPA',
    startTimeUtc: '2026-10-11T12:57:00.000Z', url: 'https://play.hbomax.com/sport/647f2a59-1da1-5f32-a81b-a24e8e4ab08e',
    note: null, sortOrder: 3, showInRevive: false, isSporza: false },
  { id: 'me-tnt', raceId: 'dendermonde', category: 'ME', channel: 'TNT Sports (HBO Max)', country: 'UK_IE',
    startTimeUtc: '2026-10-11T12:57:00.000Z', url: TNT_URL, note: null, sortOrder: 4, showInRevive: false, isSporza: false },
  { id: 'me-sporza', raceId: 'dendermonde', category: 'ME', channel: 'Sporza', country: 'BE',
    startTimeUtc: '2026-10-11T13:00:00.000Z', url: 'https://sporza.be/nl/sport/wielrennen/~3305641/',
    note: null, sortOrder: 5, showInRevive: false, isSporza: true },
];

const hboEvents = () => parseHboCyclocrossCatalog(fixture('hbo-cyclocross.html')).events;
const hboEvent = (label, category) => hboEvents()
  .find((event) => event.label === label && event.category === category);

const sporzaEvents = () => {
  const { events } = parseSporzaCxLivestreams(fixture('sporza-cx-livestream.html'), { todayKey: '2026-10-11' });
  const matches = new Map([
    ['2026-10-11', parseSporzaCxSchedule(fixture('sporza-cx-schedule-20261011.json'))],
    ['2026-10-17', parseSporzaCxSchedule(fixture('sporza-cx-schedule-20261017.json'))],
  ]);
  return joinSporzaCx(events.filter((event) => matches.has(event.dateKey)), matches).events;
};

const entry = (event) => ({ event, desired: desiredRows(event) });

describe('categorías de ciclocross en las fuentes', () => {
  it('reconoce élite, sub-23 y júnior por género y descarta etiquetas ambiguas', () => {
    expect(cxCategoryFromLabel('Men')).toBe('ME');
    expect(cxCategoryFromLabel('Women')).toBe('WE');
    expect(cxCategoryFromLabel('HG cross vrouwen')).toBe('WE');
    expect(cxCategoryFromLabel('HG cross mannen')).toBe('ME');
    expect(cxCategoryFromLabel('Men U23')).toBe('MU');
    expect(cxCategoryFromLabel('Women Juniors')).toBe('WJ');
    expect(cxCategoryFromLabel('Mixed')).toBeNull();
    expect(cxCategoryFromLabel('Highlights')).toBeNull();
    expect(cxCategoryFromLabel('Men Masters')).toBeNull();
  });
});

describe('catálogo HBO Max de ciclocross', () => {
  it('extrae solo los eventos Cyclo-cross en directo', () => {
    const { events, catalogEventCount } = parseHboCyclocrossCatalog(fixture('hbo-cyclocross.html'));
    expect(catalogEventCount).toBe(9);
    expect(events.map((event) => [event.label, event.category])).toEqual([
      ['HG Cross | Dendermonde', 'WE'],
      ['HG Cross | Dendermonde', 'ME'],
      ['HG Cross | Meulebeke', 'WE'],
      ['HG Cross | Meulebeke', 'ME'],
      ['HG Cross | Heerderstrand', 'WE'],
      ['Superprestige | Overijse', 'MU'],
      ['Superprestige | Overijse', null],
    ]);
    expect(hboEvent('HG Cross | Dendermonde', 'WE')).toMatchObject({
      externalEventId: 'aec0a6cf-12f4-5d8d-9d93-e0f7884d1d10',
      dateKey: '2026-10-11',
      tournamentLabel: 'HG Cross',
      venueLabel: 'Dendermonde',
      startTimeUtc: '2026-10-11T11:42:00.000Z',
      broadcastUrl: 'https://play.hbomax.com/sport/aec0a6cf-12f4-5d8d-9d93-e0f7884d1d10',
    });
  });

  it('genera Eurosport en EUROPA y su espejo TNT en UK_IE con la misma hora', () => {
    const rows = desiredRows(hboEvent('HG Cross | Dendermonde', 'ME'));
    expect(rows).toEqual([
      expect.objectContaining({
        role: 'hbo_primary', channel: 'Eurosport (HBO Max)', country: 'EUROPA',
        url: 'https://play.hbomax.com/sport/39687429-2b06-561f-bb4b-570832f7d200',
        startTimeUtc: '2026-10-11T12:57:00.000Z',
      }),
      expect.objectContaining({
        role: 'hbo_mirror', channel: 'TNT Sports (HBO Max)', country: 'UK_IE', url: TNT_URL,
        startTimeUtc: '2026-10-11T12:57:00.000Z',
      }),
    ]);
  });

  it('falla si el catálogo no contiene ningún evento', async () => {
    await expect(collectHboCx({ fetcher: async () => '<html></html>' })).rejects.toThrow(/no contiene eventos/);
  });
});

describe('emparejamiento con carreras CX', () => {
  it('une por fecha y sede, también con la localidad entre paréntesis o un prefijo de la sede', () => {
    expect(matchCxRace(hboEvent('HG Cross | Dendermonde', 'ME'), races))
      .toMatchObject({ status: 'matched', race: { id: 'dendermonde' }, basis: 'venue+tournament' });
    expect(matchCxRace(hboEvent('HG Cross | Meulebeke', 'WE'), races))
      .toMatchObject({ status: 'matched', race: { id: 'meulebeke' } });
    expect(matchCxRace(hboEvent('HG Cross | Heerderstrand', 'WE'), races))
      .toMatchObject({ status: 'matched', race: { id: 'heerde' } });
  });

  it('no empareja solo por torneo ni con otra fecha', () => {
    const elsewhere = { ...hboEvent('HG Cross | Dendermonde', 'ME'), venueLabel: 'Hamme' };
    expect(matchCxRace(elsewhere, races)).toMatchObject({ status: 'unmatched', candidates: ['dendermonde'] });
    const otherDay = { ...hboEvent('HG Cross | Dendermonde', 'ME'), dateKey: '2026-10-12' };
    expect(matchCxRace(otherDay, races).status).toBe('unmatched');
  });

  it('declara ambigua una sede compartida por dos carreras del mismo día', () => {
    const twin = { ...races[0], id: 'twin', name: 'Otra prueba', tournamentName: null };
    expect(matchCxRace({ ...hboEvent('HG Cross | Dendermonde', 'ME'), tournamentLabel: null }, [races[0], twin]))
      .toMatchObject({ status: 'ambiguous' });
  });
});

describe('planificación de filas HBO Max y TNT', () => {
  it('crea la pareja Eurosport/TNT al inicio del bloque de su categoría y respeta Sporza', () => {
    const rows = [{
      id: 'sporza', raceId: 'meulebeke', category: 'WE', channel: 'Sporza', country: 'BE',
      startTimeUtc: '2026-10-17T11:30:00.000Z', url: 'https://sporza.be/nl/sport/wielrennen/~3305802/',
      note: null, sortOrder: 0, showInRevive: false, isSporza: true,
    }];
    let n = 0;
    const plan = planCxRace({
      raceId: 'meulebeke', rows, newId: () => `new-${++n}`,
      entries: [entry(hboEvent('HG Cross | Meulebeke', 'WE'))],
    });
    expect(plan.inserts.map((row) => [row.id, row.channel, row.country, row.sortOrder])).toEqual([
      ['new-1', 'Eurosport (HBO Max)', 'EUROPA', 0],
      ['new-2', 'TNT Sports (HBO Max)', 'UK_IE', 1],
    ]);
    expect(plan.updates).toEqual([{ id: 'sporza', set: { sortOrder: 2 }, before: { sortOrder: 0 } }]);
    expect(plan.inserts.every((row) => row.showInRevive === false && row.isSporza === false)).toBe(true);
  });

  it('corrige un identificador erróneo y la hora de ambas filas sin tocar otras columnas', () => {
    const plan = planCxRace({
      raceId: 'dendermonde', rows: staleDendermonde(),
      entries: [entry(hboEvent('HG Cross | Dendermonde', 'WE'))],
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([
      {
        id: 'we-euro',
        set: { url: 'https://play.hbomax.com/sport/aec0a6cf-12f4-5d8d-9d93-e0f7884d1d10', startTimeUtc: '2026-10-11T11:42:00.000Z' },
        before: { url: 'https://play.hbomax.com/sport/9ff6b798-df75-5565-bfc1-3d95aa8d02cd', startTimeUtc: '2026-10-11T11:40:00.000Z' },
      },
      {
        id: 'we-tnt',
        set: { startTimeUtc: '2026-10-11T11:42:00.000Z' },
        before: { startTimeUtc: '2026-10-11T11:40:00.000Z' },
      },
    ]);
  });

  it('repone solo la fila TNT ausente justo después de Eurosport', () => {
    const rows = staleDendermonde().filter((row) => row.id !== 'we-tnt');
    rows.find((row) => row.id === 'we-euro').url = 'https://play.hbomax.com/sport/aec0a6cf-12f4-5d8d-9d93-e0f7884d1d10';
    rows.find((row) => row.id === 'we-euro').startTimeUtc = '2026-10-11T11:42:00.000Z';
    const plan = planCxRace({
      raceId: 'dendermonde', rows, newId: () => 'tnt-new',
      entries: [entry(hboEvent('HG Cross | Dendermonde', 'WE'))],
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ id: 'tnt-new', channel: 'TNT Sports (HBO Max)', sortOrder: 1 });
    // El hueco de sortOrder que dejó la fila ausente absorbe la nueva: nada más cambia.
    expect(plan.updates).toEqual([]);
  });

  it('no modifica una fila con enlace editorial distinto ni un cambio horario superior a tres horas', () => {
    const manual = staleDendermonde();
    manual.find((row) => row.id === 'we-euro').url = 'https://www.hbomax.com/es/es/sports/cycling';
    const locked = planCxRace({
      raceId: 'dendermonde', rows: manual, entries: [entry(hboEvent('HG Cross | Dendermonde', 'WE'))],
    });
    expect(locked.updates).toEqual([]);
    expect(locked.report).toEqual([expect.objectContaining({ action: 'manual_lock', rowId: 'we-euro' })]);

    const far = staleDendermonde();
    far.find((row) => row.id === 'me-euro').startTimeUtc = '2026-10-11T07:00:00.000Z';
    const implausible = planCxRace({
      raceId: 'dendermonde', rows: far, entries: [entry(hboEvent('HG Cross | Dendermonde', 'ME'))],
    });
    expect(implausible.updates).toEqual([]);
    expect(implausible.report).toEqual([expect.objectContaining({ action: 'implausible_change' })]);
  });

  it('no actúa si la categoría tiene dos filas del mismo canal gestionado', () => {
    const rows = [...staleDendermonde(), { ...staleDendermonde()[0], id: 'we-euro-dup', sortOrder: 6 }];
    const plan = planCxRace({
      raceId: 'dendermonde', rows, entries: [entry(hboEvent('HG Cross | Dendermonde', 'WE'))],
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.report).toEqual([expect.objectContaining({ action: 'ambiguous' })]);
  });

  it('es idempotente: una segunda pasada con las filas ya corregidas no produce cambios', () => {
    const first = planCxRace({
      raceId: 'dendermonde', rows: staleDendermonde(),
      entries: [...hboEvents().filter((event) => event.dateKey === '2026-10-11'), ...sporzaEvents()
        .filter((event) => event.dateKey === '2026-10-11')].map(entry),
    });
    const next = staleDendermonde().map((row) => {
      const update = first.updates.find((item) => item.id === row.id);
      return update ? { ...row, ...update.set } : row;
    });
    const second = planCxRace({
      raceId: 'dendermonde', rows: next,
      entries: [...hboEvents().filter((event) => event.dateKey === '2026-10-11'), ...sporzaEvents()
        .filter((event) => event.dateKey === '2026-10-11')].map(entry),
    });
    expect(second.inserts).toEqual([]);
    expect(second.updates).toEqual([]);
    expect(second.report.every((item) => item.action === 'unchanged')).toBe(true);
  });
});

describe('Sporza: livestreams de veldrijden', () => {
  it('extrae solo las filas de veldrijden con su fecha y su hora de emisión', () => {
    const { events, rowCount } = parseSporzaCxLivestreams(fixture('sporza-cx-livestream.html'), { todayKey: '2026-10-11' });
    expect(rowCount).toBe(8);
    expect(events.map((event) => [event.dateKey, event.localTime, event.venueLabel, event.category])).toEqual([
      ['2026-10-11', '13:30', 'Dendermonde', 'WE'],
      ['2026-10-11', '14:45', 'Dendermonde', 'ME'],
      ['2026-10-17', '13:30', 'Meulebeke', 'WE'],
      ['2026-10-17', '14:45', 'Meulebeke', 'ME'],
      ['2026-10-24', '13:30', 'Heerde (Ned)', 'WE'],
      ['2026-10-24', '14:45', 'Heerde (Ned)', 'ME'],
    ]);
    expect(events[0].startTimeUtc).toBe('2026-10-11T11:30:00.000Z');
  });

  it('une cada livestream con su partido y usa la ruta estable ~matchId', () => {
    const events = sporzaEvents();
    expect(events.map((event) => [event.dateKey, event.category, event.externalEventId, event.broadcastUrl])).toEqual([
      ['2026-10-11', 'WE', '3305648', 'https://sporza.be/nl/sport/wielrennen/~3305648/'],
      ['2026-10-11', 'ME', '3305641', 'https://sporza.be/nl/sport/wielrennen/~3305641/'],
      ['2026-10-17', 'WE', '3305802', 'https://sporza.be/nl/sport/wielrennen/~3305802/'],
      ['2026-10-17', 'ME', '3305801', 'https://sporza.be/nl/sport/wielrennen/~3305801/'],
    ]);
  });

  it('no genera enlace cuando el calendario no contiene el partido', () => {
    const { events } = parseSporzaCxLivestreams(fixture('sporza-cx-livestream.html'), { todayKey: '2026-10-11' });
    const joined = joinSporzaCx(events.filter((event) => event.dateKey === '2026-10-24'), new Map([['2026-10-24', []]]));
    expect(joined.events).toEqual([]);
    expect(joined.diagnostics).toHaveLength(2);
    expect(joined.diagnostics[0]).toMatchObject({ action: 'insufficient_broadcast_evidence', dateKey: '2026-10-24' });
  });

  it('falla si la página no contiene ninguna fila de livestream', async () => {
    await expect(collectSporzaCx({ fetcher: async () => '<html></html>', todayKey: '2026-10-11' }))
      .rejects.toThrow(/no contiene filas/);
  });
});

// Base de datos en memoria con las sentencias que usa el sincronizador.
function fakeDb({ raceRows, broadcastRows, conflictOnUpdate = false }) {
  const state = { broadcasts: structuredClone(broadcastRows), logs: [], writes: 0, backup: null };
  const clone = (row) => ({ ...row, startTimeUtc: row.startTimeUtc ? new Date(row.startTimeUtc) : null });
  return {
    state,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text === 'BEGIN') { state.backup = structuredClone(state.broadcasts); return { rows: [], rowCount: 0 }; }
      if (text === 'COMMIT') { state.backup = null; return { rows: [], rowCount: 0 }; }
      if (text === 'ROLLBACK') { state.broadcasts = state.backup; return { rows: [], rowCount: 0 }; }
      if (/pg_advisory_xact_lock/.test(text)) return { rows: [], rowCount: 0 };
      if (/FROM public\.cx_races r/.test(text)) return { rows: raceRows, rowCount: raceRows.length };
      if (/^SELECT id FROM public\.cx_broadcasts/.test(text)) {
        const rows = state.broadcasts.filter((row) => row.raceId === params[0]).map((row) => ({ id: row.id }));
        return { rows, rowCount: rows.length };
      }
      if (/FROM public\.cx_broadcasts WHERE "raceId" = ANY/.test(text)) {
        const rows = state.broadcasts.filter((row) => params[0].includes(row.raceId)).map(clone);
        return { rows, rowCount: rows.length };
      }
      if (/FROM public\.cx_broadcasts WHERE "raceId" = \$1/.test(text)) {
        const rows = state.broadcasts.filter((row) => row.raceId === params[0]).map(clone);
        return { rows, rowCount: rows.length };
      }
      if (/^INSERT INTO public\.cx_broadcasts/.test(text)) {
        const [id, raceId, category, channel, startTimeUtc, url, note, country, sortOrder, showInRevive, isSporza] = params;
        state.broadcasts.push({ id, raceId, category, channel, startTimeUtc, url, note, country, sortOrder, showInRevive, isSporza });
        state.writes += 1;
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE public\.cx_broadcasts SET/.test(text)) {
        if (conflictOnUpdate) return { rows: [], rowCount: 0 };
        const idParam = Number(text.match(/WHERE id = \$(\d+)/)[1]);
        const row = state.broadcasts.find((item) => item.id === params[idParam - 1]);
        for (const [, column, index] of text.split(' WHERE ')[0].matchAll(/"(\w+)" = \$(\d+)/g)) {
          row[column] = params[Number(index) - 1];
        }
        state.writes += 1;
        return { rows: [], rowCount: 1 };
      }
      if (/^INSERT INTO private\.cx_change_log/.test(text)) {
        state.logs.push(params);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Sentencia no prevista: ${text.slice(0, 80)}`);
    },
  };
}

const collectors = () => ({
  [HBO_CX_SOURCE]: () => collectHboCx({ fetcher: async () => fixture('hbo-cyclocross.html') }),
  [SPORZA_CX_SOURCE]: () => collectSporzaCx({
    todayKey: '2026-10-11',
    fetcher: async (url) => {
      if (url.includes('/livestream/')) return fixture('sporza-cx-livestream.html');
      if (url.includes('date=2026-10-11')) return fixture('sporza-cx-schedule-20261011.json');
      if (url.includes('date=2026-10-17')) return fixture('sporza-cx-schedule-20261017.json');
      throw new Error(`Consulta no prevista: ${url}`);
    },
  }),
});

const NOW = new Date('2026-10-11T09:00:00Z');

describe('pasada completa del sincronizador de ciclocross', () => {
  it('en sombra planifica sin escribir', async () => {
    const db = fakeDb({ raceRows: races, broadcastRows: staleDendermonde() });
    const result = await runCxBroadcasts({ client: db, applySources: new Set(), collectors: collectors(), now: NOW });
    expect(result.mode).toBe('shadow');
    expect(db.state.writes).toBe(0);
    expect(db.state.logs).toEqual([]);
    expect(result.report.filter((row) => row.action === 'shadow_update').length).toBeGreaterThan(0);
    expect(result.report.filter((row) => row.action === 'shadow_insert').length).toBe(6);
  });

  it('con escritura corrige Dendermonde, crea Meulebeke y audita cada carrera', async () => {
    const db = fakeDb({ raceRows: races, broadcastRows: staleDendermonde() });
    const result = await runCxBroadcasts({
      client: db, applySources: new Set(CX_SOURCES), collectors: collectors(), now: NOW,
    });
    expect(result.mode).toBe('apply');
    expect(result.degraded).toBe(false);

    const byId = (id) => db.state.broadcasts.find((row) => row.id === id);
    expect(byId('we-euro')).toMatchObject({
      url: 'https://play.hbomax.com/sport/aec0a6cf-12f4-5d8d-9d93-e0f7884d1d10',
      startTimeUtc: '2026-10-11T11:42:00.000Z',
    });
    expect(byId('me-euro').url).toBe('https://play.hbomax.com/sport/39687429-2b06-561f-bb4b-570832f7d200');
    expect(byId('we-sporza').startTimeUtc).toBe('2026-10-11T11:30:00.000Z');
    expect(byId('me-sporza').startTimeUtc).toBe('2026-10-11T12:45:00.000Z');

    const meulebeke = db.state.broadcasts.filter((row) => row.raceId === 'meulebeke')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(meulebeke.map((row) => [row.category, row.channel, row.country])).toEqual([
      ['WE', 'Eurosport (HBO Max)', 'EUROPA'],
      ['WE', 'TNT Sports (HBO Max)', 'UK_IE'],
      ['WE', 'Sporza', 'BE'],
      ['ME', 'Eurosport (HBO Max)', 'EUROPA'],
      ['ME', 'TNT Sports (HBO Max)', 'UK_IE'],
      ['ME', 'Sporza', 'BE'],
    ]);
    expect(meulebeke.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(db.state.logs).toHaveLength(2);

    const again = await runCxBroadcasts({
      client: db, applySources: new Set(CX_SOURCES), collectors: collectors(), now: NOW,
    });
    expect(again.report.filter((row) => ['applied_insert', 'applied_update'].includes(row.action))).toEqual([]);
    expect(db.state.logs).toHaveLength(2);
  });

  it('un conflicto concurrente revierte la carrera y marca la fuente con error', async () => {
    const db = fakeDb({ raceRows: races, broadcastRows: staleDendermonde(), conflictOnUpdate: true });
    const before = structuredClone(db.state.broadcasts);
    const result = await runCxBroadcasts({
      client: db, applySources: new Set(CX_SOURCES), collectors: collectors(), now: NOW,
    });
    expect(result.degraded).toBe(true);
    expect(db.state.broadcasts.filter((row) => row.raceId === 'dendermonde')).toEqual(before);
    // Meulebeke solo inserta filas y se escribe; solo Dendermonde falla.
    expect(db.state.logs.map((params) => params[0])).toEqual(['meulebeke']);
    expect(summarizeCxSource(HBO_CX_SOURCE, result.report)).toMatchObject({ status: 'error' });
  });

  it('avisa de un enlace HBO Max que el catálogo no reconoce en una prueba inminente', async () => {
    const db = fakeDb({ raceRows: races, broadcastRows: staleDendermonde() });
    const hbo = collectors()[HBO_CX_SOURCE];
    const trimmed = async () => {
      const collected = await hbo();
      return { ...collected, events: collected.events.filter((event) => event.dateKey !== '2026-10-11') };
    };
    const result = await runCxBroadcasts({
      client: db, applySources: new Set(),
      collectors: { ...collectors(), [HBO_CX_SOURCE]: trimmed }, now: NOW,
    });
    const warnings = result.report.filter((row) => row.action === 'unverified_link');
    expect(warnings.map((row) => row.category).sort()).toEqual(['ME', 'WE']);
    expect(summarizeCxSource(HBO_CX_SOURCE, result.report).status).toBe('warning');
  });

  it('una fuente caída no impide procesar la otra', async () => {
    const db = fakeDb({ raceRows: races, broadcastRows: staleDendermonde() });
    const result = await runCxBroadcasts({
      client: db, applySources: new Set(CX_SOURCES), now: NOW,
      collectors: {
        ...collectors(),
        [HBO_CX_SOURCE]: async () => { throw new Error('503 al consultar HBO'); },
      },
    });
    expect(result.degraded).toBe(true);
    expect(result.report).toContainEqual(expect.objectContaining({ source: HBO_CX_SOURCE, action: 'source_failure' }));
    expect(db.state.broadcasts.find((row) => row.id === 'we-sporza').startTimeUtc).toBe('2026-10-11T11:30:00.000Z');
    expect(summarizeCxSource(HBO_CX_SOURCE, result.report).status).toBe('error');
  });
});
