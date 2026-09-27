import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LEQUIPE_GRID_BASE_URL, LEQUIPE_GUIDE_URL, LEQUIPE_TV_URL, collectLequipe, parseLequipeGrid,
} from '../../scripts/broadcasts-sync/lequipe.mjs';
import { contentHash } from '../../scripts/broadcasts-sync/broadcasts-sync-core.mjs';
import { adoptionCandidate, mergeManagedBroadcast } from '../../scripts/broadcasts-sync/broadcasts-sync.mjs';

const fixture = readFileSync(fileURLToPath(new URL(
  '../../scripts/broadcasts-sync/fixtures/lequipe-grid.json', import.meta.url,
)), 'utf8');

describe('colector aislado de emisiones L\'Équipe TV', () => {
  it('extrae los directos de la chaîne L\'Équipe y convierte Europe/Paris a UTC', () => {
    const events = parseLequipeGrid(fixture);
    expect(events).toHaveLength(3);
    expect(events.find((event) => event.stageNumber === 1)).toMatchObject({
      source: 'lequipe', channel: 'L\'Équipe TV', country: 'FR',
      dateKey: '2026-09-16', startTimeUtc: '2026-09-16T14:30:00.000Z',
      broadcastUrl: LEQUIPE_TV_URL, sourceUrl: LEQUIPE_GUIDE_URL,
      sourceChannel: 'la chaine L\'Équipe', reviveCapable: false, insertSortOrder: 10,
    });
    expect(events.find((event) => event.stageNumber === 5)).toMatchObject({
      dateKey: '2026-09-20', startTimeUtc: '2026-09-20T13:15:00.000Z',
    });
  });

  it('numera las etapas con ordinal francés y descarta no directos, otros canales, otros deportes y estudios', () => {
    const events = parseLequipeGrid(fixture);
    expect(events.map((event) => event.stageNumber)).toEqual([1, 2, 5]);
    expect(events.some((event) => event.title.includes('frotter'))).toBe(false);
    const preview = {
      date: '2026-10-03T12:50:00+02:00', channel_slug: 'la-chaine-l-equipe', sport_slug: 'cyclisme-sur-route',
      title: 'Avant-course', summary: "Championnats d'Europe", is_live: true,
    };
    expect(parseLequipeGrid({ items: [preview] })).toEqual([]);
  });

  it('mantiene la identidad aunque L\'Équipe intercambie título y resumen', () => {
    const item = {
      __type: 'tv_guide_schedule_item',
      date: '2026-09-18T16:30:00+02:00',
      channel_slug: 'la-chaine-l-equipe',
      sport_slug: 'cyclisme-sur-route',
      title: '3e étape : Wiltz - Diekirch (187,3 km)',
      summary: 'Tour de Luxembourg',
      is_live: true,
    };
    const swapped = { ...item, title: item.summary, summary: item.title };
    const [direct] = parseLequipeGrid(JSON.stringify({ items: [item] }));
    const [reverse] = parseLequipeGrid(JSON.stringify({ items: [swapped] }));
    expect(direct.externalEventId).toBe(reverse.externalEventId);
    expect(direct.externalEventId).toBe(contentHash('2026-09-18|3|tour de luxembourg').slice(0, 32));
  });

  it('trata las carreras de un día sin etapa y construye la URL de parrilla diaria', () => {
    const oneDay = {
      __type: 'tv_guide_schedule_item',
      date: '2026-09-16T15:30:00+02:00',
      channel_slug: 'la-chaine-l-equipe',
      sport_slug: 'cyclisme-sur-route',
      title: 'Grand Prix de Wallonie (BEL)',
      summary: 'Cyclisme sur route',
      is_live: true,
    };
    const [event] = parseLequipeGrid(JSON.stringify({ items: [oneDay] }));
    expect(event.stageNumber).toBeNull();
    expect(event.externalEventId).toBe(contentHash('2026-09-16|one-day|grand prix de wallonie bel').slice(0, 32));
    expect(new URL(`${LEQUIPE_GRID_BASE_URL}/20260916`).href).toBe(`${LEQUIPE_GRID_BASE_URL}/20260916`);
  });

  it('valida la envoltura de la parrilla', () => {
    expect(() => parseLequipeGrid('{}')).toThrow(/parrilla no utilizable/);
  });

  it('recorre la ventana operativa, normaliza a minuto y tolera parrillas futuras sin publicar', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.endsWith('20260916')) return JSON.parse(fixture);
      if (url.endsWith('20260915')) return { items: [] };
      throw Object.assign(new Error('sin parrilla'), { status: 404 });
    };
    const observations = await collectLequipe(new Date('2026-09-16T10:00:00Z'), { fetcher });
    expect(calls).toHaveLength(10);
    expect(calls[0]).toContain('/20260915');
    expect(calls.at(-1)).toContain('/20260924');
    expect(observations.find((item) => item.stageNumber === 1)).toMatchObject({
      writeEligible: true, startTimeUtc: '2026-09-16T14:30:00.000Z', sourceHash: expect.any(String),
    });
  });

  it('registra una ventana sin ciclismo como diagnóstico y no como fallo', async () => {
    const diagnostics = [];
    const observations = await collectLequipe(new Date('2026-11-02T10:00:00Z'), {
      fetcher: async () => ({ items: [] }),
      diagnostics,
    });
    expect(observations).toEqual([]);
    expect(diagnostics).toEqual([
      { source: 'lequipe', action: 'no_cycling_events', sourceUrl: LEQUIPE_GUIDE_URL },
    ]);
  });

  it('adopta una única fila L\'Équipe TV oficial y conserva su nota editorial', () => {
    const observation = {
      source: 'lequipe',
      sourceUrl: LEQUIPE_GUIDE_URL,
      broadcastUrl: LEQUIPE_TV_URL,
    };
    const desired = [{ channel: 'L\'Équipe TV', country: 'FR' }];
    expect(adoptionCandidate(observation, desired, [{
      id: 'lequipe', channel: 'L\'Équipe TV', country: 'FR', url: LEQUIPE_TV_URL,
    }])).toMatchObject({ status: 'adoptable' });
    expect(adoptionCandidate(observation, desired, [{
      id: 'lequipe', channel: 'L\'Équipe TV', country: 'FR', url: 'https://example.com/stream',
    }])).toMatchObject({ status: 'none' });
    expect(adoptionCandidate(observation, desired, [{
      id: 'lequipe', channel: 'L\'Équipe TV', country: 'FR', url: LEQUIPE_TV_URL, automationLocked: true,
    }])).toMatchObject({ status: 'manual_lock' });
    expect(mergeManagedBroadcast({
      id: 'lequipe', sortOrder: 3, note: 'En abierto en Francia.', url: LEQUIPE_TV_URL,
    }, {
      channel: 'L\'Équipe TV', country: 'FR', startTimeUtc: '2026-09-16T14:30:00.000Z',
      url: LEQUIPE_TV_URL, note: null,
    }, 'lequipe')).toMatchObject({ sortOrder: 3, note: 'En abierto en Francia.' });
  });
});
