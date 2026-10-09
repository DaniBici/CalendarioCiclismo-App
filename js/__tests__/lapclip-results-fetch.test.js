import { describe, expect, it } from 'vitest';
import {
  activeCategory, categoryDate, classify, fetchRows, finisherRows, parseCode, parseLapTime, parseRows, stageCategory,
} from '../../scripts/results-fetchers/lapclip-results-fetch.mjs';

const row = (place, bib, laps, time) => `<a href="#" class="result" name="${bib}">
<div class="row"><div class="left"><span class="nwb">${place}</span><span class="nwb">No.${bib}</span><span class="nwb">[TEA]名前</span></div>
<div class="left"><span class="nw">${laps}周</span><span class="nw">${time}</span><span class="nw">+Top : 0:00.000</span></div></div><div class="arw"></div></a>`;
const menu = (active) => `<dd><a href="result.php?evt=261004_oita&ctg=100"${active === '100' ? ' class="active"' : ''}>[10/3] CRITERIUM</a>
<a href="result.php?evt=261004_oita&ctg=200"${active === '200' ? ' class="active"' : ''}>[10/4]ROAD RACE</a></dd>`;
const stageRow = (place, bib, mark, time) => `<a href="#" class="result" name="${bib}">
<div class="row"><div class="left"><span class="nwb">${place}</span><span class="nwb">No.${bib}</span><span class="nwb">[TEA]名前</span></div>
<div class="left">${mark ? `<span class="nw">${mark}</span>` : ''}<span class="nw">${time}</span><span class="nw">+Top : -</span></div></div><div class="arw"></div></a>`;
const stageMenu = `<a href="result.php?evt=tdk2026&ctg=100" class="active">佐世保クリテリウム</a>
<a href="result.php?evt=tdk2026&ctg=001">STAGE 1 佐賀・福岡</a>
<a href="result.php?evt=tdk2026&ctg=002">STAGE 2 大分・熊本</a>`;
const parsed = (...rows) => parseRows(rows.join('\n'));
const start = '2026-10-04T00:00:00Z';

describe('lapclip-results-fetch', () => {
  it('valida el código evento/categoría/vueltas', () => {
    expect(parseCode('261004_oita/200/13')).toEqual({ event: '261004_oita', year: 2026, category: '200', laps: 13, stages: false });
    expect(parseCode('tdk2026')).toEqual({ event: 'tdk2026', year: 2026, category: null, laps: null, stages: true });
    expect(() => parseCode('tdk')).toThrow();
    expect(parseCode('261004_oita/012-1/40').category).toBe('012-1');
    expect(() => parseCode('261004_oita/200')).toThrow();
  });

  it('toma la fecha del título de la categoría activa', () => {
    expect(categoryDate(activeCategory(menu('100'), '261004_oita/100/35'), 2026)).toBe('2026-10-03');
    expect(categoryDate(activeCategory(menu('200'), '261004_oita/200/13'), 2026)).toBe('2026-10-04');
    expect(() => activeCategory(menu('100'), '261004_oita/300/13')).toThrow(/no ofrece/);
  });

  it('lee puesto, dorsal, vueltas y tiempo', () => {
    expect(parseLapTime('3:23:01.013')).toBe(12181013);
    expect(parseLapTime('-:--:--.---')).toBeNull();
    expect(parsed(row('1位', 112, 13, '3:23:01.013'), row('-', 16, 0, '-:--:--.---'))).toEqual([
      { place: 1, bib: '112', name: '[TEA]名前', laps: 13, finish: false, ms: 12181013 },
      { place: null, bib: '16', name: '[TEA]名前', laps: 0, finish: false, ms: null },
    ]);
  });

  it('lee la llegada FINISH con centésimas y las filas sin paso', () => {
    expect(parseLapTime('2:49:32.13')).toBe(10172130);
    expect(parsed(stageRow('1位', 33, 'FINISH', '2:49:32.13'), stageRow('92位', 86, '1/2周', '2:58:00.00'),
      stageRow('-', 22, null, '-:--:--.--'))).toEqual([
      { place: 1, bib: '33', name: '[TEA]名前', laps: null, finish: true, ms: 10172130 },
      { place: 92, bib: '86', name: '[TEA]名前', laps: 1, finish: false, ms: 10680000 },
      { place: null, bib: '22', name: '[TEA]名前', laps: 0, finish: false, ms: null },
    ]);
  });

  it('localiza la categoría de cada etapa por su título', () => {
    expect(stageCategory(stageMenu, 'tdk2026', 2)).toEqual({ category: '002', title: 'STAGE 2 大分・熊本' });
    expect(() => stageCategory(stageMenu, 'tdk2026', 3)).toThrow(/0 categorías/);
  });

  it('cierra la etapa en línea con DNF solo para quien registró algún paso', () => {
    const rows = parsed(stageRow('1位', 1, 'FINISH', '2:49:32.13'), stageRow('2位', 2, 'FINISH', '2:49:33.12'),
      stageRow('3位', 3, '1/2周', '2:40:00.00'), stageRow('-', 4, null, '-:--:--.--'));
    expect(classify(parsed(stageRow('-', 1, null, '-:--:--.--')), { dateKey: '2026-10-10', neutralStartUtc: start }).rows).toEqual([]);
    const finishAt = Date.parse(start) + 10172130;
    const early = classify(rows, { dateKey: '2026-10-10', neutralStartUtc: start, now: finishAt + 60000 });
    expect(early.rows.map((r) => [r.bib, r.resultValue])).toEqual([['1', '2:49:32'], ['2', '+00']]);
    const closed = classify(rows, { dateKey: '2026-10-10', neutralStartUtc: start, now: finishAt + 21 * 60000 });
    expect(closed.rows.map((r) => [r.bib, r.rankText])).toEqual([['1', '1'], ['2', '2'], ['3', 'DNF']]);
  });

  it('aplica la regla de grupo y trunca a segundos', () => {
    const rows = finisherRows(parsed(
      row('1位', 1, 13, '3:23:01.013'), row('2位', 2, 13, '3:23:30.802'), row('3位', 3, 13, '3:23:31.745'),
      row('4位', 4, 13, '3:23:42.695'), row('5位', 5, 13, '3:23:43.475'), row('6位', 6, 13, '3:23:44.605'),
    ));
    expect(rows.map((r) => r.resultValue)).toEqual(['3:23:01', '+29', '+29', '+41', '+41', '+43']);
  });

  it('espera a que el primero complete las vueltas y cierra con DNF y DNS', () => {
    const racing = parsed(row('1位', 1, 12, '3:08:00.000'), row('2位', 2, 12, '3:08:00.500'));
    expect(classify(racing, { laps: 13, dateKey: '2026-10-04', neutralStartUtc: start }).rows).toEqual([]);

    const done = parsed(row('1位', 1, 13, '3:23:01.013'), row('2位', 2, 13, '3:23:30.802'),
      row('3位', 3, 12, '3:10:00.000'), row('-', 4, 0, '-:--:--.---'));
    const finishAt = Date.parse(start) + 12181013;
    const early = classify(done, { laps: 13, dateKey: '2026-10-04', neutralStartUtc: start, now: finishAt + 60000 });
    expect(early.rows.map((r) => r.bib)).toEqual(['1', '2']);
    const closed = classify(done, { laps: 13, dateKey: '2026-10-04', neutralStartUtc: start, now: finishAt + 21 * 60000 });
    expect(closed.rows.map((r) => [r.bib, r.rankText])).toEqual([['1', '1'], ['2', '2'], ['3', 'DNF'], ['4', 'DNS']]);
    expect(() => classify(done, { laps: 13, dateKey: '2026-10-04', neutralStartUtc: start, now: Date.parse(start) }))
      .toThrow(/futura/);
    expect(() => classify(done, { laps: 12, dateKey: '2026-10-04', neutralStartUtc: start })).toThrow(/más de 12/);
  });

  it('pagina hasta una página incompleta y trata el 404 como sin datos', async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(`${i + 1}位`, i + 1, 13, '3:00:00.000')).join('\n');
    const pages = { 1: full, 2: row('101位', 101, 13, '3:00:01.000') };
    const fetchPage = async (url) => {
      const page = new URL(url).searchParams.get('page');
      return page ? pages[page] ?? '' : menu('200');
    };
    const { title, rows } = await fetchRows('261004_oita/200/13', { fetchPage });
    expect(title).toBe('[10/4]ROAD RACE');
    expect(rows).toHaveLength(101);
  });
});
