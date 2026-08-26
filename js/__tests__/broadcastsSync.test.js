import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  desiredBroadcasts, matchObservation, parseHboCatalog, parseHboEventStart,
  isMontoneraEligible, normalizedObservation, parseRtveGuide, parseRtveStructuredGuide,
  parseRtveVueltaVideos, zonedTimeToUtc,
} from '../../scripts/broadcasts-sync/broadcasts-sync-core.mjs';
import {
  adoptionCandidate, applyRtveVueltaReplay, collectEitb, collectHbo, collectRtve,
  collectRtveVueltaReplays, confirmTvStatus, loadRtveVueltaReplayCandidates,
  mergeManagedBroadcast, sameManagedState, withMontoneraNote,
} from '../../scripts/broadcasts-sync/broadcasts-sync.mjs';

const fixture = (name) => readFileSync(
  fileURLToPath(new URL(`../../scripts/broadcasts-sync/fixtures/${name}`, import.meta.url)),
  'utf8',
);
const runnerSource = readFileSync(
  fileURLToPath(new URL('../../scripts/broadcasts-sync/broadcasts-sync.mjs', import.meta.url)),
  'utf8',
);
const serviceSource = readFileSync(
  fileURLToPath(new URL('../../deploy/broadcasts-vps/cc-broadcasts-sync.service', import.meta.url)),
  'utf8',
);
const panelSource = readFileSync(
  fileURLToPath(new URL('../panel.js', import.meta.url)),
  'utf8',
);

describe('sincronización oficial de emisiones', () => {
  it('extrae eventos HBO, excluye programas de estudio y obtiene UTC del evento', () => {
    const events = parseHboCatalog(fixture('hbo-cycling.html'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      externalEventId: '607d7a2a-e2cf-59b9-a8f5-912e9ea0cac8',
      dateKey: '2026-08-26', stageNumber: 5, title: 'La Vuelta', hasMontonera: true,
    });
    expect(parseHboEventStart(fixture('hbo-event.html'))).toBe('2026-08-26T12:45:00.000Z');
  });

  it('genera siempre la pareja territorial atómica de HBO Max', () => {
    expect(desiredBroadcasts({
      source: 'hbo_max', startTimeUtc: '2026-08-26T12:45:00.000Z',
      broadcastUrl: 'https://play.hbomax.com/sport/uuid',
    })).toEqual([
      expect.objectContaining({ channel: 'Eurosport (HBO Max)', country: 'EUROPA' }),
      expect.objectContaining({ channel: 'TNT Sports (HBO Max)', country: 'UK_IE' }),
    ]);
  });

  it('solo añade La Montonera cuando existe el evento oficial de la misma etapa', () => {
    const withStudio = parseHboCatalog(fixture('hbo-cycling.html'))[0];
    const withoutStudio = parseHboCatalog(
      fixture('hbo-cycling.html').replace(/<a href="\/es\/es\/sport\/2026-8-26\/75696bff[\s\S]*?<\/a>/, ''),
    )[0];
    expect(desiredBroadcasts(normalizedObservation({ ...withStudio, startTimeUtc: '2026-08-26T12:45:00Z' })))
      .toEqual([
        expect.objectContaining({ country: 'EUROPA', note: 'La Montonera al terminar.', hasMontonera: true }),
        expect.objectContaining({ country: 'UK_IE', note: null, hasMontonera: false }),
      ]);
    expect(withoutStudio.hasMontonera).toBe(false);
    expect(desiredBroadcasts(normalizedObservation({ ...withoutStudio, startTimeUtc: '2026-08-26T12:45:00Z' }))[0].note)
      .toBeNull();
  });

  it('restringe La Montonera a las siete carreras masculinas autorizadas', () => {
    for (const race of [
      "Giro d'Italia", 'Tour de France', 'La Vuelta', 'UCI Road World Championships',
      'Milan-San Remo', 'Tour of Flanders', 'Paris-Roubaix',
    ]) expect(isMontoneraEligible(race, 'Stage 5 | Men')).toBe(true);
    expect(isMontoneraEligible("Giro d'Italia Women", 'Stage 5 | Women')).toBe(false);
    expect(isMontoneraEligible("Tour de l'Avenir", 'Stage 5 | Men')).toBe(false);
    expect(isMontoneraEligible('Liège-Bastogne-Liège', 'Men')).toBe(false);
  });

  it('normaliza a minuto los segundos residuales de una fuente', () => {
    expect(normalizedObservation({
      source: 'hbo_max', externalEventId: 'event', dateKey: '2026-08-26',
      title: 'La Vuelta', startTimeUtc: '2026-08-26T12:45:05.872Z',
      sourceUrl: 'https://www.hbomax.com/es/es/sports/cycling',
      broadcastUrl: 'https://play.hbomax.com/sport/event',
    }).startTimeUtc).toBe('2026-08-26T12:45:00.000Z');
  });

  it('extrae RTVE, convierte a UTC y conserva la primera emisión frente a la repetición', () => {
    const events = parseRtveGuide(fixture('rtve-guide.html'), {
      channel: 'Teledeporte', referenceDate: '2026-08-26',
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      dateKey: '2026-08-26', sourceChannel: 'Teledeporte', channel: 'RTVE',
      stageNumber: 5, startTimeUtc: '2026-08-26T12:35:00.000Z',
    });
    expect(zonedTimeToUtc('2026-12-15', '14:30')).toBe('2026-12-15T13:30:00.000Z');
  });

  it('falla de forma explícita si RTVE no devuelve ciclismo', async () => {
    await expect(collectRtve(async () => '<html></html>')).rejects.toThrow(/RTVE no devolvió/);
  });

  it('limita RTVE a la ventana operativa de ayer a ocho días', async () => {
    const fetcher = async () => fixture('rtve-structured-tdp.html');
    await expect(collectRtve(fetcher, new Date('2026-08-25T12:00:00Z')))
      .resolves.toHaveLength(1);
    await expect(collectRtve(fetcher, new Date('2026-08-30T12:00:00Z')))
      .rejects.toThrow(/ventana -1\/\+8 días/);
  });

  it('mantiene una emisión TDP y anota el relevo posterior a La 2 o La 1', () => {
    const tdp = parseRtveStructuredGuide(fixture('rtve-structured-tdp.html'))[0];
    const la2 = parseRtveStructuredGuide(fixture('rtve-structured-la2.html'))[0];
    const la1 = parseRtveStructuredGuide(fixture('rtve-structured-la1.html'))[0];
    expect([tdp.channel, la2.channel, la1.channel]).toEqual([
      'TDP / RTVE Play', 'TDP / RTVE Play', 'TDP / RTVE Play',
    ]);
    expect(new Set([tdp.externalEventId, la2.externalEventId, la1.externalEventId]).size).toBe(1);
    expect(la2).toMatchObject({
      startTimeUtc: '2026-08-26T14:00:00.000Z', note: 'Pasa a La 2 a las 17:00.',
    });
    expect(la1).toMatchObject({
      startTimeUtc: '2026-08-26T14:00:00.000Z', note: 'Pasa a La 1 a las 17:15.',
    });
    expect(desiredBroadcasts(la2)).toEqual([
      expect.objectContaining({ channel: 'TDP / RTVE Play', note: 'Pasa a La 2 a las 17:00.' }),
    ]);
    expect(parseRtveStructuredGuide(fixture('rtve-structured-la2-only.html'))).toEqual([]);
  });

  it('extrae solo etapas íntegras publicadas del catálogo de La Vuelta en RTVE Play', () => {
    expect(parseRtveVueltaVideos(fixture('rtve-vuelta-videos.json'))).toEqual([
      expect.objectContaining({
        externalEventId: 'vuelta-replay-17201825', dateKey: '2026-08-25', stageNumber: 4,
        channel: 'RTVE', reviveCapable: true, finalizeReplay: true,
      }),
      expect.objectContaining({
        externalEventId: 'vuelta-replay-17200584', dateKey: '2026-08-24', stageNumber: 3,
      }),
    ]);
  });

  it('consulta el catálogo Revive solo para etapas candidatas y conserva la hora del directo', async () => {
    await expect(collectRtveVueltaReplays([], async () => { throw new Error('no debe consultar'); }))
      .resolves.toEqual([]);
    const observations = await collectRtveVueltaReplays([{
      dateKey: '2026-08-24', stageNumber: 3, startTimeUtc: '2026-08-24T12:50:00.000Z',
    }], async () => fixture('rtve-vuelta-videos.json'));
    expect(observations).toEqual([expect.objectContaining({
      stageNumber: 3, startTimeUtc: '2026-08-24T12:50:00.000Z',
      broadcastUrl: expect.stringContaining('/17200584/'), finalizeReplay: true,
    })]);
  });

  it('abre la búsqueda de Revive 90 minutos después de la meta estimada', async () => {
    const calls = [];
    const client = { query: async (...args) => { calls.push(args); return { rows: [] }; } };
    await loadRtveVueltaReplayCandidates(client, new Date('2026-08-26T17:00:00Z'));
    expect(calls[0][0]).toContain(`d."estimatedFinishTimeUtc" <= $2::timestamptz - interval '90 minutes'`);
    expect(calls[0][0]).toContain(`r.name = 'La Vuelta'`);
    expect(calls[0][1]).toEqual([2026, '2026-08-26T17:00:00.000Z']);
  });

  it('finaliza la fila RTVE con enlace específico, Revive y bloqueo sin alterar hora ni nota', async () => {
    const calls = [];
    const current = {
      id: 'rtve-5', raceDayId: 'day-5', channel: 'TDP / RTVE Play', country: 'ES',
      startTimeUtc: '2026-08-26T12:50:00.000Z', url: 'https://www.rtve.es/play/teledeporte/directo/',
      note: 'Pasa a La 2 a las 16:15.', sortOrder: 0, showInRevive: false, automationLocked: false,
    };
    const client = { query: async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT observed_at')) return { rows: [{ observed_at: '2026-08-26T18:00:00Z' }] };
      if (sql.includes('FROM public.broadcasts WHERE id')) return { rows: [current] };
      return { rows: [] };
    } };
    const action = await applyRtveVueltaReplay(client, {
      source: 'rtve', externalEventId: 'vuelta-replay-5', sourceHash: 'hash',
      sourceUrl: 'https://www.rtve.es/api/programas/144990/videos.json',
      broadcastUrl: 'https://www.rtve.es/play/videos/vuelta-ciclista-a-espana/etapa-5/1/',
    }, { raceDayId: 'day-5' }, { broadcasts: [current] });
    expect(action).toBe('applied_update');
    const update = calls.find(([sql]) => sql.includes(`SET channel='RTVE'`));
    expect(update[0]).toContain(`"showInRevive"=true, "automationLocked"=true`);
    expect(update[1]).toEqual(['rtve-5', expect.stringContaining('/etapa-5/1/')]);
  });

  const liveIt = process.env.BROADCASTS_LIVE_TEST === '1' ? it : it.skip;
  liveIt('valida los contratos públicos actuales de HBO Max y RTVE', async () => {
    const [hbo, rtve, replays] = await Promise.all([
      collectHbo(), collectRtve(), collectRtveVueltaReplays([{
        dateKey: '2026-08-25', stageNumber: 4, startTimeUtc: '2026-08-25T12:25:00.000Z',
      }]),
    ]);
    expect(hbo.length).toBeGreaterThan(0);
    expect(rtve.length).toBeGreaterThan(0);
    expect(replays).toEqual([expect.objectContaining({
      externalEventId: 'vuelta-replay-17201825', finalizeReplay: true,
    })]);
    expect(hbo.every((item) => item.startTimeUtc.endsWith('Z'))).toBe(true);
    expect(rtve.every((item) => item.startTimeUtc.endsWith('Z'))).toBe(true);
  });

  it('solo empareja una jornada única por fecha, carrera y etapa', () => {
    const observation = {
      title: 'Ciclismo Vuelta a España Etapa 5', subtitle: 'La Vuelta',
      dateKey: '2026-08-26', stageNumber: 5,
    };
    const match = matchObservation(observation, [
      { raceDayId: 'day-4', raceId: 'race', dateKey: '2026-08-25', stageNumber: 4, name: 'La Vuelta', gender: 'male' },
      { raceDayId: 'day-5', raceId: 'race', dateKey: '2026-08-26', stageNumber: 5, name: 'La Vuelta', gender: 'male' },
    ]);
    expect(match).toMatchObject({ status: 'matched', raceDayId: 'day-5' });
  });

  it('rechaza empates entre carreras de la misma fecha', () => {
    const observation = { title: 'Tour de France', dateKey: '2026-07-01', stageNumber: null };
    const match = matchObservation(observation, [
      { raceDayId: 'a', raceId: 'a', dateKey: '2026-07-01', stageNumber: null, name: 'Tour de France', gender: 'male' },
      { raceDayId: 'b', raceId: 'b', dateKey: '2026-07-01', stageNumber: null, name: 'Tour de France', gender: 'male' },
    ]);
    expect(match.status).toBe('ambiguous');
  });

  it('clasifica como unmatched una emisión sin carrera compatible', () => {
    expect(matchObservation(
      { title: 'Carrera inexistente', dateKey: '2026-08-26', stageNumber: null },
      [{ raceDayId: 'x', dateKey: '2026-08-26', name: 'La Vuelta', gender: 'male' }],
    ).status).toBe('unmatched');
  });

  it('solo carga jornadas publicadas que no sean descanso ni estén canceladas', () => {
    expect(runnerSource).toContain(`d."editorialStatus" = 'published'`);
    expect(runnerSource).toContain('NOT COALESCE(d."isRestDay", false)');
    expect(runnerSource).toContain('NOT COALESCE(d."isCancelledDay", false)');
  });

  it('confirma tvStatus dentro de las ramas de alta y actualización', async () => {
    const calls = [];
    await confirmTvStatus({ query: async (...args) => calls.push(args) }, 'day-5');
    expect(calls).toEqual([[
      expect.stringContaining(`"tvStatus"='confirmed_time'`), ['day-5'],
    ]]);
    expect(calls[0][0]).toContain(`"tvStatus" IS DISTINCT FROM 'confirmed_time'`);
    expect(runnerSource.match(/await confirmTvStatus\(client, match\.raceDayId\);/g)).toHaveLength(2);
  });

  it('mantiene activado el modo apply en la unidad de producción', () => {
    expect(serviceSource).toContain('broadcasts-sync.mjs --apply-sources=hbo_max,rtve,sporza');
    expect(serviceSource).not.toContain('rtve,sporza,eitb');
  });

  it('conserva las IDs de emisiones en la caché tras guardar el panel', () => {
    expect(panelSource).toContain(
      'const savedBcasts = newBroadcasts.map(({ raceDayId: _raceDayId, ...broadcast }) => broadcast);',
    );
    expect(panelSource).not.toContain("acc.push({ id: '', channel: channel || null");
  });

  it('mantiene EITB y Sporza en sombra al incorporarlos al sondeo', () => {
    expect(runnerSource).toContain("new Set(['hbo_max', 'rtve', 'eitb', 'sporza'])");
    expect(desiredBroadcasts({
      source: 'sporza', channel: 'Sporza (één)', country: 'BE',
      startTimeUtc: '2026-08-25T12:30:00.000Z', broadcastUrl: 'https://sporza.be/live',
      insertSortOrder: 10,
    })).toEqual([expect.objectContaining({ country: 'BE', insertSortOrder: 10 })]);
  });

  it('no habilita una escritura EITB sin deep-link de ETB ON', async () => {
    const fetcher = async () => ({
      ok: true, status: 200, text: async () => fixture('eitb-schedule.html'),
    });
    const observations = await collectEitb(new Date('2026-08-20T12:00:00Z'), {
      fetcher,
      dateKeys: ['2026-08-20'],
      channels: [{ channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1', channel: 'ETB1' }],
    });
    expect(observations.find((item) => item.stageNumber === 5)).toMatchObject({
      writeEligible: false,
      broadcastUrl: 'https://www.eitb.eus/eu/kirolak/txirrindularitza/itzulia/',
    });
  });

  it('declara Revive en EITB ON y permite a futuras fuentes hacerlo mediante datos', () => {
    expect(desiredBroadcasts({
      source: 'eitb', channel: 'ETB1', country: 'ES',
      startTimeUtc: '2026-08-25T13:00:00.000Z', broadcastUrl: 'https://etbon.eus/m/etapa-4',
      reviveCapable: true,
    })).toEqual([expect.objectContaining({ showInRevive: true })]);
    expect(desiredBroadcasts({
      source: 'future_source', channel: 'FloBikes', country: 'US_CA',
      startTimeUtc: '2026-08-25T13:00:00.000Z', broadcastUrl: 'https://video.example/replay',
      reviveCapable: true,
    })).toEqual([expect.objectContaining({ showInRevive: true })]);
  });

  it('preserva el orden manual y los enlaces directos existentes de RTVE', () => {
    const current = {
      id: 'rtve', sortOrder: 0, note: null,
      url: 'https://www.rtve.es/play/videos/directo/ciclismo-vuelta-etapa-4/',
    };
    expect(mergeManagedBroadcast(current, {
      channel: 'TDP / RTVE Play', startTimeUtc: '2026-08-25T12:25:00.000Z',
      url: 'https://www.rtve.es/play/teledeporte/directo/', insertSortOrder: -30,
      note: 'Pasa a La 1 a las 15:50.',
    }, 'rtve')).toMatchObject({
      sortOrder: 0,
      url: current.url,
      note: 'Pasa a La 1 a las 15:50.',
    });
  });

  it('actualiza HBO sin borrar notas ni alterar el orden existente', () => {
    const current = { id: 'hbo', sortOrder: 1, note: 'La Montonera al terminar.', url: 'https://play.hbomax.com/sport/old' };
    expect(mergeManagedBroadcast(current, {
      channel: 'Eurosport (HBO Max)', country: 'EUROPA',
      startTimeUtc: '2026-08-26T12:45:00.000Z',
      url: 'https://play.hbomax.com/sport/new', insertSortOrder: -20, hasMontonera: true,
    }, 'hbo_max')).toMatchObject({
      sortOrder: 1, note: 'La Montonera al terminar.', url: 'https://play.hbomax.com/sport/new',
    });
  });

  it('activa Revive desde la fuente sin retirar una marca editorial existente', () => {
    const base = {
      id: 'broadcast', sortOrder: 1, note: null, url: 'https://video.example/old',
      showInRevive: false,
    };
    expect(mergeManagedBroadcast(base, {
      channel: 'ETB1', country: 'ES', startTimeUtc: '2026-08-26T12:45:00.000Z',
      url: 'https://etbon.eus/m/etapa-5', showInRevive: true,
    }, 'eitb').showInRevive).toBe(true);
    expect(mergeManagedBroadcast({ ...base, showInRevive: true }, {
      channel: 'Canal', country: 'ES', startTimeUtc: '2026-08-26T12:45:00.000Z',
      url: 'https://video.example/new', showInRevive: false,
    }, 'future_source').showInRevive).toBe(true);
  });

  it('gestiona solo la frase de La Montonera y conserva cualquier otra nota', () => {
    expect(withMontoneraNote('Solo audio ambiente.', true))
      .toBe('Solo audio ambiente. La Montonera al terminar.');
    expect(withMontoneraNote('Solo audio ambiente. La Montonera al terminar.', false))
      .toBe('Solo audio ambiente.');
    expect(withMontoneraNote('La Montonera al terminar.', false)).toBeNull();
  });

  it('trata como unchanged los mismos campos aunque cambie el orden del array', () => {
    const eu = {
      id: 'eu', channel: 'Eurosport (HBO Max)', country: 'EUROPA',
      startTimeUtc: '2026-08-26T12:45:00.000Z',
      url: 'https://play.hbomax.com/sport/event', note: 'La Montonera al terminar.',
    };
    const uk = {
      id: 'uk', channel: 'TNT Sports (HBO Max)', country: 'UK_IE',
      startTimeUtc: '2026-08-26T12:45:00.000Z',
      url: 'https://www.hbomax.com/gb/en/sports/cycling', note: null,
    };
    const current = [uk, eu];
    const desiredById = [eu, uk];
    expect(current.every((row) => sameManagedState(
      row, desiredById.find((desired) => desired.id === row.id),
    ))).toBe(true);
  });

  it('adopta únicamente una pareja HBO canónica completa y sin duplicados', () => {
    const observation = {
      source: 'hbo_max',
      sourceUrl: 'https://www.hbomax.com/es/es/sport/2026-8-26/uuid',
      broadcastUrl: 'https://play.hbomax.com/sport/uuid',
    };
    const desired = desiredBroadcasts({
      ...observation, startTimeUtc: '2026-08-26T12:45:00.000Z',
    });
    const pair = [
      { id: 'eu', channel: 'Eurosport (HBO Max)', country: 'EUROPA' },
      { id: 'uk', channel: 'TNT Sports (HBO Max)', country: 'UK_IE' },
    ];
    expect(adoptionCandidate(observation, desired, pair)).toMatchObject({ status: 'adoptable' });
    expect(adoptionCandidate(observation, desired, pair.slice(0, 1))).toMatchObject({ status: 'conflict' });
    expect(adoptionCandidate(observation, desired, [...pair, { ...pair[0], id: 'eu-2' }]))
      .toMatchObject({ status: 'conflict' });
  });

  it('no adopta ni modifica una emisión bloqueada desde el panel', () => {
    const observation = {
      source: 'hbo_max',
      sourceUrl: 'https://www.hbomax.com/es/es/sport/2026-8-26/uuid',
      broadcastUrl: 'https://play.hbomax.com/sport/uuid',
    };
    const desired = desiredBroadcasts({
      ...observation, startTimeUtc: '2026-08-26T12:45:00.000Z',
    });
    expect(adoptionCandidate(observation, desired, [
      { id: 'eu', channel: 'Eurosport (HBO Max)', country: 'EUROPA', automationLocked: true },
      { id: 'uk', channel: 'TNT Sports (HBO Max)', country: 'UK_IE' },
    ])).toMatchObject({ status: 'manual_lock' });
    expect(runnerSource).toContain('current.some((row) => row.automationLocked === true)');
  });

  it('adopta una única fila RTVE heredada con host oficial para normalizar el canal', () => {
    const observation = {
      source: 'rtve', sourceUrl: 'https://www.rtve.es/play/guia-tve/',
      broadcastUrl: 'https://www.rtve.es/play/videos/directo/la-2/',
    };
    const desired = [{ channel: 'La 2 / RTVE Play', country: 'ES' }];
    expect(adoptionCandidate(observation, desired, [
      { id: 'legacy', channel: 'RTVE', country: 'ES', url: 'https://www.rtve.es/play/teledeporte/ciclismo/' },
    ])).toMatchObject({ status: 'adoptable' });
    expect(adoptionCandidate(observation, desired, [
      { id: 'legacy', channel: 'RTVE', country: 'ES', url: 'https://example.com/stream' },
    ])).toMatchObject({ status: 'none' });
  });
});
