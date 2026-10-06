import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseRtbfSchedules, rtbfPageInfo,
} from '../broadcasts-sync/rtbf.mjs';

const fixture = readFileSync(fileURLToPath(new URL(
  '../broadcasts-sync/fixtures/rtbf-schedules.json', import.meta.url,
)), 'utf8');

describe('colector aislado de emisiones RTBF', () => {
  it('extrae la emisión íntegra, convierte Europe/Brussels a UTC y descarta el resumen corto', () => {
    const events = parseRtbfSchedules([fixture]);
    expect(events.find((event) => event.stageNumber === 1)).toMatchObject({
      source: 'rtbf', channel: 'La Une / RTBF Auvio', country: 'BE',
      startTimeUtc: '2026-08-22T14:05:00.000Z', reviveCapable: true,
      finalizeReplay: true, broadcastUrl: expect.stringContaining('/media/'),
      scheduleIds: ['stage-1-full'],
    });
    expect(events.some((event) => event.scheduleIds.includes('stage-1-summary'))).toBe(false);
  });

  it('mantiene el directo sin Revive hasta que RTBF publica el vídeo íntegro', () => {
    expect(parseRtbfSchedules([fixture]).find((event) => event.stageNumber === 5)).toMatchObject({
      channel: 'Tipik / RTBF Auvio', startTimeUtc: '2026-08-26T12:50:00.000Z',
      reviveCapable: false, finalizeReplay: false,
      broadcastUrl: expect.stringContaining('/live/'),
    });
  });

  it('representa Tipik y el relevo posterior a La Une en una sola fila', () => {
    expect(parseRtbfSchedules([fixture]).find((event) => event.stageNumber === 7)).toMatchObject({
      channel: 'Tipik / RTBF Auvio', note: '14:00 > La Une',
      scheduleIds: ['stage-7-tipik', 'stage-7-la-une'],
    });
  });

  it('valida la envoltura y limita la paginación declarada por RTBF', () => {
    const page = (last) => JSON.stringify({ status: 200, meta: { page: { last } }, data: [] });
    expect(rtbfPageInfo(page(2))).toEqual({ last: 2 });
    expect(rtbfPageInfo(page(25))).toEqual({ last: 10 });
    expect(() => rtbfPageInfo('{}')).toThrow(/respuesta de programación no utilizable/);
  });
});
