import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RTVE_LIVES_URL,
  decodeHtml, desiredBroadcasts, hboSharedEventVariants, matchObservation, parseHboCatalog, parseHboEventStart,
  isMontoneraEligible, normalizedObservation,
  parseRtveGuide, parseRtvePlayLives, parseRtveStructuredGuide,
  parseRtveVueltaScheduleArticle, parseRtveVueltaVideos, rtveRaceHintMatch, rtveVueltaExternalEventId, zonedTimeToUtc,
} from '../../scripts/broadcasts-sync/broadcasts-sync-core.mjs';
import {
  adoptionCandidate, applyOne, applyRtveVueltaReplay, collectEitb, collectRtve,
  collectRtbf, collectRtveVueltaReplays, confirmTvStatus, loadRtveVueltaReplayCandidates,
  mergeManagedBroadcast, preferredRtveOneDayObservations, rtveOneDayExternalEventId, sameManagedState,
  scopedObservation, withMontoneraNote, withRtbfTransitionNote,
} from '../../scripts/broadcasts-sync/broadcasts-sync.mjs';
import { summarizeBroadcastSource } from '../../scripts/broadcasts-sync/broadcasts-vps-runner.mjs';

const fixture = (name) => readFileSync(
  fileURLToPath(new URL(`../../scripts/broadcasts-sync/fixtures/${name}`, import.meta.url)),
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

  it('decodifica los escapes Unicode literales del catálogo HBO', () => {
    expect(decodeHtml('GP Industria \\u0026 Artigianato')).toBe('GP Industria & Artigianato');
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
      fixture('hbo-cycling.html').replace('La Vuelta | La Montonera', 'La Vuelta | Highlights'),
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

  it('extrae los directos de RTVE Play, descarta otros deportes y conserva la marca UTC', () => {
    expect(parseRtvePlayLives(fixture('rtve-play-lives.json'))).toEqual([
      expect.objectContaining({
        dateKey: '2026-09-20', localStartTime: '14:50',
        startTimeUtc: '2026-09-20T12:50:00.000Z', disciplineKey: 'cri|elite|femenino',
      }),
      expect.objectContaining({
        dateKey: '2026-09-20', localStartTime: '18:35',
        startTimeUtc: '2026-09-20T16:35:00.000Z', disciplineKey: 'cri|elite|masculino',
      }),
    ]);
  });

  it('no cruza la hora de RTVE Play entre pruebas distintas del mismo día', () => {
    expect(rtveRaceHintMatch(
      'Campeonato del Mundo en carretera',
      'Ciclismo Campeonato Del Mundo En Carretera Cri Elite Individual Femenina',
    )).toBe(true);
    expect(rtveRaceHintMatch(
      'Campeonato del Mundo en carretera',
      'Ciclismo Clasica De Almeria Femenina',
    )).toBe(false);
  });

  it('empareja la abreviatura RTVE de prueba en carretera con la carrera en línea y conserva el filtro de género', () => {
    const observation = {
      source: 'rtve', dateKey: '2026-09-24', stageNumber: null,
      title: 'Ciclismo Cto Mundo Carretera Prueba Sub23 Femenina',
    };
    const womenRace = {
      raceDayId: 'worlds-u23w', raceId: 'race-worlds-u23w', dateKey: '2026-09-24',
      stageNumber: null, name: 'Campeonato del Mundo línea sub23 femenino',
      nameEn: "World Championships - Women's U23 RR", gender: 'female',
    };
    expect(matchObservation(observation, [womenRace])).toMatchObject({
      status: 'matched', raceDayId: 'worlds-u23w',
    });

    const wrongDayRace = {
      ...womenRace, raceDayId: 'worlds-u23m', raceId: 'race-worlds-u23m',
      dateKey: '2026-09-25', name: 'Campeonato del Mundo línea sub23 masculino',
      nameEn: "World Championships - Men's U23 RR", gender: 'male',
    };
    expect(matchObservation({ ...observation, dateKey: '2026-09-25' }, [wrongDayRace]))
      .toMatchObject({ status: 'unmatched' });
  });

  it('empareja HBO con la carrera masculina cuyo nombre lleva una glosa entre paréntesis', () => {
    const eneco = (overrides) => ({
      raceDayId: 'men-1', raceId: 'men', dateKey: '2026-10-14', stageNumber: 1,
      name: 'Eneco Tour (Vuelta a los Países Bajos)', nameEn: 'Eneco Tour (Tour of Holland)', gender: 'male', ...overrides,
    });
    const days = [eneco(), eneco({ raceDayId: 'women-1', raceId: 'women', name: 'Eneco Tour Women', nameEn: 'Eneco Tour Women', gender: 'female' })];
    const stage = { source: 'hbo_max', dateKey: '2026-10-14', stageNumber: 1, title: 'Eneco Tour | Stage 1' };
    expect(matchObservation({ ...stage, subtitle: 'Men | Ede (120km)' }, days)).toMatchObject({ status: 'matched', raceDayId: 'men-1' });
    expect(matchObservation({ ...stage, subtitle: 'Women | Ede (79.5km)' }, days)).toMatchObject({ status: 'matched', raceDayId: 'women-1' });

    const prologueDays = days.map((day) => ({ ...day, raceDayId: day.raceDayId.replace('-1', '-0'), dateKey: '2026-10-13', stageNumber: 0 }));
    const prologue = normalizedObservation({
      source: 'hbo_max', externalEventId: 'uuid', dateKey: '2026-10-13', stageNumber: null,
      title: 'Eneco Tour | Prologue', subtitle: 'Mixed | The Hague (3.1km, ITT)', startTimeUtc: '2026-10-13T15:50:00Z',
      broadcastUrl: 'https://play.hbomax.com/sport/uuid',
    });
    const variants = hboSharedEventVariants(prologue);
    expect(variants.map((variant) => [variant.externalEventId, matchObservation(variant, prologueDays).raceDayId]))
      .toEqual([['uuid', 'women-0'], ['uuid:men', 'men-0']]);
    expect(hboSharedEventVariants({ ...prologue, title: 'LJUBLJANA', subtitle: 'Mixed | Relay TTT' })).toEqual([]);
  });

  const worldsDay = (overrides) => ({
    raceDayId: 'day', raceId: 'race', dateKey: '2026-09-21', stageNumber: null,
    name: 'Campeonato del Mundo CRI sub23 femenino',
    nameEn: "World Championships - Women's U23 ITT", gender: 'female', ...overrides,
  });

  it('interpreta las abreviaturas Fem y Masc de la guía de Teledeporte', () => {
    const days = [
      worldsDay({ raceDayId: 'u23w' }),
      worldsDay({ raceDayId: 'u23m', name: 'Campeonato del Mundo CRI sub23 masculino', nameEn: "World Championships - Men's U23 ITT", gender: 'male' }),
    ];
    expect(matchObservation({
      source: 'rtve', dateKey: '2026-09-21', stageNumber: null,
      title: 'Ciclismo Cto Mundo Carretera Cri Sub23 Ind Fem',
    }, days)).toMatchObject({ status: 'matched', raceDayId: 'u23w' });
    expect(matchObservation({
      source: 'rtve', dateKey: '2026-09-21', stageNumber: null,
      title: 'Ciclismo Cto Mundo Carretera Cri Sub23 Ind Masc',
    }, days)).toMatchObject({ status: 'matched', raceDayId: 'u23m' });
  });

  it('no cruza la categoría sub23 con la élite del mismo día', () => {
    const days = [
      worldsDay({ raceDayId: 'elite', name: 'Campeonato del Mundo CRI masculino', nameEn: "World Championships - Men's ITT", gender: 'male' }),
      worldsDay({ raceDayId: 'u23', name: 'Campeonato del Mundo CRI sub23 masculino', nameEn: "World Championships - Men's U23 ITT", gender: 'male' }),
    ];
    expect(matchObservation({
      source: 'rtve', dateKey: '2026-09-21', stageNumber: null,
      title: 'Ciclismo Cto Mundo Carretera Cri Sub23 Ind Masc',
    }, days)).toMatchObject({ status: 'matched', raceDayId: 'u23' });
    expect(matchObservation({
      source: 'rtve', dateKey: '2026-09-21', stageNumber: null,
      title: 'Ciclismo Campeonato Del Mundo En Carretera Cri Elite Individual Masculino',
    }, days)).toMatchObject({ status: 'matched', raceDayId: 'elite' });
  });

  it('observa un directo de RTVE Play que la guía de Teledeporte aún no alcanza', async () => {
    const lives = JSON.stringify({ page: { items: [{
      id: 'worlds-men', antetitulo: 'CICLISMO', titulo: 'Campeonato del Mundo en carretera',
      descripcion: 'Elite masculina. Desde Montreal (Canadá)',
      inicio: '27-09-2026 14:50:00',
      htmlUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-elite-masculina-27-septiembre/',
    }] } });
    const observations = await collectRtve(async (url) => {
      if (url === RTVE_LIVES_URL) return lives;
      return '<html></html>';
    }, new Date('2026-09-25T12:00:00Z'));
    expect(observations).toEqual([expect.objectContaining({
      dateKey: '2026-09-27', startTimeUtc: '2026-09-27T12:50:00.000Z',
      broadcastUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-elite-masculina-27-septiembre/',
    })]);
    expect(matchObservation(observations[0], [
      worldsDay({ raceDayId: 'men', dateKey: '2026-09-27', name: 'Campeonato del Mundo línea masculino', nameEn: "World Championships - Men's RR", gender: 'male' }),
    ])).toMatchObject({ status: 'matched', raceDayId: 'men' });
  });

  it('converge guía y RTVE Play en una identidad por jornada y prefiere el directo específico', () => {
    const match = { status: 'matched', raceDayId: 'men' };
    const raceDay = { estimatedFinishTimeUtc: '2026-09-27T19:42:00.000Z' };
    const guide = scopedObservation(normalizedObservation({
      source: 'rtve', externalEventId: 'guide', dateKey: '2026-09-27', stageNumber: null,
      title: 'Ciclismo Cto Mundo Carretera Prueba Elite Masculina',
      startTimeUtc: '2026-09-27T12:55:00.000Z',
      broadcastUrl: 'https://www.rtve.es/play/teledeporte/directo/',
      sourceUrl: 'https://www.rtve.es/play/guia-tve/', channel: 'TDP / RTVE Play', country: 'ES',
    }), match, raceDay);
    const live = scopedObservation(normalizedObservation({
      source: 'rtve', externalEventId: 'live', dateKey: '2026-09-27', stageNumber: null,
      title: 'Campeonato del Mundo en carretera', startTimeUtc: '2026-09-27T12:50:00.000Z',
      broadcastUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-elite-masculina-27-septiembre/',
      sourceUrl: 'https://api.rtve.es/api/lives/peticiones.json', channel: 'TDP / RTVE Play', country: 'ES',
    }), match, raceDay);
    expect(guide.externalEventId).toBe(rtveOneDayExternalEventId('men'));
    expect(live.externalEventId).toBe(guide.externalEventId);
    const replay = scopedObservation(normalizedObservation({
      source: 'rtve', externalEventId: 'replay', dateKey: '2026-09-27', stageNumber: null,
      title: 'Ciclismo Cto Mundo Carretera Prueba Elite Masculina', startTimeUtc: '2026-09-27T21:30:00.000Z',
      broadcastUrl: 'https://www.rtve.es/play/teledeporte/directo/',
      sourceUrl: 'https://www.rtve.es/play/guia-tve/', channel: 'TDP / RTVE Play', country: 'ES',
    }), match, raceDay);
    expect(replay).toMatchObject({ writeEligible: false, shadowReason: 'Emisión posterior a la llegada estimada' });
    const kept = preferredRtveOneDayObservations([
      { observation: replay, match }, { observation: guide, match }, { observation: live, match },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].observation.broadcastUrl).toContain('/play/videos/directo/');
  });

  it('acepta como oficial un directo observado solo en la API de RTVE Play', () => {
    const observation = {
      source: 'rtve', sourceUrl: RTVE_LIVES_URL,
      broadcastUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-elite-masculina-27-septiembre/',
    };
    const row = {
      id: 'manual', country: 'ES', channel: 'TDP / RTVE Play', automationLocked: false,
      url: observation.broadcastUrl,
    };
    expect(adoptionCandidate(observation, [], [row])).toMatchObject({ status: 'adoptable' });
    expect(adoptionCandidate({ ...observation, sourceUrl: 'https://api.example.com/lives.json' }, [], [row]))
      .toMatchObject({ status: 'invalid_source' });
  });

  it('no desplaza la hora de una emisión RTVE ya iniciada', () => {
    const current = {
      id: 'rtve', sortOrder: -30, note: null, startTimeUtc: '2026-09-24T12:50:00.000Z',
      url: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-sub-23-femenino-24-septiembre/',
    };
    expect(mergeManagedBroadcast(current, {
      channel: 'TDP / RTVE Play', country: 'ES', startTimeUtc: '2026-09-24T12:55:00.000Z',
      url: 'https://www.rtve.es/play/teledeporte/directo/',
    }, 'rtve', new Date('2026-09-24T17:00:00Z'))).toMatchObject({
      startTimeUtc: '2026-09-24T12:50:00.000Z', url: current.url,
    });
  });

  it('usa el directo específico de RTVE Play cuando la guía escribe Sub23 sin espacio', async () => {
    const guide = `<script>{"nombreCanal":"Teledeporte","uidCanal":"tv-teledeporte","items":[{"name":"CICLISMO CAMPEONATO DEL MUNDO EN CARRETERA","begintime":"20260924145500","original_event_name":"Ciclismo Cto Mundo Carretera Prueba Sub23 Femenina","original_episode_name":"Ciclismo Cto Mundo Carretera Prueba Sub23 Femenina","orden":1}],"canal":{"id":"tdp"}}</script>`;
    const lives = JSON.stringify({ page: { items: [{
      id: '87758', antetitulo: 'CICLISMO', titulo: 'Campeonato del Mundo en carretera',
      descripcion: 'Sub-23 femenina. Desde Montreal (Canadá)',
      inicio: '24-09-2026 14:50:00',
      htmlUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-sub-23-femenino-24-septiembre/',
    }] } });
    const observations = await collectRtve(async (url) => {
      if (url === RTVE_LIVES_URL) return lives;
      if (url.includes('/guia-tve/')) return guide;
      return '<html></html>';
    }, new Date('2026-09-23T12:00:00Z'));

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      dateKey: '2026-09-24', stageNumber: null,
      startTimeUtc: '2026-09-24T12:50:00.000Z',
      broadcastUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-sub-23-femenino-24-septiembre/',
    });
    expect(matchObservation(observations[0], [{
      raceDayId: 'worlds-u23w', raceId: 'race-worlds-u23w', dateKey: '2026-09-24',
      stageNumber: null, name: 'Campeonato del Mundo línea sub23 femenino',
      nameEn: "World Championships - Women's U23 RR", gender: 'female',
    }])).toMatchObject({ status: 'matched', raceDayId: 'worlds-u23w' });
  });

  it('toma la hora de RTVE Play para eventos de un día en lugar del hueco lineal de Teledeporte', async () => {
    const observations = await collectRtve(async (url) => {
      if (url === RTVE_LIVES_URL) return fixture('rtve-play-lives.json');
      if (url.includes('/guia-tve/')) return fixture('rtve-structured-worlds.html');
      return '<html></html>';
    }, new Date('2026-09-18T12:00:00Z'));
    expect(observations).toEqual([
      expect.objectContaining({
        dateKey: '2026-09-20',
        startTimeUtc: '2026-09-20T12:50:00.000Z',
        broadcastUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-contrarreloj-femenino-20-septiembre/',
      }),
      expect.objectContaining({
        dateKey: '2026-09-20',
        startTimeUtc: '2026-09-20T16:35:00.000Z',
        broadcastUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-contrarreloj-masculino-20-septiembre/',
      }),
    ]);
  });

  it('no interpreta el número de episodio del relevo mundialista como etapa y adopta el directo de Play', async () => {
    const guide = `<script>{"nombreCanal":"Teledeporte","uidCanal":"tv-teledeporte","items":[{"name":"CICLISMO CAMPEONATO DEL MUNDO EN CARRETERA","begintime":"20260922150000","original_event_name":"Ciclismo Cto Mundo Carretera Relevos Mixtos","original_episode_name":"Ciclismo Cto Mundo Carretera Relevos Mixtos","episode_number":"5","orden":1}],"canal":{"id":"tdp"}}</script>`;
    const lives = JSON.stringify({ page: { items: [{
      id: 'worlds-mixed-relay', antetitulo: 'CICLISMO',
      titulo: 'Campeonato del Mundo en carretera',
      descripcion: 'Relevos mixtos. Desde Montreal (Canadá)',
      inicio: '22-09-2026 14:20:00',
      htmlUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-relevos-mixtos-22-septiembre/',
    }] } });
    const observations = await collectRtve(async (url) => {
      if (url === RTVE_LIVES_URL) return lives;
      if (url.includes('/guia-tve/')) return guide;
      return '<html></html>';
    }, new Date('2026-09-21T12:00:00Z'));
    const observation = observations.find((item) => item.dateKey === '2026-09-22');

    expect(observations).toHaveLength(1);
    expect(observation).toMatchObject({
      stageNumber: null,
      startTimeUtc: '2026-09-22T12:20:00.000Z',
      broadcastUrl: 'https://www.rtve.es/play/videos/directo/ciclismo-mundial-carretera-relevos-mixtos-22-septiembre/',
    });
    expect(matchObservation(observation, [{
      raceDayId: 'worlds-mixed', raceId: 'race-worlds-mixed', dateKey: '2026-09-22',
      stageNumber: null, name: 'Campeonato del Mundo CRE relevo mixto',
      nameEn: 'World Championships - Mixed Relay TTT', gender: null,
    }])).toMatchObject({ status: 'matched', raceDayId: 'worlds-mixed' });
  });

  it('usa la programación específica de La Vuelta cuando la guía general conserva una reposición del descanso', async () => {
    const schedule = `
      <article><h1>Vuelta España 2026: Hora y dónde ver gratis las etapas</h1>
      <p>Etapa 9: Domingo 30 de agosto. Villajoyosa – Alto de Aitana.
      Desde las 12:00 horas en Teledeporte y RTVE Play y desde las 15:55 horas en La 1.</p>
      <p>Etapa 10: Martes 1 de septiembre. Alcaraz – Elche de la Sierra.
      Desde las 14:50 horas en Teledeporte y RTVE Play y desde las 16:15 horas en La 2.</p></article>`;
    expect(parseRtveVueltaScheduleArticle(schedule)).toEqual([
      expect.objectContaining({ dateKey: '2026-08-30', stageNumber: 9 }),
      expect.objectContaining({
        dateKey: '2026-09-01', stageNumber: 10,
        startTimeUtc: '2026-09-01T12:50:00.000Z',
        channel: 'TDP / RTVE Play', note: 'Pasa a La 2 a las 16:15.',
      }),
    ]);
    const observations = await collectRtve(async (url) => (
      url.includes('/guia-tve/') ? '<html></html>' : schedule
    ), new Date('2026-09-01T07:00:00Z'));
    expect(observations).toEqual([
      expect.objectContaining({ dateKey: '2026-09-01', stageNumber: 10 }),
    ]);
  });

  it('mantiene una identidad RTVE canónica cuando la guía diaria sustituye al artículo de La Vuelta', async () => {
    const schedule = `
      <article><h1>Vuelta España 2026: Hora y dónde ver gratis las etapas</h1>
      <p>Etapa 5: Miércoles 26 de agosto. Falset – Roquetes.
      Desde las 16:20 horas en Teledeporte y RTVE Play.</p></article>`;
    const observations = await collectRtve(async (url) => (
      url.includes('/guia-tve/') ? fixture('rtve-structured-tdp.html') : schedule
    ), new Date('2026-08-26T07:00:00Z'));
    expect(observations).toEqual([
      expect.objectContaining({
        dateKey: '2026-08-26', stageNumber: 5,
        externalEventId: rtveVueltaExternalEventId('2026-08-26', 5),
        startTimeUtc: '2026-08-26T14:15:00.000Z',
        sourceUrl: 'https://www.rtve.es/play/guia-tve/',
      }),
    ]);
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

  it('empareja Larciano aunque HBO escape el ampersand y añada una preposición', () => {
    const match = matchObservation({
      title: 'GP Industria \\u0026 Artigianato di Larciano',
      subtitle: 'Men | Larciano (196.5km)', dateKey: '2026-09-06', stageNumber: null,
    }, [
      {
        raceDayId: 'larciano', raceId: 'race-larciano', dateKey: '2026-09-06', stageNumber: null,
        name: 'GP Industria & Artigianato-Larciano', gender: 'male',
      },
      {
        raceDayId: 'vuelta-15', raceId: 'race-vuelta', dateKey: '2026-09-06', stageNumber: 15,
        name: 'La Vuelta', gender: 'male',
      },
    ]);
    expect(match).toMatchObject({
      status: 'matched', raceDayId: 'larciano',
      evidence: { aliases: ['grand prix industria and artigianato larciano'] },
    });
  });

  it('equipara GP con Grand Prix en nombres largos como Québec', () => {
    const match = matchObservation({
      title: 'Grand Prix Cycliste de Quebec', subtitle: 'Men | Quebec City (206km)',
      dateKey: '2026-09-11', stageNumber: null,
    }, [
      {
        raceDayId: 'quebec', raceId: 'race-quebec', dateKey: '2026-09-11', stageNumber: null,
        name: 'GP Québec', gender: 'male',
      },
      {
        raceDayId: 'vuelta-19', raceId: 'race-vuelta', dateKey: '2026-09-11', stageNumber: 19,
        name: 'La Vuelta', gender: 'male',
      },
    ]);
    expect(match).toMatchObject({
      status: 'matched', raceDayId: 'quebec', evidence: { aliases: ['grand prix quebec'] },
    });
  });

  it('normaliza Gran Premio, Trophy y sufijos editoriales frente a los nombres de HBO Max', () => {
    const fourmies = matchObservation({
      title: 'Grand Prix de Fourmies', subtitle: 'Men', dateKey: '2026-09-13', stageNumber: null,
    }, [{
      raceDayId: 'fourmies', raceId: 'race-fourmies', dateKey: '2026-09-13', stageNumber: null,
      name: 'GP de Fourmies / La Voix du Nord', gender: 'male',
    }]);
    const matteotti = matchObservation({
      title: 'Matteotti Trophy', subtitle: 'Men', dateKey: '2026-09-14', stageNumber: null,
    }, [{
      raceDayId: 'matteotti', raceId: 'race-matteotti', dateKey: '2026-09-14', stageNumber: null,
      name: 'Trofeo Matteotti', gender: 'male',
    }]);

    expect(fourmies).toMatchObject({ status: 'matched', raceDayId: 'fourmies' });
    expect(matteotti).toMatchObject({ status: 'matched', raceDayId: 'matteotti' });
  });

  describe('nombres editoriales de HBO Max, RAI, Sporza, RTBF y L\'Équipe', () => {
    const day = (raceDayId, dateKey, name, gender, extra = {}) => ({
      raceDayId, raceId: `race-${raceDayId}`, dateKey, stageNumber: null, name, gender, ...extra,
    });
    const obs = (source, title, subtitle, dateKey, stageNumber = null) => ({ source, title, subtitle, dateKey, stageNumber });
    const abruzzo = [day('abruzzo-1', '2026-09-15', "Il Giro d'Abruzzo", 'male', { stageNumber: 1 })];
    const euroRrMen = day('euro-rr-m', '2026-10-04', 'Campeonato de Europa línea masculino', 'male',
      { nameEn: "European Championships - Men's Elite RR" });
    const euroU23 = [
      day('euro-u23-w', '2026-10-02', 'Campeonato de Europa línea sub23 femenino', 'female',
        { nameEn: "European Championships - Women's U23 RR", startLocation: 'Šenčur', finishLocation: null }),
      day('euro-u23-m', '2026-10-02', 'Campeonato de Europa línea sub23 masculino', 'male',
        { nameEn: "European Championships - Men's U23 RR", startLocation: 'Ljubljana', finishLocation: 'Šenčur' }),
      day('costa-rica-3', '2026-10-02', 'Vuelta Femenina a Costa Rica', 'female', { stageNumber: 3, startLocation: 'Ljubljana' }),
    ];
    const binche = [
      day('binche-w', '2026-10-06', 'Binche Chimay Binche pour Dames', 'female'),
      day('binche-m', '2026-10-06', 'Binche - Chimay - Binche / Mémorial Frank Vandenbroucke', 'male'),
    ];
    const worldsItt = [
      day('itt-w', '2026-09-20', 'Campeonato del Mundo CRI femenino', 'female', { nameEn: "World Championships - Women's Elite ITT" }),
      day('itt-m', '2026-09-20', 'Campeonato del Mundo CRI masculino', 'male', { nameEn: "World Championships - Men's Elite ITT" }),
    ];
    const parisTours = [
      day('paris-tours', '2026-10-11', 'París-Tours', 'male', { nameEn: 'Paris-Tours' }),
      day('paris-tours-u23', '2026-10-11', 'París-Tours sub23', 'male', { nameEn: 'Paris-Tours U23' }),
    ];
    const fourmies = [
      day('fourmies-men', '2026-09-13', 'GP de Fourmies / La Voix du Nord', 'male'),
      day('fourmies-women', '2026-09-13', 'La Choralis Fourmies Féminine', 'female'),
    ];
    const wallonie = [
      day('wallonie-men', '2026-09-16', 'Grand Prix de Wallonie', 'male'),
      day('wallonie-women', '2026-09-16', 'Grand Prix de Wallonie Dames', 'female'),
    ];

    // [observación, jornadas candidatas, raceDayId esperado o null si debe quedar unmatched]
    it.each([
      [obs('hbo_max', 'Faun Tour Femmes', 'Women | Stage 1', '2026-09-10', 1),
        [day('faun-1', '2026-09-10', "Faun Tour Femmes (Tour de l'Ardèche)", 'female', { stageNumber: 1 })], 'faun-1'],
      [obs('rai', "Ciclismo. Giro d'Abruzzo: 1a tappa", null, '2026-09-15', 1), abruzzo, 'abruzzo-1'],
      [obs('hbo_max', 'Tour of Abruzzo', 'Men | Stage 1', '2026-09-15', 1), abruzzo, 'abruzzo-1'],
      [obs('hbo_max', 'Tour of Luxembourg', 'Men | Stage 1', '2026-09-16', 1),
        [day('luxembourg-1', '2026-09-16', 'Skoda Tour de Luxembourg', 'male', { stageNumber: 1 })], 'luxembourg-1'],
      [obs('lequipe', '1re étape : Split - Seget Donji (167 km)', 'Tour de Croatie', '2026-09-22', 1),
        [day('cro-1', '2026-09-22', 'CRO Race', 'male', { stageNumber: 1 })], 'cro-1'],
      [obs('hbo_max', 'Flandrien 0.0 Classic', 'Men | Brakel - Haacht (119.4km)', '2026-09-19'),
        [day('flandrien', '2026-09-19', 'Flandrien 0.0 Classic (Super-8)', 'male')], 'flandrien'],
      [obs('hbo_max', 'Coppa Agostoni', 'Men | Lissone (166.7km)', '2026-10-04'),
        [day('agostoni', '2026-10-04', 'Coppa Agostoni - Giro delle Brianze', 'male'), euroRrMen], 'agostoni'],
      [obs('hbo_max', 'European Championships', 'Men', '2026-10-04'), [euroRrMen], null],
      [obs('hbo_max', 'LJUBLJANA', 'Women', '2026-10-02'), euroU23, 'euro-u23-w'],
      [obs('hbo_max', 'LJUBLJANA', 'Men', '2026-10-02'), euroU23, 'euro-u23-m'],
      [obs('hbo_max', 'MARIBOR', 'Men', '2026-10-02'), euroU23, null],
      [obs('rai', 'Ciclismo Europei Lubiana Under 23 donne', null, '2026-10-02'), euroU23, 'euro-u23-w'],
      [obs('hbo_max', 'Binche-Chimay-Binche', 'Women | Chimay – Binche (125km)', '2026-10-06'), binche, 'binche-w'],
      [obs('hbo_max', 'Binche-Chimay-Binche', 'Men | Binche (206.8km)', '2026-10-06'), binche, 'binche-m'],
      [obs('rai', 'Cronometro Uomini: gli Highlights | Mondiali di Ciclismo 2026', null, '2026-09-20'), worldsItt, 'itt-m'],
      [obs('rai', 'Mondiale di Ciclismo 2026 - Cronometro Juniores Donne', null, '2026-09-20'), worldsItt, null],
      [obs('rtbf', 'Championnats du Monde sur Route', 'Course en ligne Femmes', '2026-09-26'),
        [day('rr-w', '2026-09-26', 'Campeonato del Mundo línea femenino', 'female', { nameEn: "World Championships - Women's Elite RR" })], 'rr-w'],
      [obs('sporza', 'Parijs-Tours', 'UCI ProSeries', '2026-10-11'), parisTours, 'paris-tours'],
      [obs('hbo_max', 'UCI Road World Championships', 'Elite Mixed TTT | Montreal (40.6km)', '2026-09-22'),
        [day('worlds-mixed', '2026-09-22', 'Campeonato del Mundo CRE relevo mixto', null, { nameEn: 'World Championships - Mixed Relay TTT' })], 'worlds-mixed'],
      [obs('hbo_max', 'UCI Road World Championships', "U23 Women's Road Race | Montreal (134km)", '2026-09-24'),
        [day('worlds-u23w', '2026-09-24', 'Campeonato del Mundo línea sub23 femenino', 'female', { nameEn: "World Championships - Women's U23 RR" })], 'worlds-u23w'],
      [obs('sporza', 'ITT elite women', 'WK Montreal', '2026-09-20'),
        [day('worlds-itt-w', '2026-09-20', 'Campeonato del Mundo CRI femenino', 'female', { nameEn: "World Championships - Women's Elite ITT" })], 'worlds-itt-w'],
      [obs('sporza', 'road race elite men', 'WK Montreal', '2026-09-27'),
        [day('worlds-rr-m', '2026-09-27', 'Campeonato del Mundo línea masculino', 'male', { nameEn: "World Championships - Men's Elite RR" })], 'worlds-rr-m'],
      [obs('sporza', 'Ronde van Luxemburg', 'Etappe 3', '2026-09-18', 3),
        [day('lux-3', '2026-09-18', 'Skoda Tour de Luxembourg', 'male', { stageNumber: 3 })], 'lux-3'],
      [obs('hbo_max', 'Grand Prix de Fourmies', 'Women', '2026-09-13'), fourmies, 'fourmies-women'],
      [obs('hbo_max', 'Grand Prix de Fourmies', 'Men', '2026-09-13'), fourmies, 'fourmies-men'],
      [obs('hbo_max', 'Grand Prix de Wallonie', 'Women | Seraing – Namur (127.4km)', '2026-09-16'), wallonie, 'wallonie-women'],
      [obs('hbo_max', 'Grand Prix de Wallonie', 'Men | Seraing - Namur (196.7km)', '2026-09-16'), wallonie, 'wallonie-men'],
    ].map(([observation, days, expected]) => ({ observation, days, expected })))(
      '$observation.source: $observation.title · $observation.subtitle', ({ observation, days, expected }) => {
        expect(matchObservation(observation, days)).toMatchObject(
          expected ? { status: 'matched', raceDayId: expected } : { status: 'unmatched' },
        );
      },
    );
  });

  it('empareja los Europeos rotulados por Sporza, L\'Équipe y HBO Max', () => {
    const ek = (id, dateKey, name, nameEn, gender) => ({
      raceDayId: id, raceId: `race-${id}`, dateKey, stageNumber: null, name, nameEn, gender,
    });
    const days = [
      ek('u23w', '2026-10-02', 'Campeonato de Europa línea sub23 femenino', "European Championships - Women's U23 RR", 'female'),
      ek('u23m', '2026-10-02', 'Campeonato de Europa línea sub23 masculino', "European Championships - Men's U23 RR", 'male'),
      ek('rrw', '2026-10-03', 'Campeonato de Europa línea femenino', "European Championships - Women's Elite RR", 'female'),
      ek('rrm', '2026-10-04', 'Campeonato de Europa línea masculino', "European Championships - Men's Elite RR", 'male'),
      ek('mixed', '2026-10-06', 'Campeonato de Europa CRE relevo mixto', 'European Championships - Mixed Relay TTT', null),
      ek('ittw', '2026-10-07', 'Campeonato de Europa CRI femenino', "European Championships - Women's Elite ITT", 'female'),
      ek('ittm', '2026-10-07', 'Campeonato de Europa CRI masculino', "European Championships - Men's Elite ITT", 'male'),
      ek('ittu23w', '2026-10-07', 'Campeonato de Europa CRI sub23 femenino', "European Championships - Women's U23 ITT", 'female'),
      ek('ittu23m', '2026-10-07', 'Campeonato de Europa CRI sub23 masculino', "European Championships - Men's U23 ITT", 'male'),
    ];
    const cases = [
      ['sporza', 'road race U23 women', 'EK wielrennen', '2026-10-02', 'u23w'],
      ['sporza', 'road race U23 men', 'EK wielrennen', '2026-10-02', 'u23m'],
      ['sporza', 'road race elite women', 'EK wielrennen', '2026-10-03', 'rrw'],
      ['sporza', 'road race elite men', 'EK wielrennen', '2026-10-04', 'rrm'],
      ['sporza', 'Mixed team relay elite', 'EK wielrennen', '2026-10-06', 'mixed'],
      ['sporza', 'ITT elite women', 'EK wielrennen', '2026-10-07', 'ittw'],
      ['sporza', 'ITT elite men', 'EK wielrennen', '2026-10-07', 'ittm'],
      ['lequipe', 'Course en ligne U23 F (88,4 km)', "Championnats d'Europe", '2026-10-02', 'u23w'],
      ['lequipe', 'Course en ligne U23 H (141,9 km)', "Championnats d'Europe", '2026-10-02', 'u23m'],
      ['lequipe', 'Course en ligne Elite F  (130 km)', "Championnats d'Europe", '2026-10-03', 'rrw'],
      ['lequipe', 'Course  en ligne Elite H (196,3 km)', "Championnats d'Europe", '2026-10-04', 'rrm'],
      ['lequipe', 'Contre-la-montre Elite H', "Championnats d'Europe", '2026-10-07', 'ittm'],
      ['hbo_max', 'UEC Road European Championships', 'Women | Šenčur (ITT, 22.1 km)', '2026-10-07', 'ittw'],
      ['hbo_max', 'UEC Road European Championships', 'Men | Šenčur (ITT, 22.1 km)', '2026-10-07', 'ittm'],
    ];
    for (const [source, title, subtitle, dateKey, expected] of cases) {
      expect(matchObservation({ source, title, subtitle, dateKey, stageNumber: null }, days), `${source}: ${title}`)
        .toMatchObject({ status: 'matched', raceDayId: expected });
    }
    const lombardia = matchObservation({
      source: 'sporza', title: 'Ronde van Lombardije', subtitle: 'World Tour', dateKey: '2026-10-10', stageNumber: null,
    }, [ek('lombardia', '2026-10-10', 'Il Lombardia', 'Il Lombardia', 'male')]);
    expect(lombardia).toMatchObject({ status: 'matched', raceDayId: 'lombardia' });
  });

  it('exige tokens completos en las coincidencias parciales por palabras', () => {
    expect(matchObservation(
      { title: 'Cartagena Tour', dateKey: '2026-09-11', stageNumber: null },
      [{ raceDayId: 'art', dateKey: '2026-09-11', stageNumber: null, name: 'Tour Art', gender: 'male' }],
    ).status).toBe('unmatched');
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

  it('confirma tvStatus dentro de las ramas de alta y actualización', async () => {
    const calls = [];
    await confirmTvStatus({ query: async (...args) => calls.push(args) }, 'day-5');
    expect(calls).toEqual([[
      expect.stringContaining(`"tvStatus"='confirmed_time'`), ['day-5'],
    ]]);
    expect(calls[0][0]).toContain(`"tvStatus" IS DISTINCT FROM 'confirmed_time'`);
  });

  it('resume por fuente los cambios y fallos que consume el monitor', () => {
    expect(summarizeBroadcastSource('eitb', [
      { source: 'eitb', action: 'applied_insert', match: { status: 'matched' } },
      { source: 'eitb', action: 'unchanged', match: { status: 'matched' } },
    ])).toMatchObject({ status: 'success', itemsFound: 2, itemsMatched: 2, itemsChanged: 1, errors: 0 });
    expect(summarizeBroadcastSource('rtve', [
      { source: 'rtve', action: 'source_failure' },
    ])).toMatchObject({ status: 'error', itemsFound: 0, errors: 1 });
    expect(summarizeBroadcastSource('sporza', [
      { source: 'sporza', action: 'insufficient_broadcast_evidence', title: 'La Vuelta',
        dateKey: '2026-09-01', sourceUrl: 'https://sporza.be/nl/sport/wielrennen/~1/' },
    ])).toMatchObject({
      status: 'warning', itemsFound: 1, itemsMatched: 0,
      summary: { issues: [expect.objectContaining({ title: 'La Vuelta' })] },
    });
  });

  it('consulta por separado La Une y Tipik en la ventana histórica y futura', async () => {
    const calls = [];
    const payload = JSON.stringify({ status: 200, data: [] });
    await collectRtbf(new Date('2026-08-26T12:00:00Z'), {
      dateKeys: ['2026-08-22', '2026-08-27'],
      fetcher: async (url) => { calls.push(url); return payload; },
    });
    expect(calls).toHaveLength(2);
    expect(calls.map((url) => new URL(url).searchParams.get('channelIds'))).toEqual(['1', '33']);
    expect(calls.every((url) => url.includes('scheduledAfter=2026-08-22'))).toBe(true);
    expect(calls.every((url) => url.includes('scheduledBefore=2026-08-27'))).toBe(true);
  });

  it('no duplica una fila Sporza de otro canal en la misma jornada', () => {
    const observation = {
      source: 'sporza', sourceUrl: 'https://sporza.be/nl/livestream/',
      broadcastUrl: 'https://sporza.be/nl/livestream/',
    };
    const een = { id: 'een', channel: 'Sporza (één)', country: 'BE', url: 'https://sporza.be/nl/livestream/' };
    const stream = { ...een, id: 'stream', channel: 'Sporza' };
    expect(adoptionCandidate(observation, [{ channel: 'Sporza', country: 'BE' }], [een]))
      .toMatchObject({ status: 'conflict', rows: [een] });
    expect(adoptionCandidate(observation, [{ channel: 'Sporza (één)', country: 'BE' }], [stream]))
      .toMatchObject({ status: 'conflict' });
    expect(adoptionCandidate(observation, [{ channel: 'Sporza (één)', country: 'BE' }], [een, stream]))
      .toMatchObject({ status: 'adoptable', rows: [een] });
    expect(adoptionCandidate(observation, [{ channel: 'Sporza', country: 'BE' }], []))
      .toMatchObject({ status: 'none' });
  });

  it('adopta una única fila RTBF oficial y gestiona solo su nota de relevo', () => {
    const observation = {
      source: 'rtbf', sourceUrl: 'https://bff-service.rtbf.be/oaos/v1.6/schedulings',
      broadcastUrl: 'https://auvio.rtbf.be/live/cyclisme-la-vuelta-etape-5-744914',
    };
    const desired = [{ channel: 'Tipik / RTBF Auvio', country: 'BE' }];
    expect(adoptionCandidate(observation, desired, [{
      id: 'rtbf', channel: 'Tipik', country: 'BE',
      url: 'https://auvio.rtbf.be/live/cyclisme-la-vuelta-etape-5-744914',
    }])).toMatchObject({ status: 'adoptable' });
    expect(mergeManagedBroadcast({
      id: 'rtbf', sortOrder: 3, note: 'Solo en Bélgica. Pasa a La Une a las 14:00.',
      url: 'https://auvio.rtbf.be/live/cyclisme-la-vuelta-etape-5-744914',
    }, {
      channel: 'Tipik / RTBF Auvio', country: 'BE', startTimeUtc: '2026-08-26T12:50:00.000Z',
      url: 'https://auvio.rtbf.be/live/cyclisme-la-vuelta-etape-5-744914',
      note: '14:15 > La Une',
    }, 'rtbf')).toMatchObject({
      sortOrder: 3, note: 'Solo en Bélgica. 14:15 > La Une',
    });
    expect(withRtbfTransitionNote('Pasa a Tipik a las 13:00.', null)).toBeNull();
    expect(withRtbfTransitionNote('13:50 > La Une', '14:05 > La Une')).toBe('14:05 > La Une');
  });

  it('mantiene en sombra la parrilla lineal de EITB sin directo equivalente en ETB On', async () => {
    const fetcher = async () => ({
      ok: true, status: 200, text: async () => fixture('eitb-schedule.html'),
    });
    const observations = await collectEitb(new Date('2026-08-20T12:00:00Z'), {
      fetcher,
      etbonFetcher: async () => JSON.stringify({ children: [] }),
      dateKeys: ['2026-08-20'],
      channels: [{ channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1', channel: 'ETB1' }],
    });
    expect(observations.find((item) => item.stageNumber === 5)).toMatchObject({
      writeEligible: false,
      broadcastUrl: 'https://www.eitb.eus/eu/kirolak/txirrindularitza/itzulia/',
    });
  });

  it('habilita la parrilla lineal de EITB solo con directo y deep-link de ETB On', async () => {
    const directFixture = fixture('eitb-schedule.html').replace(
      '/eu/kirolak/txirrindularitza/itzulia/',
      'https://etbon.eus/m/itzulia-emakumeak-2026-3',
    );
    const observations = await collectEitb(new Date('2026-08-20T12:00:00Z'), {
      fetcher: async () => ({ ok: true, status: 200, text: async () => directFixture }),
      etbonFetcher: async () => JSON.stringify({ children: [] }),
      dateKeys: ['2026-08-20'],
      channels: [{ channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1', channel: 'ETB1' }],
    });
    expect(observations.find((item) => item.stageNumber === 5)).toMatchObject({
      writeEligible: true,
      broadcastUrl: 'https://etbon.eus/m/itzulia-emakumeak-2026-3',
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

  it('registra conflicto manual si una observación intenta readoptar una emisión ya vinculada', async () => {
    const calls = [];
    const existing = {
      id: 'rtve-day-11', raceDayId: 'day-11', channel: 'TDP / RTVE Play', country: 'ES',
      startTimeUtc: '2026-09-02T12:50:00.000Z', url: 'https://www.rtve.es/play/teledeporte/ciclismo/',
      note: null, sortOrder: 0, showInRevive: false, automationLocked: false,
    };
    const client = { query: async (sql, params) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT observed_at')) return { rows: [{ observed_at: '2026-09-01T14:22:00Z' }] };
      if (sql.includes('WHERE source=$1 AND external_event_id=$2 FOR UPDATE')) return { rows: [] };
      if (sql.includes('WHERE primary_broadcast_id = ANY')) return { rows: [{
        source: 'rtve', external_event_id: 'previous-event', race_day_id: 'day-11',
        primary_broadcast_id: existing.id, mirror_broadcast_id: null,
      }] };
      return { rows: [] };
    } };
    const action = await applyOne(client, {
      source: 'rtve', externalEventId: 'new-event', sourceHash: 'hash',
      sourceUrl: 'https://www.rtve.es/play/guia-tve/',
      broadcastUrl: 'https://www.rtve.es/play/teledeporte/directo/',
      startTimeUtc: '2026-09-02T12:45:00.000Z', channel: 'TDP / RTVE Play', country: 'ES',
    }, { raceDayId: 'day-11' }, { broadcasts: [existing] });
    expect(action).toBe('manual_conflict');
    expect(calls.some(([sql]) => sql.includes('INSERT INTO private.broadcast_source_links'))).toBe(false);
    expect(calls.find(([sql]) => sql.includes('INSERT INTO private.broadcast_source_observations'))?.[1])
      .toEqual(expect.arrayContaining(['manual_conflict', expect.stringContaining('rtve:previous-event')]));
  });
});
