import { describe, expect, it } from 'vitest';
import { buildZone4CxDocument, fetchZone4Linked, parseZone4Cx, zone4Country, zone4Map, zone4ParseKey, zone4Target, zone4Tree } from '../results-fetchers/zone4-cx-fetch.mjs';

const T0 = 1_800_000_000_000_000;
const at = seconds => [[T0 + Math.round(seconds * 1e6), 'device'], 1];
const LAP = { mode: 'lap', name: 'Lap' };
const SPLIT = { mode: 'split', name: '80%' };
// Tres vueltas: índices 2, 4 y 6 de points_list (0 = salida, impares = paso intermedio).
const course = { uuid: ['course-wj', null], name: ['U19 W/F', null], points_list: [[{ mode: 'start' }, SPLIT, LAP, SPLIT, LAP, SPLIT, LAP], 1] };
const racer = (bib, first, last, extra, entity) => ({ uuid: [`r${bib}`, 1], bib: [String(bib), 1], first_name: [first, 1], last_name: [last, 1],
  team: ['SHREDDERS RACE TEAM', 1], uciid: ['101 188 135 63', 1], dob: ['2009', 1], prov: ['ON', 1], ...extra,
  _child_timedentitys: [{ course: ['course-wj', 1], startgroup: ['sg', 1], ...entity }] });
const tree = {
  name: ['Sunday Wave 1-4', 1], date: ['2026-11-01', null],
  _child_startgroups: [{ uuid: ['sg', null], recorded_start_time: [T0, 1] }],
  _child_courses: [course],
  _child_resultformats: [{ uuid: ['bb48534c-d4c1', null], name: ['Morning Overall Results', 1], _child_resultgroups: [
    { name: ['U19 W/F (17-18 yrs/ans)', 1], description: ['Official', 1], page_url: ['/event/2026/x/results/A', 1], criteria_list: [[{ course: 'course-wj' }], 1] },
    { name: ['U17 W/F (15-16 yrs/ans)', 1], description: ['Unofficial', 1], criteria_list: [[{ course: 'course-wj', prov: 'QC' }], 1] },
  ] }],
  _child_racers: [
    racer(102, 'Eliane', 'BLAIS', { prov: ['QC', 1] }, { time_2_list: at(800), time_4_list: at(1600), time_6_list: at(2526.9) }),
    racer(101, 'Alexa', 'HAVILAND', {}, { time_2_list: at(790), time_4_list: at(1590), time_6_list: at(2443.9) }),
    racer(103, 'Pinja', 'HYYTIAINEN', { prov: ['MB', 1] }, { time_2_list: at(900), time_4_list: at(1900) }),
    racer(104, 'Clare', 'HAUBER', {}, { is_dns: [true, 1] }),
    racer(105, 'Ana', 'Ruiz', { nat: ['ESP', 1] }, { time_2_list: at(820), dnf_time: at(1000) }),
    racer(106, 'Sin', 'PASOS', {}, {}),
  ],
};

describe('Zone4 CX', () => {
  it('reconoce la URL de resultados y extrae el árbol', () => {
    expect(zone4Target('https://zone4.ca/race/2026-11-01/BB48534C/results/')).toEqual({ date: '2026-11-01', formatId: 'bb48534c',
      resultsUrl: 'https://zone4.ca/race/2026-11-01/bb48534c/results/' });
    expect(() => zone4Target('https://zone4.ca/event/2026/wBoNoQ/')).toThrow('no reconocida');
    expect(zone4Tree('<script>\nwindow.z4data = {"tree": {"_child_racers": [], "_child_resultformats": []}, "id": 1};\n</script>'))
      .toEqual({ _child_racers: [], _child_resultformats: [] });
    expect(zone4Map('U19 W/F (17-18 yrs/ans)=wj, Elite W/F (23+ yrs/ans)=WE')).toEqual({ 'U19 W/F (17-18 yrs/ans)': 'WJ', 'Elite W/F (23+ yrs/ans)': 'WE' });
  });

  it('deduce la nacionalidad del campo nat o de la provincia o estado de la licencia', () => {
    expect([{ nat: ['FRA', 1] }, { prov: ['QC', 1] }, { prov: ['NJ', 1] }, { prov: ['HKG', 1] }, { prov: ['XX', 1] }].map(zone4Country))
      .toEqual(['FR', 'CA', 'US', 'HK', null]);
  });

  it('ordena por vueltas y último paso, con vueltas perdidas, estados y truncado al segundo', () => {
    const doc = parseZone4Cx(tree, { formatId: 'bb48534c', map: { 'u19 w/f (17-18 yrs/ans)': 'WJ' }, dateKey: '2026-11-01', resultsUrl: 'u' });
    const [wj] = doc.categories;
    expect(wj.rows.map(row => [row.bib, row.rankText, row.timeSeconds, row.timeText, row.gapText, row.irm])).toEqual([
      ['101', '1', '2443', '0:40:43', null, null],
      ['102', '2', '2526', '0:42:06', '+1:23', null],
      ['103', '3', null, null, '-1 LAP', 'LAP'],
      ['105', 'DNF', null, null, null, 'DNF'],
      ['104', 'DNS', null, null, null, 'DNS'],
    ]);
    expect(wj.rows[0]).toMatchObject({ firstName: 'Alexa', lastName: 'Haviland', riderDisplay: 'Alexa Haviland', isoCode2: 'CA',
      uciLicenseId: '10118813563', teamName: 'SHREDDERS RACE TEAM' });
    expect(wj.rows[3]).toMatchObject({ lastName: 'Ruiz', isoCode2: 'ES' });
    expect(wj.evidence).toMatchObject({ officialReviewed: true, officialReviewSourceUrl: 'https://zone4.ca/event/2026/x/results/A',
      zone4: { status: 'Official' } });
    expect(doc.warnings).toEqual([{ group: 'U19 W/F (17-18 yrs/ans)', category: 'WJ', reason: 'Inscritos sin pasos ni estado, omitidos', bibs: ['106'] }]);
  });

  it('omite grupos no oficiales salvo petición y filtra por los criterios del grupo', () => {
    const map = { 'U17 W/F (15-16 yrs/ans)': 'WU' };
    expect(parseZone4Cx(tree, { formatId: 'bb48534c', map }).skipped.find(item => item.category))
      .toMatchObject({ category: 'WU', status: 'Unofficial', reason: 'Clasificación no marcada «Official» en Zone4' });
    const [wu] = parseZone4Cx(tree, { formatId: 'bb48534c', map, allowUnofficial: true }).categories;
    expect(wu.rows.map(row => [row.bib, row.rankText, row.timeSeconds])).toEqual([['102', '1', '2526']]);
    expect(wu.evidence.officialReviewed).toBeUndefined();
  });

  it('rechaza otra fecha y grupos inexistentes', () => {
    expect(() => parseZone4Cx(tree, { formatId: 'bb48534c', dateKey: '2026-10-31' })).toThrow('Fecha de la oleada');
    const page = parseZone4Cx(tree, { formatId: 'bb48534c', map: { 'Junior W/F': 'WJ' } });
    expect(page.unmatched).toEqual(['junior w/f']);
    expect(() => buildZone4CxDocument({ pages: [page, { ...page, unmatched: [] }] })).not.toThrow();
    expect(() => buildZone4CxDocument({ pages: [page, { ...page, mapped: [], unmatched: [] }] })).toThrow('ausente de los formatos');
    expect(() => buildZone4CxDocument({ pages: [page] })).toThrow('ausente de los formatos');
  });
});

describe('Zone4 CX enlazado', () => {
  it('lee una vez cada oleada de categoryKeys y acredita la clave del grupo', async () => {
    const urls = [];
    const fetchTree = async url => { urls.push(url); return { ...zone4Target(url), tree }; };
    const doc = await fetchZone4Linked({ categoryKeys: { '2026-11-01/bb48534c/U19 W/F (17-18 yrs/ans)': 'WJ', '2026-11-01/bb48534c/U17 W/F (15-16 yrs/ans)': 'WU' },
      raceId: 'r', seasonKey: '2026-27', fetchTree });
    expect(urls).toEqual(['https://zone4.ca/race/2026-11-01/bb48534c/results/']);
    expect(doc.source).toBe('zone4');
    expect(doc.categories.map(c => [c.category, c.evidence.zone4.key])).toEqual([['WJ', '2026-11-01/bb48534c/U19 W/F (17-18 yrs/ans)']]);
    expect(doc.skipped.find(item => item.category === 'WU')).toMatchObject({ status: 'Unofficial' });
    expect(() => zone4ParseKey('bb48534c/U19')).toThrow('Clave Zone4 inválida');
  });
});
