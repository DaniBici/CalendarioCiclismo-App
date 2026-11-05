import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGolazoCxDocument, golazoCacheStamp, golazoFinality, golazoObserve, parseGolazoResults } from '../results-fetchers/golazo-cx-fetch.mjs';

// Tabla U19 de koppenbergcross.be del 01-11-2026 (juniors masculinos).
const html = readFileSync(new URL('./fixtures/golazo-koppenbergcross-2026-u19.html', import.meta.url), 'utf8');
const url = 'https://koppenbergcross.be/uitslagen-u19/';

describe('Golazo CX', () => {
  it('convierte llegadas y vueltas perdidas y aparta los no clasificados', () => {
    const { rows, unclassified } = parseGolazoResults(html);
    expect(rows).toHaveLength(71);
    expect(unclassified).toHaveLength(10);
    expect(rows[0]).toMatchObject({ rank: 1, riderDisplay: 'Victor Devos', isoCode2: 'FR', nationalityCode: 'FRA',
      teamName: 'SOUDAL QUICK-STEP U19', timeText: '41:42', timeSeconds: '2502', gapText: null, irm: null });
    expect(rows[1]).toMatchObject({ rank: 2, timeSeconds: '2524', gapText: '+0:22' });
    expect(rows.at(-1)).toMatchObject({ rank: 71, riderDisplay: 'Jens De Neef', irm: 'LAP', gapText: '-3 LAP', timeSeconds: null });
    expect(unclassified[0]).toMatchObject({ sourceName: 'LANDRIN ZEBERT Jules' });
  });
  it('rechaza diferencias incoherentes y puestos no consecutivos', () => {
    expect(() => parseGolazoResults(html.replace('<p>+0:22</p>', '<p>+0:23</p>'))).toThrow(/diferencia/);
    expect(() => parseGolazoResults(html.replace('standing-row-pos">2<', 'standing-row-pos">3<'))).toThrow();
  });
  it('separa páginas sin publicar y cachés anteriores a la manga', () => {
    expect(golazoCacheStamp(html)).toMatch(/^2026-11-01 /);
    const document = buildGolazoCxDocument({ raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-01', pages: [
      { url, category: 'MJ', html }, { url: 'https://koppenbergcross.be/uitslagen-u23/', category: 'MU', html: '<p>No results available yet</p>' }] });
    expect(document.categories).toMatchObject([{ category: 'MJ', dateKey: '2026-11-01', evidence: { sourceUrl: url } }]);
    expect(document.categories[0].rows).toHaveLength(71);
    expect(document.skipped).toMatchObject([{ category: 'MU' }]);
    const stale = buildGolazoCxDocument({ raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-02', pages: [{ url, category: 'MJ', html }] });
    expect(stale.invalid).toMatchObject([{ category: 'MJ' }]);
    // Antes de la manga la tabla lista los inscritos sin puesto ni tiempo, con «-» en la primera fila.
    const entries = html.replace(/standing-row-pos">\d+</g, 'standing-row-pos"><').replace(/<h5>[\d:]+<\/h5>/g, '<h5></h5>').replace(/<p>(\+[\d:]+|-\d+ LAP)<\/p>/g, '<p></p>');
    expect(buildGolazoCxDocument({ raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-01', pages: [{ url, category: 'MJ', html: entries }] }).skipped)
      .toMatchObject([{ category: 'MJ', reason: 'Tabla del organizador sin llegadas' }]);
  });
});

// Elite masculina (60 min) del 01-11-2026: tabla en directo con el líder en su paso de 53:55, que se leyó igual con
// dos cachés durante más de tres minutos, y tabla final (Thibau Nys en 1:01:31).
const live = readFileSync(new URL('./fixtures/golazo-koppenbergcross-2026-me-live.html', import.meta.url), 'utf8');
const final = readFileSync(new URL('./fixtures/golazo-koppenbergcross-2026-me-final.html', import.meta.url), 'utf8');
const site = 'https://www.koppenbergcross.be/';
const manga = page => buildGolazoCxDocument({ raceId: 'r', seasonKey: '2026-27', dateKey: '2026-11-01', source: 'golazo', siteUrl: site,
  pages: [{ url: `${site}uitslagen-elite-mannen/`, page: 'uitslagen-elite-mannen', category: 'ME', html: page }] }).categories[0];
const at = minutes => new Date(Date.parse('2026-11-01T15:00:00Z') + minutes * 60000);

describe('Golazo CX en directo', () => {
  it('lee la tabla en directo y acredita la cuenta de la página en la evidencia del worker', () => {
    const value = manga(live);
    expect(value.rows[0]).toMatchObject({ rank: 1, riderDisplay: 'Michael Vanthourenhout', timeText: '53:55', timeSeconds: '3235' });
    expect(value.rows.filter(row => row.irm === 'LAP')).toHaveLength(6);
    expect(value).toMatchObject({ sourceGeneratedAt: '2026-11-01 16:00:09',
      evidence: { sourceUrl: `${site}uitslagen-elite-mannen/`, golazo: { sourceUrl: site, page: 'uitslagen-elite-mannen' } } });
    expect(value.evidence.sourceGeneratedAt).toBeUndefined();
  });
  it('no acredita la tabla del penúltimo paso del líder aunque no cambie', () => {
    // Paso anterior del líder observado por el vigilante: 46:13.
    const state = golazoObserve({ leaderSeconds: 2773 }, manga(live), at(0));
    expect(state).toMatchObject({ leaderSeconds: 3235, previousLeaderSeconds: 2773, digestStamp: '2026-11-01 16:00:09' });
    expect(golazoFinality(state, { durationMinutes: 60, now: at(10), stamp: '2026-11-01 16:10:00' }))
      .toMatchObject({ final: false, reason: expect.stringContaining('antes de su último paso') });
    expect(golazoFinality({ leaderSeconds: 3235 }, { durationMinutes: 60, now: at(10), stamp: 'x' }).reason).toContain('dos pasos');
  });
  it('acredita la tabla final estable tras el último paso del líder', () => {
    let state = golazoObserve({ leaderSeconds: 2773 }, manga(live), at(0));
    state = golazoObserve(state, manga(final), at(10));
    expect(state).toMatchObject({ leaderSeconds: 3691, previousLeaderSeconds: 3235 });
    const stamp = golazoCacheStamp(final);
    expect(golazoFinality(state, { durationMinutes: 60, now: at(15), stamp }).final).toBe(false);
    // Media vuelta (3:48) más los 3 minutos de la caché de la página.
    expect(golazoFinality(state, { durationMinutes: 60, now: at(16.5), stamp: '2026-11-01 16:30:00' }).final).toBe(false);
    expect(golazoFinality(state, { durationMinutes: 60, now: at(17), stamp: '2026-11-01 16:30:00' })).toMatchObject({ final: true, lapSeconds: 456 });
    // Con la meta por debajo de la duración prevista se espera una vuelta completa más ese plazo.
    expect(golazoFinality(state, { durationMinutes: 62, now: at(17), stamp: '2026-11-01 16:30:00' }).final).toBe(false);
    expect(golazoFinality(state, { durationMinutes: 62, now: at(21), stamp: '2026-11-01 16:30:00' }).final).toBe(true);
    // Una corrección del líder inferior a un minuto no cuenta como paso por meta.
    expect(golazoObserve(state, { ...manga(final), rows: [{ rank: 1, timeSeconds: '3700' }] }, at(16))).toMatchObject({ leaderSeconds: 3700, previousLeaderSeconds: 3235 });
  });
});
