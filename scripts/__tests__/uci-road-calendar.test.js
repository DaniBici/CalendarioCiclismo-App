import { describe, it, expect } from 'vitest';
import {
  roadYear, roadClass, uciCivilDate, uciDateRange, uciCompetitionProps, flattenUciCalendar,
  normalizeRoadCompetition, collectUciRoadCalendar, foldName, buildSeriesIndex, matchSeries,
  pendingRaces, roadDumpSql, slugBase,
} from '../uci-calendar/road.mjs';

const iso3to2 = code => ({ ESP: 'es', ITA: 'it', FRA: 'fr', CHN: 'cn', BEL: 'be' }[code] || null);

const propsFor = ({ name, dates, classText, days, website, venue = '' }) => ({
  competitionDetails: { name, dates, competitionClass: classText, website: website ? { url: website } : undefined, venue },
  schedule: { items: days },
});

const oneDay = (category = 'Men Elite', date = '03 Oct 2027') => [{ date, races: [{ raceName: 'Road race', raceType: 'Individual Road Race', raceClass: '1.Pro', category }] }];
const multiDay = (n, category = 'Men Elite', start = 3) => Array.from({ length: n }, (_, i) => ({ date: `${String(start + i).padStart(2, '0')} Oct 2027`, races: [{ raceType: 'Individual Road Race', category }] }));

const entry = (id, country = 'ITA') => ({ uciCalendarId: id, name: 'Prueba', country, calendarSourceUrl: `https://www.uci.org/competition-details/2027/ROA/${id}` });
const htmlFor = props => `<div data-props="${JSON.stringify(props).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`;
const listFor = (...items) => ({ items: [{ items: [{ items }] }] });

describe('calendario UCI de carretera', () => {
  it('valida el año y traduce las clases a uciCategory', () => {
    expect(roadYear(2027)).toBe(2027);
    expect(() => roadYear('2027-28')).toThrow();
    expect(roadClass('1.Pro - 1 day - UCI ProSeries')).toMatchObject({ code: '1.Pro', uciCategory: '1.Pro' });
    expect(roadClass('2.2U - Stages - Class 2 - U23')).toMatchObject({ uciCategory: '2.2U' });
    expect(roadClass('CM - UCI World Championships')).toMatchObject({ uciCategory: 'WC', championship: true });
    expect(roadClass('2.UWT - Stages - UCI WorldTour').excluded).toBe('worldtour');
    expect(roadClass('CN - National Championships').excluded).toBe('national_championship');
    expect(roadClass('1.Ncup - 1 day - UCI Class Nations Cup').excluded).toBe('unsupported_class');
  });

  it('lee fechas civiles, rangos del mismo año y a caballo de diciembre', () => {
    expect(uciCivilDate('03 Oct 2027')).toBe('2027-10-03');
    expect(() => uciCivilDate('31 Feb 2027')).toThrow();
    expect(uciDateRange('27 Sep - 04 Oct 2027')).toEqual({ startDate: '2027-09-27', endDate: '2027-10-04' });
    expect(uciDateRange('30 Dec - 03 Jan 2027')).toEqual({ startDate: '2026-12-30', endDate: '2027-01-03' });
  });

  it('lee el rango del listado: un día, mismo mes, entre meses y entre años', () => {
    expect(uciDateRange('23 May 2027')).toEqual({ startDate: '2027-05-23', endDate: '2027-05-23' });
    expect(uciDateRange('17 Feb - 21 Feb 2027')).toEqual({ startDate: '2027-02-17', endDate: '2027-02-21' });
    expect(uciDateRange('07 Jul - 11 Jul 2027')).toEqual({ startDate: '2027-07-07', endDate: '2027-07-11' });
    expect(uciDateRange('27 Sep - 04 Oct 2026')).toEqual({ startDate: '2026-09-27', endDate: '2026-10-04' });
    expect(uciDateRange('28 Dec - 02 Jan 2027')).toEqual({ startDate: '2026-12-28', endDate: '2027-01-02' });
    expect(uciDateRange('28 Dec 2026 - 02 Jan 2027')).toEqual({ startDate: '2026-12-28', endDate: '2027-01-02' });
    expect(() => uciDateRange('21 Feb 2027 - 17 Feb 2027')).toThrow();
    expect(() => uciDateRange('17 Feb - 21 Feb - 22 Feb 2027')).toThrow();
  });

  it('descarta el tramo del calendario del año anterior y las clases no soportadas', () => {
    const early = normalizeRoadCompetition(
      { ...entry(1), name: 'Tour du Faso', country: 'BUR' },
      propsFor({ name: 'Tour du Faso', dates: '30 Oct - 08 Nov 2026', classText: '2.2 - Stages - Class 2', days: [{ date: '30 Oct 2026', races: [{ category: 'Men Elite', raceType: 'Individual Road Race' }] }] }),
      { year: 2027, countryCode: iso3to2 },
    );
    expect(early.excludedCompetition.reason).toBe('outside_year');
    const junior = normalizeRoadCompetition(entry(81026, 'BEL'), propsFor({
      name: 'Liège-Bastogne-Liège', dates: '08 May 2027', classText: '1.1 - 1 day - Class 1', days: oneDay('Men Junior', '08 May 2027'),
    }), { year: 2027, countryCode: iso3to2 });
    expect(junior.excludedCompetition.reason).toBe('junior');
  });

  it('normaliza una prueba de un día con serie y una vuelta por etapas', () => {
    const oneDayRace = normalizeRoadCompetition(entry(78445), propsFor({
      name: "Giro dell'Emilia", dates: '03 Oct 2027', classText: '1.Pro - 1 day - UCI ProSeries', days: oneDay(), website: 'https://www.gsemilia.it',
    }), { year: 2027, countryCode: iso3to2 }).race;
    expect(oneDayRace).toMatchObject({
      name: "Giro dell'Emilia", uciCategory: '1.Pro', gender: 'male', raceFormat: 'one_day',
      countryCode: 'IT', startDate: '2027-10-03', endDate: '2027-10-03', year: 2027, slug: 'giro-dell-emilia-2027', slugEn: 'giro-dell-emilia-2027',
    });
    const stageRace = normalizeRoadCompetition(entry(78441, 'MAS'), propsFor({
      name: 'Petronas Le Tour de Langkawi', dates: '27 Sep - 04 Oct 2027', classText: '2.Pro - Stages - UCI ProSeries', days: multiDay(8),
    }), { year: 2027, countryCode: code => code === 'MAS' ? 'my' : null }).race;
    expect(stageRace).toMatchObject({ uciCategory: '2.Pro', raceFormat: 'stage_race', countryCode: 'MY', startDate: '2027-10-03', endDate: '2027-10-10' });
  });

  it('toma el rango del listado aunque la ficha solo programe el primer día', () => {
    const canarias = normalizeRoadCompetition(
      { ...entry(80146, 'ESP'), name: 'Vuelta Ciclista a Canarias', dates: '14 Jan - 17 Jan 2027' },
      propsFor({ name: 'Vuelta Ciclista a Canarias', dates: '14 Jan 2027', classText: '2.2 - Stages - Class 2', days: [{ date: '14 Jan 2027', races: [{ category: 'Men Elite', raceType: 'Individual Road Race' }] }] }),
      { year: 2027, countryCode: iso3to2 },
    ).race;
    expect(canarias).toMatchObject({ raceFormat: 'stage_race', startDate: '2027-01-14', endDate: '2027-01-17' });
  });

  it('marca como manuales los campeonatos y las fichas con varias categorías', () => {
    const championship = normalizeRoadCompetition(entry(79742, 'FRA'), propsFor({
      name: '2027 UCI Cycling World Championships - Road', dates: '24 Aug - 05 Sep 2027', classText: 'CM - UCI World Championships', days: multiDay(2),
    }), { year: 2027, countryCode: iso3to2 });
    expect(championship.manual).toBe(true);
    expect(championship.manualReasons).toContain('championship');
    const combined = normalizeRoadCompetition(entry(2, 'BEL'), propsFor({
      name: 'Omloop mixto', dates: '27 Feb 2027', classText: '1.1 - 1 day - Class 1', days: [{ date: '27 Feb 2027', races: [{ category: 'Men Elite', raceType: 'Individual Road Race' }, { category: 'Women Elite', raceType: 'Individual Road Race' }] }],
    }), { year: 2027, countryCode: iso3to2 });
    expect(combined.manualReasons).toContain('multi_gender');
    expect(combined.race.gender).toBeNull();
  });

  it('une upcoming y past por id y rechaza una importación incompleta', async () => {
    const seen = [];
    const manifest = await collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: async (url) => {
      seen.push(url);
      if (String(url).includes('/api/')) return { ok: true, json: async () => listFor(
        { name: "Giro dell'Emilia", country: 'ITA', detailsLink: { url: '/competition-details/2027/ROA/78445' } },
        { name: 'Tour de France', country: 'FRA', detailsLink: { url: '/competition-details/2027/ROA/79718' } },
      ) };
      if (String(url).endsWith('/79718')) return { ok: true, text: async () => htmlFor(propsFor({ name: 'Tour de France', dates: '02 Jul - 25 Jul 2027', classText: '2.UWT - Stages - UCI WorldTour', days: multiDay(2) })) };
      return { ok: true, text: async () => htmlFor(propsFor({ name: "Giro dell'Emilia", dates: '03 Oct 2027', classText: '1.Pro - 1 day - UCI ProSeries', days: oneDay() })) };
    } });
    expect(manifest.summary.races).toBe(1);
    expect(manifest.exclusions.map(e => e.reason)).toContain('worldtour');
    expect(seen.slice(0, 2).every(url => url.includes('year=2027'))).toBe(true);
    await expect(collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: async (url) => String(url).includes('/api/') ? { ok: true, json: async () => listFor({ name: 'X', country: 'ITA', detailsLink: { url: '/competition-details/2027/ROA/1' } }) } : { ok: false, status: 503 } })).rejects.toThrow(/incompleta/);
    await expect(collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: async () => ({ ok: true, json: async () => ({ items: [] }) }) })).rejects.toThrow(/vacío/);
  });

  it('deduplica la repetición diaria del listado y conserva el rango de dates', async () => {
    const andalucia = day => ({ name: 'Vuelta a Andalucía', country: 'ESP', dates: '17 Feb - 21 Feb 2027', detailsLink: { url: '/competition-details/2027/ROA/81064' }, day });
    const listing = { items: [{ items: [
      { items: [andalucia('17')] }, { items: [andalucia('18')] }, { items: [andalucia('19')] }, { items: [andalucia('20')] }, { items: [andalucia('21')] },
    ] }] };
    expect(flattenUciCalendar(listing, 2027)).toHaveLength(5);
    const manifest = await collectUciRoadCalendar({ year: 2027, countryCode: iso3to2, fetcher: async (url) => {
      if (String(url).includes('/upcoming')) return { ok: true, json: async () => listing };
      if (String(url).includes('/api/')) return { ok: true, json: async () => ({ items: [] }) };
      return { ok: true, text: async () => htmlFor(propsFor({ name: 'Vuelta a Andalucía', dates: '17 Feb 2027', classText: '2.Pro - Stages - UCI ProSeries', days: [{ date: '17 Feb 2027', races: [{ category: 'Men Elite', raceType: 'Individual Road Race' }] }] })) };
    } });
    expect(manifest.summary.listedCompetitions).toBe(1);
    expect(manifest.races).toHaveLength(1);
    expect(manifest.races[0]).toMatchObject({ uciCalendarId: 81064, raceFormat: 'stage_race', startDate: '2027-02-17', endDate: '2027-02-21' });
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
    expect(matchSeries(index, { name: 'Liège-Bastogne-Liège', gender: 'male', year: 2027, classCode: '1.1', categories: [{ category: 'Men Under 23' }], countryCode: 'BE' }).raceSeriesId).toBe('LBLU');
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

  it('detecta lo pendiente y emite SQL idempotente por uciCalendarId', () => {
    const manifest = { races: [
      { uciCalendarId: 900, calendarSourceUrl: 'u/900', name: 'Nueva Carrera', nameEn: 'Nueva Carrera', originalName: 'Nueva Carrera', uciCategory: '1.1', gender: 'male', raceFormat: 'one_day', countryCode: 'IT', startDate: '2027-03-01', endDate: '2027-03-01', year: 2027, slug: 'nueva-carrera-2027', slugEn: 'nueva-carrera-2027' },
    ] };
    expect(pendingRaces(manifest, [900]).map(r => r.uciCalendarId)).toEqual([]);
    expect(pendingRaces(manifest, [899])).toHaveLength(1);
    const { sql, rows } = roadDumpSql({ manifest, seriesIndex: buildSeriesIndex([]), loadedSlugs: ['otra-2027'], loadedSlugsEn: ['nueva-carrera-2027'] });
    expect(rows[0]).toMatchObject({ slug: 'nueva-carrera-2027', slugEn: 'nueva-carrera-2027-2', raceSeriesId: 'uci-2027-900', seriesMatch: 'new' });
    expect(sql).toContain('insert into race_series');
    expect(sql).toContain('slug,"slugEn","uciCategory"');
    expect(sql).toContain("'nueva-carrera-2027','nueva-carrera-2027-2'");
    expect(sql).toContain('on conflict ("uciCalendarId") do nothing');
    expect(sql.match(/insert into races/g)).toHaveLength(1);
  });
});
