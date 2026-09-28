import { describe, it, expect, vi } from 'vitest';
import { COMPUTER_EVENTS, computerPdfLinks, parseComputerPdf } from '../results-fetchers/computerauswertung-pdf.mjs';
import { fetchComputerStages, mapStageRows, normAbsTime, normGap } from '../results-fetchers/livetiming-results-fetch.mjs';

const event = COMPUTER_EVENTS['260903'];
const pdfUrl = 'https://www.computerauswertung.at/veranstaltungen/2026/260906/stage1.pdf';
const html = '<a href="/veranstaltungen/2026/260906/stage1.pdf">Ergebnisliste 1. Etappe (PDF)</a>';
const pdf = `Sauerlandrundfahrt
Etappenklassement nach Zeit / Stage Classification on time  Thursday, September 3th, 2026
1. Etappe / stage 1 Brilon - Brilon
Pos. BIB Name UCI-ID Nat. Code Team Time
1. 14 RIDER One 100 000 000 01 GER AAA Team A 0:17:15,93
2. 74 RIDER Two 100 000 000 02 GER BBB Team B 0:17:23,23 + 0:07,30
DNS 82 RIDER Three 100 000 000 03 GER BBB Team B
Number of starters/Anzahl der Starter: 2
Did not start/Nicht am Start: 1
Einzel-Etappenklassement nach Punkten / Points Classification (stage)
1. 14 RIDER One 30
Mannschafts-Etappenklassement nach Zeit / Teams' Classification (stage) on
1. AAA Team A 0:52:44
 14 RIDER One 0:17:15
\fEinzel-Gesamtklassement nach Zeit / Individual General Classification
1. Etappe / stage 1
1. 14 RIDER One AAA Team A 0:17:15
2. 74 RIDER Two BBB Team B 0:17:23 + 0:08
Einzel-Gesamtklassement nach Punkten / Points General Classification
1. 14 RIDER One AAA Team A 30
2. 74 RIDER Two BBB Team B 25
Mannschafts-Gesamtklassement nach Zeit / Teams' General ClassificationThursday,
on September 3th, 2026
1. Etappe / stage 1
1. AAA Team A 0:52:44
\f2. BBB Team B 0:53:03 + 0:19
Konvoi-Nummern / Convoy Numbers
1. AAA Team A
`;
const parse = (text = pdf, options = {}) => parseComputerPdf(text, { event, stageNumber: 1, expectedDate: '2026-09-03', ...options });
const metadata = (stage = 1, extra = {}) => ({ Rennen: [{ Name: `${stage}. Etappe / stage ${stage}`, Veranstaltung: event.name,
  Renndatum: `${stage + 2}. 9. 2026`, has_Tour: 0, Rennart: 2, ...extra }] });
const live = { FF: [
  { Place: '1', BIB: '14', Name: 'RIDER One', Time: '0:17:15,93', Gap: '-' },
  { Place: '2', BIB: '74', Name: 'RIDER Two', Time: '0:17:23,23', Gap: '+0:07,30' },
  { Place: 'DNS', BIB: '82', Time: '-' },
], GC: [], PT: [], GP: [], YU: [] };

describe('Computerauswertung PDF', () => {
  it('descubre enlaces publicados, limitados a edición y origen', () => {
    expect(computerPdfLinks(`${html}<a href="https://example.org/veranstaltungen/2026/260906/other.pdf">Ergebnisliste 2. Etappe</a><a href="/veranstaltungen/2025/260906/old.pdf">Ergebnisliste 3. Etappe</a>`, event)).toEqual(new Map([[1, pdfUrl]]));
    expect(computerPdfLinks('<a href="/veranstaltungen/2026/260906/start.pdf">Startliste 1. Etappe</a>', event).size).toBe(0);
  });
  it('extrae solo los cuadros publicables y sus IRM, incluso entre páginas', () => {
    const result = parse();
    expect(result.classifications.map((c) => [c.classKind, c.rows.length])).toEqual([['stage', 3], ['gc', 2], ['points', 2], ['teams', 2]]);
    expect(result.classifications[0].expectedRowCount).toBe(3);
    expect(result.classifications[0].rows[2]).toMatchObject({ bib: '82', rank: null, irm: 'DNS' });
    expect(result.classifications[2].rows[0].points).toBe(30);
    expect(result.classifications[3].rows[0]).toMatchObject({ riderDisplay: 'Team A', timeText: '0:52:44' });
  });
  it('no confunde la diferencia CRI con la diferencia de la general', () => {
    const { classifications } = parse();
    expect(classifications[0].rows[1].gapText).toBe('+7');
    expect(classifications[1].rows[1].gapText).toBe('+8');
    expect(classifications.filter((c) => !c.isTeamEvent).flatMap((c) => c.rows).every((r) => !('riderDisplay' in r) && !('teamName' in r))).toBe(true);
  });
  it('calcula un gap ausente desde los absolutos sin redondear antes de restar', () => {
    expect(parse(pdf.replace('0:17:23,23 + 0:07,30', '0:17:23,23')).classifications[0].rows[1].gapText).toBe('+7');
    expect(() => parse(pdf.replace('0:17:23,23 + 0:07,30', '0:17:13,23'))).toThrow('diferencia no verificable');
  });
  it('conserva la equivalencia comprobada del equipo nacional alemán', () => {
    expect(parse(pdf.replaceAll('AAA Team A 0:52:44', 'GER National Team Germany 0:52:44')).classifications[3].rows[0].teamName).toBe('Germany');
  });
  it('rechaza otra carrera, año, fecha o etapa', () => {
    expect(() => parse(pdf.replace('Sauerlandrundfahrt', 'Other Race'))).toThrow('carrera distinta');
    expect(() => parse(pdf.replace('2026', '2025'))).toThrow('fecha o año');
    expect(() => parse(pdf, { expectedDate: '2026-09-04' })).toThrow('fecha o año');
    expect(() => parse(pdf, { stageNumber: 2 })).toThrow('etapa distinta');
  });
  it('falla ante filas perdidas, dorsales duplicados o gaps incoherentes', () => {
    expect(() => parse(pdf.replace('Anzahl der Starter: 2', 'Anzahl der Starter: 3'))).toThrow('se esperaban');
    expect(() => parse(pdf.replace('2. 74 RIDER Two 100', '2. 14 RIDER Two 100'))).toThrow('duplicado');
    expect(() => parse(pdf.replace('0:17:23,23 + 0:07,30', 'UNREADABLE'))).toThrow('fila no interpretada');
    expect(() => parse(pdf.replace('2. 74 RIDER Two 100', '3. 74 RIDER Two 100'))).toThrow('puestos incompletos');
  });
});

describe('Computerauswertung y live', () => {
  it('prefiere el PDF publicado y conserva los IDs ya cargados manualmente', async () => {
    const loadLinks = vi.fn(() => { throw new Error('No debe necesitar el live'); });
    const stages = await fetchComputerStages({ baseVid: '260903', event, html, totalStages: 4, onlyStage: 1, loadPdf: async () => pdf, loadLinks });
    expect(loadLinks).not.toHaveBeenCalled();
    expect(stages[0].sourcePdfUrl).toBe(pdfUrl);
    expect(stages[0].raceType).toBe('ITT');
    expect(stages[0].classifications.map((c) => c.eventId)).toEqual([-1084310101, -1084310102, -1084310103, -1084310106]);
  });
  it('acepta la CRI sin has_Tour solo con carrera, etapa y fecha confirmadas', async () => {
    const stages = await fetchComputerStages({ baseVid: '260903', event, html: '', totalStages: 4, onlyStage: 1, loadLinks: async () => metadata(), loadData: async () => live });
    expect(stages[0].raceType).toBe('ITT');
    expect(stages[0].classifications[0].rows[1]).toMatchObject({ bib: '74', gapText: '+7', timeText: null });
    expect(stages[0].classifications[0].rows[0]).not.toHaveProperty('riderDisplay');
    expect(stages[0].classifications[0].winnerName).toBeNull();
  });
  it('no publica generales heredadas sin llegada ni filas de otra carrera', async () => {
    const options = { baseVid: '260903', event, html: '', totalStages: 4, onlyStage: 2, loadLinks: async () => metadata(2), loadData: async () => ({ FF: [], GC: [{ Place: '1', BIB: '14', Time: '0:17:15', markTime: 'bggrn' }] }) };
    expect(await fetchComputerStages(options)).toEqual([]);
    expect(await fetchComputerStages({ ...options, loadLinks: async () => metadata(2, { Veranstaltung: 'Other Race', has_Tour: 1 }) })).toEqual([]);
    await expect(fetchComputerStages({ ...options, loadLinks: async () => metadata(2, { Renndatum: '3. 9. 2026' }) })).rejects.toThrow('fecha distinta');
  });
  it('un PDF anunciado pero ilegible produce error, no vacía resultados', async () => {
    await expect(fetchComputerStages({ baseVid: '260903', event, html, totalStages: 4, onlyStage: 1, loadPdf: async () => 'broken' })).rejects.toThrow('carrera distinta');
  });
  it('la última etapa incluye finales con IDs distintos y sin número de etapa', async () => {
    const finalPdf = pdf.replaceAll('1. Etappe / stage 1', '4. Etappe / stage 4').replaceAll('September 3th', 'September 6th');
    const stages = await fetchComputerStages({ baseVid: '260903', event, html: html.replaceAll('1.', '4.').replaceAll('stage1', 'stage4'), totalStages: 4, onlyStage: 4, loadPdf: async () => finalPdf });
    expect(stages).toHaveLength(2);
    expect(stages[1]).toMatchObject({ stageNumber: null, isFinalClassification: true });
    expect(stages[1].classifications.map((c) => c.classKind)).toEqual(['gc', 'points', 'teams']);
    expect(new Set(stages.flatMap((s) => s.classifications.map((c) => c.eventId))).size).toBe(7);
  });
  it('normaliza centésimas sin alterar el contrato de las etapas en ruta', () => {
    expect(normAbsTime('0:17:15,93')).toBe('0:17:15');
    expect(normGap('+[0:07,30]')).toBe('+7');
    expect(mapStageRows(live.FF)[1].gapText).toBe('+7');
    const route = mapStageRows([{ Place: '1', BIB: '1', Time: '4:00:00' }, { Place: '2', BIB: '2', Time: '4:00:08', Gap: '+0:08' }]);
    expect(route[1]).toMatchObject({ timeText: '4:00:08', gapText: null });
  });
});
