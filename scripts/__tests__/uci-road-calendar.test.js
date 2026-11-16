import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  roadYear, roadClass, normalizeRoadCompetition, collectUciRoadCalendar, foldName, buildSeriesIndex, matchSeries,
  pendingRaces, roadDumpSql, slugBase,
} from '../uci-calendar/road.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/uci-competition-road-2027.json', import.meta.url), 'utf8'));
const iso3to2 = code => ({ AUS: 'au', VEN: 've', BEL: 'be', BUR: 'bf', POR: 'pt' }[code] || null);
const byCode = code => structuredClone(fixture.list.find(item => item.v1Code === code));
const normalize = code => normalizeRoadCompetition(byCode(code), { year: 2027, countryCode: iso3to2 });

// Directorio servido desde la fixture: un listado de una página y las fichas.
const directory = ({ list = fixture.list, details = fixture.details, failDetail = false } = {}) => {
  const seen = [];
  const fetcher = async (url) => {
    seen.push(String(url));
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/api/competitions') {
      const offset = Number(searchParams.get('offset'));
      return { ok: true, json: async () => ({ count: list.length, limit: 100, offset, items: list.slice(offset, offset + 100) }) };
    }
    const detail = details[decodeURIComponent(pathname.split('/').pop())];
    return failDetail || !detail ? { ok: false, status: 503 } : { ok: true, json: async () => structuredClone(detail) };
  };
  return { fetcher, seen };
};

describe('calendario UCI de carretera', () => {
  it('valida el año y traduce las clases a uciCategory', () => {
    expect(roadYear(2027)).toBe(2027);
    expect(() => roadYear('2027-28')).toThrow();
    expect(roadClass('1.Pro')).toMatchObject({ code: '1.Pro', uciCategory: '1.Pro' });
    expect(roadClass('2.2U')).toMatchObject({ uciCategory: '2.2U' });
    expect(roadClass('CM')).toMatchObject({ uciCategory: 'WC', championship: true });
    expect(roadClass('2.UWT').excluded).toBe('worldtour');
    expect(roadClass('CN').excluded).toBe('national_championship');
    expect(roadClass('JOJ').excluded).toBe('unsupported_class');
    expect(roadClass('XYZ').excluded).toBe('unknown_class');
  });

  it('normaliza una prueba de un día y una vuelta por etapas del directorio', () => {
    expect(normalize('D2CP80079').race).toMatchObject({
      uciCalendarId: 80079, calendarSourceUrl: 'https://www.uci.org/competition-details/2027/ROA/80079',
      name: 'Surf Coast Classic - Women', uciCategory: '1.Pro', gender: 'female', raceFormat: 'one_day', countryCode: 'AU',
      startDate: '2027-01-27', endDate: '2027-01-27', year: 2027, slug: 'surf-coast-classic-women-2027',
      websiteUrl: 'https://www.cadelevansgreatoceanroadrace.com.au',
    });
    const tachira = normalize('D2CP81048');
    expect(tachira.manual).toBe(false);
    expect(tachira.race).toMatchObject({ uciCategory: '2.2', gender: 'male', raceFormat: 'stage_race', countryCode: 'VE', startDate: '2027-01-08', endDate: '2027-01-17' });
  });

  it('descarta WorldTour, junior y pruebas que empezaron el año anterior', () => {
    expect(normalize('D2CP79669').excludedCompetition.reason).toBe('worldtour');
    expect(normalize('D2CP80539').excludedCompetition.reason).toBe('junior');
    expect(normalize('D2CP79698').excludedCompetition).toMatchObject({ uciCalendarId: 79698, reason: 'outside_year', startDate: '2026-10-30' });
  });

  it('marca como manuales los campeonatos, las fichas con varias categorías y las que no tienen categoría', () => {
    expect(normalize('D2CP81284').manualReasons).toEqual(['championship', 'multi_gender', 'multi_category']);
    expect(normalize('D2CP81284').race.gender).toBeNull();
    expect(normalize('D2CP81286').manualReasons).toEqual(['unknown_category']);
  });

  it('exige el ID del calendario de uci.org y fechas ISO válidas', () => {
    expect(() => normalizeRoadCompetition({ ...byCode('D2CP80079'), v1Code: 'ROA_2027_1.Pro_000001' }, { year: 2027, countryCode: iso3to2 })).toThrow(/v1Code/);
    expect(() => normalizeRoadCompetition({ ...byCode('D2CP80079'), endDate: '2027-01-26' }, { year: 2027, countryCode: iso3to2 })).toThrow(/invertido/);
    expect(() => normalizeRoadCompetition({ ...byCode('D2CP80079'), startDate: '2027-02-30' }, { year: 2027, countryCode: iso3to2 })).toThrow(/no reconocida/);
  });

  it('lee el año civil completo y adjunta el programa de las fichas manuales', async () => {
    const { fetcher, seen } = directory();
    const manifest = await collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher });
    const listing = new URL(seen[0]).searchParams;
    expect(Object.fromEntries(['disciplineCode', 'dateFrom', 'dateTo'].map(key => [key, listing.get(key)]))).toEqual({ disciplineCode: 'ROA', dateFrom: '2027-01-01', dateTo: '2027-12-31' });
    expect(manifest.summary).toEqual({ listedCompetitions: 7, races: 2, manual: 2, excludedCompetitions: 3 });
    const oceania = manifest.manual.find(race => race.uciCalendarId === 81284);
    expect(oceania.programme).toHaveLength(12);
    expect(oceania.programme[0]).toMatchObject({ category: expect.any(String), raceType: expect.stringMatching(/^(IRR|ITT)$/), startDate: '2027-01-15' });
    expect(manifest.manual.find(race => race.uciCalendarId === 81286).programme).toEqual([]);
  });

  it('no produce un manifiesto vacío ni oculta competiciones fallidas o sin ID', async () => {
    await expect(collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: directory({ list: [] }).fetcher })).rejects.toThrow(/vacío/);
    await expect(collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: directory({ failDetail: true }).fetcher })).rejects.toThrow(/incompleta/);
    const list = fixture.list.map(item => item.v1Code === 'D2CP80079' ? { ...item, v1Code: null } : item);
    await expect(collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: directory({ list }).fetcher })).rejects.toThrow(/v1Code/);
    const short = async () => ({ ok: true, json: async () => ({ count: 8, items: [] }) });
    await expect(collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: short })).rejects.toThrow(/incompleto/);
  });

  it('enlaza la serie por nombre exacto, aproximado o crea una nueva', () => {
    expect(foldName('GP Montréal')).toBe('gp montreal');
    const index = buildSeriesIndex([
      { name: 'Giro dell’Emilia', nameEn: "Giro dell'Emilia", gender: 'male', year: 2026, slug: 'giro-dell-emilia-2026', raceSeriesId: 'S1', countryCode: 'IT', uciCategory: '1.Pro', startDate: '2026-10-03' },
      { name: 'Tour de Langkawi', nameEn: 'Petronas Le Tour de Langkawi', gender: 'male', year: 2026, slug: 'tour-langkawi-2026', raceSeriesId: 'S2', countryCode: 'MY', uciCategory: '2.Pro', startDate: '2026-09-28' },
    ]);
    expect(matchSeries(index, { name: "Giro dell'Emilia", gender: 'male', year: 2027, classCode: '1.Pro', countryCode: 'IT' })).toMatchObject({ raceSeriesId: 'S1', confidence: 'exact', matchedYear: 2026 });
    expect(matchSeries(index, { name: 'Le Tour de Langkawi', gender: 'male', year: 2027, classCode: '2.Pro', countryCode: 'MY' })).toMatchObject({ raceSeriesId: 'S2', confidence: 'fuzzy' });
    expect(matchSeries(index, { name: 'Carrera Inédita', gender: 'male', year: 2027 }).raceSeriesId).toBeNull();
    expect(slugBase('Grand Prix San Salvador')).toBe('grand-prix-san-salvador');
  });

  it('prioriza la edición del año anterior y coteja país en cualquier caja y fecha', () => {
    const index = buildSeriesIndex([
      { name: 'Jaén Paraiso Interior', nameEn: 'Jaén Paraiso Interior', gender: 'male', year: 2023, slug: 'jaen-paraiso-interior-2023', raceSeriesId: 'OLD', countryCode: 'ES', uciCategory: '1.1', startDate: '2023-02-13' },
      { name: 'Clásica Jaén', nameEn: 'Cl\u0087sica Ja\u008en', gender: 'male', year: 2026, slug: 'clasica-jaen-2026', raceSeriesId: 'NEW', countryCode: 'es', uciCategory: '1.1', startDate: '2026-02-16' },
      { name: 'Tour de France', nameEn: 'Tour de France', gender: 'male', year: 2026, slug: 'tour-de-france-2026', raceSeriesId: 'TDF', countryCode: 'FR', uciCategory: '2.UWT', startDate: '2026-07-04' },
    ]);
    const race = { name: 'Clásica Jaén Paraíso Interior', gender: 'male', year: 2027, classCode: '1.1', countryCode: 'ES', startDate: '2027-02-15' };
    expect(matchSeries(index, race)).toMatchObject({ raceSeriesId: 'NEW', confidence: 'fuzzy', matchedYear: 2026 });
    // Nombre idéntico en otro país: misma serie; nombre solo parecido: serie nueva.
    expect(matchSeries(index, { name: 'Clásica Jaén', gender: 'male', year: 2027, classCode: '1.1', countryCode: 'AR', startDate: '2027-02-15' }).raceSeriesId).toBe('NEW');
    expect(matchSeries(index, { name: 'Clásica Jaén Sur', gender: 'male', year: 2027, classCode: '1.1', countryCode: 'AR', startDate: '2027-02-15' }).raceSeriesId).toBeNull();
    // Formato distinto con nombre solo parecido: serie nueva (CRO Race Classic ≠ CRO Race).
    expect(matchSeries(index, { name: 'Tour de France Classic', gender: 'male', year: 2027, classCode: '1.1', countryCode: 'FR', startDate: '2027-07-01' }).raceSeriesId).toBeNull();
  });

  it('enlaza por nameEn las ediciones con nombre en castellano y separa sub-23 y elite', () => {
    const index = buildSeriesIndex([
      { name: 'Tour de l’Avenir', nameEn: "Tour de l'Avenir", gender: 'male', year: 2021, slug: 'tour-de-lavenir-2021', raceSeriesId: 'OLD', countryCode: 'FR', uciCategory: '2.Ncup', startDate: '2021-08-13' },
      { name: 'Tour del Porvenir', nameEn: "Tour de l'Avenir", gender: 'male', year: 2026, slug: 'tour-del-porvenir-2026', slugEn: 'tour-de-lavenir-2026', raceSeriesId: 'AV', countryCode: 'fr', uciCategory: '2.2U', startDate: '2026-08-20' },
      { name: 'Lieja-Bastoña-Lieja', nameEn: 'Liège-Bastogne-Liège', gender: 'male', year: 2026, slug: 'lieja-bastona-lieja-2026', raceSeriesId: 'LBL', countryCode: 'BE', uciCategory: '1.UWT', startDate: '2026-04-26' },
      { name: 'Lieja-Bastoña-Lieja sub23', nameEn: 'Liège-Bastogne-Liège Espoirs', gender: 'male', year: 2026, slug: 'lieja-bastona-lieja-sub23-2026', raceSeriesId: 'LBLU', countryCode: 'BE', uciCategory: '1.2U', startDate: '2026-04-18' },
      { name: 'Trofeo Piva', nameEn: 'Trofeo Piva', gender: 'male', year: 2026, slug: 'trofeo-piva-2026', raceSeriesId: 'PIVA', countryCode: 'IT', uciCategory: '1.2U', startDate: '2026-04-05' },
    ]);
    expect(matchSeries(index, { name: "Tour de l'Avenir", gender: 'male', year: 2027, classCode: '2.2U', countryCode: 'FR', startDate: '2027-08-12' })).toMatchObject({ raceSeriesId: 'AV', confidence: 'exact' });
    expect(matchSeries(index, { name: 'Liège-Bastogne-Liège', gender: 'male', year: 2027, classCode: '1.2U', countryCode: 'BE', startDate: '2027-04-17' }).raceSeriesId).toBe('LBLU');
    expect(matchSeries(index, { name: 'Liège-Bastogne-Liège', gender: 'male', year: 2027, classCode: '1.1', categories: [{ category: 'MU', ageCategory: 'u23' }], countryCode: 'BE' }).raceSeriesId).toBe('LBLU');
    // Cambio de clase entre años: se enlaza, pero queda para revisión.
    expect(matchSeries(index, { name: 'Trofeo Piva', gender: 'male', year: 2027, classCode: '1.2', countryCode: 'IT', startDate: '2027-04-03' })).toMatchObject({ raceSeriesId: 'PIVA', confidence: 'fuzzy', ageMismatch: true });
  });

  it('coteja el núcleo del nombre con el mismo país, formato y época del año', () => {
    const index = buildSeriesIndex([
      { name: 'GP Emilia', nameEn: 'GP Emilia', gender: 'male', year: 2026, slug: 'gp-emilia-2026', raceSeriesId: 'EM', countryCode: 'IT', uciCategory: '1.1', startDate: '2026-09-20' },
      { name: 'Tour of Malopolska', nameEn: 'Tour of Malopolska', gender: 'male', year: 2026, slug: 'tour-of-malopolska-2026', raceSeriesId: 'MP', countryCode: 'PL', uciCategory: '2.2', startDate: '2026-06-18' },
      { name: 'Tour of Sakarya', nameEn: 'Tour of Sakarya', gender: 'male', year: 2026, slug: 'tour-of-sakarya-2026', raceSeriesId: 'SK', countryCode: 'TR', uciCategory: '2.2', startDate: '2026-05-01' },
    ]);
    expect(matchSeries(index, { name: 'G.P. Emilia', gender: 'male', year: 2027, classCode: '1.1', countryCode: 'IT', startDate: '2027-09-19' })).toMatchObject({ raceSeriesId: 'EM', confidence: 'fuzzy' });
    expect(matchSeries(index, { name: 'Małopolski Wyścig Górski', gender: 'male', year: 2027, classCode: '2.2', countryCode: 'PL', startDate: '2027-06-17' }).raceSeriesId).toBe('MP');
    expect(matchSeries(index, { name: 'G.P. Emilia', gender: 'male', year: 2027, classCode: '1.1', countryCode: 'IT', startDate: '2027-03-01' }).raceSeriesId).toBeNull();
    expect(matchSeries(index, { name: 'Tour of Anatolia', gender: 'male', year: 2027, classCode: '2.2', countryCode: 'TR', startDate: '2027-05-02' }).raceSeriesId).toBeNull();
  });

  it('detecta lo pendiente y resuelve slugs y serie de cada fila', () => {
    const manifest = { races: [
      { uciCalendarId: 900, calendarSourceUrl: 'u/900', name: 'Nueva Carrera', nameEn: 'Nueva Carrera', originalName: 'Nueva Carrera', uciCategory: '1.1', gender: 'male', raceFormat: 'one_day', countryCode: 'IT', startDate: '2027-03-01', endDate: '2027-03-01', year: 2027, slug: 'nueva-carrera-2027', slugEn: 'nueva-carrera-2027' },
    ] };
    expect(pendingRaces(manifest, [900]).map(r => r.uciCalendarId)).toEqual([]);
    expect(pendingRaces(manifest, [899])).toHaveLength(1);
    const { rows } = roadDumpSql({ manifest, seriesIndex: buildSeriesIndex([]), loadedSlugs: ['otra-2027'], loadedSlugsEn: ['nueva-carrera-2027'] });
    expect(rows[0]).toMatchObject({ slug: 'nueva-carrera-2027', slugEn: 'nueva-carrera-2027-2', raceSeriesId: 'uci-2027-900', seriesMatch: 'new' });
  });
});
