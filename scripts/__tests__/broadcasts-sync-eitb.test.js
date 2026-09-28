import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  buildEitbScheduleUrl, collectEitb, parseEitbSchedule,
} from '../broadcasts-sync/eitb.mjs';

const fixture = readFileSync(fileURLToPath(new URL(
  '../broadcasts-sync/fixtures/eitb-schedule.html', import.meta.url,
)), 'utf8');

const options = {
  dateKey: '2026-08-20', channelId: 1, station: 'ETB-1',
  sourceChannel: 'ETB1', channel: 'ETB1',
};

describe('colector aislado de emisiones EITB', () => {
  it('extrae ciclismo, convierte Europe/Madrid a UTC y conserva evidencia', () => {
    const events = parseEitbSchedule(fixture, options);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      source: 'eitb', dateKey: '2026-08-20', title: 'Txirrindularitza; Alemaniako Tourra',
      sourceChannel: 'ETB1', channel: 'ETB1', country: 'ES',
      localStartTime: '15:05', startTimeUtc: '2026-08-20T13:05:00.000Z',
      isLive: null, liveEvidence: [], broadcastUrl: null,
      evidence: { channelId: 1, station: 'ETB-1', section: 'tarde' },
    });
    expect(events[1]).toMatchObject({
      stageNumber: 5, isLive: true, liveEvidence: ['Zuzenean'],
      broadcastUrl: 'https://www.eitb.eus/eu/kirolak/txirrindularitza/itzulia/',
    });
  });

  it('excluye repeticiones y resúmenes y desplaza la madrugada al día siguiente', () => {
    const events = parseEitbSchedule(fixture, options);
    expect(events.map((event) => event.localStartTime)).toEqual(['15:05', '17:30', '00:30']);
    expect(events[2]).toMatchObject({
      dateKey: '2026-08-21', startTimeUtc: '2026-08-20T22:30:00.000Z',
      isLive: true, evidence: { section: 'madrugada' },
    });
  });

  it('mantiene la identidad externa cuando EITB cambia la hora', () => {
    const original = parseEitbSchedule(fixture, options)[1];
    const changed = parseEitbSchedule(fixture.replace('17:30', '18:15'), options)[1];
    expect(changed.externalEventId).toBe(original.externalEventId);
    expect(changed.startTimeUtc).toBe('2026-08-20T16:15:00.000Z');
  });

  it('construye el endpoint oficial y recolecta sin realizar escrituras', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, text: async () => fixture }));
    const events = await collectEitb({ fetcher, dateKeys: ['2026-08-20'], channels: [options] });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://www.eitb.eus/es/modulo/programacion/programacion_berria_3_col_ajax/canal/1/emisoras/ETB-1/fecha/2026-08-20',
    );
    expect(events).toHaveLength(3);
  });

  it('propaga un fallo HTTP de fuente con la URL afectada', async () => {
    const url = buildEitbScheduleUrl(options, '2026-08-20');
    await expect(collectEitb({
      fetcher: async () => ({ ok: false, status: 503 }),
      dateKeys: ['2026-08-20'], channels: [options],
    })).rejects.toThrow(`EITB respondió 503 para ${url}`);
  });

  it('no confunde menciones genéricas a una vuelta con una emisión ciclista', () => {
    const html = fixture.replace(
      'Txirrindularitza; Alemaniako Tourra',
      'Doc Martin',
    ).replace('Kirol emanaldia', 'Lo que pasa a la vuelta de la esquina');
    expect(parseEitbSchedule(html, options).some((event) => event.title === 'Doc Martin')).toBe(false);
  });

  it('falla si cambia el contrato estructural de la parrilla', () => {
    expect(() => parseEitbSchedule('<html></html>', options)).toThrow(/parrilla reconocible/);
  });
});
