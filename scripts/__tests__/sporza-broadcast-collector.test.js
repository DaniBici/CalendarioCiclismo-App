import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectSporza,
  normalizeSporzaDutch,
  parseSporzaEditorialPage,
  parseSporzaLivestreamSchedule,
  parseSporzaSchedule,
  sporzaScheduleUrl,
} from '../broadcasts-sync/sporza-collector.mjs';

const fixture = (name) => readFileSync(
  fileURLToPath(new URL(`../../scripts/broadcasts-sync/fixtures/${name}`, import.meta.url)),
  'utf8',
);

describe('colector aislado de emisiones Sporza', () => {
  it('usa el calendario solo para la identidad y conserva startLabel como dato deportivo', () => {
    const events = parseSporzaSchedule(fixture('sporza-schedule.json'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'sporza',
      externalEventId: '3305262',
      dateKey: '2026-08-25',
      title: 'Vuelta a España',
      subtitle: 'Etappe 4',
      stageNumber: 4,
      sportsStartLabel: '14:53 Andorra la Vella',
    });
    expect(events[0]).not.toHaveProperty('startTimeUtc');
  });

  it('obtiene hora y canales solo de la evidencia editorial explícita', () => {
    const identity = parseSporzaSchedule(fixture('sporza-schedule.json'))[0];
    expect(parseSporzaEditorialPage(fixture('sporza-editorial.html'), identity)).toMatchObject({
      externalEventId: '3305262',
      startTimeUtc: '2026-08-25T12:30:00.000Z',
      localStartTime: '14:30',
      timeZone: 'Europe/Brussels',
      sourceChannels: ['VRT 1', 'VRT MAX'],
      country: 'BE',
      sourceUrl: 'https://sporza.be/nl/sport/wielrennen/~3305262/',
      broadcastUrl: 'https://sporza.be/nl/sport/wielrennen/~3305262/',
      evidence: {
        observedCanonicalUrl: 'https://sporza.be/nl/matches/wielrennen/vuelta-a-espana/2026/vuelta-rit-4~1759432444152/',
      },
    });
  });

  it('no convierte startLabel deportivo en hora de emisión', () => {
    const identity = parseSporzaSchedule(fixture('sporza-schedule.json'))[0];
    const withoutEditorialTime = fixture('sporza-editorial.html')
      .replaceAll('vanaf 14.30 uur', 'zonder aangekondigd uur');
    expect(parseSporzaEditorialPage(withoutEditorialTime, identity)).toBeNull();
  });

  it('excluye páginas de resúmenes aunque contengan hora y canal', () => {
    const identity = parseSporzaSchedule(fixture('sporza-schedule.json'))[0];
    expect(parseSporzaEditorialPage(fixture('sporza-summary.html'), identity)).toBeNull();
  });

  it('excluye un resumen declarado solo en la descripción', () => {
    const identity = parseSporzaSchedule(fixture('sporza-schedule.json'))[0];
    const disguisedSummary = fixture('sporza-editorial.html')
      .replace('LIVESTREAM Vuelta: de vierde etappe', 'Vuelta: de vierde etappe')
      .replaceAll('Kijk integraal naar de rit', 'Bekijk de samenvatting van de rit');
    expect(parseSporzaEditorialPage(disguisedSummary, identity)).toBeNull();
  });

  it('no infiere canales ni continuidad cuando la página no los declara', () => {
    const identity = parseSporzaSchedule(fixture('sporza-schedule.json'))[0];
    const withoutChannel = fixture('sporza-editorial.html')
      .replaceAll('VRT 1 en VRT MAX', 'onze kanalen');
    expect(parseSporzaEditorialPage(withoutChannel, identity)).toBeNull();
  });

  it('recoge observaciones sin efectuar escrituras', async () => {
    const scheduleUrl = sporzaScheduleUrl('2026-08-25');
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url === scheduleUrl) return { ok: true, text: async () => fixture('sporza-schedule.json') };
      return {
        ok: true,
        url: 'https://sporza.be/nl/matches/wielrennen/vuelta-a-espana/2026/vuelta-rit-4~1759432444152/',
        text: async () => fixture('sporza-editorial.html'),
      };
    };
    await expect(collectSporza({ dateKey: '2026-08-25', fetcher })).resolves.toEqual([
      expect.objectContaining({ externalEventId: '3305262', startTimeUtc: '2026-08-25T12:30:00.000Z' }),
    ]);
    expect(calls).toEqual([
      scheduleUrl,
      'https://sporza.be/nl/sport/wielrennen/~3305262/',
    ]);
  });

  it('explica cuándo el calendario tiene carrera pero falta evidencia de emisión', async () => {
    const diagnostics = [];
    const fetcher = async (url) => url === sporzaScheduleUrl('2026-08-25')
      ? { ok: true, text: async () => fixture('sporza-schedule.json') }
      : { ok: true, url, text: async () => '<html><title>Sin datos de emisión</title></html>' };
    await expect(collectSporza({ dateKey: '2026-08-25', fetcher, diagnostics }))
      .resolves.toEqual([]);
    expect(diagnostics).toEqual([expect.objectContaining({
      action: 'insufficient_broadcast_evidence',
      title: 'Vuelta a España',
      dateKey: '2026-08-25',
      sourceUrl: 'https://sporza.be/nl/sport/wielrennen/~3305262/',
    })]);
  });

  it('extrae del esquema de livestreams solo ciclismo con hora y enlace editorial', () => {
    const events = parseSporzaLivestreamSchedule(fixture('sporza-livestream.html'), {
      todayKey: '2026-09-16',
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      source: 'sporza', dateKey: '2026-09-18',
      title: 'Kampioenschap van Vlaanderen', subtitle: 'Koolskamp Koers (1.1)',
      startTimeUtc: '2026-09-18T13:30:00.000Z',
      sourceChannels: ['Sporza'], country: 'BE',
      broadcastUrl: 'https://sporza.be/nl/2026/09/14/livestream-kijk-vrijdag-naar-koolskamp-koers-bij-sporza~1789375904342/',
    });
    expect(events[1]).toMatchObject({
      dateKey: '2026-09-20', title: 'ITT elite women', subtitle: 'WK Montreal',
      startTimeUtc: '2026-09-20T12:45:00.000Z',
    });
    expect(events.some((event) => event.title.includes('Anderlecht'))).toBe(false);
    expect(events.some((event) => /samenvatting/i.test(event.title))).toBe(false);
  });

  it('traduce el vocabulario neerlandés del esquema y exige fecha de referencia', () => {
    expect(normalizeSporzaDutch('tijdrit beloften mannen')).toBe('ITT U23 men');
    expect(normalizeSporzaDutch('wegrit junioren vrouwen')).toBe('road race junior women');
    expect(() => parseSporzaLivestreamSchedule(fixture('sporza-livestream.html'))).toThrow(/fecha de referencia/);
  });

  it('resuelve los días relativos del esquema contra la fecha de referencia', () => {
    const html = fixture('sporza-livestream.html')
      .replace('Morgen, 17 september 2026', 'Vandaag');
    expect(parseSporzaLivestreamSchedule(html, { todayKey: '2026-09-16' }))
      .toHaveLength(2);
    expect(parseSporzaLivestreamSchedule(fixture('sporza-livestream.html'), {
      todayKey: '2026-09-16',
    })).toHaveLength(2);
  });
});
