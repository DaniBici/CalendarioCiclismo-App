import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchCxCompetition, matchUciDirectoryResults } from '../results-fetchers/cx-dataride-results.mjs';
import { prepareCxResults } from '../results-fetchers/cx-results-upsert.mjs';

// Registros reales de CX Ciudad de Ávila 2026: DataRide y directorio de competiciones UCI (11-11-2026).
const { dataRide, directory } = JSON.parse(readFileSync(new URL('./fixtures/cx-dataride-uci-directory-avila-2026.json', import.meta.url), 'utf8'));
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const dataRideClient = () => ({
  pages: async (path, form) => structuredClone(path === 'Races/' ? dataRide.races : dataRide.results[form.eventId]),
  events: async raceId => structuredClone(dataRide.events[raceId]),
});
function directoryFetch({ fail = () => false, results = directory.results } = {}) {
  const requests = [];
  const fetcher = async url => {
    requests.push(url);
    const path = new URL(url).pathname.replace(/^\/api/, '');
    if (fail(path)) return new Response('', { status: 503 });
    if (path === '/competitions') return json(directory.list);
    const match = /^\/competitions\/([^/]+)(?:\/events\/([^/]+)\/results)?$/.exec(path);
    if (match && !match[2] && match[1] === directory.competition.id) return json(directory.competition);
    if (match?.[2] && results[match[2]]) return json(results[match[2]]);
    return new Response('', { status: 404 });
  };
  return { fetcher, requests };
}
const directoryResults = category => {
  const race = directory.competition.races.find(item => item.categoryCode === category);
  return directory.results[race.events[0].id].results;
};
const fetchAvila = (options = {}) => fetchCxCompetition({ competitionId: dataRide.competitionId, client: dataRideClient(),
  uciCalendarId: directory.uciCalendarId, ...options });

describe('ID UCI por fila desde el directorio de competiciones UCI', () => {
  it('asigna a cada fila de Ávila 2026 el riderRef del mismo puesto o estado y nombre', async () => {
    const { fetcher, requests } = directoryFetch();
    const doc = await fetchAvila({ directoryFetch: fetcher });
    expect(doc.categories.map(manga => manga.category)).toEqual(['ME', 'WE']);
    for (const manga of doc.categories) {
      // Ambas fuentes ordenan igual: puestos, después DNF y DNS; hermanos (Reinoso Sánchez) con ID propio.
      expect(manga.rows.map(row => row.uciLicenseId)).toEqual(directoryResults(manga.category).map(result => result.riderRef));
      expect(manga.evidence.uciDirectory).toMatchObject({ v1Code: `D2CP${directory.uciCalendarId}`, eventCode: manga.eventCode, matchedRows: manga.rows.length });
    }
    expect(doc.uciDirectory).toMatchObject({ status: 'ok', competitionId: directory.competition.id });
    // La clasificación se lee del origen, no de la copia de CloudFront.
    expect(requests.filter(url => url.includes('/results')).every(url => /[?&]t=\d+/.test(url))).toBe(true);
  });

  it('empareja por tokens contenidos y deja sin ID los puestos ambiguos, el estado distinto y el riderRef repetido', async () => {
    const doc = await fetchAvila({ uciCalendarId: null });
    const rows = doc.categories.find(manga => manga.category === 'WE').rows;
    const results = directoryResults('WE');
    const [first, second, third, fourth] = results;
    const dns = rows.findIndex(row => row.irm === 'DNS');
    // Ficha de nombre y un apellido frente a los dos apellidos del directorio.
    const short = rows.map((row, index) => index === 0 ? { ...row, lastName: 'Cueto', riderDisplay: 'Sara Cueto' } : row);
    expect(matchUciDirectoryResults(short, results)[0]).toBe(first.riderRef);
    // Un solo token no basta para un emparejamiento por inclusión.
    expect(matchUciDirectoryResults([{ ...rows[0], firstName: null, lastName: null, riderDisplay: 'Cueto' }], results)).toEqual([null]);
    const ambiguous = [...results, { ...second, riderRef: '10000000001' }];
    expect(matchUciDirectoryResults(rows, ambiguous)[1]).toBeNull();
    const otherState = results.map(result => result.mark === 'DNS' ? { ...result, mark: 'DNF' } : result);
    expect(matchUciDirectoryResults(rows, otherState)[dns]).toBeNull();
    const repeated = results.map(result => result === fourth ? { ...result, riderRef: third.riderRef } : result);
    expect(matchUciDirectoryResults(rows, repeated).slice(2, 4)).toEqual([null, null]);
    expect(matchUciDirectoryResults(rows, repeated)[0]).toBe(first.riderRef);
  });

  it('sin directorio, sin la competición o sin la clasificación conserva el documento con las filas sin ID', async () => {
    const offline = await fetchAvila({ directoryFetch: directoryFetch({ fail: () => true }).fetcher });
    expect(offline.uciDirectory.status).toBe('error');
    expect(offline.categories.flatMap(manga => manga.rows).every(row => row.uciLicenseId === null)).toBe(true);
    expect(offline.categories.map(manga => [manga.rows.length, manga.publicationHint])).toEqual([[29, 'unverified_results'], [13, 'unverified_results']]);
    expect(offline.categories.every(manga => !manga.evidence.uciDirectory)).toBe(true);

    const other = await fetchAvila({ uciCalendarId: 1, directoryFetch: directoryFetch().fetcher });
    expect(other.uciDirectory.status).toBe('unavailable');

    const weEvent = directory.competition.races.find(race => race.categoryCode === 'WE').events[0].id;
    const unpublished = { ...directory.results, [weEvent]: { ...directory.results[weEvent], results: [] } };
    const partial = await fetchAvila({ directoryFetch: directoryFetch({ results: unpublished }).fetcher });
    const [me, we] = partial.categories;
    expect(me.rows.every(row => row.uciLicenseId)).toBe(true);
    expect(we.rows.every(row => row.uciLicenseId === null)).toBe(true);
    expect(partial.uciDirectory.categories.find(item => item.category === 'WE').status).toBe('unavailable');

    const { fetcher, requests } = directoryFetch();
    const onlyWe = await fetchAvila({ uciLicenseCategories: ['WE'], directoryFetch: fetcher });
    expect(onlyWe.categories[0].rows.every(row => row.uciLicenseId === null)).toBe(true);
    expect(requests.filter(url => url.includes('/results'))).toHaveLength(1);
  });

  it('la ingesta resuelve por el ID UCI la ficha de nombre y un apellido que el nombre no enlaza', async () => {
    // riderRef 10008981271 → uciProfileId str(int('0089812')).
    const rider = { id: 'cueto-sara', firstName: 'Sara', lastName: 'Cueto', otherNames: null, nationality: 'ES',
      birthDate: null, birthDatePrecision: null, verified: true, uciProfileId: '89812' };
    const context = { race: { id: 'avila-2026', seasonKey: '2026-27', dateKey: '2026-11-08', editorialStatus: 'published', isCancelled: false },
      categories: [{ raceId: 'avila-2026', category: 'WE', dateKey: null, isCancelled: false, resultsLockedAt: null }],
      link: { raceId: 'avila-2026', competitionId: dataRide.competitionId, seasonId: dataRide.seasonId, disciplineId: 3, uciRaceId: 0 },
      riders: { men: [], women: [rider] } };
    const winner = async options => prepareCxResults(await fetchAvila({ categories: ['WE'], ...options }), context).imports[0].rows[0];
    expect(await winner({ directoryFetch: directoryFetch().fetcher })).toMatchObject({ globalRiderId: 'cueto-sara', riderDisplay: 'Sara Cueto' });
    expect((await winner({ uciCalendarId: null })).globalRiderId).toBeNull();
  });
});
