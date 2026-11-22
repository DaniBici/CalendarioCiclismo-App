import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  UCI_DIRECTORY_PROVIDER, collapseTeamTimeTrialRanks, directorySyntheticId, fetchDirectoryCxCompetition,
  fetchDirectoryRoadCompetition, uciProfileIdFromRiderRef,
} from '../results-fetchers/uci-directory-results.mjs';
import { buildPlan } from '../results-fetchers/results-upsert.mjs';
import { prepareCxResults } from '../results-fetchers/cx-results-upsert.mjs';
import { findUciCompetitionByCalendarId } from '../../supabase/functions/_shared/uci-competition-api.mjs';

describe('búsqueda de una competición del directorio por uciCalendarId', () => {
  // Carretera 2027: `code` propio (ROA_2027_…) y la búsqueda no mira `v1Code`.
  const andalucia2027 = { id: 'a14ad479-3d68-4a66-a801-406d53905fad', code: 'ROA_2027_2.PRO_001184', v1Code: 'D2CP81064',
    name: 'Vuelta a Andalucia Ruta Ciclista Del Sol', seasonYear: 2027 };
  const decoy = { id: 'b', code: 'ROA_2027_1.2_000001', v1Code: 'D2CP810640', name: 'Otra', seasonYear: 2027 };
  const fakeFetch = (pages) => async (url) => {
    const query = new URL(url).searchParams;
    const items = pages[query.get('search') ? 'search' : query.get('seasonYear')] || [];
    return new Response(JSON.stringify({ count: items.length, items }), { status: 200 });
  };

  it('recorre las temporadas cuando la búsqueda no encuentra el D2CP y exige el código exacto', async () => {
    const fetcher = fakeFetch({ search: [decoy], 2026: [], 2027: [decoy, andalucia2027] });
    await expect(findUciCompetitionByCalendarId({ fetcher, calendarId: 81064, disciplineCode: 'ROA', seasonYears: [2026, 2027] }))
      .resolves.toMatchObject({ id: andalucia2027.id });
    await expect(findUciCompetitionByCalendarId({ fetcher, calendarId: 81064, disciplineCode: 'ROA', seasonYears: [2026] }))
      .resolves.toBeNull();
  });

  it('no recorre temporadas si la búsqueda ya da la competición', async () => {
    const urls = [];
    const pages = fakeFetch({ search: [{ ...andalucia2027, code: 'D2CP81064' }] });
    const fetcher = async (url) => { urls.push(url); return pages(url); };
    await expect(findUciCompetitionByCalendarId({ fetcher, calendarId: 81064, disciplineCode: 'ROA', seasonYears: [2027] }))
      .resolves.toMatchObject({ id: andalucia2027.id });
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.get('seasonYear')).toBeNull();
  });
});

// Respuestas reales del directorio de competiciones UCI (11-11-2026), sin el
// correo del organizador ni los comisarios: Clásica Provincia de Chiriquí 2026
// (dos etapas y «Final Result») y Jaarmarktcross de Niel (CX, cuatro mangas).
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const clientFor = (data, overrides = {}) => ({
  findByCalendarId: async () => { const { races, ...item } = data.competition; return item; },
  competition: async () => data.competition,
  availability: async () => data.availability,
  results: async (_competition, eventId) => {
    if (!data.results[eventId]) throw new Error(`Evento sin fixture: ${eventId}`);
    return data.results[eventId];
  },
  ...overrides,
});

describe('directorio UCI → contrato de carretera de DataRide', () => {
  const chiriqui = fixture('uci-directory-chiriqui-2026.json');

  it('mapea etapas, final y clasificaciones por nombre con IDs sintéticos negativos', async () => {
    const document = await fetchDirectoryRoadCompetition({ calendarId: 79060, client: clientFor(chiriqui) });
    expect(document.provider).toBe(UCI_DIRECTORY_PROVIDER);
    expect(document).not.toHaveProperty('source');
    expect(document.competitionId).toBeLessThan(0);
    expect(document.directory).toMatchObject({ uciCalendarId: 79060, v1Code: 'D2CP79060' });
    expect(document.stages.map((stage) => [stage.stageNumber, stage.isFinalClassification, stage.dateKey]))
      .toEqual([[1, false, '2026-10-17'], [null, true, '2026-10-18'], [2, false, '2026-10-18']]);
    const first = document.stages[0];
    expect(first.classifications.map((cl) => `${cl.scope}/${cl.classKind}`))
      .toEqual(['stage/stage', 'stage/gc', 'stage/points', 'overall/points', 'stage/youth', 'overall/youth']);
    const ids = document.stages.flatMap((stage) => [stage.uciRaceId, ...stage.classifications.map((cl) => cl.eventId)]);
    expect(ids.every((id) => Number.isInteger(id) && id < 0 && id >= -200_000_000)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.stages.flatMap((stage) => stage.classifications.map((cl) => cl.publication))
      .every((publication) => publication.provider === UCI_DIRECTORY_PROVIDER && publication.format === 'uci')).toBe(true);
    const again = await fetchDirectoryRoadCompetition({ calendarId: 79060, client: clientFor(chiriqui) });
    expect(again.stages.flatMap((stage) => stage.classifications.map((cl) => cl.eventId)))
      .toEqual(document.stages.flatMap((stage) => stage.classifications.map((cl) => cl.eventId)));
  });

  it('emite filas sin dorsal con perfil y licencia UCI, nacionalidad ISO-2 y puntos enteros', async () => {
    const document = await fetchDirectoryRoadCompetition({ calendarId: 79060, client: clientFor(chiriqui) });
    const [arrival, , points] = document.stages[0].classifications;
    expect(arrival.rows[0]).toMatchObject({
      rank: 1, bib: null, birthDate: null, riderDisplay: 'MARTIN SANZ Gotzon', firstName: 'Gotzon', lastName: 'MARTIN SANZ',
      isoCode2: 'es', uciId: '10009110607', uciProfileId: '91106', timeText: '03:38:12', gapText: null, points: 7, irm: null,
    });
    expect(arrival.winnerName).toBe('MARTIN SANZ Gotzon');
    expect(arrival.rows.find((row) => row.riderDisplay === 'CASTILLO Kelvin')).toMatchObject({ irm: 'DNF', rankText: '61' });
    expect(points.rows[0]).toMatchObject({ rank: 1, resultValue: '18', timeText: null, gapText: null });
    const final = document.stages[1].classifications.find((cl) => cl.classKind === 'gc');
    expect(final.rows[1]).toMatchObject({ isoCode2: 'pa', uciProfileId: '97249', timeText: '07:04:59' });
  });

  it('limita a una etapa y omite los eventos sin filas publicadas', async () => {
    const stageTwo = await fetchDirectoryRoadCompetition({ calendarId: 79060, stage: 2, client: clientFor(chiriqui) });
    expect(stageTwo.stages.map((stage) => stage.stageNumber)).toEqual([2]);
    const youth = chiriqui.competition.races.find((race) => race.name === 'Stage 2').events.find((event) => event.classificationCode === 'STYO');
    const availability = { ...chiriqui.availability, resultCounts: { ...chiriqui.availability.resultCounts, [youth.id]: 0 } };
    const partial = await fetchDirectoryRoadCompetition({ calendarId: 79060, stage: 2,
      client: clientFor(chiriqui, { availability: async () => availability }) });
    expect(partial.stages[0].classifications.map((cl) => cl.classKind)).toEqual(['stage', 'points']);
  });

  it('rechaza una competición de otra disciplina o de otro ID de calendario', async () => {
    await expect(fetchDirectoryRoadCompetition({ calendarId: 79146, client: clientFor(fixture('uci-directory-niel-cx-2026.json')) }))
      .rejects.toThrow('CRO, no ROA');
    await expect(fetchDirectoryRoadCompetition({ calendarId: 79061, client: clientFor(chiriqui) })).rejects.toThrow('no es D2CP79061');
  });

  it('el upsert lo carga como fuente secundaria sin fuente declarada', async () => {
    const document = await fetchDirectoryRoadCompetition({ calendarId: 79060, client: clientFor(chiriqui) });
    const plan = buildPlan(document);
    expect(plan.nStages).toBe(12);
    expect([...plan.acceptedEventIds].every((id) => id < 0)).toBe(true);
    expect(() => buildPlan(document, null, null, null, null, 'pdf')).toThrow('no declara fuente');
  });
});

describe('identificadores del directorio', () => {
  it('deriva el uciProfileId de las cifras 3 a 9 de la licencia', () => {
    expect(uciProfileIdFromRiderRef('10008198096')).toBe('81980');
    expect(uciProfileIdFromRiderRef('10066730021')).toBe('667300');
    expect(uciProfileIdFromRiderRef('1000819809')).toBeNull();
    expect(uciProfileIdFromRiderRef('10000000001')).toBeNull();
  });

  it('genera IDs negativos estables por tipo y código', () => {
    expect(directorySyntheticId('event', 'D2EV382295')).toBe(-46582630);   // ancla del ID guardado
    expect(directorySyntheticId('race', 'D2EV382295')).toBe(-32900745);
    expect(() => directorySyntheticId('event', '')).toThrow();
  });

  it('deja el puesto y el equipo de una CRE solo en el primer corredor de cada equipo', () => {
    const rows = [
      { rank: 1, rankText: '1', teamName: 'A', irm: null }, { rank: 1, rankText: '1', teamName: 'A', irm: null },
      { rank: 2, rankText: '2', teamName: 'B', irm: null }, { rank: 2, rankText: '2', teamName: 'B', irm: null },
      { rank: null, rankText: 'DNS', teamName: 'B', irm: 'DNS' },
    ];
    expect(collapseTeamTimeTrialRanks(rows).map((row) => [row.rank, row.rankText, row.teamName]))
      .toEqual([[1, '1', 'A'], [null, '', null], [2, '2', 'B'], [null, '', null], [null, 'DNS', 'B']]);
  });
});

describe('directorio UCI → documento CX manual', () => {
  const niel = fixture('uci-directory-niel-cx-2026.json');
  const options = { calendarId: 79146, raceId: 'niel-2026', seasonKey: '2026-27', client: clientFor(niel) };

  it('emite las cuatro mangas con vueltas perdidas, abandonos y licencia UCI', async () => {
    const document = await fetchDirectoryCxCompetition(options);
    expect(document).toMatchObject({ schemaVersion: 1, source: 'manual', provider: UCI_DIRECTORY_PROVIDER, disciplineId: 3,
      raceId: 'niel-2026', seasonKey: '2026-27', exclusions: [] });
    expect(document.categories.map((manga) => [manga.category, manga.dateKey, manga.rows.length]))
      .toEqual([['ME', '2026-11-11', 41], ['WE', '2026-11-11', 28], ['MJ', '2026-11-11', 64], ['WJ', '2026-11-11', 12]]);
    const elite = document.categories[0];
    expect(elite.rows[0]).toMatchObject({ rank: 1, riderDisplay: 'Cameron Mason', isoCode2: 'GB', timeSeconds: '3824',
      uciLicenseId: '10023574923', teamName: '777tv CX TEAM' });
    expect(elite.rows[1]).toMatchObject({ rank: 2, gapText: '+20', timeSeconds: '3844' });
    expect(elite.rows.find((row) => row.riderDisplay === 'Declan Oldham')).toMatchObject({ rank: 27, irm: 'LAP', gapText: '-2 LAPS', timeSeconds: null });
    expect(elite.rows.find((row) => row.riderDisplay === 'Laurens Sweeck')).toMatchObject({ rank: null, irm: 'DNF' });
    expect(elite.rows.every((row) => /^\d{11}$/.test(row.uciLicenseId))).toBe(true);
    expect(elite.evidence).toMatchObject({ inputProvider: UCI_DIRECTORY_PROVIDER, officialReviewed: true, lockAutomatic: false });
    expect(elite.evidence.officialReviewSourceUrl).toBe(elite.evidence.sourceUrl);
  });

  it('filtra por categoría y exige carrera y temporada propias', async () => {
    const document = await fetchDirectoryCxCompetition({ ...options, category: 'WJ' });
    expect(document.categories.map((manga) => manga.category)).toEqual(['WJ']);
    await expect(fetchDirectoryCxCompetition({ ...options, seasonKey: null })).rejects.toThrow('--season-key');
    await expect(fetchDirectoryCxCompetition({ ...options, category: 'XX' })).rejects.toThrow('no reconocida');
  });

  it('cx-results-upsert resuelve la ficha por uciLicenseId aunque cambie la grafía', async () => {
    const document = await fetchDirectoryCxCompetition({ ...options, category: 'WJ' });
    const winner = document.categories[0].rows[0];
    const context = {
      race: { id: 'niel-2026', seasonKey: '2026-27', dateKey: '2026-11-11', endDateKey: null, editorialStatus: 'published', isCancelled: false },
      categories: [{ raceId: 'niel-2026', category: 'WJ', dateKey: '2026-11-11', isCancelled: false, resultsLockedAt: null }],
      riders: { men: [], women: [{ id: 'huys-lentel', firstName: 'Lentel', lastName: 'Huijs', otherNames: null, nationality: 'BE',
        birthDate: '2009-01-01', birthDatePrecision: 'year', verified: true, uciProfileId: uciProfileIdFromRiderRef(winner.uciLicenseId) }] },
    };
    const prepared = prepareCxResults(document, context, { status: 'official' });
    expect(prepared.imports[0].rows[0].globalRiderId).toBe('huys-lentel');
    expect(prepared.imports[0].evidence).toMatchObject({ inputSource: 'manual', lockAutomatic: false, officialReviewed: true });
  });
});
