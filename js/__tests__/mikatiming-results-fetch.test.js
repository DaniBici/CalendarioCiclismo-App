import { describe, expect, it } from 'vitest';
import {
  assertEventOffered, assessAuthenticity, buildStage, parseCode, parseDetailFinish, parseListPage, zonedInstant,
} from '../../scripts/results-fetchers/mikatiming-results-fetch.mjs';

const EVENT = 'P200_9TGOTQ702E5';
const item = (place, name, bib, time, idp = `ID${bib}`) => `<li class=" list-group-item row">
<div class="row"><div class=" list-field type-place place-primary numeric" style="width: 30px">${place}</div>
<h4 class=" list-field type-fullname"><a href="?content=detail&amp;idp=${idp}&amp;lang=EN_CAP&amp;event=${EVENT}">${name}</a></h4></div>
<div class=" list-field type-field" style="width: 45px"><div class="visible-xs-block list-label">Bib Number</div>${bib}</div>
<div class=" list-field type-time"><div class="visible-xs-block list-label">Finish</div>${time}</div>
</li>`;
const page = (...items) => `<ul class="list-group"><li class="list-group-item list-group-header">x</li>${items.join('\n')}</ul>`;
const detail = (timeOfDay, time) => `
<table><tr class="f-time_finish_brutto"><th class="desc">Finish Time (Gun)</th><td class="last">${time}</td></tr></table>
<div class="detail-box box-splits"><table><tbody>
<tr class=" f-time_21"><th class="desc">Durchfahrt 1</th><td class="time_day">16:19:05</td><td class="time">03:54:05</td></tr>
<tr class="list-highlight f-time_finish_brutto highlight"><th class="desc">Finish</th><td class="time_day">${timeOfDay}</td><td class="time">${time}</td></tr>
</tbody></table></div>`;

// Münsterland Giro 2026: salida neutralizada 13:14 y real 13:30 (Berlín).
const schedule = { dateKey: '2026-10-03', timeZone: 'Europe/Berlin',
  neutralStartUtc: '2026-10-03T11:14:00Z', startUtc: '2026-10-03T11:30:00Z' };

describe('mikatiming-results-fetch', () => {
  it('valida el código y el evento ofrecido por la edición', () => {
    expect(parseCode('muensterland-giro.r.mikatiming.com/2026/P200_9TGOTQ702E5'))
      .toEqual({ host: 'muensterland-giro.r.mikatiming.com', path: '/2026/', event: EVENT });
    expect(() => parseCode('example.com/2026/P200')).toThrow();
    expect(() => assertEventOffered('<option value="J65_X">', EVENT)).toThrow(/no ofrece/);
  });

  it('lee llegados e IRM y omite inscritos sin puesto ni tiempo', () => {
    const rows = parseListPage(page(item(1, 'LAMPERTI, Luke (USA)', 25, '04:09:49'), item(2, 'X, Y (BEL)', 76, '04:10:50'),
      item('DNF', 'Z, Z (GER)', 9, ''), item('–', 'W, W (GER)', 10, '')), EVENT);
    expect(rows.map((row) => [row.rank, row.irm ?? null, row.bib, row.finishSeconds]))
      .toEqual([[1, null, '25', 14989], [2, null, '76', 15050], [null, 'DNF', '9', null]]);
    expect(() => parseListPage(page(item(1, 'A', 1, '04:00:00').replace(EVENT, 'J65_X')), EVENT)).toThrow(/otro evento/);
  });

  it('construye la clasificación de un día con diferencias', () => {
    const rows = parseListPage(page(item(1, 'A', 25, '04:09:49'), item(2, 'B', 184, '04:10:38'), item(3, 'C', 7, '04:10:38')), EVENT);
    const stage = buildStage(rows, { competitionId: -14479, dateKey: '2026-10-03' });
    expect(stage).toMatchObject({ stageNumber: null, isFinalClassification: false, uciRaceId: -1447999 });
    expect(stage.classifications[0]).toMatchObject({ classKind: 'gc', scope: 'stage', eventId: -144799901, rowCount: 3 });
    expect(stage.classifications[0].rows.map((row) => row.resultValue)).toEqual(['4:09:49', '+49', '+49']);
  });

  it('toma la llegada de la tabla de pasos', () => {
    expect(parseDetailFinish(detail('16:34:49', '04:09:49'))).toEqual({ timeOfDay: '16:34:49', raceSeconds: 14989 });
  });

  it('convierte la hora local con el horario de verano', () => {
    expect(new Date(zonedInstant('2026-10-03', '16:34:49', 'Europe/Berlin')).toISOString()).toBe('2026-10-03T14:34:49.000Z');
  });

  it('no publica la simulación de la víspera ni la que persiste tras su hora de llegada', () => {
    // Simulación: ganador a las 16:34:49 con 4:09:49 → salida deducida 12:25.
    const simulation = { winnerFinish: { timeOfDay: '16:34:49', raceSeconds: 14989 }, lastFinishSeconds: 15306 };
    expect(assessAuthenticity({ ...schedule, ...simulation, now: Date.parse('2026-10-02T17:21:00Z') }).status).toBe('pending');
    expect(assessAuthenticity({ ...schedule, ...simulation, now: Date.parse('2026-10-03T13:00:00Z') }).status).toBe('pending');
    expect(assessAuthenticity({ ...schedule, ...simulation, now: Date.parse('2026-10-03T15:00:00Z') }).status).toBe('invalid');
  });

  it('acepta la llegada real ya ocurrida y coherente con la salida', () => {
    const real = { winnerFinish: { timeOfDay: '17:42:10', raceSeconds: 4 * 3600 + 11 * 60 }, lastFinishSeconds: 4 * 3600 + 14 * 60 };
    expect(assessAuthenticity({ ...schedule, ...real, now: Date.parse('2026-10-03T15:43:00Z') }).status).toBe('pending');
    expect(assessAuthenticity({ ...schedule, ...real, now: Date.parse('2026-10-03T15:46:00Z') }).status).toBe('ok');
  });

  it('sin horario de salida solo acepta jornadas pasadas', () => {
    const past = { winnerFinish: { timeOfDay: '17:23:43', raceSeconds: 15053 }, lastFinishSeconds: 15331 };
    const base = { dateKey: '2025-10-03', timeZone: 'Europe/Berlin', ...past };
    expect(assessAuthenticity({ ...base, now: Date.parse('2026-10-02T17:00:00Z') }).status).toBe('ok');
    expect(assessAuthenticity({ ...base, now: Date.parse('2025-10-03T17:00:00Z') }).status).toBe('invalid');
  });
});
