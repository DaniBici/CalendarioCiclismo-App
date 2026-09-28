import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ETBON_PAGE_URLS, collectEtbon, etbonMediaApiUrl, isEtbonMediaUrl, mergeEtbonWithLinear,
  parseEtbonMedia, parseEtbonPageSlugs,
} from '../broadcasts-sync/etbon.mjs';
import { parseEitbSchedule, collectEitb as collectEitbSchedule } from '../broadcasts-sync/eitb.mjs';
import { matchObservation } from '../broadcasts-sync/broadcasts-sync-core.mjs';
import {
  adoptionCandidate, collectEitb, mergeManagedBroadcast, withLinearTransitionNote,
} from '../broadcasts-sync/broadcasts-sync.mjs';

const fixture = (name) => readFileSync(
  fileURLToPath(new URL(`../../scripts/broadcasts-sync/fixtures/${name}`, import.meta.url)),
  'utf8',
);

const MEDIA = {
  'txirrindularitza-cro-race-4-17942713': 'etbon-media-cro-race-4.json',
  'txirrindularitza-cro-race-5-17942714': 'etbon-media-cro-race-5.json',
  'erremontea-7-17775100': 'etbon-media-erremontea.json',
};

async function etbonFetcher(url) {
  if (url === ETBON_PAGE_URLS[0]) return fixture('etbon-kirolak-on.json');
  const slug = Object.keys(MEDIA).find((item) => url === etbonMediaApiUrl(item));
  if (slug) return fixture(MEDIA[slug]);
  throw new Error(`404 al consultar ${url}`);
}

const croRaceLinear = `<div id="tarde1"></div><ul>
  <li class="expandible"><p class="hora"> 15:20</p>
    <h2 class="titulo"><a href=""> Txirrindularitza; CRO Race - <span class="titulo_emision">4.etapa: Pula/Rijeka (160 km)</span></a></h2>
    <div class="detalles"><p class="entradilla"></p></div></li>
  <li class="expandible"><p class="hora"> 17:20</p>
    <h2 class="titulo"><a href=""> BIBA ZUEK! 2026/2027 - <span class="titulo_emision"></span></a></h2></li>
</ul>`;

describe('colector de directos de ETB On', () => {
  it('descubre directos y temporadas de ciclismo en la página de Kirolak On', () => {
    const slugs = parseEtbonPageSlugs(fixture('etbon-kirolak-on.json'));
    expect(slugs).toEqual(expect.arrayContaining([
      'txirrindularitza-cro-race-5-17942714',
      'txirrindularitza-cro-race-4-17942713',
      'txirrindularitza-5-17944016',
    ]));
    expect(slugs).not.toContain('estropadak-euskotren-liga-2026-19-18272813');
    expect(() => parseEtbonPageSlugs('{}')).toThrow(/Kirolak On/);
  });

  it('extrae la etapa, la hora UTC y el deep-link oficial de una ficha de ciclismo', () => {
    expect(parseEtbonMedia(fixture('etbon-media-cro-race-4.json'))).toMatchObject({
      source: 'eitb', dateKey: '2026-09-25', stageNumber: 4,
      title: 'Cro Race · 4.etapa: Pula-Rijeka (160 km)',
      startTimeUtc: '2026-09-25T12:00:01.000Z',
      broadcastUrl: 'https://etbon.eus/m/txirrindularitza-cro-race-4-17942713',
      channel: 'EITB', country: 'ES',
    });
    expect(parseEtbonMedia(fixture('etbon-media-erremontea.json'))).toBeNull();
  });

  it('descarta resúmenes y piezas cortas', () => {
    const media = JSON.parse(fixture('etbon-media-cro-race-5.json'));
    expect(parseEtbonMedia({ ...media, title: 'Laburpena: 5.etapa' })).toBeNull();
    expect(parseEtbonMedia({ ...media, duration: 600 })).toBeNull();
  });

  it('recorre las demás etapas de la temporada y limita el resultado a la ventana', async () => {
    const events = await collectEtbon({ fetcher: etbonFetcher, dateKeys: ['2026-09-25', '2026-09-26'] });
    expect(events.map((event) => [event.dateKey, event.stageNumber])).toEqual([
      ['2026-09-25', 4], ['2026-09-26', 5],
    ]);
  });

  it('reconoce únicamente deep-links de medios de ETB On', () => {
    expect(isEtbonMediaUrl('https://etbon.eus/m/txirrindularitza-cro-race-5-17942714')).toBe(true);
    expect(isEtbonMediaUrl('https://etbon.eus/ch/etb-1')).toBe(false);
    expect(isEtbonMediaUrl('https://www.youtube.com/watch?v=abc')).toBe(false);
  });
});

describe('combinación de ETB On con la parrilla lineal', () => {
  const linear = parseEitbSchedule(croRaceLinear, {
    dateKey: '2026-09-25', channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1',
  });

  it('anota el relevo a ETB1 cuando la señal lineal entra después del directo', () => {
    const event = parseEtbonMedia(fixture('etbon-media-cro-race-4.json'));
    const { events, unpairedLinear } = mergeEtbonWithLinear([event], linear);
    expect(events[0]).toMatchObject({ channel: 'EITB', note: 'Pasa a ETB1 a las 15:20.' });
    expect(unpairedLinear).toEqual([]);
  });

  it('usa el canal lineal cuando empieza a la vez que ETB On', () => {
    const event = { ...parseEtbonMedia(fixture('etbon-media-cro-race-4.json')), startTimeUtc: '2026-09-25T13:18:00.000Z' };
    expect(mergeEtbonWithLinear([event], linear).events[0]).toMatchObject({ channel: 'ETB1', note: null });
  });

  it('no enlaza una emisión lineal posterior al final del directo', () => {
    const event = {
      ...parseEtbonMedia(fixture('etbon-media-cro-race-4.json')),
      startTimeUtc: '2026-09-25T10:00:00.000Z', endTimeUtc: '2026-09-25T12:00:00.000Z',
    };
    const { events, unpairedLinear } = mergeEtbonWithLinear([event], linear);
    expect(events[0].note).toBeNull();
    expect(unpairedLinear).toHaveLength(1);
  });

  it('entrega una observación escribible por directo y no duplica la parrilla emparejada', async () => {
    const observations = await collectEitb(new Date('2026-09-25T10:00:00Z'), {
      dateKeys: ['2026-09-25'],
      etbonFetcher,
      fetcher: async () => ({ ok: true, status: 200, text: async () => croRaceLinear }),
      channels: [{ channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1', channel: 'ETB1' }],
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      source: 'eitb', stageNumber: 4, channel: 'EITB', country: 'ES',
      startTimeUtc: '2026-09-25T12:00:00.000Z', note: 'Pasa a ETB1 a las 15:20.',
      broadcastUrl: 'https://etbon.eus/m/txirrindularitza-cro-race-4-17942713',
      writeEligible: true, reviveCapable: true, insertSortOrder: -25,
    });
  });

  it('no invalida la pasada por una parrilla lineal futura aún sin publicar', async () => {
    const events = await collectEitbSchedule({
      dateKeys: ['2026-09-25', '2026-10-01'],
      todayKey: '2026-09-25',
      channels: [{ channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1' }],
      fetcher: async (url) => ({
        ok: true, status: 200,
        text: async () => (url.endsWith('2026-10-01') ? '<html></html>' : croRaceLinear),
      }),
    });
    expect(events).toHaveLength(1);
    await expect(collectEitbSchedule({
      dateKeys: ['2026-09-25'], todayKey: '2026-09-25',
      channels: [{ channelId: 1, station: 'ETB-1', sourceChannel: 'ETB1' }],
      fetcher: async () => ({ ok: true, status: 200, text: async () => '<html></html>' }),
    })).rejects.toThrow(/parrilla reconocible/);
  });
});

describe('emparejamiento y escritura de EITB', () => {
  const day = (overrides) => ({
    raceDayId: 'day', raceId: 'race', dateKey: '2026-08-08', stageNumber: 5,
    name: 'Vuelta a Burgos', nameEn: 'Vuelta a Burgos', gender: 'male', ...overrides,
  });

  it('traduce los nombres de carrera en euskera', () => {
    expect(matchObservation({
      source: 'eitb', dateKey: '2026-08-08', stageNumber: 5,
      title: 'Burgosko itzulia · 5. etapa: Caleruega-Lagunas de Neila (137 km)',
    }, [day()])).toMatchObject({ status: 'matched', raceDayId: 'day' });
    expect(matchObservation({
      source: 'eitb', dateKey: '2026-08-01', stageNumber: null,
      title: 'Txirrindularitza: Donostiako Klasika 2026',
    }, [day({ dateKey: '2026-08-01', stageNumber: null, name: 'Clásica de San Sebastián', nameEn: 'Donostia San Sebastian Klasikoa' })]))
      .toMatchObject({ status: 'matched' });
    expect(matchObservation({
      source: 'eitb', dateKey: '2026-08-07', stageNumber: 7,
      title: 'Emakumezkoen Frantziako Tourra · 7. etapa',
    }, [
      day({ raceDayId: 'women', dateKey: '2026-08-07', stageNumber: 7, name: 'Tour de Francia femenino', nameEn: 'Tour de France Femmes', gender: 'female' }),
      day({ raceDayId: 'men', dateKey: '2026-08-07', stageNumber: 7, name: 'Tour de Francia', nameEn: 'Tour de France' }),
    ])).toMatchObject({ status: 'matched', raceDayId: 'women' });
  });

  const observation = {
    source: 'eitb', sourceUrl: etbonMediaApiUrl('txirrindularitza-cro-race-5-17942714'),
    broadcastUrl: 'https://etbon.eus/m/txirrindularitza-cro-race-5-17942714',
  };
  const row = (overrides) => ({
    id: 'row', country: 'ES', channel: 'EITB', automationLocked: false,
    url: 'https://etbon.eus/m/txirrindularitza-cro-race-5-17942714', ...overrides,
  });

  it('adopta una única fila EITB oficial y respeta un enlace editorial ajeno', () => {
    expect(adoptionCandidate(observation, [], [])).toMatchObject({ status: 'none' });
    expect(adoptionCandidate(observation, [], [row()])).toMatchObject({ status: 'adoptable' });
    expect(adoptionCandidate(observation, [], [row({ channel: 'ETB1' })])).toMatchObject({ status: 'adoptable' });
    expect(adoptionCandidate(observation, [], [row({ url: 'https://www.youtube.com/watch?v=abc' })]))
      .toMatchObject({ status: 'conflict' });
    expect(adoptionCandidate(observation, [], [row({ automationLocked: true })]))
      .toMatchObject({ status: 'manual_lock' });
    expect(adoptionCandidate({ ...observation, broadcastUrl: 'https://www.eitb.eus/es/' }, [], []))
      .toMatchObject({ status: 'invalid_source' });
  });

  it('gestiona solo la nota de relevo lineal y conserva la hora de una emisión iniciada', () => {
    expect(withLinearTransitionNote('Comentarios en euskera. Pasa a ETB1 a las 15:20.', 'Pasa a ETB1 a las 15:30.'))
      .toBe('Comentarios en euskera. Pasa a ETB1 a las 15:30.');
    expect(withLinearTransitionNote('Pasa a ETB1 a las 15:20.', null)).toBeNull();
    const current = {
      id: 'row', sortOrder: -25, note: 'Pasa a ETB1 a las 15:20.', showInRevive: true,
      startTimeUtc: '2026-09-25T12:00:00.000Z', url: observation.broadcastUrl,
    };
    const desired = {
      channel: 'EITB', country: 'ES', startTimeUtc: '2026-09-25T12:03:00.000Z',
      url: observation.broadcastUrl, note: null, showInRevive: true,
    };
    expect(mergeManagedBroadcast(current, desired, 'eitb', new Date('2026-09-25T15:00:00Z')))
      .toMatchObject({ startTimeUtc: '2026-09-25T12:00:00.000Z', note: null, sortOrder: -25 });
    expect(mergeManagedBroadcast(current, desired, 'eitb', new Date('2026-09-25T11:00:00Z')))
      .toMatchObject({ startTimeUtc: '2026-09-25T12:03:00.000Z' });
  });
});
