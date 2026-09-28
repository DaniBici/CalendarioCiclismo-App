import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseRaiSchedule, parseRaiVideo, classifyRaiObservation, collectRai, raiScheduleUrl, withRaiTransition } from '../broadcasts-sync/rai.mjs';
import { normalizedObservation, matchObservation, desiredBroadcasts, parseStageNumber } from '../broadcasts-sync/broadcasts-sync-core.mjs';
import { adoptionCandidate, applyOne, mergeManagedBroadcast, sameManagedState } from '../broadcasts-sync/broadcasts-sync.mjs';
const fixture = (name) => JSON.parse(readFileSync(new URL(`../../scripts/broadcasts-sync/fixtures/${name}`, import.meta.url)));
const schedule = fixture('rai-schedule.json');
const video = fixture('rai-video.json');
const day = { raceDayId: 'day', raceId: 'race', dateKey: '2026-09-09', name: 'Giro della Toscana', gender: 'male', stageNumber: null,
  neutralStartTimeUtc: '2026-09-09T09:00:00Z', estimatedFinishTimeUtc: '2026-09-09T15:30:00Z' };
const parseSchedule = () => parseRaiSchedule(schedule, raiScheduleUrl('rai-sport', day.dateKey));
describe('colector RAI', () => {
  it('clasifica con los horarios de carrera y conserva diferidos sin confirmar directo', () => {
    const events = parseSchedule();
    expect(events).toHaveLength(2);
    expect(classifyRaiObservation(events[0], day)).toMatchObject({ mediaKind: 'live', startTimeUtc: '2026-09-09T15:00:00.000Z', writeEligible: true });
    expect(classifyRaiObservation(events[1], day)).toMatchObject({ mediaKind: 'delayed', note: 'Diferido.', writeEligible: true });
    expect(classifyRaiObservation(events[0], { ...day, estimatedFinishTimeUtc: null }).writeEligible).toBe(false);
    expect(classifyRaiObservation({ ...events[0], explicitDelayed: true }, day).mediaKind).toBe('delayed');
    expect(classifyRaiObservation({ ...events[0], startTimeUtc: day.estimatedFinishTimeUtc }, day).mediaKind).toBe('delayed');
  });
  it('no usa una reposición con vídeo como prueba de directo y rechaza otros deportes', () => {
    const item = schedule.events[0];
    const parsed = parseRaiSchedule({ events: [{ ...item, name: 'Ciclismo Mountain Bike' }, { ...item, name: 'Radiocorsa' }] }, 'https://www.raiplay.it/guidatv/');
    expect(parsed).toEqual([]);
  });
  it('representa el relevo de Rai Sport a Rai 2 en una sola fila con hora de Roma', () => {
    const sport = classifyRaiObservation({ ...parseSchedule()[0], startTimeUtc: '2026-09-09T11:25:00.000Z' }, day);
    const rai2 = classifyRaiObservation({ ...sport, channel: 'RAI 2', sourceChannel: 'Rai 2', startTimeUtc: '2026-09-09T13:30:00.000Z' }, day);
    const delayed = { ...rai2, mediaKind: 'delayed', startTimeUtc: '2026-09-09T12:00:00.000Z' };
    expect(withRaiTransition(sport, [sport, delayed, rai2])).toMatchObject({ channel: 'RAI Sport', note: '15:30 > RAI 2' });
    expect(withRaiTransition(sport, [sport]).note).toBeNull();
    expect(withRaiTransition(rai2, [sport, rai2]).note).toBeNull();
    const row = { id: 'rai', sortOrder: 13, note: 'Solo en Italia. Pasa a RAI 2 a las 15:30.' };
    expect(mergeManagedBroadcast(row, { note: '15:45 > RAI 2' }, 'rai').note).toBe('Solo en Italia. 15:45 > RAI 2');
    expect(mergeManagedBroadcast({ ...row, note: '15:30 > RAI 2' }, { note: null }, 'rai').note).toBeNull();
  });
  it('interpreta tappa y exige la etapa correcta', () => {
    expect(parseStageNumber('4a tappa')).toBe(4);
    expect(parseStageNumber('tappa 3')).toBe(3);
    const obs = { ...parseSchedule()[0], stageNumber: 4 };
    expect(matchObservation(obs, [day]).status).toBe('unmatched');
    expect(matchObservation({ ...obs, stageNumber: null }, [{ ...day, stageNumber: 4 }]).status).toBe('unmatched');
  });
  it('publica vídeos vigentes sin inventar hora y distingue resumen de repetición', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const full = parseRaiVideo(video, { now });
    expect(full).toMatchObject({ mediaKind: 'replay', note: null, dateKey: '2026-08-30', startTimeUtc: null, reviveCapable: true });
    expect(normalizedObservation(full).startTimeUtc).toBeNull();
    expect(desiredBroadcasts(normalizedObservation(full))[0]).toMatchObject({ startTimeUtc: null, showInRevive: true });
    expect(parseRaiVideo({ ...video, form: 'Clip', name: 'Giro della Toscana - Highlights - 30/08/2026' }, { now })).toMatchObject({ mediaKind: 'highlights', note: 'Resumen.' });
    expect(parseRaiVideo({ ...video, form: 'Clip' }, { now })).toBeNull();
    expect(parseRaiVideo(video, { now: new Date('2026-09-08') })).toBeNull();
    expect(parseRaiVideo({ ...video, season: '2025' }, { now })).toBeNull();
    expect(parseRaiVideo({ ...video, name: 'Giro della Toscana 2025 - 30/08/2026' }, { now })).toBeNull();
    expect(parseRaiVideo({ ...video, weblink: 'https://other.example/video/foo' }, { now })).toBeNull();
  });
  it('adopta la fila de directo para sustituirla por highlights y respeta el bloqueo', () => {
    const obs = normalizedObservation(parseRaiVideo({ ...video, name: 'Giro della Toscana Highlights', form: 'Clip' }, { now: new Date('2026-09-05') }));
    const row = { id: 'rai', channel: 'RAI Sport', country: 'IT', url: parseSchedule()[0].broadcastUrl };
    expect(adoptionCandidate(obs, desiredBroadcasts(obs), [row]).status).toBe('adoptable');
    expect(adoptionCandidate(obs, desiredBroadcasts(obs), [{ ...row, automationLocked: true }]).status).toBe('manual_lock');
    expect(adoptionCandidate(obs, desiredBroadcasts(obs), [row, { ...row, id: 'rai2', channel: 'RAI 2' }]).status).toBe('conflict');
  });
  it('no oculta errores de la fuente como una parrilla vacía', async () => {
    await expect(collectRai(new Date('2026-09-05'), { channels: ['rai-sport'], dateKeys: ['2026-09-05'], fetcher: async () => ({}) })).rejects.toThrow('events');
  });
  it('compara horas nulas sin convertirlas en la fecha de 1970', () => {
    const row = { channel: 'RAI', country: 'IT', startTimeUtc: null };
    expect(sameManagedState(row, row)).toBe(true);
    expect(sameManagedState(row, { ...row, startTimeUtc: '1970-01-01T00:00:00Z' })).toBe(false);
  });
});

describe('sustitución RAI en la misma fila', () => {
  async function apply(existing, observation) {
    const calls = [];
    const client = { query: async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT observed_at')) return { rows: [{ observed_at: '2026-09-01' }] };
      if (sql.includes('WHERE source=$1 AND external_event_id=$2 FOR UPDATE')) return { rows: [{ primary_broadcast_id: existing.id, last_applied: [existing] }] };
      if (sql.includes('FROM public.broadcasts WHERE id = ANY')) return { rows: [existing] };
      return { rows: [] };
    } };
    const result = await applyOne(client, observation, { raceDayId: 'day' }, { broadcasts: [existing] });
    return { result, calls };
  }
  const live = { id: 'rai', raceDayId: 'day', channel: 'RAI Sport', country: 'IT', startTimeUtc: '2026-08-30T12:00:00Z',
    url: 'https://www.raiplay.it/dirette/raisport', note: null, sortOrder: 5, showInRevive: false, automationLocked: false };
  const highlights = normalizedObservation(parseRaiVideo({ ...video, name: 'Ciclismo Giro della Toscana Highlights', form: 'Clip' }, { now: new Date('2026-09-05') }));
  it('reemplaza el directo con highlights y no crea otra fila ni confirma TV en directo', async () => {
    const { result, calls } = await apply(live, highlights);
    expect(result).toBe('applied_update');
    const update = calls.find(([sql]) => sql.includes('UPDATE public.broadcasts'));
    expect(update[1]).toEqual(['rai', 'RAI / RaiPlay', 'IT', null, highlights.broadcastUrl, 'Resumen.', 5, true, false]);
    expect(calls.some(([sql]) => sql.includes('INSERT INTO public.broadcasts') || sql.includes('UPDATE public.race_days'))).toBe(false);
  });
  it('una pasada de parrilla posterior conserva los highlights', async () => {
    const existing = { ...live, channel: 'RAI / RaiPlay', startTimeUtc: null, url: highlights.broadcastUrl, note: 'Resumen.', showInRevive: true };
    const { result, calls } = await apply(existing, classifyRaiObservation(parseSchedule()[0], day));
    expect(result).toBe('unchanged');
    expect(calls.some(([sql]) => sql.includes('UPDATE public.broadcasts') || sql.includes('UPDATE public.race_days'))).toBe(false);
  });
  it('un diferido posterior no sustituye un directo ya emitido', async () => {
    const delayed = { ...classifyRaiObservation(parseSchedule()[1], day), startTimeUtc: '2026-08-31T23:05:00.000Z' };
    const { result, calls } = await apply(live, delayed);
    expect(result).toBe('unchanged');
    expect(calls.some(([sql]) => sql.includes('UPDATE public.broadcasts'))).toBe(false);
  });
  it('antes de la salida, un directo reclasificado como diferido actualiza la fila', async () => {
    const future = { ...live, startTimeUtc: '2099-09-09T12:00:00Z' };
    const delayed = { ...classifyRaiObservation(parseSchedule()[1], day), startTimeUtc: '2099-09-09T13:00:00.000Z' };
    const { result } = await apply(future, delayed);
    expect(result).toBe('applied_update');
  });
  it('resuelve los nombres oficiales de Larciano y del Toscana femenino', () => {
    expect(matchObservation({ ...parseSchedule()[0], title: 'Ciclismo. G. P. Industria e Artigianato' }, [{ ...day, name: 'GP Industria & Artigianato-Larciano' }]).status).toBe('matched');
    expect(matchObservation({ ...parseSchedule()[0], title: 'Ciclismo Giro della Toscana 3a tappa', stageNumber: 3 }, [{ ...day, name: 'Premondiale Giro Toscana - Memorial Michela Fanini', gender: 'female', stageNumber: 3 }]).status).toBe('matched');
  });
});

describe('horizonte de parrillas RAI', () => {
  it('tolera solo el 404 de una parrilla futura, no errores de la parrilla actual', async () => {
    const fetcher = async (url) => {
      if (url.includes('/palinsesto/')) { const error = new Error('404'); error.status = 404; throw error; }
      return { blocks: [] };
    };
    const options = { fetcher, channels: ['rai-1'], dateKeys: ['2026-09-13'], diagnostics: [] };
    expect(await collectRai(new Date('2026-09-05'), options)).toEqual([]);
    expect(options.diagnostics[0].action).toBe('no_cycling_events');
    await expect(collectRai(new Date('2026-09-05'), { ...options, dateKeys: ['2026-09-05'] })).rejects.toThrow('404');
  });
});
